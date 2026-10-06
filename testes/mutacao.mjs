// ═══════════════════════════════════════════════════════════════════════════
// mutacao.mjs — prova de que os gates do projeto medem o que dizem medir.
//
// Uso:
//   node mutacao.mjs                 todas as famílias, saída por família
//   node mutacao.mjs --rapido        só as mais baratas (sem as de 3.000 casos)
//   node mutacao.mjs render conf     só as famílias cujo nome casa com "render"
//   node mutacao.mjs --so=confmedio  só a família indicada
//
// Sai com 0 se TODA mutação morre, 1 se alguma passa (gate cego).
//
// ── por que isto é versionado ────────────────────────────────────────────────
// O projeto mede o próprio comportamento em quatro lugares (regressão executa
// os renders de XML, executa o leitor de PDF, roda num clone limpo; a bancada
// compara contra gabarito). A PROVA de que esses gates têm dente é a mutação:
// cada correção volta ao estado errado e o gate tem de reprovar. Sem esse
// arquivo, a afirmação "os 61 sinks morrem" vivia só no README — não auditável
// por quem chega depois, e o número envelhecia sem ninguém ver.
//
// A lição quejustify o arquivo: um gate que passa com o defeito é pior do que
// nenhum gate, porque treina a equipe a confiar nele. Foi o que aconteceu com o
// gate de render (fixture escrita à mão) e com o do `cnpjsNoTexto` (`i++` fixo
// na forma do laço). Cada família aqui tem um caso de equivalência que NÃO
// pode reprovar — senão o harness passa a exigir uma implementação específica.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const IDX = path.join(RAIZ, 'index.html');
const REG = path.join(RAIZ, 'testes', 'regressao.mjs');

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith('--' + nome + '='));
  return a ? a.slice(nome.length + 3) : padrao;
};
/* O filtro aceita as duas formas: `mutacao.mjs render` (posicional, o jeito que
   se digita) e `--so=render`. A primeira versão só lia `--so=`, então o
   `node mutacao.mjs render` documentado no cabeçalho rodava as CINCO famílias
   e saía verde sem querer. Interface é gate: uma flag que não filtra é um
   filtro que não existe. */
const SO = arg('so', process.argv.slice(2).find((x) => !x.startsWith('--') && !['rapido', 'todos'].includes(x)) || '');
const RAPIDO = process.argv.includes('--rapido') || process.argv.includes('rapido');
const TODOS = process.argv.includes('--todos') || process.argv.includes('todos');
const html = fs.readFileSync(IDX, 'utf8');
const NL = html.includes('\r\n') ? '\r\n' : '\n';

/* A regra do jogo: uma mutação SOBE um `ok()` para vermelho. O `ok` do regressão
   conta falhas e sai com código 1, então basta o código de saída.

   Um caso conta como morto quando a contagem de reprovadas sobe — não quando o
   regressão sai diferente. Medido: com o gate do render, 1 mutação matava 5
   asserções de uma vez; comparar "passou/falhou" perderia informação que o
   relatório usa. */
function roda() {
  let out = '';
  try { out = execFileSync('node', [REG], { encoding: 'utf8', cwd: RAIZ }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const m = out.match(/REGRESSÃO: (\d+) passaram, (\d+) falharam/);
  const p = m ? +m[1] : -1;
  const f = m ? +m[2] : -1;
  const falhou = (out.split('FALHAS:')[1] || '').split('\n')
    .map((l) => l.trim()).filter((l) => l.startsWith('✗'))
    .map((l) => l.slice(1, 96));
  /* `f < 0` é "não rodou", e a primeira linha da saída é o sintoma (SyntaxError
   do fonte mutado, ENOENT de um arquivo, etc.). */
  return { p, f, falhou, ok: f === 0, aviso: m ? '' : out.trim().split('\n').slice(0, 2).join(' | ').slice(0, 160) };
}

function aplica(trocas, base) {
  let src = base !== undefined ? base : fs.readFileSync(IDX, 'utf8');
  for (const [de, para] of trocas) {
    if (!src.includes(de)) return { erro: 'trecho não encontrado: ' + JSON.stringify(de.slice(0, 60)) };
    src = src.split(de).join(para);
  }
  return { src };
}
const L = (s) => s.split('\n').join(NL);

// ═══════════════════════════════════════════════════════════════════════════
// As famílias
// ═══════════════════════════════════════════════════════════════════════════
/* Um sintético declarado e ÓRFÃO, para o gate de órfão reprovar. O literal é
   CONSTRUÍDO em runtime, e isso é a regra que fecha o bug: este harness é
   `git ls-files`, entra no gate anti-vazamento, e um CNPJ escrito à mão aqui
   viraria exatamente o que o `3a3209d` consertou — o clone passaria a reprovar
   com o arquivo que existe para provar que o clone não reprova. (Foi o que
   aconteceu na primeira versão: clone 555/1, e o próprio `npm run mutacao`
   saía 1 com `GATE CEGO :: clone`.) O par [DV que fecha, DV que não fecha]
   sai do `vC` do app — nenhum número escrito à mão em lugar nenhum. */
function cnpjSintetico(base13) {
  const vcsrc = html.match(/function vC\(c\)\{[\s\S]*?\n\}/)[0];
  const sb = { d: (s) => (s || '').replace(/\D/g, '') };
  vm.createContext(sb);
  vm.runInContext(vcsrc, sb);
  const vC = vm.runInContext('vC', sb);
  let comDv = null, semDv = null;
  for (let a = 0; a < 10 && !(comDv && semDv); a++) {
    for (let b = 0; b < 10 && !(comDv && semDv); b++) {
      const c = base13 + a + b;
      if (vC(c) && !comDv) comDv = c;
      if (!vC(c) && !semDv) semDv = c;
    }
  }
  return { comDv, semDv };
}

const FAMILIAS = [

  // ── 1 · RENDER XML: o `esc` de um campo volta a ser cru ────────────────────
  {
    nome: 'render',
    titulo: 'RENDER XML — dado de arquivo no DOM',
    fonte: 'deriva os sinks do FONTE dos 4 renders, como o grupo 15',
    casos: () => {
      const ini = html.indexOf('function cellsTable(');
      const fim = html.indexOf('// ═══ EVENT DELEGATION', html.indexOf('function renderNFSe('));
      const bloco = html.slice(ini, fim);
      /* Só as interpolações cujo embrulho é `esc(` — é o que este gate
         é responsible por saber; as de `moeda`/`pct`/`formatoBr` passam por
         formatador que já foi verificado. */
      const alvos = [];
      for (const m of bloco.matchAll(/\$\{([^}]*)\}/g)) {
        const expr = m[1].trim();
        if (!/\b[pn]\.[A-Za-z_]/.test(expr)) continue;
        if (!/^esc\(/.test(expr)) continue;
        alvos.push({ expr, sem: expr.slice(4, -1) });
      }
      /* `g.` entra pelo mesmo motivo do grupo 15: o rodapé do NF-e lê
         `g.itens[0].Arquivo_Origem`, e um filtro só de `p.`/`n.` o deixaria
         de fora — que era o bug que a derivação do grupo 15 já pegou. */
      const comG = [];
      for (const m of bloco.matchAll(/\$\{([^}]*)\}/g)) {
        const expr = m[1].trim();
        if (!/\bg\./.test(expr) || !/^esc\(/.test(expr)) continue;
        comG.push({ expr, sem: expr.slice(4, -1) });
      }
      for (const a of comG) if (!alvos.some((x) => x.expr === a.expr)) alvos.push(a);
      /* Uma de cada sete por padrão: a lista toda custa minutos e o que
         importa é que TODA interpolação com `esc` seja mutável. `--todos` roda
         a lista inteira, e é o número que o README não publica. */
      const lista = TODOS ? alvos : alvos.filter((a, i) => i % 7 === 0);
      return lista.map((a) => ({
        nome: a.expr.replace(/\s+/g, ' ').slice(0, 54),
        trocas: [[a.expr, a.sem]],
        espero: 'reprovar',
      })).concat([{
        nome: 'cellsTable valor cru (o sink de ~45 células de imposto)',
        trocas: [[L('<td>${esc(c[1])}</td>'), L('<td>${c[1]}</td>')]],
        espero: 'reprovar',
      }, {
        nome: 'dataBr sem esc (truncar sem escapar abre tag)',
        trocas: [['return esc(String(d).slice(0,10))', 'return String(d).slice(0,10)']],
        espero: 'reprovar',
      }]);
    },
  },

  // ── 2 · LEITOR DE PDF: a confiança e a varredura ───────────────────────────
  {
    nome: 'conf',
    titulo: 'LEITOR DE PDF — confiança ponderada pela chave',
    fonte: 'a chave pesa zero sem `chaveValida`; a confiança crua continua na auditoria',
    casos: () => [
      {
        nome: 'a chave volta a pesar o DV (a dívida que o passeio queria fechar)',
        trocas: [['const pesoChave=r.chaveValida?(r.chaveConf||0):0;', 'const pesoChave=(r.chaveConf||0);']],
        espero: 'reprovar',
      },
      {
        nome: 'o peso da chave some de vez (média inteiramente crua)',
        trocas: [['const pesoChave=r.chaveValida?(r.chaveConf||0):0;', 'const pesoChave=0;']],
        espero: 'reprovar',
      },
      {
        nome: 'a auditoria da média crua some (`confMedioComChaveInvalida`)',
        trocas: [['r.confMedioComChaveInvalida=Math.round(((r.chaveConf||0)+(r.cnpjConf||0)+(r.numeroConf||0))/3);', '']],
        espero: 'reprovar',
      },
    ],
  },

  {
    nome: 'cnpj',
    titulo: 'LEITOR DE PDF — cnpjsNoTexto sem varredura quadrática',
    fonte: 'dois ponteiros em vez de `spans.some` por candidato; inclui um CONTROLE',
    casos: () => [
      {
        nome: 'volta o `spans.some` por candidato (o O(n²))',
        trocas: [[
          L('    while(i<spans.length&&spans[i][1]<ini) i++;\n    if(i<spans.length&&spans[i][0]<=ini&&fim<=spans[i][1]) continue;'),
          L('    if(spans.some(([a,b])=>ini>=a&&fim<=b)) continue;'),
        ]],
        espero: 'reprovar',
      },
      {
        nome: 'tira o `while` (span que já passou é reaproveitado errado)',
        trocas: [[L('    while(i<spans.length&&spans[i][1]<ini) i++;\n'), '']],
        espero: 'reprovar',
      },
      {
        nome: 'o `while` anda de 2 em 2 (pula span)',
        trocas: [['while(i<spans.length&&spans[i][1]<ini) i++;', 'while(i<spans.length&&spans[i][1]<ini) i+=2;']],
        espero: 'reprovar',
      },
      {
        nome: 'o `while` nunca avança',
        trocas: [['while(i<spans.length&&spans[i][1]<ini) i++;', 'while(false&&i<spans.length) i++;']],
        espero: 'reprovar',
      },
      {
        nome: 'borda esquerda `[0]<=` vira `[0]<`',
        trocas: [['spans[i][0]<=ini&&fim<=spans[i][1]', 'spans[i][0]<ini&&fim<=spans[i][1]']],
        espero: 'reprovar',
      },
      {
        nome: 'borda direita `fim<=` vira `fim<`',
        trocas: [['spans[i][0]<=ini&&fim<=spans[i][1]', 'spans[i][0]<=ini&&fim<spans[i][1]']],
        espero: 'reprovar',
        caro: true,
      },
    ],
    controles: [
      {
        nome: 'CONTROLE: `i++` → `i+=1` é equivalente e NÃO pode reprovar',
        trocas: [['spans[i][1]<ini) i++;', 'spans[i][1]<ini) i+=1;']],
        espero: 'passar',
        motivo: 'gate que fixa a FORMA do laço reprova correção sem comportamento',
      },
    ],
  },

  // ── 3 · PRIVACIDADE: o gate anti-vazamento ──────────────────────────────────
  {
    nome: 'privacidade',
    titulo: 'PRIVACIDADE — o gate anti-vazamento tem dente',
    fonte: 'um CNPJ real de DV válido tem de reprovar, com e sem gabarito',
    casos: async () => {
      /* Um CNPJ de DV válido, gerado com o PROPRIO `vC` do app: reimplementar
         o módulo 11 para auditar um módulo 11 cria uma segunda fonte de
         verdade — e a minha primeira versão errava a base e devolvia
         "não achei nenhum válido", que parece falha do gate. */
      const vcsrc = html.match(/function vC\(c\)\{[\s\S]*?\n\}/)[0];
      const sb = { d: (s) => (s || '').replace(/\D/g, '') };
      vm.createContext(sb);
      vm.runInContext(vcsrc, sb);
      const vC = vm.runInContext('vC', sb);
      let real = null;
      for (let a = 0; a < 10 && !real; a++) {
        for (let b = 0; b < 10 && !real; b++) {
          const c = '98765432000' + '1' + a + b;
          if (c.length === 14 && vC(c)) real = c;
        }
      }
if (!real) return [];
      /* O par é [de, para] como os outros: um índice não é um trecho, e
         `split(índice)` trocava a mutação por lixo — o harness escrevia
         `index.html` corrompido e o `restaura` seguinte devolvia o arquivo
         certo, mas o "clone reprova" que veio depois era da corrupção. */
      const marca = '// ═══ RENDER NF-e (COMPLETO) ═══';
      return [{
        nome: 'um CNPJ de DV válido (não declarado) citado em comentário do index.html',
        trocas: [[marca, '// prestador ' + real + '.\n' + marca]],
        espero: 'reprovar',
      }];
    },
  },

  // ── 4 · CLONE LIMPO ───────────────────────────────────────────────────────
  {
    nome: 'clone',
    titulo: 'CLONE LIMPO — a regressão passa sem verdade.json',
    fonte: 'a lista de sintéticos é o que segura o clone; órfão nela é esconderijo',
    casos: () => {
      const { comDv, semDv } = cnpjSintetico('987654320002');
      if (!comDv || !semDv) return [];
      const masc = comDv.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
      return [{
        nome: 'um sintético declarado que não existe no fonte (a lista infla sozinha)',
        arquivo: REG,
        trocas: [[
          /const SINT = new Set\(\[[\s\S]*?\]\);/,
          "const SINT = new Set(['" + masc + "', '" + semDv + "', '00000000000000', '11222333000181']);",
        ]],
        esperaRegex: true,
        espero: 'reprovar',
      }];
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// Execução
// ═══════════════════════════════════════════════════════════════════════════
function restaura(arquivo, original) {
  fs.writeFileSync(arquivo, original, 'utf8');
}

async function main() {
  const originais = new Map();
  SALVOS = originais;
  /* Cada mutação é gravada a partir do ORIGINAL lido aqui, não do que está em
     disco. Ler o arquivo mutado de novo (o que a primeira versão fazia) meant
     que duas mutações seguidas compunham: a segunda partia da primeira, e o
     `restaura` no fim devolvia o original — mas durante a corrida a suíte
     media um fonte que nunca existiu. */
  const pega = (f) => { if (!originais.has(f)) originais.set(f, fs.readFileSync(f, 'utf8')); return originais.get(f); };
  pega(IDX); pega(REG);

  const base = roda();
  if (!base.ok) {
    console.log('O SOURCE ESTÁ VERMELHO antes de mutar — não dá para medir os gates:');
    base.falhou.forEach((f) => console.log('  ✗ ' + f));
    process.exit(1);
  }
  const P0 = base.p;
  console.log(`base: ${P0} asserções, 0 falha(s)\n`);

  const alvo = FAMILIAS.filter((f) => !SO || f.nome.includes(SO));
  if (!alvo.length) { console.log('nenhuma família casa com "' + SO + '". Disponíveis: ' + FAMILIAS.map((f) => f.nome).join(', ')); process.exit(1); }

  let total = 0, mortos = 0, controlesOk = 0, controlesN = 0, gatesCegos = [], harnessQuebrou = [];

  for (const fam of alvo) {
    console.log('══ ' + fam.titulo);
    console.log('   ' + fam.fonte + '\n');
    const casos = await fam.casos();
    for (const c of casos.concat(fam.controles || [])) {
      if (RAPIDO && c.caro) { console.log('   – ' + c.nome + '  (pulado: --rapido)'); continue; }
      const arquivo = c.arquivo || IDX;
      const original = pega(arquivo);
      /* A mutação é montada a partir do ORIGINAL, sempre — inclusive no ramo
         de string. A primeira versão relia do disco, e o invariante "toda
         mutação parte do original" só se sustentava como efeito colateral do
         `restaura` da iteração anterior: se uma família falhasse no meio, a
         seguinte media lixo e o culpado era o gate errado. */
      if (!fs.existsSync(arquivo)) { console.log('   !! arquivo ausente: ' + arquivo); continue; }
      let mutado;
      if (c.trocas[0][0] instanceof RegExp) {
        if (!c.trocas[0][0].test(original)) { console.log('   !! não encontrado: ' + c.nome); continue; }
        mutado = original.replace(c.trocas[0][0], c.trocas[0][1]);
      } else {
        const r = aplica(c.trocas, original);
        if (r.erro) { console.log('   !! ' + r.erro + '  [' + c.nome + ']'); continue; }
        mutado = r.src;
      }
      fs.writeFileSync(arquivo, mutado, 'utf8');
      const r = roda();
      /* O arquivo volta ao original ANTES da próxima mutação, e também se a
         regressão estourar: uma família que deixa o fonte mutado contamina as
         seguintes e o relatório final culpa o gate errado. */
      restaura(arquivo, original);
      /* Três estados, não dois: `f < 0` é "a suíte NÃO RODOU" (o fonte mutado nem
         compilou, ou o harness quebrou), e isso é reprovação do HARNESS, não um
         gate que passou. Tratar "não rodou" como "não falhou" já denunciou um
         gate cego que era um fonte quebrado. */
      if (r.f < 0) {
        harnessQuebrou.push(fam.nome + ' :: ' + c.nome);
        console.log(`   ✗ NÃO RODOU  ${c.nome}` + (r.aviso ? '\n       ' + r.aviso : ''));
        continue;
      }
      total++;
      if (c.espero === 'passar') {
        controlesN++;
        if (r.ok) controlesOk++;
        else console.log(`   ✗ CONTROLE REPROVOU  ${c.nome}\n       ${c.motivo || ''}`);
        continue;
      }
      /* A mutação matou se alguma asserção ficou VERMELHA. Comparar só "passou ou
         falhou" é mais frágil: uma mutação pode até trocar uma falha por outra
         (o arquivo fica vermelho dos dois jeitos, mas por outro motivo). A
         asserção que reprovou é a primeira da lista de falhas. */
      const morreu = r.f > 0;
      if (morreu) mortos++;
      else gatesCegos.push(fam.nome + ' :: ' + c.nome);
      const detalhe = morreu && r.falhou[0] ? '\n       ' + r.falhou[0] : '';
      console.log(`   ${morreu ? 'morre' : 'NEUTRO'}  ${c.nome}` + detalhe);
    }
    console.log('');
  }

  /* O clone limpo é um ambiente DIFERENTE (sem verdade.json), então roda os
     mesmos casos lá — é onde o gate 2.B da família privacidade é exercitado
     de verdade, e onde a lista de sintéticos decide. */
  console.log('── no clone limpo (sem verdade.json) ──');
  /* `mkdtempSync` e NÃO um caminho fixo: duas instâncias em paralelo (CI, dois
     terminais) apagavam a mesma pasta uma da outra e escreviam no mesmo
     `index.html`. */
  const CLONE = fs.mkdtempSync(path.join(process.env.TEMP || '.', 'gcon-clone-limpo-'));
  execFileSync('git', ['clone', '-q', '--no-hardlinks', '--local', RAIZ, CLONE], { encoding: 'utf8' });
  for (const f of execFileSync('git', ['ls-files'], { cwd: RAIZ, encoding: 'utf8' }).split('\n').filter(Boolean)) {
    const dest = path.join(CLONE, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(RAIZ, f), dest);
  }
  const rodaClone = () => {
    let out = '';
    try { out = execFileSync('node', [path.join(CLONE, 'testes', 'regressao.mjs')], { encoding: 'utf8', cwd: CLONE }); }
    catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
    const m = out.match(/REGRESSÃO: (\d+) passaram, (\d+) falharam/);
    return { p: m ? +m[1] : -1, f: m ? +m[2] : -1 };
  };
  const cb = rodaClone();
  console.log(`   clone sem gabarito: ${cb.p} asserções, ${cb.f} falha(s)`
    + (cb.f === 0 ? '  ✓ a promessa do README se verifica' : '  ✗ o clone reprova'));
  /* `f < 0` aqui é o MESMO sinal: um clone que não rodou não é um clone que
     passou. */
  if (cb.f < 0) harnessQuebrou.push('clone :: a regressão nem rodou no clone');
  else if (cb.f !== 0) gatesCegos.push('clone :: a regressão passa em clone limpo');
  fs.rmSync(CLONE, { recursive: true, force: true });

  console.log('═'.repeat(64));
  console.log(`mutações: ${mortos}/${total} morreu(m)`
    + (controlesN ? `   controles: ${controlesOk}/${controlesN} passou(m)` : '')
    + (harnessQuebrou.length ? `   harness quebrou: ${harnessQuebrou.length}` : ''));
  const temCego = gatesCegos.length > 0 || (controlesN > 0 && controlesOk < controlesN) || harnessQuebrou.length > 0;
  if (temCego) {
    console.log('\nGATE CEGO (passou com o defeito, ou reprovou o equivalente):');
    gatesCegos.forEach((g) => console.log('  ✗ ' + g));
    if (harnessQuebrou.length) {
      console.log('\nHARNESS QUEBROU (isto não é gate cego, é o instrumento):');
      harnessQuebrou.forEach((g) => console.log('  ✗ ' + g));
    }
  }
  console.log(temCego ? 'FALHA — um gate não mede o que diz medir' : 'OK — todo gate tem dente');
  process.exit(temCego ? 1 : 0);
}

/* Toda saída — inclusive Ctrl+C e exceção — devolve os arquivos. Um harness
   que deixa o `index.html` mutado é pior do que não rodar: o próximo
   `npm test` mede um fonte que ninguém commitou. */
let SALVOS = null;
function segura() {
  if (!SALVOS) return;
  for (const [f, txt] of SALVOS) { try { fs.writeFileSync(f, txt, 'utf8'); } catch (e) { /* disco cheio etc. */ } }
}
process.on('exit', segura);
for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { segura(); process.exit(130); });

main().catch((e) => {
  console.error('erro no harness: ' + e.message);
  process.exit(2);
});