// Regressão estrutural do GCON/SIAN — SEM OCR, SEM browser, ~1 s.
// Uso: node regressao.mjs   (exit != 0 se algo falhar)
//
// Cobre o que a bancada de PDF (rodar.mjs) NÃO alcança: a bancada fatia o index.html
// do marcador do ModPDFIsolado até o primeiro </script>, ou seja, tudo que vem DEPOIS
// do fim desse módulo (tema, sprite, CSS, acessibilidade, CDNs, separador, CNPJ) é
// estruturalmente invisível para ela. Aqui essa parte é auditada de verdade.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
/* O gate anti-vazamento lê `git ls-files`: a lista de publicação é o índice do
   git, não uma lista escrita à mão aqui — que foi exatamente como o segundo
   vazamento escapou (o primeiro estava no index.html, o seguinte em testes/). */
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

let passou = 0, falhou = 0;
const falhas = [];
function ok(nome, cond, detalhe) {
  if (cond) { passou++; return true; }
  falhou++; falhas.push(nome + (detalhe ? ' — ' + detalhe : ''));
  return false;
}
const grupo = (n) => console.log('\n' + n);

// ══════════════════════════════════════════════════════════════
grupo('1 · SINTAXE');
// ══════════════════════════════════════════════════════════════
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok('existe ao menos 3 bloco(s) inline', scripts.length >= 3, 'achou ' + scripts.length);
scripts.forEach((code, i) => {
  if (!code.trim()) return;
  let erro = '';
  try { new vm.Script(code, { filename: 'inline#' + (i + 1) }); } catch (e) { erro = e.message; }
  ok('bloco inline #' + (i + 1) + ' compila', !erro, erro);
});

/* ---------- 1.1 nenhuma função declarada duas vezes no mesmo script ----------
   Em script sloppy a última declaração de um function statement vence. Duas
   funções homônimas na mesma IIFE significam que todo call site da primeira
   está chamando a segunda em silêncio — foi assim que o filtro do painel
   morreu (marcar de filtro x marcar de estado) com o gate verde, porque o
   gate só contava texto. Este é o gate genérico que pega essa classe. */
{
  const fontes = scripts.map((code, i) => ({ i, code })).filter(f => f.code.trim());
  fontes.forEach(({ i, code }) => {
    const nomes = new Map();
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      const n = m[1];
      if (nomes.has(n)) nomes.set(n, nomes.get(n) + 1); else nomes.set(n, 1);
    }
    const dup = [...nomes].filter(([, c]) => c > 1).map(([n, c]) => n + '×' + c);
    ok('inline #' + (i + 1) + ': nenhuma função declarada duas vezes', dup.length === 0, dup.join(','));
  });
  // A checagem acima é por bloco; o mesmo nome em IIFEs diferentes é legal e
  // o acima não acusa. Confirma que o detector enxerga duplicata de verdade
  // (senão um gate que nunca falha é pior do que nenhum).
  const sentinela = 'function a(){}\nfunction b(){}\nfunction a(){}\n';
  const nomesS = new Map();
  for (const m of sentinela.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    nomesS.set(m[1], (nomesS.get(m[1]) || 0) + 1);
  }
  ok('o detector de duplicata realmente detecta (auto-teste do gate)',
    [...nomesS].filter(([, c]) => c > 1).map(([n]) => n).join(',') === 'a');
}

// ══════════════════════════════════════════════════════════════
grupo('2 · SEGURANÇA (bloqueios da revisão de segurança)');
// ══════════════════════════════════════════════════════════════
const consoles = [...html.matchAll(/console\.(log|warn|error)/g)];
ok('nenhum console.log/warn/error', consoles.length === 0, 'achou ' + consoles.length);
ok('nenhum window._lastOCRDebug (vaza texto do PDF)', !/window\._lastOCRDebug/.test(html));
ok('nenhum outline:none / outline:0', !/outline\s*:\s*(none|0)\b/.test(html));
ok('nenhum segredo hardcoded', !/(api[_-]?key|secret|token|password).{0,20}=["'][^"'\s]+/i.test(html));
ok('esc() vive no escopo do script (não dentro de IIFE)', /function ESC\(/.test(html) && /const esc=ESC;/.test(html));
ok('esc() escapa aspas simples e duplas (atributos)', /replace\(\/"\/g,'&quot;'\)/.test(html) && /&#39;/.test(html));
ok('resposta de API externa é escapada no render (escProfundo existe e é usado lá)',
  /function escProfundo\(/.test(html) && /dados=escProfundo\(dados\)/.test(html));
ok('aviso de localStorage presente (LGPD)', /id="cnpj-privacidade"/.test(html));
ok('cache de CNPJ tem TTL', /CACHE_TTL\s*=/.test(html));
// O cache precisa de tratamento dedicado de cota. O try/catch da escrita mora
// em ARM.gravar e a política de liberação de espaço em gravarCache: os dois
// precisam existir, senão a falha de quota engole o erro e o cache para de
// funcionar em silêncio (o sintoma "só funciona em outro navegador").
ok('escrita do cache tem try/catch dedicado (quota)', /gravar\(k,v\)\{try\{localStorage\.setItem/.test(html));
ok('cache libera espaço quando a cota estoura', /function gravarCache[\s\S]{0,900}cacheEntradas\(\)/.test(html) && /function gravarCache[\s\S]{0,1400}ARM\.apagar\(/.test(html));
ok('cache degradado é reportado (não some em silêncio)', /ARM\.bloq=true/.test(html) && /cacheResumo/.test(html));
ok('ReDoS: PADROES_SEP sem \s* adjacentes', !/const PADROES_SEP[\s\S]*?\];/.exec(html)[0].includes('\\s*'));

/* ── Dado fiscal real não pode entrar em NENHUM arquivo versionado ────
   `git check-ignore` prova que o ARQUIVO da cliente não está no índice; não
   prova que o DADO não foi copiado para dentro de um arquivo versionado. E o
   dado fiscal não é só CNPJ: chave de acesso (44) e protocolo de autorização
   (15) identificam nota e operação tanto quanto o CNPJ identifica empresa.

   O escopo é `git ls-files`, não uma lista escrita à mão — porque o segundo
   vazamento (protocolo + natureza de operação, achado na revisão de segurança depois do
   push) entrou por `testes/regressao.mjs`, um arquivo que a primeira versão do
   gate não olhava. Sem verdade.json — clone novo — o gate cai na lista de
   sintéticos e NÃO reprova o fonte correto: falhar sem gabarito treina a
   equipe a ignorar a falha. */
{
  const VERDADE = path.join(RAIZ,'testes','verdade.json');
  /* Versionados, lidos do índice do git — o mesmo que o GitHub Pages publica. */
  const versionados = execFileSync('git', ['ls-files'], { cwd: RAIZ, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => /\.(html|mjs|cjs|md|json|js|css)$/.test(f));
  const brutos = [];
  for (const f of versionados) {
    const p = path.join(__dirname, '..', f);
    if (!fs.existsSync(p)) continue;
    try { brutos.push([f, fs.readFileSync(p, 'utf8')]); } catch (e) { /* binário */ }
  }
  const achouEm = (re) => {
    const out = new Map();
    for (const [f, txt] of brutos) {
      for (const m of txt.matchAll(re)) out.set(m[0], f);
    }
    return out;
  };
  /* CNPJ: mascarado e cru de 14. O cru usa borda que não seja dígito NEM
     ponto-final — sem o ponto, "prestador 11222333000181." (fim natural de uma
     frase em comentário) escapava; o ponto está ali para não contar
     "45.932.889/0002" atravessando a máscara. */
  const cnpjMasc = achouEm(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g);
  /* O ponto está no LOOKAHEAD para não contar "45.932.889/0002" atravessando
      a máscara. Mas o ponto-final também é fim natural de frase em comentário
      — e foi por um "prestador <CNPJ>." escrito assim que o dado real da
      cliente escapou (não repito o número aqui: citar o dado real na
      comentário que explica o vazamento seria um terceiro vazamento). Com
      (?![\d.]) o gate era cego para o caso que mais importa: dado real citado
      dentro de um comentário, que é publicado como o resto. O ponto na borda
      esquerda continua protegendo a máscara; o da direita, não: 14 dígitos
      não-mascarados logo após ponto ou espaço são um CNPJ, não um fragmento
      de máscara. */
  const cnpjCru = achouEm(/(?<![\d.])\d{14}(?![\d])/g);
  const chave44 = achouEm(/(?<![\d.])\d{44}(?![\d])/g);
  const protocolo = achouEm(/(?<![\d.])\d{15}(?![\d])/g);
  /* CNPJ alfanumérico (NT 2026.004): letra A-Z nas 12 primeiras posições e DV
     numérico; na chave, letra só nas posições 7-18. Os coletores acima só veem
     dígito, então um CNPJ ou uma chave alfanumérica real escaparia do gate.
     Entram nos MESMOS mapas (a mesma allowlist decide), mas só quando têm letra
     — o numérico já foi contado — e, no cru, só quando o DV fecha: sem isso todo
     identificador de código em maiúscula com 2 dígitos no fim viraria "CNPJ". */
  const dvAlfaFecha = (c14) => {
    const dv = (s) => {
      let r = 0;
      for (let i = 0; i < s.length; i++) r += (s.charCodeAt(s.length - 1 - i) - 48) * (2 + (i % 8));
      const x = r % 11;
      return x < 2 ? 0 : 11 - x;
    };
    const b12 = c14.slice(0, 12);
    const d1 = String(dv(b12));
    return c14 === b12 + d1 + String(dv(b12 + d1));
  };
  const temLetra = (s) => /[A-Z]/.test(s);
  for (const [k, f] of achouEm(/(?<![0-9A-Za-z])[0-9A-Z]{2}\.[0-9A-Z]{3}\.[0-9A-Z]{3}\/[0-9A-Z]{4}-\d{2}(?![0-9A-Za-z])/g)) {
    if (temLetra(k)) cnpjMasc.set(k, f);
  }
  for (const [k, f] of achouEm(/(?<![0-9A-Za-z.])[0-9A-Z]{12}\d{2}(?![0-9A-Za-z])/g)) {
    if (temLetra(k) && dvAlfaFecha(k)) cnpjCru.set(k, f);
  }
  for (const [k, f] of achouEm(/(?<![0-9A-Za-z.])\d{6}[0-9A-Z]{12}\d{26}(?![0-9A-Za-z])/g)) {
    if (temLetra(k)) chave44.set(k, f);
  }
  /* IE e número de nota não têm formato próprio — IE é 8-12 dígitos, número de
     nota é 1-9. Não dá para casar por regex sem reprovar fixture de teste
     ("Nº 5", "123456789012345"). Então estes dois são casados pelo VALOR
     exato que o gabarito declara: é mais lento, mas é o que não gera
     falso positivo, e o custo é uma passada por arquivo versionado. */
  const ie = new Map();
  const numero = new Map();
  const textoReal = new Map();
  const casarValor = (destino, alvo) => {
    if (!alvo) return;
    for (const [f, txt] of brutos) {
      if (txt.includes(alvo)) destino.set(alvo, f);
    }
  };
  /* UMA lista de sintéticos, compartilhada pelos dois ramos deste gate.
     Duas listas do mesmo conceito é a armadilha que este projeto já pagou:
     `SINT_14` (rama sem gabarito) e `SINT_CNPJ` (2.B, com gabarito) tinham
     conteúdo diferente, e o clone novo reprovava com 14 valores que o 2.B
     aceitava — porque o 2.B só exige declaração quando o DV FECHA, enquanto o
     ramo sem gabarito exigia para qualquer 14 dígitos, inclusive placeholder
     como `11.111.111/1111-11` que jamais fecha.

     Cada entrada declara POR QUE é sintética, e não apenas o número: foi a
     lista sem justificativa que deixou um dado real passar, porque "está na
     lista" e "está demonstrado ser sintético" são afirmações diferentes. */
  const SINT = new Set([
    // Família 11.222.33x/0001-xx: derivada do exemplo público da Receita
    // (11.222.333/0001-81) e dos CNPJs que o `index.html` usa como exemplo
    // nos comentários do leitor. Conferido com o `vC` do próprio app: fecham
    // '81', '26', '70' e '15'; '83' e '72' NÃO fecham — e é por isso que
    // precisam de declaração no ramo sem gabarito, que exige para qualquer 14
    // dígitos. Não reescreva nenhum destes números: o gate existe para barrar
    // justamente o dado real que alguém copia daqui.
    '11.222.333/0001-81', '11222333000181',
    '11.222.334/0001-26', '11222334000126',
    '11.222.335/0001-70', '11222335000170',
    '11.222.336/0001-15', '11222336000115',
    '11.222.337/0001-83', '11222337000183',
    '11.222.338/0001-72', '11222338000172',
    '12.345.678/0001-95', '12345678000195',
    // Placeholders de zero e de dígito repetido: DV não fecha por construção,
    // e é por isso que precisam estar declarados mesmo com o 2.B desligado.
    '00.000.000/0000-00', '00000000000000',
    '11.111.111/1111-11', '11111111111111',
    '00.000.000/0001-91', '00000000000191',
    '00.000.000/0000-04', '00000000000004',
    // CNPJ com DV trocado, usado como "DV inválido" nos testes do 2.B e do
    // smoke. Fica declarado porque o DV não fecha e o valor está no fonte.
    '11.222.333/0001-03', '11222333000103',
    // 13.126.789/2684-76 citado no comentário do rodar.mjs: 14 dígitos com DV
    // INVÁLIDO, usado para provar que a comparação tolerante não pode valer
    // para campo numérico. Declarado porque DV não fecha.
    '13126789268476',
    // Protocolo: 100.200.300.400.501 (sequência) e o de 15 dígitos do exemplo.
    '100200300400501', '123456789012345', '123451234512345',
    // Chaves de 44: as forjadas dos testes de estrutura (cUF 00, mês 00,
    // modelo ≠ 55/65, a janela com DV válido e estrutura inválida) e as
    // variantes de 43/45 dígitos que o vH tem de rejeitar.
    '12345678901234567890123456789012345678901234',
    '35260911222333000181550010000001231123456783',
    '35268011222334000126550019000001011123456784',
    '00260911222333000181550010000001231123456783',
    '35260011222333000181550010000001231123456783',
    '35260911222333000181500010000001231123456783',
    '52609112223330001815500100000012311234567835',
    '43526091122233300018155001000000123112345678',
    // CNPJ alfanumérico (NT 2026.004): 12.ABC.345/01DE-35 é o exemplo público
    // da Receita Federal para o novo formato (o DV fecha no vC do app); o -36 é
    // o mesmo com DV trocado. A chave de 44 foi montada sobre ele a partir da
    // chave sintética 352609...783 acima (mesma UF, AAMM, série e número) e o
    // -783 dela é a variante com DV trocado.
    '12.ABC.345/01DE-35', '12ABC34501DE35',
    '12.ABC.345/01DE-36', '12ABC34501DE36',
    '35260912ABC34501DE35550010000001231123456784',
    '35260912ABC34501DE35550010000001231123456783',
    // Não são CNPJ: uma palavra do DANFE com 2 dígitos e um código de
    // verificação de NFS-e inventado. Os dois fecham o DV alfanumérico por
    // acaso e estão nos testes justamente para provar que o leitor NÃO os toma
    // por CNPJ — por isso o gate os enxerga e eles precisam estar aqui.
    'DESTINATARIO04', 'CS9Q9XK8QIOT18',
  ]);
  const ehSintetico = (v) => SINT.has(v) || SINT.has(String(v).replace(/[^0-9A-Z]/g, ''));

  if (!fs.existsSync(VERDADE)) {
    console.log('  ! sem verdade.json: cruzamento impossível; valida só os sintéticos conhecidos');
    const fora = [...[...cnpjMasc.keys()].filter((x) => !ehSintetico(x)),
      ...[...cnpjCru.keys()].filter((x) => !ehSintetico(x)),
      ...[...protocolo.keys()].filter((x) => !ehSintetico(x)),
      ...[...chave44.keys()].filter((x) => !ehSintetico(x))];
    ok('sem gabarito: todo CNPJ/protocolo/chave nos versionados é sintético conhecido',
      fora.length === 0, fora.join(', ') || 'todos sintéticos (' + SINT.size + ' declarados)');
    /* A lista é o que segura o clone, então a lista precisa estar sã: um
       sintético declarado que NÃO existe no fonte é lista que cresce sozinha e
       vira esconderijo — a próxima pessoa acrescenta "só mais um" e o gate
       para de reprovar. Zero tolerância: quando apurei a lista, havia uma
       entrada órfã (uma chave de 43 dígitos na lista de 44), que ninguém
       notaria leyendo. É a mesma classe de erro da lista duplicada. */
    const achados = [...cnpjMasc.keys(), ...cnpjCru.keys(), ...protocolo.keys(), ...chave44.keys()];
    const orfaos = [...SINT].filter((s) => !achados.some((a) => a === s || a.replace(/[^0-9A-Z]/g, '') === s.replace(/[^0-9A-Z]/g, '')));
    ok('sem gabarito: nenhum sintético declarado está órfão (a lista não infla sozinha)',
      orfaos.length === 0,
      orfaos.join(', ') || (SINT.size + ' declarados, todos no fonte'));
  } else {
    const t = JSON.parse(fs.readFileSync(VERDADE, 'utf8'));
    const notas = Array.isArray(t) ? t : Object.values(t);
    const dig = (v) => String(v).replace(/\D/g, '');
    const cnpjReais = new Set(); const chavesReais = new Set(); const protReais = new Set();
    /* Campos que o cruzamento anterior NÃO cobria. Dado fiscal não é só o que
       identifica a empresa: a inscrição estadual localiza o contribute, o
       número da nota localiza o documento, a natureza de operação diz o que
       foi vendido e a quem, e data+CEP situam o evento. Foi por esta porta que
       a IE e o número de nota reais entraram: os gates eram pesados em
       CNPJ/chave/protocolo e leves em todo o resto, e dado não catalogado
       passa por qualquer gate que só olha o que já conhece. */
    const ieReais = new Set(); const numReais = new Set(); const textoReais = new Map();
    const CAMPOS_TEXTO = /^(natOp|munEmitente|ufEmitente|enderecoEmitente|logradouro)$/i;
    /* Números de 1-3 dígitos são identificadores fracos: "108" é o número da
       nota de amostra que o smoke.crs usa para localizar o PDF na máquina, e
       "5" é a série. O gate pega "108" em smoke.cjs — que é o comportamento
       CORRETO do detector, apontando uma colisão real de 3 dígitos. Ele não
       é acrescentado aqui como exceção silenciosa: número de nota com menos
       de 4 dígitos não é dado fiscal num portão de acesso a repositório
       (não localiza empresa nenhuma), e a exceção fica escrita, não
       escondida no código. IE e NatOp continuamSob o gate — os dois têm
       comprimento fixo real e não têm essa colisão. */
    const MIN_DIGITOS_NUMERO = 4;
    for (const n of notas) {
      if (!n || typeof n !== 'object') continue;
      for (const k of ['cnpjPrestador', 'cnpjTomador', 'cnpj']) if (n[k]) cnpjReais.add(dig(n[k]));
      if (n.chave) chavesReais.add(dig(n.chave));
      if (n.protocolo) protReais.add(dig(n.protocolo));
      if (n.ieEmitente) ieReais.add(dig(n.ieEmitente));
      /* número com 4+ dígitos: a partir daí o número identifica documento */
      if (n.numero && dig(n.numero).length >= MIN_DIGITOS_NUMERO) numReais.add(dig(n.numero));
      /* NatOp, município, UF e endereço são texto livre; entram inteiros */
      for (const k of Object.keys(n)) {
        if (!CAMPOS_TEXTO.test(k) || n[k] == null) continue;
        const v = String(n[k]).trim();
        if (v.length >= 6) textoReais.set(v, k);
      }
    }
    /* passa os valores sem formato para o Detector por valor exato */
    for (const v of ieReais) casarValor(ie, v);
    for (const v of numReais) casarValor(numero, v);
    for (const [v] of textoReais) casarValor(textoReal, v);

    /* NÚMERO DE NOTA DENTRO DE CHAVE: o nNF ocupa as posições 26-34 de uma
       chave de 44. Um número de nota real que ninguém mais cita continua
       publicado dentro da chave — foi assim que ele sobreviveu à primeira
       limpeza, que só trocava a ocorrência solta. */
    const nNFemChave = new Map();
    for (const [ch, arq] of chave44) {
      const n = ch.slice(25, 34);
      if (numReais.has(n) || numReais.has(n.replace(/^0+(?=\d)/, ''))) nNFemChave.set(n, arq);
    }
    const marca = (m, reais, rotulo) => [...m.keys()]
      .filter((x) => reais.has(x.replace(/\D/g, '')))
      .map((x) => rotulo + ' ' + x + ' em ' + m.get(x));
    const vazou = [
      ...marca(cnpjMasc, cnpjReais, 'CNPJ'),
      ...marca(cnpjCru, cnpjReais, 'CNPJ-cru'),
      ...marca(chave44, chavesReais, 'chave'),
      ...marca(protocolo, protReais, 'protocolo'),
    ];
    ok('nenhum dado fiscal real da cliente está em arquivo versionado (CNPJ, chave, protocolo)',
      vazou.length === 0,
      vazou.slice(0, 6).join(' | ') || 'limpo em ' + versionados.length + ' arquivo(s)');

    /* Gate 2.C — os campos SEM FORMATO. Os três gates acima casam por regex,
       e regex pressupõe formato: CNPJ tem 14 dígitos, chave 44, protocolo 15.
       IE e número de nota não têm comprimento próprio, então nenhuma regex
       plausível os pega sem reprovar fixture de teste. Resultado: os gates
       eram pesados em identificador de empresa e leves em identificador de
       operação, e foi por isso que a IE e o número de nota reais passaram
       três revisões.

       Aqui o Detector é por VALOR EXATO do gabarito: sem regex, sem falso
       positivo possível, e cobre NatOp, município e endereço também — que
       são texto livre e nunca casariam por formato. */
    const vazou2 = [
      ...[...ie].map(([v, f]) => 'IE ' + v + ' em ' + f),
      ...[...numero].map(([v, f]) => 'número ' + v + ' em ' + f),
      ...[...nNFemChave].map(([v, f]) => 'número ' + v + ' no nNF de uma chave em ' + f),
      ...[...textoReal].map(([v, f]) => textoReais.get(v) + ' "' + v.slice(0, 30) + '" em ' + f),
    ];
    ok('nenhum dado real de operação nos versionados (IE, número de nota, NatOp, endereço)',
      vazou2.length === 0,
      vazou2.slice(0, 6).join(' | ') || 'limpo em ' + versionados.length + ' arquivo(s)');
    ok('o gate de operação cobre os campos que o cruzamento por formato ignorava',
      ie.size + numero.size + textoReais.size > 0 || !fs.existsSync(VERDADE),
      'IE=' + ie.size + ' número=' + numero.size + ' texto=' + textoReais.size);
    ok('o gate olha os versionados, não só o index.html',
      versionados.length >= 7 && versionados.some((f) => f.startsWith('testes/')),
      versionados.length + ' arquivo(s): ' + versionados.join(', '));

    /* O cruzamento acima só pega o que o GABARITO conhece. E foi assim que o
       CNPJ real da cliente entrou de novo, dentro de um COMENTÁRIO deste
       arquivo — eu mesmo escrevi, copiando do valor vazado. Dado que não está
       no gabarito não tem como o cruzamento acusar.

       Regra que fecha isso sem depender do gabarito: um CNPJ de 14 dígitos
       cujo DV fecha é, neste projeto, ou um sintético declarado ou um dado
       real. Não há terceiro caso. Então a lista de sintéticos é a allowlist,
       e qualquer outro CNPJ válido reprova — inclusive em comentário, porque
       comentário é texto e texto publicado é público. */
    const dvCnpjFecha = (c14) => {
      const mod11 = (s) => {
        let r = 0;
        for (let i = 0; i < s.length; i++) r += Number(s[s.length - 1 - i]) * (2 + (i % 8));
        const d = 11 - (r % 11);
        return d >= 10 ? 0 : d;
      };
      const b12 = c14.slice(0, 12);
      const d1 = String(mod11(b12));
      return c14 === b12 + d1 + String(mod11(b12 + d1));
    };
    /* A MESMA lista do ramo sem gabarito (acima), não uma segunda: foi ter duas
       que o clone novo reprovou com 14 valores que aqui já eram aceitos. */
    const cnpjValidosNaoSinteticos = [...cnpjCru.keys()]
      .filter((x) => /^[0-9A-Z]{12}\d{2}$/.test(x))
      .filter((x) => !ehSintetico(x))
      .filter((x) => (/^\d{14}$/.test(x) ? dvCnpjFecha(x) : dvAlfaFecha(x)))
      .map((x) => 'CNPJ ' + x + ' em ' + cnpjCru.get(x));
    ok('todo CNPJ de DV válido nos versionados é um sintético declarado',
      cnpjValidosNaoSinteticos.length === 0,
      cnpjValidosNaoSinteticos.slice(0, 6).join(' | ')
        || 'todos os CNPJ válidos são sintéticos conhecidos');
  }
}

// ══════════════════════════════════════════════════════════════
grupo('3 · CDNs E DEGRADAÇÃO');
// ══════════════════════════════════════════════════════════════
const cdn = [...html.matchAll(/<script src="([^"]+)"([^>]*)>/g)];
ok('exatamente 6 CDNs', cdn.length === 6, 'achou ' + cdn.length);
cdn.forEach(([, url, attrs], i) => {
  ok('CDN ' + (i + 1) + ' tem integrity', /integrity="sha384-[A-Za-z0-9+/=]+"/.test(attrs), url);
  ok('CDN ' + (i + 1) + ' tem crossorigin', /crossorigin="anonymous"/.test(attrs), url);
  // jsdelivr usa @1.2.3; cdnjs usa /1.2.3/ — as duas formas são versão exata
  ok('CDN ' + (i + 1) + ' com versão EXATA (sem @latest ou faixa)',
    /@\d+\.\d+\.\d+/.test(url) || /\/\d+\.\d+\.\d+\//.test(url), url);
});
ok('tesseract pinado em 4.1.4', /tesseract\.js@4\.1\.4/.test(html));
ok('corePath do OCR aponta para versão existente (4.0.4)', /tesseract\.js-core@v4\.0\.4/.test(html));
ok('corePath não aponta para 4.1.4 (404 comprovado)', !/tesseract\.js-core@4\.1\.4/.test(html));
ok('langPath do OCR declarado', /langPath:'https:\/\/tessdata\.projectnaptha\.com/.test(html));
ok('aviso de CDN ausente existe (#cdn-avisos)', /id="cdn-avisos"/.test(html));
ok('detecta as 6 bibliotecas ausentes', /esperado\s*=\s*\[/.test(html) &&
  ['chart.js', 'xlsx', 'pdfjs', 'pdf-lib', 'jszip', 'tesseract'].every(lib => html.includes("['" + lib + "',")));
ok('renderDashboard tem guard de Chart', /typeof Chart==='undefined'/.test(html));

// ══════════════════════════════════════════════════════════════
grupo('4 · SPRITE DE ÍCONES');
// ══════════════════════════════════════════════════════════════
const simbolos = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
/* Uso literal no HTML + uso dinâmico por JS (o toggle da sidebar troca o `href`
   com setAttribute conforme o estado, então o par de ícones não aparece em
   nenhum markup estático — sem esta segunda fonte, o gate acusaria órfão). */
const usos = new Set([...html.matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]));
for (const m of html.matchAll(/['"]#(i-[a-z-]+)['"]/g)) usos.add(m[1]);
ok('sprite tem 23 símbolos', simbolos.size === 23, 'achou ' + simbolos.size);
ok('todo use aponta para um símbolo existente', [...usos].every(u => simbolos.has(u)),
  [...usos].filter(u => !simbolos.has(u)).join(','));
ok('nenhum símbolo órfão (definido e nunca usado)', [...simbolos].every(s => usos.has(s)),
  [...simbolos].filter(s => !usos.has(s)).join(','));
ok('ícones de ação usam o sprite, não glifo', !/<span class="toggle">(?!<svg)/.test(html));
ok('o toggle da sidebar tem os DOIS glifos do sprite e troca por JS',
  simbolos.has('i-panel-open') && simbolos.has('i-panel-close') &&
  /setAttribute\('href',\s*on\s*\?\s*'#i-panel-open'\s*:\s*'#i-panel-close'\)/.test(html));

// ══════════════════════════════════════════════════════════════
grupo('5 · IDs E LABELS');
// ══════════════════════════════════════════════════════════════
const idsHtml = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const duplicados = idsHtml.filter((v, i) => idsHtml.indexOf(v) !== i);
ok('nenhum id duplicado', duplicados.length === 0, duplicados.join(','));
const getById = [...html.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const orfaosId = [...new Set(getById)].filter(id => !idsHtml.includes(id));
ok('todo getElementById tem elemento no HTML', orfaosId.length === 0, orfaosId.join(','));
ok('todo <label> tem for= ou input aninhado',
  [...html.matchAll(/<label(?![^>]*\bfor=)[^>]*>([\s\S]{0,120}?)<\/label>/g)]
    .filter(m => !/<input/i.test(m[1])).length === 0);

// ══════════════════════════════════════════════════════════════
grupo('6 · ACESSIBILIDADE');
// ══════════════════════════════════════════════════════════════
ok(':focus-visible global', /:focus-visible\{outline:2px solid var\(--focus\)/.test(html));
ok('focus visível tem override de cor na sidebar', /\.nav-btn:focus-visible/.test(html));
ok('theme-btn tem aria-pressed estático no HTML', /id="theme-btn"[^>]*aria-pressed="false"/.test(html));
ok('dropzone de XML é alcançável por teclado', /id="upload-area" role="button" tabindex="0"/.test(html));
ok('dropzone de PDF é alcançável por teclado', /id="pdfiso-upload" role="button" tabindex="0"/.test(html));
/* DANFE completo: o header da NF-e nasce com aria-expanded do estado (nota aberta
   continua aberta ao redesenhar), e o toggleNota mantém o atributo. A NFS-e deixou
   de ser card (virou lista com painel), então resta o header da NF-e. */
ok('header de nota é botão acessível', (html.match(/class="header" role="button" tabindex="0" aria-expanded="/g) || []).length >= 1);
ok('o toggleNota atualiza aria-expanded', /function toggleNota\(el\)\{[\s\S]{0,300}?el\.setAttribute\('aria-expanded'/.test(html));
/* Os det-title eram os do card de NFS-e (CSRF e IBS/CBS); a NFS-e virou lista com
   painel, e a linha é que precisa ser alcançável por teclado (Tab + Enter/Espaço). */
ok('a linha da NFS-e é alcançável por teclado e abre com Enter/Espaço',
  /<tr data-i="\$\{i\}" tabindex="0"/.test(html.slice(html.indexOf('function renderNFSe('), html.indexOf('// ═══ EVENT DELEGATION')))
  && /if\(tr\)\{e\.preventDefault\(\);nfseAbre\(\+tr\.dataset\.i,/.test(html));
ok('Enter/Espaço dispara o toggle (nota)', /addEventListener\('keydown'[\s\S]{0,600}?toggleNota/.test(html));
/* O Enter/Espaço da linha e a marca da linha aberta (aria-current) são EXECUTADOS no
   grupo 15 ("NFS-e na tela"); aqui fica só a garantia de que o código do card antigo
   (toggleDet, .det-body.open e a delegação na #nfse-list) não voltou. */
ok('o código do card antigo da NFS-e saiu (toggleDet, .det-body.open, delegação de det-title)',
  !/toggleDet/.test(html) && !/\.det-body\.open/.test(html) && !/\['nfe-list','nfse-list'\]/.test(html)
  && !/'\.det-title'/.test(html.slice(html.indexOf('// ═══ EVENT DELEGATION'), html.indexOf('// ═══ CT-e (modelo 57)'))));
ok('Enter/Espaço abre a dropzone', /upload-area'\)\.addEventListener\('keydown'/.test(html));
ok('live region do PDF é container permanente no HTML', /id="pdfiso-avisos" role="status" aria-live="polite"/.test(html));
ok('a live region recebe conteúdo fora do innerHTML da tabela', /getElementById\('pdfiso-avisos'\)\.innerHTML=aviso/.test(html));
ok('prefers-reduced-motion presente', /@media \(prefers-reduced-motion:reduce\)/.test(html));
ok('barra de progresso não reintroduz transição no reduced-motion', /transition:none!important/.test(html));

// ══════════════════════════════════════════════════════════════
grupo('7 · CONTRASTE WCAG (implementado aqui, sem WebAIM)');
// ══════════════════════════════════════════════════════════════
function tokens(tema) {
  const re = tema === 'escuro'
    ? /:root\[data-theme="dark"\]\{([\s\S]*?)\}/
    : /:root\{([\s\S]*?)\n\}/;
  const m = re.exec(html);
  const out = {};
  if (!m) return out;
  // Casa o par direto: --nome: valor;  (o valor pode conter rgba(), que tem ponto e vírgula dentro)
  for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[d[1]] = d[2].replace(/!important/g, '').trim();
  }
  return out;
}
// O escuro SOBRESCREVE o claro; o que não é sobrescrito é HERDADO (cascata do CSS).
const claro = tokens('claro');
const escuro = { ...claro, ...tokens('escuro') };
ok('tema claro tem tokens', Object.keys(claro).length > 30, Object.keys(claro).length + ' tokens');
ok('tema escuro tem tokens', Object.keys(tokens('escuro')).length > 20, Object.keys(tokens('escuro')).length + ' tokens');
const sobrescritas = Object.keys(tokens('escuro'));
const semParDark = sobrescritas.filter(k => !/[a-z]/.test(k));
ok('todo token sobrescrito no escuro existe no claro', semParDark.length === 0, semParDark.join(','));
ok('tokens que mudam entre os temas estão declarados no escuro',
  ['--card', '--surface', '--text', '--text2', '--border', '--tint'].every(k => k in claro && k in escuro));
/* O log do lote depende dos --log-* nos DOIS temas: se só existissem no claro,
   o escuro herdaria o valor do claro e a medição do escuro seria fiction. */
ok('os 5 tokens --log-* existem nos DOIS temas (o escuro não herda o valor do claro)',
  ['--log-neutro', '--log-info', '--log-ok', '--log-aviso', '--log-err']
    .every(k => k in claro && k in tokens('escuro')),
  ['--log-neutro', '--log-info', '--log-ok', '--log-aviso', '--log-err']
    .filter(k => !(k in claro && k in tokens('escuro'))).join(','));
ok('TOM do lote aponta para os --log-*, não para tokens de superfície clara',
  /const TOM=\{neutro:'var\(--log-neutro\)',info:'var\(--log-info\)',ok:'var\(--log-ok\)',erro:'var\(--log-err\)',aviso:'var\(--log-aviso\)'\}/.test(html));
ok('nenhum log do lote usa literal de cor de superfície clara',
  !/loteLog\([^)]*'var\(--err\)'\)/.test(html) && !/loteLog\([^)]*'var\(--warn-ink\)'\)/.test(html));

function lum(cor) {
  if (typeof cor !== 'string') return null;
  let c = cor.trim();
  if (!c) return null;
  const m3 = /^#([0-9a-f]{3})$/i.exec(c);
  if (m3) c = '#' + m3[1].split('').map(x => x + x).join('');   // #fff -> #ffffff
  const m6 = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m6) return null;                                    // rgb()/rgba() não é usado em token de cor
  const v = [0, 2, 4].map(i => parseInt(m6[1].substr(i, 2), 16) / 255)
    .map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
const paresTexto = [
  ['--text', '--card', 4.5], ['--text', '--surface', 4.5], ['--text', '--tint', 4.5],
  ['--text2', '--card', 4.5], ['--text2', '--surface', 4.5], ['--text2', '--tint', 4.5],
  ['--text3', '--card', 4.5], ['--text3', '--surface', 4.5], ['--text3', '--tint', 4.5],
  ['--primary-ink', '--card', 4.5], ['--primary-ink', '--card-2', 4.5],
  ['--err-ink', '--err-bg', 4.5], ['--warn-ink', '--warn-bg', 4.5],
  // o aviso de cache do lote (#cnpj-cache-aviso) é texto de 11px sobre --warn-bg
  ['--text2', '--warn-bg', 4.5],
  ['--err', '--card', 4.5], ['--success', '--card', 4.5],
  ['--code-fg', '--code-bg', 4.5],
  /* #cnpj-lote-log é a .code (fundo --code-bg, ardósia escura) onde o usuário lê
     o erro de um lote de 5,5 h. Os tokens --text2/--info/--success/--err são
     calibrados para superfície CLARA e davam de 2,06:1 a 3,98:1 a 10px aí.
     Os cinco --log-* passam de 7,7:1 a 10,2:1 nos dois temas. */
  ['--log-neutro', '--code-bg', 4.5], ['--log-info', '--code-bg', 4.5],
  ['--log-ok', '--code-bg', 4.5], ['--log-aviso', '--code-bg', 4.5],
  ['--log-err', '--code-bg', 4.5],
];
for (const tema of ['claro', 'escuro']) {
  const T = tema === 'claro' ? claro : escuro;
  for (const [fg, bg, min] of paresTexto) {
    const r = ratio(T[fg], T[bg]);
    ok(`contraste ${fg} sobre ${bg} (${tema}) >= ${min}`,
      r !== null && r >= min, r === null ? 'token não resolvido' : r.toFixed(2) + ':1');
  }
}
// botões: branco sobre o CTA (texto de 11px = texto normal, precisa 4.5:1)
for (const tema of ['claro', 'escuro']) {
  const T = tema === 'claro' ? claro : escuro;
for (const cta of ['--primary-cta', '--primary-cta-h', '--sec-cta', '--sec-cta-h',
  '--accent-cta', '--accent-cta-h', '--success-solid', '--success-solid-h', '--err-solid',
  '--badge-ok', '--badge-warn', '--badge-err']) {
  const r = ratio('#ffffff', T[cta]);
  ok(`branco sobre ${cta} (${tema}) >= 4.5`, r !== null && r >= 4.5,
    r === null ? 'token não resolvido: ' + T[cta] : r.toFixed(2) + ':1');
}
// --badge-on-cta é alpha no tema claro (sobre CTA escuro, medido 5.15:1) e sólido no
// escuro. Alpha não é computável isoladamente, então o claro é verificado por forma.
if (tema === 'claro') {
  ok('badge sobre CTA no claro usa alpha (medido 5.15:1 na auditoria de design)',
    /^rgba\(/.test(claro['--badge-on-cta']), claro['--badge-on-cta']);
} else {
  const r = ratio('#ffffff', escuro['--badge-on-cta']);
  ok('branco sobre --badge-on-cta (escuro) >= 4.5', r !== null && r >= 4.5,
    r === null ? 'token não resolvido' : r.toFixed(2) + ':1');
}
  const rBorder = ratio(T['--warn-ink'], T['--warn-bg']);
  ok(`borda de aviso (${tema}) >= 3:1 (1.4.11)`, rBorder !== null && rBorder >= 3,
    rBorder === null ? 'token não resolvido: ' + T['--warn-ink'] + ' / ' + T['--warn-bg'] : rBorder.toFixed(2) + ':1');
  const rInput = ratio(T['--border-input'], T['--card']);
  ok(`borda de input (${tema}) >= 3:1 (1.4.11)`, rInput !== null && rInput >= 3,
    rInput === null ? 'token não resolvido: ' + T['--border-input'] + ' / ' + T['--card'] : rInput.toFixed(2) + ':1');
}

// ══════════════════════════════════════════════════════════════
grupo('8 · TEMA NO BOOT (executa o script real com stub de DOM)');
// ══════════════════════════════════════════════════════════════
const scriptTema = scripts[scripts.length - 1];
function ambienteArmazenamento(falhaEm) {
  const dados = {};
  return {
    _d: dados,
    getItem(k) { if (falhaEm === 'get') throw new Error('SecurityError'); return Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null; },
    setItem(k, v) { if (falhaEm === 'set') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } dados[k] = String(v); },
    removeItem(k) { delete dados[k]; },
    key() { return null; },
    get length() { return Object.keys(dados).length; },
    clear() { for (const k of Object.keys(dados)) delete dados[k]; },
  };
}
function stubDOM(atributoTema) {
  const navs = ['Importar XMLs', 'Separar PDF', 'Leitura PDF', 'Consultar CNPJ', 'NF-e (Peças)', 'NFS-e (Serviços)', 'Dashboard', 'Exportar Dados'];
  const botoes = navs.map(t => ({ lastElementChild: { textContent: t }, _ev: {}, addEventListener(_, f) { this._ev.click = f; } }));
  const cur = { textContent: '' };
  const btn = { attrs: { 'aria-pressed': 'false' }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(_, f) { this._f = f; } };
  const root = { attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  if (atributoTema) root.attrs['data-theme'] = 'dark';
  return {
    documentElement: root,
    getElementById(id) { return id === 'theme-btn' ? btn : (id === 'crumb-cur' ? cur : null); },
    querySelectorAll(sel) { return sel === '.nav-btn' ? botoes : []; },
    querySelector(sel) { return sel === '.nav-btn.active' ? botoes[0] : null; },
    __btn: btn, __root: root, __cur: cur, __navs: botoes,
  };
}
function rodarTema({ temaSalvo, falhaStorage, comChart }) {
  const dom = stubDOM(temaSalvo === 'dark' ? 'dark' : null);
  const chartsFalsos = {};
  const sandbox = {
    document: dom,
    localStorage: ambienteArmazenamento(falhaStorage),
    getComputedStyle: () => ({ getPropertyValue: (n) => (claro[n] || '') }),
    setTimeout, clearTimeout, Date, Math, JSON,
    window: {},
  };
  if (comChart) {
    sandbox.Chart = {
      defaults: { color: null, borderColor: null, plugins: { tooltip: {} } },
      __n: 0,
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(scriptTema, sandbox, { filename: 'tema#final' });
  return { dom, sandbox };
}

// boot com tema salvo -> atributo aplicado (via o script anti-FOUC) e Chart.defaults sincronizado
{
  const { dom, sandbox } = rodarTema({ temaSalvo: 'dark', comChart: true });
  ok('Chart.defaults sincronizado NO BOOT (bug do dashboard em dark)', sandbox.Chart.defaults.color !== null,
    'color=' + sandbox.Chart.defaults.color);
  ok('Chart.defaults recebeu cor lida do token', sandbox.Chart.defaults.color === claro['--text2'],
    sandbox.Chart.defaults.color + ' vs token ' + claro['--text2']);
  ok('aria-pressed coerente no boot', dom.__btn.attrs['aria-pressed'] === 'true', dom.__btn.attrs['aria-pressed']);
  ok('breadcrumb deriva do .nav-btn.active no boot (não de texto fixo)', dom.__cur.textContent === 'Importar XMLs', dom.__cur.textContent);
}
// boot sem tema salvo -> sem atributo, aria-pressed false
{
  const { dom } = rodarTema({ temaSalvo: null, comChart: true });
  ok('sem tema salvo: sem data-theme', dom.__root.getAttribute('data-theme') === null);
  ok('sem tema salvo: aria-pressed=false', dom.__btn.attrs['aria-pressed'] === 'false');
}
// toggle alterna e persiste
{
  const { dom, sandbox } = rodarTema({ temaSalvo: 'light', comChart: true });
  dom.__btn._f();
  ok('toggle aplica data-theme', dom.__root.getAttribute('data-theme') === 'dark');
  ok('toggle persiste em localStorage', sandbox.localStorage.getItem('gcon-theme') === 'dark');
  ok('toggle inverte aria-pressed', dom.__btn.attrs['aria-pressed'] === 'true');
  dom.__btn._f();
  ok('toggle volta (idempotente por par)', dom.__root.getAttribute('data-theme') === null);
  ok('toggle persiste light', sandbox.localStorage.getItem('gcon-theme') === 'light');
  const nav = dom.__navs[5];
  nav._ev.click();
  ok('breadcrumb acompanha o clique na aba', dom.__cur.textContent === 'NFS-e (Serviços)', dom.__cur.textContent);
}
// Chart.js ausente: nao pode explodir. Comeca sem tema salvo, entao um clique vai para dark.
{
  const { dom } = rodarTema({ temaSalvo: null, comChart: false });
  let explodiu = false;
  try { dom.__btn._f(); } catch (e) { explodiu = true; }
  ok('toggle funciona com Chart.js ausente (CDN fora)', !explodiu);
  ok('tema aplica mesmo sem Chart.js', dom.__root.getAttribute('data-theme') === 'dark',
    String(dom.__root.getAttribute('data-theme')));
}
// localStorage bloqueado: o app tem que seguir funcionando
{
  const { dom } = rodarTema({ temaSalvo: null, falhaStorage: 'set', comChart: true });
  let explodiu = false;
  try { dom.__btn._f(); } catch (e) { explodiu = true; }
  ok('setItem bloqueado não quebra o toggle (try/catch)', !explodiu);
  ok('tema aplica mesmo sem persistência', dom.__root.getAttribute('data-theme') === 'dark');
}
{
  const { dom } = rodarTema({ temaSalvo: null, falhaStorage: 'get', comChart: true });
  let explodiu = false;
  try { dom.__btn._f(); } catch (e) { explodiu = true; }
  ok('localStorage indisponível não quebra o app', !explodiu);
}

// ══════════════════════════════════════════════════════════════
grupo('9 · CHAVE DE ACESSO 44 (validador vH do próprio index.html)');
// ══════════════════════════════════════════════════════════════
// vH e vC dependem do helper d() do mesmo IIFE — extrai os tres juntos.
const sandboxChave = { d: (s) => (s || '').replace(/\D/g, '') };
vm.createContext(sandboxChave);
for (const nome of ['d', 'vC', 'vH']) {
  const re = nome === 'd'
    ? /function d\(s\)\{return\(s\|\|''\)\.replace\(\/\\D\/g,''\);\}/
    : new RegExp('function ' + nome + '\\([\\s\\S]*?\\n');
  const src = re.exec(html);
  ok('extraiu ' + nome + '() do index.html', !!src);
  if (src) vm.runInContext(src[0], sandboxChave, { filename: nome });
}
const vH = sandboxChave.vH, vC = sandboxChave.vC;
const caminhoV = path.join(__dirname, 'chaves-verdade.json');
if (fs.existsSync(caminhoV)) {
  const reais = Object.values(JSON.parse(fs.readFileSync(caminhoV, 'utf8')));
  ok('há chaves reais de referência', reais.length >= 8, reais.length + ' chaves');
  const invalidas = reais.filter(k => !vH(k));
  ok('todas as chaves reais passam em vH', invalidas.length === 0, invalidas.join(','));
  // alterações de 1 dígito no DV precisam falhar
  const adulteradas = reais.filter(k => {
    const d = k.slice(0, 43) + (k[43] === '0' ? '1' : '0');
    return vH(d);
  });
  ok('chave com DV trocado é rejeitada', adulteradas.length === 0, adulteradas.length + ' passaram errado');
} else {
  console.log('  (chaves-verdade.json ausente — validação de chave real pulada; arquivo é gitignored)');
}
const falsas = [
  '0'.repeat(44), '1'.repeat(44), '12345678901234567890123456789012345678901234',
  '3526091122233300018155001000000123112345678',   // 43
  '352609112223330001815500100000012311234567837', // 45
  'abcdefghijklmnopqrstuvwxyzabcdefghijklmnop', '', '   ',
  '352609112223330001815500100000012311234567 6',
];
falsas.forEach((k, i) => ok('chave falsa #' + (i + 1) + ' rejeitada por vH', vH(k) === false, JSON.stringify(k.slice(0, 20))));
ok('vH aceita chave válida sintética (controle positivo)',
  vH('35260911222333000181550010000001231123456783') === true);
ok('CNPJ placeholder rejeitado por vC', vC('00.000.000/0000-00') === false);
ok('CNPJ válido aceito por vC', vC('11.222.333/0001-81') === true);
/* CNPJ alfanumérico (NT 2026.004): o exemplo público da Receita. vC e vH
   precisam funcionar sozinhos (sem d(), que descarta letra). */
ok('CNPJ alfanumérico aceito por vC (exemplo da Receita)', vC('12.ABC.345/01DE-35') === true);
ok('chave com CNPJ alfanumérico aceita por vH',
  vH('35260912ABC34501DE35550010000001231123456784') === true);

// ══════════════════════════════════════════════════════════════
grupo('10 · REGRAS DO PROJETO');
// ══════════════════════════════════════════════════════════════
ok('erro de XML malformado é específico', /XML inválido ou malformado/.test(html));
/* Lookbehind em regex literal é erro de SINTAXE no Safari/iOS abaixo de 16.4:
   o <script> inteiro deixa de carregar, não só o recurso que usa a regex. */
ok('nenhum lookbehind de regex no app (Safari < 16.4 não carregaria o script)',
  !/\(\?<[=!]/.test(scripts.join('\n')), (scripts.join('\n').match(/.{0,30}\(\?<[=!].{0,20}/) || [''])[0]);
ok('single-file: nenhum .js ou .css local', !/<script[^>]+src="(?!https:)[^"]+\.js"/.test(html));
// A fonte precisa estar carregada, mas por um caminho só: <link> no <head>
// (com preconnect, em paralelo) ou @import no <style>. Ter os dois fazia a
// mesma requisição duas vezes, e o @import só saía depois do primeiro paint.
const fonteLink = /<link[^>]+href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter[^"]*"/.test(html);
const fonteImport = /@import url\('https:\/\/fonts\.googleapis\.com[^']*'\)/.test(html);
ok('fonte Inter carregada', fonteLink || fonteImport, 'link=' + fonteLink + ' import=' + fonteImport);
ok('fonte Inter sem requisição duplicada', !(fonteLink && fonteImport), 'link e @import juntos');
const hnfe = /const HNFE=\[([\s\S]*?)\];/.exec(html)[1];
const hnfse = /const HNFSE=\[([\s\S]*?)\];/.exec(html)[1];
const nHnfe = (hnfe.match(/'[^']+'/g) || []).length;
const nHnfse = (hnfse.match(/'[^']+'/g) || []).length;
/* 93 colunas originais + 24 do grupo veicProd (veículo novo), anexadas no FIM. */
ok('HNFE tem 117 campos (93 + 24 do veicProd)', nHnfe === 117, 'achou ' + nHnfe);
{
  const cols = (hnfe.match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
  /* Quem lê a planilha por posição não pode ver coluna andar: as 93 antigas
     continuam nas mesmas posições, terminando em Arquivo_Origem. */
  /* Impressão digital das 93 colunas da versão anterior, NA ORDEM (sha256 da lista
     separada por vírgula). Conferir só as pontas congelava o tamanho, não a ordem. */
  ok('as 93 colunas antigas estão idênticas e na mesma ordem (impressão digital da lista)',
    createHash('sha256').update(cols.slice(0, 93).join(',')).digest('hex') === '0dbeb787619b914eea24f5b315afbf04f81d610065d6b8dda132e03319047685');
  ok('as 93 colunas antigas não mudaram de posição (a 93ª continua sendo Arquivo_Origem)',
    cols[92] === 'Arquivo_Origem' && cols[0] === 'Tipo_Nota', 'col93=' + cols[92]);
  {
    const m = /const VEIC_CAMPOS=\[([\s\S]*?)\];/.exec(html);
    const daTabela = m ? [...m[1].matchAll(/\['[^']+','([^']+)'\]/g)].map((x) => x[1]) : [];
    ok('a tabela VEIC_CAMPOS e a cauda do HNFE são a mesma lista, na mesma ordem',
      daTabela.length === 24 && daTabela.join() === cols.slice(93).join(), daTabela.join());
  }
  {
    const readme = fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8');
    const painel = fs.readFileSync(path.join(RAIZ, 'painel-gerencial.html'), 'utf8');
    ok('README e painel não citam mais 93 nem 56 como total de campos do XML',
      !/XML (lê|extrai) \(?93\b/.test(readme + painel) && !/\+ 56\b/.test(painel));
    /* O KPI "Schema coberto" é conferido contra a contagem real das duas listas: um
       número escrito à mão envelhece sem ninguém ver quando uma coluna entra. */
    const kpi = /Schema coberto<\/span><\/div>\s*<div class="v">(\d+) \+ (\d+)<\/div>/.exec(painel);
    ok('o KPI "Schema coberto" do painel bate com HNFE + HNFSE do código',
      !!kpi && +kpi[1] === nHnfe && +kpi[2] === nHnfse, kpi ? kpi[1] + ' + ' + kpi[2] + ' (código: ' + nHnfe + ' + ' + nHnfse + ')' : 'KPI não encontrado');
  }
  ok('as 24 colunas do veicProd vêm depois, todas Veic_* e com o chassi',
    cols.slice(93).length === 24 && cols.slice(93).every((c) => c.startsWith('Veic_')) && cols.includes('Veic_Chassi'),
    cols.slice(93).join(','));
}
/* 56 colunas originais + 65 da leitura completa da NFS-e, anexadas no FIM. */
ok('HNFSE tem 121 campos (56 + 65 da leitura completa)', nHnfse === 121, 'achou ' + nHnfse);
{
  const cols = (hnfse.match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
  /* Quem lê a planilha da NFS-e por posição não pode ver coluna andar: as 56 antigas
     continuam iguais e na mesma ordem (impressão digital da lista), terminando em
     Arquivo_Origem; as novas vêm todas depois, sem repetir nenhum nome. */
  ok('as 56 colunas antigas da NFS-e estão idênticas e na mesma ordem (impressão digital da lista)',
    createHash('sha256').update(cols.slice(0, 56).join(',')).digest('hex') === '7e6da78c2e259e4e57827bdc4ed1987054dc4d0b67740aff093f9c394f604bb2'
    && cols[55] === 'Arquivo_Origem', 'col56=' + cols[55]);
  ok('as colunas novas da NFS-e vêm depois de Arquivo_Origem e nenhum nome se repete',
    new Set(cols).size === cols.length && cols.indexOf('Descricao_Completa') > 55 && cols.indexOf('Cod_Mun_Tomador') > 55, cols.slice(56, 60).join(','));
  ok('README diz 121 colunas NFS-e (bate com o código)', /121 NFS-e/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')));
}
ok('README diz 117 colunas NF-e (bate com o código)', /117 NF-e/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')));
ok('README não fala 423 campos', !/423/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')));
ok('todo var(--x) usado está definido em :root',
  [...new Set([...html.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))].every(v => claro[v]),
  [...new Set([...html.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))].filter(v => !claro[v]).join(','));
// "zero emoji" tem duas leituras e ambas valem:
//  1) nenhum EMOJI de verdade (blocos pictograficos) em lugar nenhum do arquivo
//  2) nenhum glifo (✓ ✗ ⚠) na INTERFACE — dentro dos logs em monospace eles são
//     marcador de texto legítimo, não ícone
const semLog = html.replace(/`(?:[^`\\]|\\.)*`/g, '``').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
ok('nenhum emoji (bloco pictográfico) no arquivo', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{FE0F}]/u.test(html));
ok('nenhum glifo (✓/✗/⚠) na interface (logs são exceções)',
  !/[\u2713\u2717\u26a0]/.test(semLog),
  (semLog.match(/.{0,40}[\u2713\u2717\u26a0].{0,30}/u) || [''])[0].replace(/\s+/g, ' '));
ok('breakpoints 1440/768/375 presentes',
  /min-width:1440px/.test(html) && /max-width:768px/.test(html) && /max-width:375px/.test(html));
ok('alturas de sidebar usam 100dvh com fallback 100vh', /height:100vh;height:100dvh/.test(html));

/* Documentação é bloqueio pela regra do projeto, então ela tem gate. */
{
  const readme = fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8');
  ok('README lista o que é versionado (index, painel, testes)',
    /\| `index\.html` \|/.test(readme) && /\| `painel-gerencial\.html` \|/.test(readme) && /\| `testes\/` \|/.test(readme));
  ok('README reenumera os grupos ignorados pelo .gitignore',
    /amostras\//.test(readme) && /testes\/node_modules\//.test(readme)
    && /painel-estado\.json/.test(readme) && /previews\//.test(readme));
  ok('README documenta a Consulta em Lote e o painel gerencial',
    /\*\*Consulta em Lote\*\*/.test(readme) && /\*\*Painel gerencial\*\*/.test(readme));
  ok('README tem a seção "Testes" com as três suítes e a ordem do npm test',
    /## Testes/.test(readme) && /node regressao\.mjs/.test(readme) && /node painel-check\.mjs/.test(readme)
    && /node rodar\.mjs/.test(readme) && /npm test/.test(readme));
  ok('README diz que o painel-check roda da raiz e de dentro de testes/',
    /__dirname/.test(readme) && /da raiz ou de dentro de `testes\/`/.test(readme));
  ok('README não promete o que não é verdade (o aviso de privacidade cita o CNPJ)',
    /publica\.cnpj\.ws/.test(readme) && !/Nada é enviado a nenhum servidor/.test(readme));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  ok('npm test roda as DUAS suítes de ~1 s antes da bancada',
    /regressao\.mjs/.test(pkg.scripts.test) && /painel-check\.mjs/.test(pkg.scripts.test)
    && /rodar\.mjs/.test(pkg.scripts.test),
    pkg.scripts.test);
  ok('existe o atalho "painel" no package.json',
    pkg.scripts.painel === 'node painel-check.mjs', JSON.stringify(pkg.scripts));
  ok('as duas suítes resolvem caminho por __dirname (rodam da raiz e de testes/)',
    /__dirname/.test(fs.readFileSync(path.join(__dirname, 'painel-check.mjs'), 'utf8'))
    && /__dirname/.test(fs.readFileSync(path.join(__dirname, 'rodar.mjs'), 'utf8')));
}

// ══════════════════════════════════════════════════════════════
grupo('11 · SEPARADOR DE PDF (agrupamento de páginas em notas)');
// ══════════════════════════════════════════════════════════════
// sepAgrupar é a regra que mais errou: duas notas com o mesmo número iam
// parar no mesmo arquivo. Roda a função real do index.html num sandbox,
// sem browser e sem pdf.js.
{
  const m = /function sepAgrupar\([\s\S]*?\n\}/.exec(html);
  ok('sepAgrupar existe como função isolada', !!m);
  if (m) {
    const avisos = [];
    const sb = { sepLog: (t) => avisos.push(t), console, Set };
    vm.createContext(sb);
    try {
      vm.runInContext(m[0] + '\n;this.__g = sepAgrupar;', sb);
    } catch (e) { }
    const agrupar = sb.__g;
    ok('sepAgrupar carrega no sandbox', typeof agrupar === 'function');
    if (typeof agrupar === 'function') {
      const p = (g) => JSON.stringify(g);
      // caso real: nota 100 (2 pág), nota 200 (2 pág), nota 100 de novo (2 pág)
      // PDF de 0 página (ou contador corrompido) devolvia [[]] — um grupo
      // vazio que virava um PDF de 0 página chamado NF-nota_0001.pdf.
      ok('total 0 devolve lista vazia, não [[]]',
        p(agrupar([null, 200], 0, 'auto')) === p([]), p(agrupar([null, 200], 0, 'auto')));
      ok('total 0 no modo "uma página = uma nota" também devolve []',
        p(agrupar([], 0, 'unica')) === p([]), p(agrupar([], 0, 'unica')));
      ok('nenhum grupo devolvido é vazio (nunca [[]] em nenhum cenário)',
        [[null, 200, 200], [100, null, 100, null], ['1', '2'], [null, null, null]]
          .every((nums) => {
            const g = agrupar(nums, nums.length, 'auto');
            return g.every((grp) => Array.isArray(grp) && grp.length > 0);
          }));
      ok('número repetido vira nota nova (bug do "juntou tudo")',
        p(agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto')) === p([[0, 1], [2, 3], [4, 5]]),
        p(agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto')));
      avisos.length = 0;
      agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto');
      ok('número repetido é avisado no log (1 vez por repetição)',
        avisos.length === 1 && /já apareceu antes/.test(avisos[0]), avisos.join('|'));
      ok('nota única não quebra',
        p(agrupar(['777'], 1, 'auto')) === p([[0]]), p(agrupar(['777'], 1, 'auto')));
      ok('modo "uma página = uma nota" ignora o número',
        p(agrupar(['100', '100', '200'], 3, 'unica')) === p([[0], [1], [2]]));
      ok('página sem número herda a nota atual',
        p(agrupar(['100', null, null, '200'], 4, 'auto')) === p([[0, 1, 2], [3]]),
        p(agrupar(['100', null, null, '200'], 4, 'auto')));
      ok('nenhum número detectado = uma página por arquivo',
        p(agrupar([null, null, null], 3, 'auto')) === p([[0], [1], [2]]));
      ok('primeira página sem número não perde a primeira nota',
        p(agrupar([null, '200', '200'], 3, 'auto')) === p([[0, 1, 2]]),
        p(agrupar([null, '200', '200'], 3, 'auto')));
      const todas = agrupar(['1', '2', '3', '4', '5'], 5, 'auto');
      ok('sempre cobre todas as páginas, sem buraco nem repetição',
        todas.flat().length === 5 && todas.flat().every((x, i) => x === i), p(todas));
      ok('soma das páginas = total do PDF',
        agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto').flat().length === 6);
      // Invariante forte: qualquer entrada devolve cada página exatamente uma
      // vez, na ordem, e a soma é o total. Inclui os casos degenerados: PDF
      // sem número nenhum, PDF de 0 página (numPag só com 1 item) e numsPag
      // mais longo que o PDF.
      [[[], 0], [[null], 2], [['1', '2'], 1], [['100', null, '100', null], 4], [['9'], 3]]
        .forEach(([nums, tot], i) => {
          ['auto', 'unica'].forEach((md) => {
            let g = null, erro = '';
            try { g = agrupar(nums, tot, md); } catch (e) { erro = e.message; }
            const cob = g ? g.flat() : [];
            ok('invariante de páginas #' + (i + 1) + '/' + md + ': soma = total, ordem, sem repetição',
              !erro && cob.length === tot && cob.every((x, k) => x === k),
              JSON.stringify(nums) + ' total=' + tot + ' -> ' + (erro || JSON.stringify(g)));
            ok('invariante de páginas #' + (i + 1) + '/' + md + ': nenhum grupo vazio',
              !erro && g.every((grp) => grp.length > 0),
              JSON.stringify(nums) + ' total=' + tot + ' -> ' + JSON.stringify(g));
          });
        });
    }
  }
}

// ══════════════════════════════════════════════════════════════
grupo('11.1 · SEPARADOR: nomeação do arquivo (executa sepNomear de verdade)');
// ══════════════════════════════════════════════════════════════
/* O gate antigo conferia só o AGRUPAMENTO e nunca o NOME. SepAgrupar já
   decidia que a página sem número pertence à nota cujo número vem depois, e a
   nomeação lia numsPag[paginas[0]] — as duas coisas discordam, e 5 dos 14
   cenários saíam com o arquivo errado (NF-nota_0001.pdf para a nota 200).
   Tabela do tester, rodada como teste. */
{
  const mNomear = /function sepNomear\([\s\S]*?\n\}/.exec(html);
  const mSan = /function sepSanitizar\([\s\S]*?\n\}/.exec(html);
  ok('sepNomear existe como função isolada', !!mNomear);
  if (mNomear) {
    /* sepAgrupar entra no MESMO sandbox: a nomeação é consumidora do
       agrupamento, e testar as duas juntas é o que prova o contrato. */
    const sb = { Set, console, sepLog: () => {} };
    vm.createContext(sb);
    try {
      vm.runInContext(
        (mSan ? mSan[0] : '') + '\n'
        + (/function sepAgrupar\([\s\S]*?\n\}/.exec(html) || [''])[0] + '\n'
        + mNomear[0] + '\n;this.__n = sepNomear;', sb);
    } catch (e) { }
    const nomear = sb.__n;
    ok('sepNomear carrega no sandbox', typeof nomear === 'function');
    if (typeof nomear === 'function') {
      const cenario = (nums, esperado) => {
        const usados = new Set();
        const g = vm.runInContext(
          'JSON.stringify(sepAgrupar(' + JSON.stringify(nums) + ',' + nums.length + ',"auto"))',
          sb);
        const grupos = JSON.parse(g);
        const saida = grupos.map((pg) => nomear(nums, pg, true, usados).arquivo);
        ok('nomeação: [' + JSON.stringify(nums) + '] -> ' + esperado.join(', '),
          saida.join(', ') === esperado.join(', '), 'veio ' + JSON.stringify(saida));
      };
      // a mesma tabela do tester, agora como asserção
      cenario([null, '200', '200'], ['NF-200.pdf']);
      cenario([null, null, '200', '200', '201'], ['NF-200.pdf', 'NF-201.pdf']);
      cenario([null, '777'], ['NF-777.pdf']);
      cenario([null, null, null], ['NF-nota_0001.pdf', 'NF-nota_0002.pdf', 'NF-nota_0003.pdf']);
      cenario(['100', '100', '200', '200', '100', '100', '100', '100'],
        ['NF-100.pdf', 'NF-200.pdf', 'NF-100_2.pdf']);
      /* A linha da tabela do tester com ['100','100','200','200','100','100',
         '100','100'] -> 4 nomes é internamente inconsistente: o agrupamento
         (já travado pelo caso "número repetido vira nota nova") junta as
         páginas 4-7 numa nota só, porque o número 100 não mudou. A linha que
         exercita o sufixo _3 tem de ter uma interrupção de verdade: a nota 300
         entre as duas repetições do 100. */
      cenario(['100', '100', '200', '200', '100', '100', '300', '300', '100', '100'],
        ['NF-100.pdf', 'NF-200.pdf', 'NF-100_2.pdf', 'NF-300.pdf', 'NF-100_3.pdf']);
      // sem ler o número: nome por página
      {
        const usados = new Set();
        const g = JSON.parse(vm.runInContext('JSON.stringify(sepAgrupar([null,"200","200"],3,"auto"))', sb));
        const saida = g.map((pg) => nomear([null, '200', '200'], pg, false, usados).arquivo);
        ok('sem ler número: nome por página', saida[0] === 'NF-pagina_0001.pdf', JSON.stringify(saida));
      }
      ok('sepNomear devolve o numeroNota usado no log',
        nomear(['200', '200'], [0, 1], true, new Set()).numeroNota === '200');
    }
  }
  ok('a nomeação usa a PRIMEIRA página do grupo que tem número (não só a [0])',
    /const pNum = paginas\.find\(\(p\) => numsPag\[p\]\)/.test(html));
  ok('PDF de 0 página é barrado antes dos early returns',
    /if \(!\(total > 0\)\) return \[\];/.test(html));
}

// ══════════════════════════════════════════════════════════════
grupo('11.2 · MÓDULO DE CNPJ EXECUTADO (sandbox vm com DOM stub)');
// ══════════════════════════════════════════════════════════════
/* O gate antigo só lia texto. Os bloqueios B1/B3/B6 viviam exatamente aí:
   um ReferenceError numa interpolação de template, uma função de outra IIFE,
   e um cache gravado CRU — nada disso aparece num regex. Aqui a IIFE inteira
   do index.html é executada. */
function extrairCnpjModule() {
  const marca = '  const API="https://publica.cnpj.ws/cnpj/";';
  const i = html.indexOf(marca);
  if (i < 0) return null;
  const abre = html.lastIndexOf('(() => {', i);
  /* A IIFE de CNPJ tem duas: a externa e a do lote, aninhada. O fim é o
     `})();` que fecha a EXTERNA — o segundo depois do último avisoCache(). */
  const ultimo = html.lastIndexOf('avisoCache();');
  const fimLote = html.indexOf('})();', ultimo);
  const fim = html.indexOf('})();', fimLote + 1);   // +1: senão reacha a mesma
  if (abre < 0 || ultimo < 0 || fim < 0) return null;
  const corpo = html.slice(abre, ultimo);
  /* Exposição só para o harness: o código executado é o do index.html, com uma
     linha a mais em cada escopo que publica funções privadas. Sem isto o teste
     só poderia conferir a forma do texto — que é o que não prova nada.
     A linha do lote entra ANTES do fechamento da IIFE aninhada, porque
     cnpjsDoTexto/renderLote/registra vivem ali, e a da consulta antes do
     fechamento da externa. */
  return corpo
    + '\n    this.__lote = { cnpjsDoTexto, renderLote, registrar: registra, avisoCache, lista: () => lista, resultados: () => resultados,'
    + ' step, carregar: (l) => { lista = l; idx = 0; resultados = []; abort = false; pausaAte = 0; recusas = 0; },'
    + ' estado: () => ({ idx, pausaAte, recusas }), tempo: tempoLote, fimDaPausa: () => { pausaAte = 0; }, parar: () => { abort = true; } };\n  '
    + html.slice(ultimo + 'avisoCache();'.length, fim)
    + '\n  this.__t = { consultar, render, lerCache, gravarCache, cacheResumo, expurgarCacheLegado, CHAVE_CACHE, CHAVE_CACHE_LEGADO };\n  })();';
}
function stubEl(id) {
  const el = {
    id, value: '', textContent: '', innerHTML: '', disabled: false, dataset: {},
    style: {}, files: null,
    scrollTop: 0, scrollHeight: 0, classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    /* guarda o ouvinte: o teste do lote dispara o 'change' real do arquivo */
    addEventListener(tipo, f) { (el._ouv = el._ouv || {})[tipo] = f; }, removeEventListener() { },
    appendChild(c) { (el._filhos = el._filhos || []).push(c); return c; },
    querySelectorAll: () => [],
    querySelector: () => null,
    click() { },
    setAttribute() { }, removeAttribute() { }, getAttribute: () => null,
  };
  return el;
}
/* Storage com key(i) de verdade: cacheEntradas/expurgarCacheLegado varrem por
   índice, e o stub do grupo 8 (tema) devolve null — o que faria o expurgo e o
   resumo de cache passarem por vazio sem provar nada. */
function storageReal(semente) {
  const dados = Object.assign({}, semente || {});
  return {
    _d: dados,
    getItem(k) { return Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null; },
    setItem(k, v) { dados[k] = String(v); },
    removeItem(k) { delete dados[k]; },
    key(i) { return Object.keys(dados)[i] === undefined ? null : Object.keys(dados)[i]; },
    get length() { return Object.keys(dados).length; },
    clear() { for (const k of Object.keys(dados)) delete dados[k]; },
  };
}
function ambienteCnpj({ storage, fetchImpl, modPdf }) {
  const els = {};
  /* Os dois stubs de abaixo precisam ser reais: o painel de cache lê as
     entradas por localStorage.key(i) e é atualizado por um evento, não por
     chamada direta. */
  const ouvintes = {};
  const ids = ['cnpj-input', 'cnpj-btn', 'cnpj-limpar', 'cnpj-result', 'cnpj-raw', 'cnpj-status',
    'cnpj-lote-file', 'cnpj-lote-start', 'cnpj-lote-stop', 'cnpj-lote-export', 'cnpj-lote-modelo',
    'cnpj-lote-bar', 'cnpj-lote-bar-inner', 'cnpj-lote-info', 'cnpj-lote-eta', 'cnpj-lote-log',
    'cnpj-lote-table', 'cnpj-cache-aviso', 'cnpj-lote-resumo', 'cnpj-lote-tela'];
  ids.forEach((i) => { els[i] = stubEl(i); });
  const doc = {
    getElementById: (i) => els[i] || null,
    createElement: () => stubEl('novo'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(tipo, f) { (ouvintes[tipo] = ouvintes[tipo] || []).push(f); },
    dispatchEvent(ev) { (ouvintes[ev && ev.type] || []).forEach((f) => f(ev)); return true; },
    body: { appendChild() { }, removeChild() { } },
  };
  const sandbox = {
    document: doc, localStorage: storage, fetch: fetchImpl,
    CustomEvent: function CustomEvent(t) { this.type = t; },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Intl, Promise, Set, String, Number, Object, Array, Error,
    TextDecoder, console: { log() { }, warn() { }, error() { } },
    window: { ModPDFIsolado: modPdf, addEventListener() { }, XLSX: undefined },
    Blob: function Blob() { }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // helpers que vivem no script principal e são consumidos pelo módulo
  vm.runInContext(
    /function ESC\(s\)\{[\s\S]*?\n/.exec(html)[0] + '\nthis.esc=ESC;'
    + '\nfunction f(v){if(v===null||v===undefined)return 0;let s=String(v).replace(/[^0-9,\\-.]/g,\'\');if(s.includes(\',\')){s=s.replace(/\\./g,\'\').replace(\',\',\'.\');}const n=parseFloat(s);return isNaN(n)?0:n}'
    + '\nfunction moeda(v){return `R$ ${f(v).toLocaleString(\'pt-BR\',{minimumFractionDigits:2,maximumFractionDigits:2})}`}',
    sandbox);
  return { sandbox, els };
}
function rodarCnpj(opts) {
  const src = extrairCnpjModule();
  const { sandbox, els } = ambienteCnpj(opts);
  const erros = [];
  try {
    vm.runInContext(src, sandbox, { filename: 'index.html#cnpj' });
  } catch (e) {
    erros.push(e);
  }
  return { sandbox, els, erros, t: sandbox.__t };
}
await (async () => {
  const modPdf = (() => {
    const src = /function vC\(c\)\{[\s\S]*?\n/.exec(html)[0];
    const sb = { d: (s) => (s || '').replace(/\D/g, '') };
    vm.createContext(sb);
    vm.runInContext(src, sb);
    return sb.vC;
  })();
  const cnpjValido = '11.222.333/0001-81';

  // ── B3: CNPJ com 11/13/15 dígitos ──
  [11, 13, 15].forEach((n) => {
    const storage = storageReal();
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.reject(new Error('não deveria buscar')),
      modPdf: { vC: modPdf },
    });
    ok('módulo de CNPJ sobe sem exceção (base p/ ' + n + ' dígitos)', erros.length === 0,
      erros.map((e) => e.message).join('|'));
    if (erros.length) return;
    els['cnpj-input'].value = '1'.repeat(n);
    let r = '';
    try { t.consultar(); r = 'ok'; } catch (e) { r = e.constructor.name + ': ' + e.message; }
    ok('consultar() com ' + n + ' dígitos não lança ReferenceError', r === 'ok', r);
    const html14 = els['cnpj-result'].innerHTML;
    ok('consultar() com ' + n + ' dígitos mostra a mensagem de 14 caracteres',
      /14 caracteres/.test(html14) && !/undefined/.test(html14), html14.slice(0, 160));
  });

  // ── B1: vC vem do módulo de PDF, não de uma função livre ──
  {
    const storage = storageReal();
    const { sandbox, t, erros } = rodarCnpj({ storage, fetchImpl: () => Promise.reject(new Error('x')), modPdf: { vC: modPdf } });
    ok('módulo sobe para o teste de vC', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (!erros.length) {
      /* cnpjsDoTexto vive na IIFE aninhada do lote (ver extrairCnpjModule). */
      const cnpjsDoTexto = sandbox.__lote.cnpjsDoTexto;
      let achou = null, erro = '';
      try { achou = [...cnpjsDoTexto(cnpjValido)]; } catch (e) { erro = e.constructor.name + ': ' + e.message; }
      ok('cnpjsDoTexto() lê um CNPJ válido (vC resolvido, sem "vC is not defined")',
        erro === '' && achou.length === 1 && achou[0] === '11222333000181', erro || JSON.stringify(achou));
      let cov = [], erro2 = '';
      try { cov = [...cnpjsDoTexto('CNPJ 11.222.333/0001-81 e 11.111.111/1111-11')]; } catch (e) { erro2 = e.constructor.name + ': ' + e.message; }
      ok('cnpjsDoTexto() descarta CNPJ com DV inválido (não gasta taxa do lote)',
        erro2 === '' && cov.length === 1 && cov[0] === '11222333000181', erro2 || JSON.stringify(cov));
      /* O bug original: vC é função da OUTRA IIFE. Se alguém voltar a chamar
         vC() sem prefixar, este caso volta a falhar — com o nome do erro. */
      const semPrefixo = /[^.\w]vC\(soDigitos\)/.test(html);
      ok('cnpjsDoTexto chama vC pelo contrato do módulo (ModPDFIsolado.vC)',
        !semPrefixo && /window\.ModPDFIsolado\.vC\(soDigitos\)/.test(html));
      /* E o contrato precisa realmente publicar vC (foi o que faltou). */
      ok('o return de ModPDFIsolado publica vC e vH',
        /return\{extrair,parseFull,mergeExtracao,finalizar,tC,vC,vH\};/.test(html));
    }
  }

  // ── CNPJ alfanumérico (NT 2026.004) na consulta e no lote ──
  /* Sintéticos declarados no gate do grupo 2: o exemplo público da Receita e o
     mesmo com o DV trocado. */
  {
    const ALFA = '12ABC34501DE35';
    const storage = storageReal();
    const pedidos = [];
    const { sandbox, t, els, erros } = rodarCnpj({
      storage,
      fetchImpl: (url) => { pedidos.push(url); return Promise.resolve({ ok: true, json: async () => ({ razao_social: 'EXEMPLO ALFA LTDA', estabelecimento: { cnpj: ALFA } }) }); },
      modPdf: { vC: modPdf },
    });
    ok('módulo sobe para o teste do CNPJ alfanumérico', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (!erros.length) {
      const doTexto = (s) => [...sandbox.__lote.cnpjsDoTexto(s)];
      ok('cnpjsDoTexto lê o CNPJ alfanumérico mascarado e cru',
        doTexto('Cliente 12.ABC.345/01DE-35 emite').join() === ALFA && doTexto(ALFA).join() === ALFA,
        JSON.stringify(doTexto('Cliente 12.ABC.345/01DE-35 emite')));
      ok('cnpjsDoTexto descarta o alfanumérico de DV inválido',
        doTexto('12.ABC.345/01DE-36').length === 0);
      ok('cnpjsDoTexto não pega palavra em maiúscula colada em número',
        doTexto('CODIGOINTERNO12 PRODUTOXYZABC99').length === 0);
      /* DESTINATARIO04 fecha o DV: só a forma o separa de um CNPJ. */
      ok('cnpjsDoTexto: palavra que fecha o DV no meio de uma observação não é CNPJ',
        doTexto('entregar ao DESTINATARIO04 amanha').length === 0);
      ok('cnpjsDoTexto: alfanumérico cru vale quando é a célula inteira (CSV)',
        doTexto('CNPJ;Obs\n' + ALFA + ';x\n').join() === ALFA && doTexto('"' + ALFA + '"').join() === ALFA);
      ok('cnpjsDoTexto: minúscula fica de fora no lote (a consulta individual aceita)',
        doTexto('12.abc.345/01de-35').length === 0);
      ok('cnpjsDoTexto: célula com espaço e tab nas bordas ainda vale',
        doTexto('x;  ' + ALFA + ' \t;y').join() === ALFA);
      /* ReDoS: a entrada hostil é a sequência do separador que o lookbehind
         aceita. Com `[ \t]*` logo depois dele, 100 KB de tab levavam ~10 s. */
      {
        const ini = Date.now();
        doTexto('\t'.repeat(100000) + 'X');
        doTexto(' \t'.repeat(50000) + 'X');
        const ms = Date.now() - ini;
        ok('cnpjsDoTexto: 100 KB de tabs/espaços não travam (linear)', ms < 300, ms + ' ms');
      }
      ok('cnpjsDoTexto continua lendo o numérico ao lado do alfanumérico',
        doTexto('12.ABC.345/01DE-35;11.222.333/0001-81').sort().join() === ['11222333000181', ALFA].sort().join());
      ok('o vC do módulo de PDF valida o alfanumérico (o lote usa o mesmo)', modPdf(ALFA) === true && modPdf('12ABC34501DE36') === false);

      els['cnpj-input'].value = '12.abc.345/01de-35';
      await t.consultar();
      ok('consultar() aceita o alfanumérico e pede publica.cnpj.ws com 14 caracteres em maiúscula',
        pedidos.length === 1 && pedidos[0] === 'https://publica.cnpj.ws/cnpj/' + ALFA, JSON.stringify(pedidos));
      ok('o resultado mostra o CNPJ alfanumérico formatado',
        /12\.ABC\.345\/01DE-35/.test(els['cnpj-result'].innerHTML), els['cnpj-result'].innerHTML.slice(0, 200));
      const antes = pedidos.length;
      els['cnpj-input'].value = '12.ABC.345/01D';
      await t.consultar();
      ok('consultar() com alfanumérico incompleto não busca e mostra a mensagem',
        pedidos.length === antes && /14 caracteres/.test(els['cnpj-result'].innerHTML));
      els['cnpj-input'].value = '12ABC34501DEA5';
      await t.consultar();
      ok('consultar() recusa letra na posição do DV', pedidos.length === antes);
      /* A máscara do campo enquanto digita: letra fica, em maiúscula. */
      const ouv = els['cnpj-input']._ouv && els['cnpj-input']._ouv.input;
      if (ouv) {
        const ev = { target: { value: '12abc34501de35' } };
        ouv(ev);
        ok('a máscara do campo formata o alfanumérico', ev.target.value === '12.ABC.345/01DE-35', ev.target.value);
      } else ok('o campo de CNPJ tem ouvinte de digitação', false);
    }
  }

  // ── Lote: 429 espera e repete o MESMO CNPJ; 404 vira "não encontrado" ──
  /* O bug: o 429 virava ERRO e o lote passava ao próximo CNPJ 20s depois,
     ainda dentro da janela da recusa — as recusas se emendavam e o lote
     inteiro saía "HTTP 429". */
  {
    const storage = storageReal();
    const fila = [];
    const pedidos = [];
    const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const { sandbox, els, erros } = rodarCnpj({
      storage, fetchImpl: (u) => { pedidos.push(String(u).slice(-14)); return Promise.resolve(fila.shift()); },
      modPdf: { vC: modPdf },
    });
    ok('módulo sobe para o teste de 429 do lote', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (!erros.length) {
      /* o rodapé do lote esconde o pai do #cnpj-lote-info quando está vazio */
      els['cnpj-lote-info'].parentElement = els['cnpj-lote-info'].parentElement || { hidden: false };
      const L = sandbox.__lote;
      const api = { razao_social: 'EMPRESA TESTE', estabelecimento: { estado: { sigla: 'SP' } } };
      L.carregar(['11222333000181', '00000000000191']);
      fila.push(resp(429));
      await L.step();
      let e = L.estado();
      ok('429: o lote NÃO avança para o próximo CNPJ', e.idx === 0 && L.resultados().length === 0, JSON.stringify(e));
      ok('429: o lote entra em espera (pelo menos 1 min)', e.pausaAte - Date.now() >= 55000, String(e.pausaAte - Date.now()));
      await L.step();
      ok('429: durante a espera o intervalo não consulta nada', pedidos.length === 1, JSON.stringify(pedidos));
      fila.push(resp(429));
      L.fimDaPausa(); await L.step();
      e = L.estado();
      ok('429 seguido: a espera cresce (2 min)', e.recusas === 2 && e.pausaAte - Date.now() >= 115000, JSON.stringify(e));
      fila.push(resp(200, api));
      L.fimDaPausa(); await L.step();
      e = L.estado();
      ok('depois da espera, o MESMO CNPJ é consultado de novo e entra OK',
        pedidos[2] === '11222333000181' && e.idx === 1 && L.resultados()[0].ok === true && e.recusas === 0,
        JSON.stringify({ pedidos, e, r: L.resultados() }));
      fila.push(resp(404));
      await L.step();
      const r404 = L.resultados()[1] || {};
      ok('404 sai como "não encontrado", não como código cru', r404.ok === false && /não encontrado/.test(r404.msg) && !/HTTP/.test(r404.msg), JSON.stringify(r404));

      /* cada cenário começa sem cache: o CNPJ que entrou OK acima voltaria do
         cache e não passaria pela consulta */
      const novo = (l) => { storage.clear(); L.carregar(l); };

      // 429 → 404 → 429: a resposta que não é 429 zera a espera crescente
      novo(['11222333000181', '00000000000191']);
      fila.push(resp(429)); await L.step(); L.fimDaPausa();
      fila.push(resp(404)); await L.step();
      fila.push(resp(429)); await L.step();
      e = L.estado();
      ok('depois de um 404 a espera recomeça de 1 min (recusas zeradas)', e.recusas === 1 && e.idx === 1, JSON.stringify(e));

      // sem resposta (rede, ou 429 sem CORS): mesma espera, não vira ERRO
      novo(['11222333000181']);
      fila.push(Promise.reject(new TypeError('Failed to fetch'))); await L.step();
      e = L.estado();
      ok('falha de rede: espera e repete o mesmo CNPJ', e.idx === 0 && e.pausaAte > Date.now() && L.resultados().length === 0, JSON.stringify(e));

      // 6 recusas seguidas: o CNPJ sai como ERRO e o lote anda (não fica preso)
      novo(['11222333000181', '00000000000191']);
      for (let k = 0; k < 6; k++) { fila.push(resp(429)); L.fimDaPausa(); await L.step(); }
      e = L.estado();
      const rMax = L.resultados()[0] || {};
      ok('depois de 6 recusas o CNPJ vira ERRO e o lote segue', e.idx === 1 && rMax.ok === false && /6 tentativas/.test(rMax.msg) && e.recusas === 0, JSON.stringify({ e, rMax }));

      // 500: erro comum, sem espera
      novo(['11222333000181']);
      fila.push(resp(500)); await L.step();
      e = L.estado();
      ok('HTTP 500 sai como erro e não entra em espera', e.idx === 1 && e.pausaAte === 0 && /HTTP 500/.test((L.resultados()[0] || {}).msg), JSON.stringify(e));

      // Parar durante a espera: o próximo tick encerra o lote, não fica preso na pausa
      novo(['11222333000181', '00000000000191']);
      fila.push(resp(429)); await L.step();
      const antes = pedidos.length;
      L.parar(); await L.step();
      ok('parar durante a espera encerra o lote sem consultar de novo', pedidos.length === antes && /Concluído/.test(els['cnpj-lote-info'].textContent), els['cnpj-lote-info'].textContent);

      // Parado com a consulta em voo: o resultado não entra depois do "Parado"
      novo(['11222333000181']);
      let solta;
      fila.push(new Promise((res) => { solta = res; }));
      const voo = L.step();
      L.parar();
      solta(resp(200, api));
      await voo;
      ok('parado com consulta em voo: o resultado não entra na lista depois do "Parado"', L.resultados().length === 0, JSON.stringify(L.resultados()));
      ok('parado com consulta em voo: o resultado fica no cache (a consulta já foi gasta)',
        !!sandbox.__t.lerCache(sandbox.__t.CHAVE_CACHE + '11222333000181'));
    }
  }
  ok('Iniciar e Parar trocam a geração (consulta em voo do ciclo anterior é descartada)',
    /stop\?\.addEventListener\('click',\(\)=>\{ abort=true; ger\+\+;/.test(html) && /ger\+\+;\s*\n\s*resultados=\[\]; idx=0;/.test(html));
  // ── Lote: os já lidos (cache) entram na hora; importar mostra o resumo e libera exportar ──
  {
    const storage = storageReal();
    const pedidos = [];
    const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const fila = [];
    const { sandbox, els, erros } = rodarCnpj({
      storage, fetchImpl: (u) => { pedidos.push(String(u).slice(-14)); return Promise.resolve(fila.shift()); },
      modPdf: { vC: modPdf },
    });
    ok('módulo sobe para o teste de retomada do lote', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (!erros.length) {
      els['cnpj-lote-info'].parentElement = els['cnpj-lote-info'].parentElement || { hidden: false };
      const L = sandbox.__lote, T = sandbox.__t;
      const api = { razao_social: 'EMPRESA TESTE', estabelecimento: { estado: { sigla: 'SP' } } };
      T.gravarCache(T.CHAVE_CACHE + '11222333000181', api);
      T.gravarCache(T.CHAVE_CACHE + '12345678000195', api);
      // importar um CSV com 3 CNPJs, 2 já lidos
      els['cnpj-lote-file'].files = [{ name: 'lote.csv', arrayBuffer: async () => new TextEncoder().encode('CNPJ\n11.222.333/0001-81\n12.345.678/0001-95\n00.000.000/0001-91\n').buffer }];
      await els['cnpj-lote-file']._ouv.change();
      const res = els['cnpj-lote-resumo'];
      ok('importar: o resumo mostra total, já lidos e faltam', res.hidden === false && />3</.test(res.innerHTML) && />2</.test(res.innerHTML) && />1</.test(res.innerHTML), res.innerHTML.slice(0, 200));
      ok('importar: os já lidos ficam prontos para exportar na hora', els['cnpj-lote-export'].disabled === false && L.resultados().length === 2 && /Exportar 2 já lidos/.test(els['cnpj-lote-export'].innerHTML), els['cnpj-lote-export'].innerHTML);
      ok('importar: o botão vira "Continuar lote (faltam 1)"', /Continuar lote \(faltam 1\)/.test(els['cnpj-lote-start'].innerHTML), els['cnpj-lote-start'].innerHTML);
      ok('importar: o resumo não gasta consulta', pedidos.length === 0, JSON.stringify(pedidos));
      // um disparo só: os 2 do cache entram e o 3º já é consultado
      L.carregar(L.lista());
      fila.push(resp(200, api));
      await L.step();
      const e = L.estado();
      ok('retomar: os já lidos entram no mesmo disparo e o próximo já é consultado', e.idx === 3 && pedidos.length === 1 && pedidos[0] === '00000000000191' && L.resultados().length === 3, JSON.stringify({ e, pedidos }));
      ok('durante o lote o Exportar fica liberado com a contagem', els['cnpj-lote-export'].disabled === false && /Exportar 3 resultados/.test(els['cnpj-lote-export'].innerHTML), els['cnpj-lote-export'].innerHTML);
      ok('retomar: o log resume os já lidos numa linha', /\[1–2\/3\] 2 CNPJ\(s\) já lidos \(cache\)/.test(JSON.stringify(els['cnpj-lote-log']._filhos.map((d) => d.textContent))), '');
      // sem Wake Lock no ambiente: o aviso explica o que fazer
      ok('sem Wake Lock: o tempo estimado usa horas', sandbox.__lote.tempo(1824) === '~10h08', sandbox.__lote.tempo(1824));
    }
  }
  ok('Wake Lock: pede no Iniciar, solta no Parar e no fim, e pede de novo ao voltar à aba',
    /ultimoTick=Date\.now\(\); emLote=true; manterTela\(\);/.test(html) && /soltarTela\(\);[^\n]*loteLog\('Parado pelo usuário'/.test(html)
    && /soltarTela\(\); rotulo\(start,ICO_PLAY,'Iniciar lote'\);\s*\n\s*avisoCache\(\);\s*\n\s*return;/.test(html) && /visibilitychange[^\n]*manterTela\(\)/.test(html));
  ok('repouso do computador: o lote avisa quanto tempo ficou parado', /agora-ultimoTick>LOTE_SONO_MS/.test(html));
  ok('Parar libera a exportação do parcial', /stop\?\.addEventListener[^\n]*exp\.disabled=resultados\.length===0/.test(html));

  // ── B3b: fetch rejeita com payload HTML na mensagem ──
  {
    const storage = storageReal();
    const evil = 'HTTP 500 <img src=x onerror="window.__pwn=1">';
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.reject(new Error(evil)), modPdf: { vC: modPdf },
    });
    ok('módulo sobe com fetch que rejeita', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (!erros.length) {
      els['cnpj-input'].value = cnpjValido;
      await t.consultar();
      const h = els['cnpj-result'].innerHTML;
      ok('mensagem de erro da API escapa o HTML (nada de <img onerror> cru)',
        !/<img/i.test(h) && /&lt;img/i.test(h), h.slice(0, 220));
      ok('a mensagem de erro aparece uma vez, com o marcador na frente',
        (h.match(/onerror/g) || []).length === 1 && h.indexOf('✗') < h.indexOf('HTTP 500'),
        h.slice(0, 220));
    }
  }

  // ── B6: cache legado gravado CRU é expurgado, e o render escapa ──
  {
    const storage = storageReal();
    const cru = {
      razao_social: '<img src=x onerror="window.__pwn=1"> LTDA',
      estabelecimento: { cnpj: '11222333000181', inscricoes_estaduais: [] },
      socios: [{ nome: 'Fulano', cpf_cnpj_socio: '123.456.789-00' }],
    };
    /* build 627b8e0: envelope {t,d} com d CRU, prefixo antigo */
    storage.setItem('cnpj_11222333000181', JSON.stringify({ t: Date.now(), d: cru }));
    storage.setItem('cnpj_v2_11222333000181', JSON.stringify({ t: Date.now(), d: cru }));
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.reject(new Error('não deve buscar: está em cache')),
      modPdf: { vC: modPdf },
    });
    ok('módulo sobe com cache semeado', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (erros.length) return;
    ok('o expurgo apaga a entrada do namespace legado (PII não fica órfão)',
      storage.getItem('cnpj_11222333000181') === null,
      String(storage.getItem('cnpj_11222333000181')).slice(0, 80));
    ok('o expurgo NÃO apaga a entrada nova (o cache continua funcionando)',
      storage.getItem('cnpj_v2_11222333000181') !== null);
    ok('a chave nova é versionada (cnpj_v2_) e a legada declarada',
      t.CHAVE_CACHE === 'cnpj_v2_' && t.CHAVE_CACHE_LEGADO === 'cnpj_');
    ok('o resumo de cache só enxerga a chave nova (Limpar cache funciona)',
      t.cacheResumo().n === 1, JSON.stringify(t.cacheResumo()));
    // render da entrada CRU (simulando o que o build antigo deixou no navegador)
    els['cnpj-input'].value = cnpjValido;
    await t.consultar();
    const h = els['cnpj-result'].innerHTML;
    ok('render() escapa payload cru vindo do cache (XSS armazenado)',
      !/<img/i.test(h) && /&lt;img/i.test(h), h.slice(0, 240));
    ok('o texto do payload cru aparece escaped na tela, não interpretado',
      /&lt;img src=x onerror=/.test(h), h.slice(0, 240));
  }

  // ── B6b: grava pela chave nova, relê e renderiza com HTML da API ──
  {
    const storage = storageReal();
    const api = { razao_social: '<img src=x onerror="window.__pwn=1">', estabelecimento: { cnpj: '11222333000181' } };
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => api }),
      modPdf: { vC: modPdf },
    });
    ok('módulo sobe com fetch bem-sucedido', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (erros.length) return;
    els['cnpj-input'].value = cnpjValido;
    await t.consultar();
    const h = els['cnpj-result'].innerHTML;
    ok('render() escapa HTML vindo da API nova', !/<img/i.test(h) && /&lt;img/i.test(h), h.slice(0, 200));
    const gravado = storage.getItem('cnpj_v2_11222333000181');
    ok('o cache guarda o dado CRU (o escape é do render, não da fronteira)',
      gravado !== null && /"<img src=x onerror=/.test(gravado), String(gravado).slice(0, 120));
    ok('o aviso de cache fica VISÍVEL depois de uma consulta bem-sucedida (B26)',
      els['cnpj-cache-aviso'].style.display === 'block',
      els['cnpj-cache-aviso'].style.display + ' / ' + els['cnpj-cache-aviso'].innerHTML.slice(0, 80));
  }

  // ── B7: injeção de fórmula no CSV (um helper só, compartilhado) ──
  {
    /* Revisão de segurança: o escape do CSV do lote morava dentro da IIFE dele e o
       export do leitor de PDF nao escapava nada. Com o eEndereco deixando de usar
       a classe [A-Z0-9 .,-] e o nome do participante aceitando os tokens crus do
       texto do PDF, `=HYPERLINK("http://evil.tld","clique")` passou a chegar ao
       .csv do leitor de PDF. O helper virou `window.GCON.csvCelula` e os dois
       caminhos de exportacao passam a chamalo. */
    /* O fonte e executado como esta: nada de reescrever a expressao (uma
       transformacao de texto aqui ja quebrou uma vez e o sintoma foi um
       SyntaxError sem relacao com a regra testada). */
    const ini = html.indexOf('window.GCON={csvCelula:');
    const fim = ini < 0 ? -1 : html.indexOf('}};', ini) + 3;
    const sbCsv = { window: {} };
    let carregouCelula = '';
    try { vm.runInNewContext(html.slice(ini, fim), sbCsv, { filename: 'csv#celula' }); carregouCelula = 'ok'; } catch (e) { carregouCelula = e.message; }
    const celula = ini < 0 ? null : sbCsv.window.GCON && sbCsv.window.GCON.csvCelula;
    ok('a função de escape do CSV existe em UM lugar só (window.GCON.csvCelula)', typeof celula === 'function', carregouCelula);
    /* A unidade da contagem e o padrao do proprio sanitizador (o .source dele), e
       nao um regex escrito a mao: escaped duas vezes, esse padrao erra em silencio
       e o teste vira verde sem verificar nada. */
    const ALVO = /^[=+\-@\t\r]/.source;
    const nDup = html.split(ALVO).length - 1;
    ok('a escape do CSV não é duplicada (nenhuma segunda implementação do prefixo de fórmula)',
      nDup === 1, nDup + ' ocorrência(s) de ' + ALVO);
    /* O helper só serve se SOBREVIVER ao carregamento inteiro: o script do tema
       fazia window.GCON={theme:...} e apagava o csvCelula. A falha só aparecia
       no navegador, ao exportar — o teste acima monta o GCON sozinho e passava.
       Aqui: um único "window.GCON={" (a criação), e todo o resto acrescenta. */
    ok('ninguém substitui window.GCON depois de criado (o tema acrescenta, não apaga o csvCelula)',
      (html.match(/window\.GCON=\{/g) || []).length === 1
      && /window\.GCON=Object\.assign\(window\.GCON\|\|\{\},\{theme:/.test(html),
      (html.match(/window\.GCON=\{/g) || []).length + ' substituição(ões) de window.GCON');
    {
      /* E na prática: roda a criação do GCON e depois a linha do tema no MESMO
         contexto, como o navegador faz, e confere que as duas coisas existem. */
      const criar = html.slice(html.indexOf('window.GCON={csvCelula:'), html.indexOf('\n', html.indexOf('window.GCON={csvCelula:')));
      const tema = (html.match(/window\.GCON=Object\.assign\([^\n]*/) || [''])[0];
      const ctx = { window: {}, isDark() {}, applyTheme() {}, recolorCharts() {} };
      let r = 'nao rodou';
      try { vm.createContext(ctx); vm.runInContext(criar + ';' + tema + ';', ctx); r = typeof ctx.window.GCON.csvCelula + '/' + typeof ctx.window.GCON.theme; } catch (e) { r = e.message; }
      ok('depois do tema, window.GCON ainda tem csvCelula E theme', r === 'function/object', r);
    }
    ok('o export do LOTE de CNPJ usa o helper compartilhado', /const q=window\.GCON\.csvCelula;/.test(html));
    /* O terceiro caminho: o CSV de NF-e/NFS-e só duplicava aspas. Com o
       infAdProd passando a vir preenchido (texto livre do emitente, até 500
       caracteres), um "=HYPERLINK(...)" chegava cru ao Excel. */
    ok('o export CSV de NF-e/NFS-e usa o helper compartilhado (sem escape feito à mão)',
      /function exportCSV\(tipo\)\{[\s\S]{0,900}?cab\.map\(c=>window\.GCON\.csvCelula\(formatoBr\(row\[c\]\)\)\)/.test(html)
      && !/function exportCSV\(tipo\)\{[\s\S]{0,600}?replace\(\/"\/g,'""'\);return\/\[;\\n"\]\//.test(html));
    {
      /* Executa o exportCSV REAL num vm, com um item cujo texto livre começa
         com = e @, e mede o arquivo gerado. */
      const ini = html.indexOf('function exportCSV(tipo){');
      const fim = html.indexOf('\n}', ini) + 2;
      let saida = '', erro = '';
      try {
        const sbx = { window: { GCON: {} }, Blob: function (p) { saida = p.join(''); }, URL: { createObjectURL: () => 'x', revokeObjectURL() {} },
          document: { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } }, exportAviso() {},
          formatoBr: (v) => (v == null ? '' : String(v)), HNFE: ['xProd', 'infAdProd', 'Veic_Chassi', 'vProd'], HNFSE: [],
          DB: { nfe: [{ xProd: '=HYPERLINK("http://x")', infAdProd: '@SUM(1)', Veic_Chassi: '+1', vProd: '10,00' }], nfse: [], sessaoId: 't' } };
        vm.createContext(sbx);
        vm.runInContext(html.slice(html.indexOf('window.GCON={csvCelula:'), html.indexOf('\n', html.indexOf('window.GCON={csvCelula:'))), sbx);
        vm.runInContext(html.slice(ini, fim) + ';exportCSV("nfe")', sbx);
      } catch (e) { erro = e.message; }
      const linha = saida.split('\n')[1] || '';
      ok('CSV de NF-e: texto que começa com = @ + sai neutralizado com \' e entre aspas',
        !erro && linha.includes('"\'=HYPERLINK(""http://x"")"') && linha.includes('"\'@SUM(1)"') && linha.includes('"\'+1"') && linha.includes('"10,00"'),
        erro || linha);
    }
    ok('o export do LEITOR DE PDF usa o helper compartilhado',
      /\.map\(window\.GCON\.csvCelula\)\.join\(';'\)/.test(html)
      && !/pdf_leitura[\s\S]{0,400}?replace\(\/"\/g,'""'\)/.test(html),
      (/\.map\(window\.GCON\.csvCelula\)/.test(html) ? 'ok' : 'nao achou o .map(window.GCON.csvCelula)'));
    if (typeof celula === 'function') {
      const q = celula;
      const casos = [['=1+1', '\'=1+1'], ['@SUM(A1)', "'@SUM(A1)"], ['-2+3+cmd', "'-2+3+cmd"],
        ['+41', "'+41"], ['\tcmd', "'\tcmd"], ['EMPRESA LTDA', 'EMPRESA LTDA'],
        ['=HYPERLINK("x")', '\'=HYPERLINK(""x"")']];
      casos.forEach(([entra, esperado]) => {
        ok('CSV neutraliza fórmula: ' + JSON.stringify(entra), q(entra) === '"' + esperado + '"', q(entra));
      });
      /* O XLSX vai por XLSX.utils.aoa_to_sheet, que escreve string como string
         (fórmula exigiria {f:...}), então o risco é do caminho CSV — que é o
         caminho de reserva e o que roda quando a CDN do Excel cai. */
      ok('o export XLSX do lote escreve string (sem objeto {f:})',
        /const ws=XLSX\.utils\.aoa_to_sheet\(\[header,\.\.\.rows\]\)/.test(html));
    }
  }

  // ── B8: o aviso de privacidade do arquivo gerado não é falso ──
  {
    const mIns = /const INSTRUCOES=(\[[\s\S]*?\n    \]);/.exec(html);
    ok('INSTRUCOES extraível', !!mIns);
    if (mIns) {
      const linhas = vm.runInNewContext(mIns[1]).map((l) => l[0]);
      /* Só as linhas que FAZEM afirmação de privacidade — as que citam para
         onde os dados vão. As demais linhas de "Limites" falam de cache e de
         CDN e não são afirmação de privacidade. */
      const priv = linhas.filter((t) => /nada é enviado|não são enviados|nenhum servidor|transmitid|enviado a fora|servidor/i.test(t));
      ok('o painel gerado tem aviso de privacidade', priv.length > 0, JSON.stringify(priv));
      priv.forEach((t) => {
        ok('aviso de privacidade cita publica.cnpj.ws: ' + t.slice(0, 60),
          /publica\.cnpj\.ws/.test(t), t);
        ok('aviso de privacidade NÃO afirma "nenhum servidor": ' + t.slice(0, 60),
          !/nenhum servidor|não são enviados a nenhum servidor/i.test(t), t);
      });
    }
    /* O aviso da tela (#cnpj-privacidade) e o do arquivo precisam concordar.
       O bloco é um <details> desde a rodada de design, então o fechamento
       pode ser </details> e não só </div>. */
    const tela = /id="cnpj-privacidade"[\s\S]*?<\/(?:div|details)>/.exec(html);
    ok('o aviso da tela também cita publica.cnpj.ws e o CNPJ digitado',
      !!tela && /publica\.cnpj\.ws/.test(tela[0]) && /CNPJ digitado/.test(tela[0]));
    ok('o sumário do avisocollapsed já diz que os dados ficam no navegador (LGPD sem abrir)',
      /<summary>[\s\S]{0,200}?os dados ficam só neste navegador<\/summary>/.test(html));
  ok('o sumário do aviso tem 44px de alvo e foco próprio',
    /\.privacidade>summary\{[^}]*min-height:\s*44px/.test(html)
    && /\.privacidade>summary:focus-visible\{/.test(html));
  /* ── O bug do `hidden` silencioso ────────────────────────────────────────
     display:flex do autor vence o display:none da folha do navegador, então
     `el.hidden = true` não esconde nada em elemento com display explícito. Foi
     o que aconteceu com a faixa de estatísticas e com os contadores: o
     atributo era escrito, o texto sumia, a caixa continuava na tela com
     "0 produtos NF-e". O gate exige o par [hidden]{display:none} para todo
     seletor que o JS apaga por atributo. */
  const somePorAtributo = [...new Set([...html.matchAll(/([.#][\w-]+)\[hidden\]\{display:none\}/g)].map((m) => m[1]))];
  ok('todo bloco que o JS esconde por atributo tem o par [hidden]{display:none}',
    somePorAtributo.length >= 4, 'pares: ' + somePorAtributo.join(', '));
  ok('a faixa de estatísticas some inteira quando não há contagem',
    /#status-bar\[hidden\]\{display:none\}/.test(html)
    && /barra\.hidden=!\(DB\.nfe\.length\+DB\.nfse\.length\+DB\.cte\.length\+DB\.arquivos>0\)/.test(html));
  ok('cada contador some quando volta a zero (a faixa não fica com "0 produtos")',
    /el\.parentElement\.hidden=!\(n>0\)/.test(html) && /#status-bar \.stat\[hidden\]\{display:none\}/.test(html));
  ok('a barra de filtro do leitor de PDF só existe depois do primeiro PDF',
    /id="pdfiso-filtros" hidden/.test(html) && /filtros\.hidden=false;/.test(html)
    && /filtros\.hidden=true;return;/.test(html) && /\.pdfiso-filtros\[hidden\]\{display:none\}/.test(html));
  /* KPIs e a barra de filtro têm a mesma existência, e essa é a razão do gate:
     tirar um dos dois do mesmo ramo faria a tela discordar de si mesma (filtro
     sobre lista vazia, ou KPIs sem lista). As duas escritas precisam ficar
     presas ao mesmo `if`, não basta cada uma existir no arquivo. */
  ok('KPIs e barra de filtro somem juntos, no mesmo ramo (nunca discordam)',
    /if\(!DBpdf\.length\)\{resEl\.innerHTML='';kpis\.style\.display='none';filtros\.hidden=true;return;\}\s*kpis\.style\.display='grid';\s*filtros\.hidden=false;/.test(html));
  /* O :has() é o que centraliza a drop area no estado vazio. O que importa não
     é a regra existir: é ela estar dentro de min-width:769px. Fora da media
     query, a centralização valeria no celular e jogaria a área de drop para
     fora da dobra. */
  /* Atenção: o index.html tem VÁRIOS <style> — o doLeitor de PDF é um bloco
     próprio, dentro da aba, e fica DEPOIS do primeiro </style>. Por isso o
     gate do :has() olha `html` inteiro, e não `css` (que é só o primeiro
     bloco). Errar esse corte faz o gate passar sem ver nada: foi o que
     aconteceu na primeira versão deste caso. */
  const blocoHas = /@media \(min-width:769px\)\{([\s\S]*?)\n\s*\}/.exec(html);
  const cssAqui = html;
  ok('a centralização da drop area está dentro de min-width:769px (nunca no celular)',
    !!blocoHas && /#tab-pdfleitura\.active:has\(#pdfiso-filtros\[hidden\]\)\{[^}]*display:flex/.test(blocoHas[1])
    && /#tab-pdfleitura\.active:has\(#pdfiso-filtros\[hidden\]\)>div\{[^}]*max-width:900px/.test(blocoHas[1]),
    blocoHas ? blocoHas[1].slice(0, 90) : 'media query nao achada');
  /* Fronteira: o JS corta em 768 e o CSS de celular também em 768, então
     desktop e celular não dividem faixa nenhuma. Se um lado virar 800 e o outro
     ficar em 768, nasce uma faixa em que o JS acha que é desktop e o CSS
     trata como celular. */
  ok('a fronteira do JS e a do CSS de celular são a mesma (768, sem faixa morta)',
    /matchMedia\('\(max-width:768px\)'\)/.test(html) && /@media \(max-width:768px\)\{/.test(cssAqui)
    && !/@media \(max-width:800px\)|@media \(min-width:769px\)[\s\S]{0,400}#sidebar/.test(cssAqui));
  ok('o rodapé do lote de CNPJ não nasce com um travessão solto',
    /<span id="cnpj-lote-info"><\/span>/.test(html)
    && /const infoSet=\(t\)=>\{info\.textContent=t;info\.parentElement\.hidden=!t;\};/.test(html)
    && /\.lote-rodape\[hidden\]\{display:none\}/.test(html));
  ok('o dashboard não mostra 3 KPIs zerados nem 6 gráficos vazios sem documento',
    /if\(!qt\)\{[\s\S]{0,400}?kpis\.innerHTML='';[\s\S]{0,300}?Nenhum documento para exibir\. Importe XMLs\.[\s\S]{0,120}?return;/.test(html)
    && !/kpis\.innerHTML=`[\s\S]{0,80}?Total Documentos[\s\S]{0,2000}?if\(!qt\)/.test(html));
  }
})();

// ══════════════════════════════════════════════════════════════
grupo('12 · CACHE DE CNPJ (cota, degradação e leitura no lote)');
// ══════════════════════════════════════════════════════════════
// O lote chamava JSON.parse() sobre o retorno de lerCache(), que já é um
// objeto: lançava exceção, era engolida no catch e todo CNPJ em cache era
// consultado de novo — o cache do lote nunca funcionou.
{
  ok('lote NÃO faz JSON.parse sobre o retorno de lerCache',
    !/JSON\.parse\(cached\)/.test(html));
  ok('lote registra direto o objeto do cache', /const j=lerCache\(CHAVE_CACHE\+c\)/.test(html));
  ok('lote tem trava de reentrância (2 requisições no mesmo instante)',
    /if\(rodando\)return;/.test(html));
  ok('lote valida o DV do CNPJ antes de consumir a taxa',
    /RE_CNPJ_CELULA/.test(html) && /vC\(soDigitos\)/.test(html));
  ok('lote avisa antes de fechar a aba', /beforeunload/.test(html));
  ok('cache informa quando não coube (não some em silêncio)',
    /if\(!gravarCache\(CHAVE_CACHE\+c,dados\)\)naoGravados\+\+/.test(html));
  ok('aviso de cache visível existe e tem role=status',
    /id="cnpj-cache-aviso" role="status"/.test(html));
  ok('tabela do lote limita linhas (não trava com 2.000 CNPJs)', /LIMITE_LINHAS=\d+/.test(html));
  ok('modelo de consulta em massa existe', /id="cnpj-lote-modelo"/.test(html));
  ok('modelo tem as duas abas (CNPJs + Instrucoes)',
    /book_append_sheet\(wb,ws,'CNPJs'\)/.test(html) && /book_append_sheet\(wb,wi,'Instrucoes'\)/.test(html));
  ok('modelo tem fallback em CSV se o Excel não carregar', /modelo_consulta_cnpj\.csv/.test(html));
  ok('leitura do cache trata relógio que andou para trás',
    /idade<-86400000/.test(html));
// ── o modelo de consulta em massa é lido pelo mesmo validador do importador ──
const mExemplos = /const exemplos=(\[\[.*?\]\]);/.exec(html);
ok('a lista de exemplos do modelo é extraível do index.html', !!mExemplos);
if (mExemplos) {
  const cnpjsModelo = vm.runInNewContext(mExemplos[1]).slice(1).map((l) => l[0]);
  ok('o modelo traz 3 exemplos de CNPJ', cnpjsModelo.length === 3, String(cnpjsModelo.length));
  // O importador só aceita CNPJ com DV válido. Um exemplo inválido no modelo
  // faz o usuário concluir que a coluna dele está errada.
  const rejeitados = cnpjsModelo.filter((c) => !vC(c));
  ok('todo exemplo do modelo passa no vC do próprio app', rejeitados.length === 0, rejeitados.join(','));
}
const mInstrucoes = /const INSTRUCOES=(\[[\s\S]*?\n    \]);/.exec(html);
ok('as instruções do modelo são extraíveis do index.html', !!mInstrucoes);
if (mInstrucoes) {
  const linhas = vm.runInNewContext(mInstrucoes[1]).map((l) => l[0]);
  const emIngles = linhas.filter((t) => /\b(the|are|ignored|columns|other|with)\b/i.test(t));
  ok('nenhuma linha do modelo escrito em inglês', emIngles.length === 0, emIngles.join(' | '));
  ok('o modelo avisa que sem a biblioteca de planilhas só há CSV',
    linhas.some((t) => /CSV/.test(t)));
}
// ── estado do lote: uma lista por vez, um intervalo por vez ──
ok('importar outra planilha no meio do lote mata o lote (2 intervalos = 6/min, o dobro do teto)',
  /ger\+\+;\s*\n\s*abort=true;\s*\n\s*if\(timer\)\{clearInterval\(timer\);timer=null;\}/.test(html));
ok('a resposta que chegou depois da troca de lista é descartada',
  /const meuGer=ger;/.test(html) && (html.match(/if\(meuGer!==ger(\|\|abort)?\)return;/g) || []).length >= 3);
  /* 3 saídas assíncronas: o 429/sem resposta, o sucesso e o erro. Os já lidos
     (cache) entram no mesmo disparo, sem await, e não precisam de guarda. */
ok('"Iniciar" nunca cria um segundo intervalo',
  /if\(timer\)\{clearInterval\(timer\);timer=null;\}/.test(html));
ok('importar .xlsx sem a biblioteca diz o que fazer (CDN fora)', /!window\.XLSX/.test(html) && /Exporte a planilha como CSV/.test(html));
ok('nenhum código morto sobrou no módulo do lote', !/linhaDe/.test(html));
// O log era apagado logo DEPOIS de receber a linha "N CNPJ(s) prontos para
// iniciar" (e escondido quando a lista vinha vazia): a mensagem existia no
// código e nunca aparecia.
// O escape é do RENDER, não do fetch: o cache guarda o dado cru. O caminho
// inverso (escapar na fronteira) fazia o invariante depender de qual versão do
// app gravou a entrada — e foi isso que deixou o payload cruo do 627b8e0
// chegar ao innerHTML por 30 dias.
ok('NÃO escapa só no fetch (o escape tem de ser do render)',
  !/escProfundo\(await/.test(html));
ok('render() escapa a carga antes de escrever no DOM',
  /function render\(dados,cached\)[\s\S]{0,600}?dados=escProfundo\(dados\);/.test(html));
ok('renderLote() escapa cada campo da tabela do lote',
  /const rows=janela\.map\(r=>`[\s\S]{0,240}?esc\(r\.razao\)[\s\S]{0,240}?esc\(r\.fantasia\)/.test(html));
ok('o log do lote não é apagado depois de escrever nele',
  !/loteLog\([^;]{0,200};\s*\n?[^\n]*logEl\.textContent\s*=\s*''/.test(html));
ok('a mensagem de lista vazia fica visível (o log não some junto)',
  !/logEl\.style\.display\s*=\s*cnpjs\.length\s*\?\s*'block'\s*:\s*'none'/.test(html));

}

// ══════════════════════════════════════════════════════════════
grupo('13 · SEPARADOR: robustez e layout');
// ══════════════════════════════════════════════════════════════
{
  ok('separador usa a largura da tela (sem coluna central)',
    /#tab-separar\{max-width:none\}/.test(html) && !/#tab-separar\{max-width:760px/.test(html));
  ok('separador tem grade responsiva',
    /#tab-separar \.grade\{display:grid/.test(html) && /@media \(max-width:900px\)/.test(html));
  ok('rádio ausente não trava o botão (sem .value em null)',
    /const modo = modoEl \? modoEl\.value : 'auto'/.test(html)
    && !/querySelector\('input\[name=modo\]:checked'\)\.value/.test(html));
  ok('lê o PDF uma vez só (buffer não duplicado)',
    /const original = await arquivo\.arrayBuffer\(\)/.test(html)
    && !/getDocument\(await arquivo\.arrayBuffer\(\)\)/.test(html));
  ok('destrói o documento do pdf.js mesmo em erro', /finally\s*\{[\s\S]{0,120}doc\.destroy\(\)/.test(html));
  ok('erro na separação invalida os resultados antigos',
    /window\.__resultados\s*=\s*null;\s*\n\s*baixar\.style\.display\s*=\s*'none';/.test(html));
  ok('trocar de PDF limpa o que estava pronto',
    /getElementById\('pdfFile'\)\.addEventListener\('change'/.test(html));
  ok('falha na pasta cai para ZIP em vez de perder os arquivos',
    /baixarZip\(motivo\)/.test(html) && /A pasta parou de responder/.test(html));
  ok('permissão da pasta é renovada antes de salvar',
    /queryPermission\(\{ mode: 'readwrite' \}\)/.test(html));
  ok('confere se nenhuma página se perdeu no agrupamento',
    /paginasGeradas !== saida\.totalPaginas/.test(html));
  ok('log do separador não é reescrito inteiro a cada linha',
    /appendChild\(document\.createTextNode/.test(html));
  ok('referência a CDN fica dentro de guarda',
    /if \(typeof pdfjsLib !== 'undefined'\)[\s\S]{0,140}workerSrc/.test(html));
  ok('wrapper morto de localStorage removido',
    !/window\.localStorage\s*=/.test(html));
ok('falha parcial também gera o ZIP (o log não promete o que não entrega)',
  /if \(falhas\.length\)[\s\S]{0,900}await baixarZip\(\)/.test(html));
ok('"Salvar arquivos" trava já no primeiro await (dois cliques = dois laços de gravação)',
  /if \(btnBaixar\.disabled\) return;\s*\n\s*btnBaixar\.disabled = true;/.test(html));
ok('o rótulo do botão volta por um caminho só (sem dataset.orig)', !/dataset\.orig/.test(html));

}

/* ══════════════════════════════════════════════════════════════
   grupo('14 · ALVOS DE TOQUE, ESCALA E TOKENS (bloqueios da revisão de design)');
   ══════════════════════════════════════════════════════════════ */
{
  /* .btn media 32,5px com o padding de 8px — abaixo do piso. Os 4 botões da
     Consulta em Lote são .btn. */
  const regraBtn = /\.btn\{([^}]*)\}/.exec(html);
  ok('.btn tem min-height de 40px (media 32,5px sem ele)',
    !!regraBtn && /min-height:\s*40px/.test(regraBtn[1]), regraBtn && regraBtn[1].slice(0, 80));
  const mq768 = /@media \(max-width:768px\)\{([\s\S]*?)\n\}/.exec(html);
  ok('no celular .btn vai a 44px (piso de alvo de toque)',
    !!mq768 && /\.btn\{[^}]*min-height:\s*44px/.test(mq768[1]), mq768 && mq768[1].slice(0, 60));
  /* .radio-group label sem padding/altura: alvo de ~20px na aba Separar. */
  const regraRadio = /#tab-separar \.radio-group label\{([^}]*)\}/.exec(html);
  ok('o label do radio tem min-height de 44px (era ~20px)',
    !!regraRadio && /min-height:\s*44px/.test(regraRadio[1]), regraRadio && regraRadio[1]);
  ok('o label do radio é flex e centraliza (alvo clicável de verdade)',
    !!regraRadio && /display:\s*flex/.test(regraRadio[1]) && /align-items:\s*center/.test(regraRadio[1]));
  ok('o radio em si tem 20x20 e margin 0 (não empurra o alvo)',
    /#tab-separar \.radio-group label input\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*margin:\s*0/.test(html));
  /* Escala de 4px no código NOVO (esta rodada). O arquivo tem 10px em regras
     antigas (.filter-bar, .info-grid, .nav-btn): mexer nelas seria troca de
     aperto visual fora do escopo, então o gate mede só o que foi introduzido. */
  const escala4 = (sel) => {
    const r = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(html);
    return r ? r[1] : '';
  };
  /* Só as regras que a rodada tocou: .btn e .campo mantêm espaçamento antigo
     (18px no padding, 6px no gap, 14px no margin-bottom) que já é o padrão do
     arquivo inteiro — mudá-las seria troca de aperto visual fora do escopo. */
  /* A lista precisa ser atualizada a cada rodada que escreve CSS novo, senão o
     gate envelhece calado: a mensagem diz "código novo" e a lista só cobre a
     rodada anterior. Os dois lados (atributo e media query) entram juntos, e a
     paridade do rail garante que corrigir um corrige o outro. */
  const novosComEspaco = ['#tab-separar .grade', '#tab-separar .acoes-sep', '#tab-separar .radio-group',
    '#tab-separar .radio-group label', '#cnpj-lote-log',
    /* rodada da sidebar e das telas vazias */
    '.privacidade', '.privacidade>summary', '.privacidade>p', '#btn-rail', '.lote-rodape',
    '.pdfiso-filtros', '#sidebar[data-rail="on"] .nav-btn', '#sidebar[data-rail="on"] #btn-rail',
    '#tab-separar .acoes-sep>.btn'];
  const furos = novosComEspaco.flatMap((s) => {
    const corpo = escala4(s);
    return [...corpo.matchAll(/(?:margin|gap|padding)[a-z-]*\s*:\s*([^;]+)/g)]
      .filter((m) => /(?<![\d.])(?:6px|10px|18px|14px|22px)(?![\d.])/.test(m[1]))
      .map((m) => s + ' -> ' + m[0].trim());
  });
  ok('nenhum espaçamento do código novo fura a escala de 4px (nada de 6, 10, 14, 18 ou 22px)',
    furos.length === 0, furos.join(' | '));
  ok('o painel também não usa 6px no código novo (.est-msg/.est-alert)',
    /\.est-msg, \.est-alert\s*\{[^}]*margin:\s*8px 0 0/.test(fs.readFileSync(path.join(RAIZ, 'painel-gerencial.html'), 'utf8')));
  ok('o gap da grade do separador é 16px (não 18)',
    /#tab-separar \.grade\{[^}]*gap:\s*0 16px/.test(html));
  ok('o gap das ações do separador é 12px e a margem 8px',
    /#tab-separar \.acoes-sep\{[^}]*gap:\s*12px;[^}]*margin-top:\s*8px/.test(html));
  /* A grade 1fr 1fr reservava a metade direita para o botão "Salvar arquivos",
     que só existe depois da divisão: botão principal em meia largura e metade
     morta. Em flex, um só item ocupa a linha e os dois se dividem quando o
     segundo aparece. */
  ok('a linha de ação do separador é flex, não grade com coluna reservada',
    /#tab-separar \.acoes-sep\{display:flex;flex-wrap:wrap;/.test(html)
    && /#tab-separar \.acoes-sep>\.btn\{flex:1 1 260px\}/.test(html)
    && !/#tab-separar \.acoes-sep\{[^}]*grid-template-columns/.test(html));
  ok('o gap do grupo de radios é 24px (não 18) e a margem 8px (não 6)',
    /#tab-separar \.radio-group\{[^}]*gap:\s*24px;[^}]*margin-top:\s*8px/.test(html));
  /* Nenhum rgba escrito à mão em style="" (fora dos tokens). */
  const rgbaInline = [...html.matchAll(/style="[^"]*rgba\(/g)].map((m) => m[0]);
  ok('nenhuma cor rgba escrita à mão em style="" (tokenize, B16)',
    rgbaInline.length === 0, rgbaInline.slice(0, 3).join(' | '));
  ok('o badge "cache" usa o token --badge-on-cta',
    /<span class="badge" style="background:var\(--badge-on-cta\)">cache<\/span>/.test(html));
  /* Nomenclatura e copy. */
  ok('"Separar notas" com n minúsculo', /id="btn-processar" class="btn">Separar notas</.test(html));
  ok('"Nomenclatura dos arquivos" (não "Nomeação")',
    /<legend class="campo-legenda">Nomenclatura dos arquivos<\/legend>/.test(html)
    && !/Nomeação dos arquivos/.test(html));
  ok('o texto auxiliar cita o rótulo real do radio',
    /Com “Ler número da nota” o nome sai como/.test(html) && /com “Não ler”/.test(html));
  /* Contrato entre módulos: consultarCNPJ é publicado por outra IIFE. */
  /* O consumidor do CNPJ verifica o contrato antes de chamar — e o dado vai por
     ATRIBUTO, nunca interpolado em `onclick`. Num onclick inline o CNPJ cai
     num contexto de JavaScript, onde o escape de HTML não protege: uma aspa
     simples sobrevive ao esc e fecha o argumento da chamada. */
  ok('o consumidor do CNPJ verifica o contrato antes de chamar (não ReferenceError cru)',
    /typeof window\.consultarCNPJ!=='function'/.test(html)
    && /class="pdfiso-cnpj" data-cnpj="\$\{esc\(c\)\}"/.test(html)
    && /querySelectorAll\('\.pdfiso-cnpj'\)\.forEach\(a=>a\.addEventListener\('click'/.test(html));
  ok('nenhum dado de arquivo entra em onclick inline (contexto de JavaScript)',
    !/onclick="[^"]*\$\{[^}]*(cnpj|CNPJ|c\}|prestador|emitente|tomador)/.test(html),
    'escapar para HTML nao protege dentro de onclick: a aspa simples sobrevive');
  /* fmtCNPJ e fmtChave escapam (a chave nem é reformatada): o dado vem de
     PDF/XML, e reformatar não protege. */
  ok('os formatadores de dado de arquivo escapam, não só reformatam',
    /function fmtCNPJ\(c\)\{return c\?esc\(/.test(html)
    && /function fmtChave\(ch\)\{return ch\?esc\(/.test(html));
  {
    /* A chave de acesso aparece sempre junta, sem espaços entre os blocos. */
    const src = (/function fmtChave\(ch\)\{[^\n]*\}/.exec(html) || [''])[0];
    const chave = '0123456789'.repeat(5).slice(0, 44); // sintética, montada em tempo de execução
    let saida = '', erro = '';
    try { saida = new Function('esc', src + ';return fmtChave;')((s) => String(s))(chave); } catch (e) { erro = e.message; }
    ok('a chave do leitor de PDF sai junta (44 dígitos, sem espaço)',
      !erro && saida === chave, erro || JSON.stringify(saida));
  }
  /* dataBr truncava sem escapar, e o truncamento nao impede o ataque:
     `"><img src=x onerror=...>` nos 10 primeiros caracteres ainda abre tag. */
  ok('dataBr escapa além de truncar (a data vem do XML)',
    /function dataBr\(d\)\{if\(!d\|\|d==='nan'\|\|d==='None'\)return'';return esc\(String\(d\)\.slice\(0,10\)\)\}/.test(html));
  ok('a IIFE de CNPJ nomeia o contrato que publica',
    /CONTRATO ENTRE M[ÓO]DULOS: publica window\.consultarCNPJ/.test(html));
  /* Teto de volume do separador. */
  ok('o separador tem teto de páginas (o OCR tem, o separador não)',
    /const SEP_MAX_PAGINAS = \d+;/.test(html) && /const SEP_MAX_BYTES = \d+ \* 1024 \* 1024;/.test(html));
  ok('acima do teto o pedido é um segundo clique explícito (sem alert/confirm)',
    /e\.code = 'SEP_VOLUME'/.test(html) && /sepConfirmado = file;/.test(html)
    && /Clique em "Separar notas" de novo para continuar\./.test(html));
  ok('trocar de PDF invalida a confirmação de volume',
    /pdfFile'\)\.addEventListener\('change'[\s\S]{0,400}?sepConfirmado = null;/.test(html));
  ok('o separador informa o volume que fica retido em memória',
    /retidos em memória/.test(html) && /sepMb\(original\.byteLength\)/.test(html));
  /* alert() pré-existente. O gate olha o código, não os comentários que
     citam a regra (dois deles legítimamente mencionam alert()). */
  const semComentarios = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('nenhum alert() no index.html (regra do projeto)',
    !/\balert\s*\(/.test(semComentarios), (/\balert\s*\([^)]*\)/.exec(semComentarios) || [''])[0]);
  ok('nenhum confirm() novo no separador (a confirmação é por segundo clique)',
    (semComentarios.match(/confirm\s*\(/g) || []).length === 1,
    String((semComentarios.match(/confirm\s*\(/g) || []).length));
  ok('"sem dados para exportar" vai para a faixa de status, não para alert()',
    /function exportAviso\(msg\)/.test(html)
    && (html.match(/exportAviso\('Nada para exportar/g) || []).length === 2);
  ok('a faixa de status some sozinha (não fica sempre na tela)',
    /exportAvisoTimer=setTimeout\([\s\S]{0,120}?b\.style\.display='none'/.test(html));
}

// ══════════════════════════════════════════════════════════════
grupo('14.1 · SIDEBAR RECOLHÍVEL: um estado, dois gatilhos');
// ══════════════════════════════════════════════════════════════
{
  /* ── Geometria ──────────────────────────────────────────────────────────
     A regra de ouro: as regras do rail existem em UM lugar só, o seletor
     #sidebar[data-rail="on"], e a media query de ≤768px liga o MESMO atributo.
     Antes eram duas cópias e já divergiram: o min-height:44px entrou só na
     media query, então um rail ligado por atributo nasceria com 42px. */
  const css = html.slice(0, html.indexOf('</style>'));
  /* O mesmo CSS sem nenhum comentário. O comentário dentro de .btn:disabled
     CITA "opacity:.5" ao explicar por que a opacidade não é usada, e o gate
     anti-opacidade casava com a própria documentação do defeito — reprovar a
     regra que corrige o problema porque ela explica o problema é o gate
     mentindo. Texto de comentário nunca conta como CSS. */
  const semComentario = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const corpo = (sel, texto) => {
    const r = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g');
    return [...texto.matchAll(r)].map((m) => m[1]);
  };
  const mqRail = /@media \(max-width:768px\)\{([\s\S]*?)\n\}/.exec(css);
  /* As regras de rail existem em DOIS lugares, por escolha: o atributo
     (escolha do usuário, desktop) e a media query (fallback pré-JS do celular —
     o script do fim do body seta o atributo, mas o layout do celular não pode
     depender de JS para não piscar 240px). O que NÃO pode existir é divergência:
     cada par abaixo tem que declarar as mesmas coisas, propriedade a
     propriedade. É esta comparação que pegaria a divergência real que já
     aconteceu uma vez (min-height:44px só na media query). */
  /* Os DEZ blocos duplicados, um a um. A primeira versão deste gate comparava
     só quatro e o comentário do index.html já prometia "propriedade a
     propriedade": um gate que cobre parte da duplicação é amostra, não fonte
     única. Se um par for acrescentado aqui, confere que existe nos dois lados
     — um par sem equivalente na media query reprova com "sem <prop>", que é o
     sinal de que o array ficou defasado. */
  /* A marca não tem par no rail: nos DOIS gatilhos ela some inteira, então
     não há o que comparar. As regras #logo/#logo h1 saíram da lista (a barra
     estreita não ajusta a marca), e o gate de paridade genérico abaixo
     confere que nenhuma declaração de geometria do rail ficou órfã. */
  const pares = [
    ['#sidebar[data-rail="on"]', '#sidebar', ['width', 'min-width']],
    ['#sidebar[data-rail="on"] .nav-btn', '.nav-btn', ['justify-content', 'padding', 'gap', 'min-height']],
    ['#sidebar[data-rail="on"] .nav-btn .icon', '.nav-btn .icon', ['width']],
    ['#sidebar[data-rail="on"] .nav-btn .icon svg.i', '.nav-btn .icon svg.i', ['width', 'height']],
    ['#sidebar[data-rail="on"] #btn-fechar', '#btn-fechar', ['justify-content', 'padding', 'gap', 'font-size']],
    ['#sidebar[data-rail="on"] #btn-fechar span', '#btn-fechar span', ['font-size']],
  ];
  /* Estas duas não batem por seletor: na media query o #logo p e o .nav-section
     são agrupados numa regra só, e o rótulo do .nav-btn fica solto. A
     comparação é feita pelo conteúdo, procurando a regra que declara a
     propriedade, em vez de pelo seletor exato. */
  const paresPorDeclaracao = [
    ['oculta o subtítulo do logo e as seções', /#logo p,\s*\.nav-section\{[^}]*display:none/, 'display', 'none'],
    ['esconde o rótulo do item de menu', /\.nav-btn>span:not\(\.icon\)\{[^}]*position:absolute/, 'position', 'absolute'],
  ];
  const divergencias = [];
  for (const [selA, selB, props] of pares) {
    const a = corpo(selA, css)[0] || '';
    const b = (corpo(selB, mqRail ? mqRail[1] : '')[0]) || '';
    for (const p of props) {
      const va = (new RegExp('(?:^|;)\\s*' + p + ':([^;]*)')).exec(a);
      const vb = (new RegExp('(?:^|;)\\s*' + p + ':([^;]*)')).exec(b);
      if (!va || !vb) { divergencias.push(selB + ' sem ' + p); continue; }
      if (va[1].replace(/\s+/g, '') !== vb[1].replace(/\s+/g, '')) {
        divergencias.push(selA + ' ' + p + '=' + va[1].trim() + ' vs media ' + vb[1].trim());
      }
    }
  }
  ok('o rail do atributo e o da media query declaram as mesmas propriedades (paridade)',
    divergencias.length === 0, divergencias.join(' | '));
  for (const [nome, reA, prop, val] of paresPorDeclaracao) {
    const a = reA.test(css);
    const b = reA.test(mqRail ? mqRail[1] : '');
    ok('paridade do bloco que ' + nome + ' (atributo e media query)',
      a && b, 'atributo=' + a + ' media=' + b);
  }
  /* O número de blocos duplicados é fixo por escolha, não por acaso. A
     verificação é por CONJUNTO DE DECLARAÇÕES, não por contagem de seletores
     (contagem quebra na hora em que alguém acrescenta um tooltip). Tudo que o
     bloco do rail declara tem de existir também na media query. As regras de
     tooltip (seletor com ::after) ficam de fora: elas não têm contrapartida
     porque não descrevem largura, e sim o nome flutuante do item ativo. */
  const declRail = [];
  for (const m of css.matchAll(/(#sidebar\[data-rail="on"\][^{}]*)\{([^}]*)\}/g)) {
    if (m[1].includes('::after')) continue;
    /* Duas exceções, ambas deliberadas: (a) as regras do #btn-rail, porque no
       celular o botão sai da tela (display:none) e a geometria dele vira
       irrelevante; (b) transition, porque a animação do rail é decisão de UX do
       desktop e a media query não repete animação. */
    if (m[1].includes('#btn-rail')) continue;
    for (const d of m[2].split(';').map((x) => x.trim()).filter(Boolean)) {
      if (d.startsWith('transition')) continue;
      declRail.push(d.replace(/\s+/g, ''));
    }
  }
  const mqTexto = (mqRail ? mqRail[1] : '').replace(/\s+/g, '');
  const faltando = [...new Set(declRail)].filter((d) => !mqTexto.includes(d));
  ok('toda declaração de geometria do rail existe também na media query (nada órfão)',
    declRail.length > 0 && faltando.length === 0,
    'declaracoes=' + declRail.length + ' faltando=' + (faltando.join(' | ') || 'nenhuma'));
  ok('o rail do atributo tem o mesmo piso de toque de 44px do rail do celular',
    /min-height:\s*44px/.test(corpo('#sidebar[data-rail="on"] .nav-btn', css)[0] || ''));
  ok('o toggle também tem alvo de 44px (a revisão de design mediu 42px nos botões do rail)',
    /#btn-rail\{[^}]*min-height:\s*44px/.test(css));
  ok('no celular o toggle some por display:none (nunca aria-hidden em focável)',
    !!mqRail && /#btn-rail\{display:none\}/.test(mqRail[1]));
  /* Pedido explícito: nada de card ao lado da barra. O balão com o nome do item
     ativo (:hover e :focus-visible) foi retirado — ele abria sempre que algo
     era aberto, porque trocar de aba deixa o item .active. O nome continua no
     title (mouse) e no rótulo visually-hidden (leitor de tela), então a remoção
     não tira informação de ninguém. */
  ok('a barra recolhida não desenha nenhum balão ao lado',
    !/::after\{content:attr\(title\)/.test(css) && !/\.nav-btn:hover::after/.test(css)
    && !/#sidebar\[data-rail="on"\][^{]*::after\{/.test(css));
  ok('o item ativo continua marcado no rail (cor e borda, sem balão)',
    /\.nav-btn\.active\{[^}]*background:var\(--sidebar-active\)[^}]*border-right-color:var\(--accent\)/.test(css));
  /* A marca some INTEIRA no rail (revisão de design): o primeiro item de uma coluna de
     8 ícones de mesmo peso não pode ser texto, e o fragmento herdava a cor mais
     saturada do topo. O nome completo continua no breadcrumb e no title de cada
     item. Isto também substitui o max-width/overflow que existia só para o
     texto não vazar da barra — com o bloco fora, os dois não têm consumidor. */
  ok('a marca some inteira no rail (não vira sigla espremida)',
    /#sidebar\[data-rail="on"\] #logo\{display:none\}/.test(css)
    && /#logo,#logo p,\.nav-section\{display:none\}/.test(css)
    && !/#sidebar\[data-rail="on"\] #logo h1\{/.test(css));
  /* O h1 do documento vive no body, não dentro de #logo — a marca some em
     ≤768px e, sem isso, o documento ficava sem nenhum h1 nesses dois layouts.
     Este gate existe porque a afirmação "adicionei o h1" já foi feita uma vez e
     a mudança não estava no arquivo (perdeu num rebase). */
  ok('o documento tem um h1 no body, e ele não depende da marca',
    /<h1 class="visually-hidden">GCON\/SIAN — leitor de NF-e e NFS-e<\/h1>/.test(html)
    && /<div id="logo"><h1>/.test(html));
  ok('o logo do menu cheio continua inteiro (GCON/SIAN em texto)',
    /<div id="logo"><h1>GCON\/<span>SIAN<\/span><\/h1><p>NF-e \| NFS-e<\/p><\/div>/.test(html)
    && !/lbl-cheio/.test(html));
  ok('a costura lateral existe nos dois temas (no escuro --sidebar≈--surface)',
    /#sidebar\{[^}]*border-right:1px solid var\(--sidebar-edge\)/.test(css)
    && /--sidebar-edge:transparent/.test(css)
    && /--sidebar-edge:#223049/.test(css));
  ok('a barra de acento tem token por tema (o laranja da barra tinha 2 donos)',
    /#accent-bar\{height:3px;background:var\(--accent-bar\)\}/.test(css)
    && /--accent-bar:var\(--accent\)/.test(css) && /--accent-bar:#6b4708/.test(css));
  ok('o trilho de progresso usa --track (--border-light sumia no escuro)',
    /--track:#e2e8f0/.test(css) && /--track:#33405c/.test(css)
    /* as TRÊS places: barra do separador, barra do lote e anel do spinner */
    && (html.match(/var\(--track\)/g) || []).length >= 3
    && /#loading-box \.spinner\{[^}]*border:4px solid var\(--track\)/.test(css));
  ok('o botão desabilitado não usa opacity (a forma sumia, não só o rótulo)',
    /* Sem confiar na ORDEM das declarações: o comentário dentro da regra quebra
       qualquer sequência posicional, e a ordem não é o que importa aqui — o que
       importa é que as três propriedades existam, todas juntas. */
    (() => {
      const corpo = /\.btn:disabled\{([\s\S]{0,1200}?)\}/.exec(css);
      if (!corpo) return false;
      const decl = corpo[1].replace(/\/\*[\s\S]*?\*\//g, '');
      return /opacity:1/.test(decl) && /background:transparent/.test(decl)
        && /border:1px solid var\(--border-disabled\)/.test(decl);
    })()
    /* A segunda condição NÃO pode ser "não usa opacity": opacity:1 É a forma
       correta. O que não pode existir é opacidade REDUZIDA, que é o defeito
       antigo (.5) e o que apagava a silhueta. E o padrão tem que pegar QUALQUER
       regra :disabled, não só a de classe: #btn-processar:disabled sobreviveu
       à reescrita da classe e, sendo regra por ID, vencia por especificidade
       e mantinha o defeito — com o gate antigo passando 522/0.

       Sem comentários no meio: o comentário dentro de .btn:disabled CITA
       "opacity:.5" ao explicar por que ela não é usada, e esse negate casava
       com a própria documentação do defeito. Reprovar a regra que corrige o
       problema porque ela explica o problema é o gate mentindo. */
    && !/[:.][\w-]*disabled\{[^}]*opacity:\s*0?\.[0-9]/.test(semComentario)
    && !/\.btn:disabled\{opacity:\./.test(css));
  /* O achado da revisão de design, que nenhum dos gates acima pegava: `border-color` não
     pinta nada quando o `border-style` herdado é `none`. A regra do desabilitado
     ficava certa no papel ("mais fraco na borda") e no browser sem CAIXA — e
     pior, o .btn-out desabilitado da MESMA linha tinha forma, porque declara
     `border`. Dois estados que deviam se parecer e não se pareciam.
     Este gate exige border com largura E estilo, não só cor. */
  ok('a borda do desabilitado tem largura e estilo (border-color sozinho não pinta)',
    (() => {
      const regra = (re) => {
        const m = re.exec(css);
        return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
      };
      const btn = regra(/\.btn:disabled\{([\s\S]{0,1200}?)\}/);
      const out = regra(/\.btn-out:disabled\{([\s\S]{0,300}?)\}/);
      const sep = regra(/#btn-processar:disabled\{([\s\S]{0,300}?)\}/);
      const temBorda = (c) => /border:1px solid var\(--border-disabled\)/.test(c);
      /* E nenhuma delas pode voltar a_border-color_: sem border-style, nao pinta. */
      const soCor = (c) => /border-color:/.test(c) && !temBorda(c);
      return temBorda(btn) && temBorda(out) && temBorda(sep)
        && !soCor(btn) && !soCor(out) && !soCor(sep);
    })(),
    'border-color sem border-style nao desenha nada');
  /* O token é dedicado porque o alvo NÃO é o mínimo de WCAG. A borda do
     desabilitado vive numa FAIXA: --border a 1,23:1 (claro) some, e
     --border-input a 3,16:1 fica indistinguível do habilitado. Subir o piso
     trocaria "fantasma" por "parece ativo". Por isso o gate mede a FAIXA e
     não um mínimo, e por isso ele não aceita --border nem --border-input. */
  ok('a borda do desabilitado usa o token próprio, na faixa entre invisível e ativo',
    (() => {
      const decl = (re) => {
        const m = re.exec(css);
        return m ? m[1].replace(/\/\*[\s\S]*?\*\//g, '') : '';
      };
      const raiz = decl(/\:root\{([\s\S]{0,4000}?)\}/);
      const dark = decl(/\:root\[data-theme="dark"\]\{([\s\S]{0,4000}?)\}/);
      /* tem de existir nos DOIS temas — um token sem par no dark some nele */
      return /--border-disabled:#[0-9a-f]{3,6}/i.test(raiz)
        && /--border-disabled:#[0-9a-f]{3,6}/i.test(dark);
    })(),
    'sem par por tema o token nao existe no escuro');
  /* O hover do CTA da aba Separar nao pode vencer o :disabled por
     especificidade. #tab-separar #btn-processar:hover e' (2,1,0) e ganha de
     #btn-processar:disabled (1,1,0): o botao desabilitado virava azul de CTA
     com o rotulo em --text3 por cima, a 2,61:1 no escuro e 1,84:1 no claro.
     Parecia ativo e nao se lia. */
  ok('o hover do CTA da aba Separar nao vence o estado desabilitado',
    /#tab-separar #btn-processar:not\(:disabled\):hover/.test(css)
    && !/#tab-separar #btn-processar:hover\{/.test(css),
    'hover sem :not(:disabled) pinta o CTA em cima do desabilitado');
  ok('o secundário do lote é contorno, e o CTA do lote é o primário azul',
    /\.btn-out\{background:transparent;border:1px solid var\(--border-input\)/.test(css)
    && /id="cnpj-lote-start" class="btn btn-prim"/.test(html)
    && /id="cnpj-lote-stop" class="btn btn-out"/.test(html)
    && /id="cnpj-lote-export" class="btn btn-out"/.test(html)
    && !/id="cnpj-lote-start" class="btn btn-ok"/.test(html));
  ok('o texto do menu vem dos tokens (o gate mede token, rgba escapa por construção)',
    /\.nav-section\{[^}]*color:var\(--sidebar-fg-dim\)/.test(css)
    && /\.nav-btn\{[^}]*color:var\(--sidebar-fg-mute\)/.test(css)
    && /\.nav-btn:hover\{[^}]*color:var\(--sidebar-fg\)/.test(css)
    && /\.nav-btn\.active\{[^}]*color:var\(--sidebar-fg\)/.test(css)
    && !/\.nav-btn\{[^}]*color:rgba/.test(css));
  ok('o rail do celular tem o mesmo fallback de largura do atributo',
    /#sidebar\{width:64px;min-width:64px\}/.test(mqRail ? mqRail[1] : '')
    && /#sidebar\[data-rail="on"\]\{width:64px;min-width:64px/.test(css));
  ok('o rail respeita prefers-reduced-motion (largura e tooltip sem transição)',
    /@media \(prefers-reduced-motion:reduce\)\{#sidebar[^{]*\{transition:none\}/.test(css.replace(/\s+/g, ' ')));
  ok('o foco do toggle usa --sidebar-accent (--focus dá 2,96:1 no claro, reprova 3:1)',
    /#btn-rail:focus-visible\{outline-color:\s*var\(--sidebar-accent\)\}/.test(html));

  /* ── Markup ──────────────────────────────────────────────────────────────*/
  ok('o botão do toggle tem type, aria-expanded e aria-controls',
    /<button id="btn-rail" type="button" aria-expanded="true" aria-controls="sidebar"/.test(html));
  /* O botão não tem <span> visível: o nome vem do aria-label/title que o JS
     reescreve a cada estado. Um span morto aqui era uma nona linha que não
     cabia em 64px, além de uma regra CSS sem efeito. Olha só o conteúdo do
     botão (até o </button>): uma janela de N caracteres alcançava o <span> do
     botão vizinho quando o arquivo vinha com LF (Linux/CI) em vez de CRLF. */
  ok('o toggle não tem span nem regra morta: o nome vem do aria-label do JS',
    !/<span/.test((/id="btn-rail"[^>]*>([\s\S]*?)<\/button>/.exec(html) || ['', '<span'])[1])
    && /btn\.setAttribute\('aria-label',txt\);btn\.setAttribute\('title',txt\);/.test(html)
    && !/#btn-rail>span\{/.test(css) && !/#sidebar\[data-rail="on"\] #btn-rail>span\{/.test(css));
  const titulosRail = [...html.matchAll(/class="nav-btn[^"]*" data-tab="[^"]+" title="([^"]+)"/g)].map((m) => m[1]);
  ok('os 9 itens do menu têm title (nome no rail, onde o rótulo é visually-hidden)',
    titulosRail.length === 9, 'achou ' + titulosRail.length + ': ' + titulosRail.join(', '));
  ok('a live region do toggle existe ANTES da primeira escrita',
    /<p id="rail-status" role="status" aria-live="polite" class="visually-hidden">/.test(html));
  ok('existe a utilitária .visually-hidden (o rail escondia o rótulo só na media query)',
    /\.visually-hidden\{position:absolute;width:1px/.test(css));
  ok('o toggle não é .nav-btn (entraria na rotação do breadcrumb e na troca de aba)',
    !/class="nav-btn[^"]*"[^>]*id="btn-rail"/.test(html) && !/id="btn-rail"[^>]*class="nav-btn/.test(html));

  /* ── Comportamento: a IIFE do toggle rodada de verdade num vm ───────────
     Confere persistência, aria, o par de ícones, Esc e a regra "no celular o
     rail manda" — as cinco coisas que o código faz e que ninguém lê no teste
     estático. O DOM é stubado, mas o código executado é o do index.html. */
  const src = /\(function\(\)\{\s*const CHAVE='gcon-sidebar-v1';[\s\S]*?\n\}\)\(\);/.exec(html);
  ok('a IIFE do toggle existe e é extraível', !!src);
  if (src) {
    /* O 3º parâmetro existe por causa da revisão de testes: sem ele, o stub de
       localStorage nunca lança e os caminhos de modo privado / quota cheia
       (onde o catch engole o erro e a UI funciona sem persistir nada) ficavam
       sem nenhum caso. `lanceEm` diz qual operação falha. */
    const rodar = (celular, semeado, lanceEm) => {
      const els = {};
      ['sidebar', 'btn-rail', 'rail-status'].forEach((i) => {
        const el = stubEl(i);
        el._attrs = {};
        el._ls = {};
        el.setAttribute = (k, v) => { el._attrs[k] = String(v); if (k === 'href') el._href = String(v); };
        el.getAttribute = (k) => {
          if (k === 'href') return el._href === undefined ? null : el._href;
          return Object.prototype.hasOwnProperty.call(el._attrs, k) ? el._attrs[k] : null;
        };
        el.addEventListener = (t, f) => { (el._ls[t] = el._ls[t] || []).push(f); };
        els[i] = el;
      });
      const use = stubEl('use');use.setAttribute = (k, v) => { use[k] = String(v); };
      /* O botão não tem <span> (o nome vem de aria-label/title), então o stub
         só resolve o <use> — se o código voltar a pedir um span, recebe null e
         o teste do aria-label reprova. */
      els['btn-rail'].querySelector = (s) => (s === 'use' ? use : null);
      const doc = { getElementById: (i) => els[i] || null, addEventListener(t, f) { (doc._ls = doc._ls || {})[t] = f; } };
      /* O MediaQueryList GUARDA o handler. A primeira versão do stub fazia
         addEventListener(){} e a asserção era um OR de literais no fonte — o
         mutante que trocava addEventListener por addListener passava 479/0
         verde. Um stub que engole o handler é indistinguível de um handler
         inexistente; o teste precisa poder chamá-lo. */
      const mql = {
        matches: /max-width:768px/.test('(max-width:768px)') ? celular : false,
        _ls: {},
        addEventListener(t, f) { (mql._ls[t] = mql._ls[t] || []).push(f); },
        addListener(f) { (mql._ls.change = mql._ls.change || []).push(f); },
        /* Simula a janela mudando de largura: dispara o que o browser dispara. */
        largura(nova) { mql.matches = nova; (mql._ls.change || []).forEach((f) => f({ matches: nova })); },
      };
      const janela = {
        matchMedia: (q) => (/max-width:768px/.test(q) ? mql : { matches: false, addEventListener() { }, addListener() { } }),
        addEventListener(t, f) { (janela._ls = janela._ls || {})[t] = f; },
      };
      const st = storageReal(semeado);
      if (lanceEm === 'getItem') st.getItem = () => { throw new Error('SecurityError'); };
      if (lanceEm === 'setItem') st.setItem = () => { throw new Error('QuotaExceededError'); };
      const sandbox = {
        document: doc, localStorage: st, window: janela,
        console: { log() { }, warn() { }, error() { } },
      };
      sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      vm.runInContext(src[0], sandbox, { filename: 'index.html#sidebar' });
      /* O `href` do ícone vive no <use> dentro do botão, não no botão. */
      return { els, use, sandbox, doc, janela, mql, st };
    };

    const cel = rodar(true, null);
    ok('em 375px o rail nasce ligado, com aria-expanded=false e o ícone de expandir',
      cel.els.sidebar.getAttribute('data-rail') === 'on'
      && cel.els['btn-rail'].getAttribute('aria-expanded') === 'false'
      && cel.use.href === '#i-panel-open',
      [cel.els.sidebar.getAttribute('data-rail'), cel.els['btn-rail'].getAttribute('aria-expanded'),
        cel.use.href].join(' / '));

    const desk = rodar(false, { 'gcon-sidebar-v1': 'rail' });
    ok('no desktop o estado guardado é respeitado (rail salvo volta rail)',
      desk.els.sidebar.getAttribute('data-rail') === 'on');

    const cheio = rodar(false, { 'gcon-sidebar-v1': 'full' });
    ok('no desktop sem estado salvo o menu vem expandido',
      cheio.els.sidebar.getAttribute('data-rail') === 'off'
      && cheio.els['btn-rail'].getAttribute('aria-expanded') === 'true'
      && cheio.use.href === '#i-panel-close',
      [cheio.els.sidebar.getAttribute('data-rail'), cheio.use.href].join(' / '));

    /* Clique de verdade: dispara o handler que a IIFE registrou no stub, e
       confere estado, aria, ícone, persistência e o texto da live region.
       O ponto de partida é o menu CHEIO (data-rail="off"), então o primeiro
       clique recolhe. */
    const s = cheio.sandbox;
    const st = cheio.els;
    const clicar = () => st['btn-rail']._ls.click.forEach((f) => f({}));
    clicar();
    ok('o clique recolhe: atributo on, aria-expanded=false, ícone de expandir, salvo como "rail"',
      st.sidebar.getAttribute('data-rail') === 'on'
      && st['btn-rail'].getAttribute('aria-expanded') === 'false'
      && cheio.use.href === '#i-panel-open'
      && s.localStorage.getItem('gcon-sidebar-v1') === 'rail',
      [st.sidebar.getAttribute('data-rail'), st['btn-rail'].getAttribute('aria-expanded'),
        cheio.use.href, s.localStorage.getItem('gcon-sidebar-v1')].join(' / '));
    ok('o clique anuncia na live region (leitor de tela ouve "Menu expandido")',
      st['rail-status'].textContent === 'Menu expandido', st['rail-status'].textContent);
    clicar();
    ok('o segundo clique expande e devolve "full" ao storage',
      st.sidebar.getAttribute('data-rail') === 'off'
      && st['btn-rail'].getAttribute('aria-expanded') === 'true'
      && cheio.use.href === '#i-panel-close'
      && s.localStorage.getItem('gcon-sidebar-v1') === 'full'
      && st['rail-status'].textContent === 'Menu recolhido',
      [st.sidebar.getAttribute('data-rail'), s.localStorage.getItem('gcon-sidebar-v1')].join(' / '));

    /* O que entra no storage tem que ser layout e nada mais. Checagem no
       código (uma única escrita, por uma função que só recebe 'rail'/'full') e
       no runtime (depois dos dois cliques só existem essas duas strings). */
    const naFuncao = /guardar=\(v\)=>\{[\s\S]{0,80}?guardado=v;[\s\S]{0,80}?setItem\(CHAVE,v\)/.test(src[0]);
    const soLayout = Object.values(s.localStorage._d).every((x) => x === 'rail' || x === 'full');
    ok('a chave é versionada e a IIFE só escreve layout, nunca dado de nota',
      /CHAVE='gcon-sidebar-v1'/.test(src[0])
      && /const RAIL='rail',FULL='full';/.test(src[0])
      && /return v===RAIL\?RAIL:FULL;/.test(src[0])
      && (src[0].match(/setItem\(/g) || []).length === 1 && naFuncao && soLayout,
      'setItem x' + (src[0].match(/setItem\(/g) || []).length + ' func=' + naFuncao
      + ' layout=' + soLayout + ' ' + JSON.stringify(s.localStorage._d));
    ok('Esc expande o rail, mas não quando o foco está num campo de texto',
      /e\.key!=='Escape'/.test(src[0]) && /digitando\)return;/.test(src[0])
      && /guardar\(FULL\);aplicar\(false,true\);/.test(src[0]));
    ok('trocar de largura reavalia (rail do celular tem prioridade sobre o estado)',
      /mq\.addEventListener\('change',aoMudar\)|mq\.addListener\(aoMudar\)/.test(src[0])
      && /aplicar\(mq\.matches\|\|guardado===RAIL,false\)/.test(src[0]));
    /* Bug encontrado pelo smoke: a mudança de largura usava a variável em
       memória. Com duas abas abertas, a que tinha 'rail' em memória ignorava o
       'full' que a outra acabara de gravar e voltava ao rail. O storage é a
       fonte da verdade da preferência, em todas as leituras. */
    ok('a mudança de largura relê o storage (duas abas não desincronizam)',
      /const aoMudar=\(\)=>\{guardado=ler\(\);/.test(src[0])
      && /const ler=\(\)=>\{try\{const v=localStorage\.getItem\(CHAVE\);return v===RAIL\?RAIL:FULL;/.test(src[0]));
    ok('existe escuta de "storage": a preferência acompanha entre abas sem recarregar',
      /window\.addEventListener\('storage'/.test(src[0]) && /e\.key!==CHAVE\)return;/.test(src[0])
      && /if\(!ehCelular\(\)\)aplicar\(guardado===RAIL,false\)/.test(src[0]));
    /* guardar é usada no clique e no Esc, e é declarada ANTES dos dois (o
       inverso só funciona porque as chamadas são em listener — armadilha de
       leitura que a revisão de qualidade apontou nesta rodada). */
    ok('guardar é declarada antes de ser usada (sem TDZ por adiamento)',
      /const guardar=\(v\)=>\{[\s\S]{0,120}?\};\s*\n\s*const aplicar=[\s\S]*?btn\.addEventListener/.test(src[0])
      && src[0].indexOf('const guardar=') < src[0].indexOf('btn.addEventListener'));
    ok('o clique alterna rail/full e persiste',
      /guardar\(on\?FULL:RAIL\)/.test(src[0]) && /aplicar\(!on,true\)/.test(src[0]));
    ok('a troca de ícone é por setAttribute no use (não innerHTML)',
      /icone\.setAttribute\('href',/.test(src[0]) && !/icone\.innerHTML/.test(src[0]));
    ok('o announce vai para a live region, não para alert() nem console',
      /status\.textContent=t/.test(src[0]));

    /* ── Mudança de largura: o handler de verdade, chamado de verdade ────── */
    const r1 = rodar(false, { 'gcon-sidebar-v1': 'rail' });
    r1.mql.largura(true);
    ok('desktop com "rail" salvo + janela estreita: o rail do celular assume',
      r1.els.sidebar.getAttribute('data-rail') === 'on');
    r1.mql.largura(false);
    ok('ao voltar para desktop, a preferência "rail" reassume',
      r1.els.sidebar.getAttribute('data-rail') === 'on');
    const r2 = rodar(false, { 'gcon-sidebar-v1': 'full' });
    r2.mql.largura(true);
    ok('celular não grava nada ao mudar de largura (o storage fica "full")',
      r2.els.sidebar.getAttribute('data-rail') === 'on'
      && r2.st.getItem('gcon-sidebar-v1') === 'full');
    r2.mql.largura(false);
    ok('celular→desktop com "full" salvo: volta expandido, semtravar no rail',
      r2.els.sidebar.getAttribute('data-rail') === 'off');
    const r3 = rodar(false, null);
    r3.mql.largura(true);
    r3.mql.largura(false);
    ok('sem preferência salva, o rail não prende ao voltar para desktop',
      r3.els.sidebar.getAttribute('data-rail') === 'off');

    /* ── Storage que lança: modo privado e quota cheia ─────────────────────
       O caminho mais caro e silencioso do produto: o catch engole o erro, a UI
       funciona e nada persiste. Nada na tela denuncia isso. */
    const p1 = rodar(false, null, 'getItem');
    ok('localStorage que lança no getItem: o app abre com o menu expandido',
      p1.els.sidebar.getAttribute('data-rail') === 'off'
      && p1.els['btn-rail'].getAttribute('aria-expanded') === 'true');
    const p2 = rodar(false, { 'gcon-sidebar-v1': 'full' }, 'setItem');
    p2.els['btn-rail']._ls.click.forEach((f) => f({}));
    ok('localStorage que lança no setItem: o clique ainda recolhe na tela',
      p2.els.sidebar.getAttribute('data-rail') === 'on'
      && p2.use.href === '#i-panel-open');
    p2.els['btn-rail']._ls.click.forEach((f) => f({}));
    ok('…e volta a expandir: sem storage, o estado vive só na sessão',
      p2.els.sidebar.getAttribute('data-rail') === 'off' && p2.use.href === '#i-panel-close');

    /* ── Valor corrompido no storage ──────────────────────────────────────
       ler() mapeia qualquer coisa diferente de 'rail' para 'full'. Um refactor
       com toLowerCase() mudaria isso sem o gate gritar. */
    for (const sujo of ['', 'RAIL', 'rail ', ' rail', 'rail\n', 'xyz', 'null', '"rail"', 'true', '1']) {
      const c = rodar(false, { 'gcon-sidebar-v1': sujo });
      ok('storage corrompido (' + JSON.stringify(sujo) + ') abre expandido, sem travar',
        c.els.sidebar.getAttribute('data-rail') === 'off',
        'veio ' + c.els.sidebar.getAttribute('data-rail'));
    }
    const cl = rodar(false, { 'gcon-sidebar-v1': 'rail' });
    ok('storage com "rail" limpo é aceito (o único valor válido)',
      cl.els.sidebar.getAttribute('data-rail') === 'on');

    /* ── Duas abas: uma grava, a outra acompanha ───────────────────────────
       Cenário mounted: a aba de referência é o DOM real (o elemento existe,
       então `ehCelular` responde 375, o celular manda) e o stub só intercepta
       a mudança de largura. Assim a volta de 375 para desktop usa a MESMA
       linha de código do boot, e não um caminho de boot separado que o teste
       nunca exercita — o que foi exatamente o buraco que o smoke achou. */
    /* No Node não existe window; o ponto do cenário é ser mounted, e a
       largura de referência é a do próprio navegador de teste. Se algum dia
       rodar num ambiente com window, o valor real é usado. */
    const refCelular = typeof window !== 'undefined'
      ? window.matchMedia('(max-width:768px)').matches : true;
    const a = rodar(refCelular, { 'gcon-sidebar-v1': 'full' });
    ok('a aba de referência nasce no celular, com o rail do layout (não do storage)',
      a.els.sidebar.getAttribute('data-rail') === 'on',
      'largura de referência = celular?' + refCelular);
    a.sandbox.localStorage.setItem('gcon-sidebar-v1', 'rail');
    const outra = a.janela._ls && a.janela._ls.storage;
    ok('a IIFE registra a escuta de storage na janela', typeof outra === 'function');
    if (outra) {
      outra({ key: 'gcon-sidebar-v1' });
      ok('no celular, a escuta ignora a gravação de outra aba (o rail é layout)',
        a.els.sidebar.getAttribute('data-rail') === 'on'
        && a.sandbox.localStorage.getItem('gcon-sidebar-v1') === 'rail');
      /* Só a mudança de largura faz o storage mandar de novo. */
      a.mql.largura(false);
      ok('ao crescer para desktop, a preferência "rail" da outra aba reassume',
        a.els.sidebar.getAttribute('data-rail') === 'on');
    }
    /* E a mesma linha de código, agora no desktop: o storage passa a mandar. */
    const d = rodar(false, { 'gcon-sidebar-v1': 'full' });
    d.sandbox.localStorage.setItem('gcon-sidebar-v1', 'rail');
    (d.janela._ls.storage)({ key: 'gcon-sidebar-v1' });
    ok('no desktop, a aba que estava "full" recolhe quando a outra grava "rail"',
      d.els.sidebar.getAttribute('data-rail') === 'on');
    (d.janela._ls.storage)({ key: 'outra-chave' });
    ok('storage de outra chave é ignorado (não mexe no menu)',
      d.els.sidebar.getAttribute('data-rail') === 'on');

    /* ── Esc de verdade: o handler registrado no document ────────────────── */
    const ev = (alvo, key) => ({ key, target: alvo || { tagName: 'BODY' } });
    const bEsc = rodar(false, { 'gcon-sidebar-v1': 'rail' });
    bEsc.doc._ls.keydown(ev(null, 'Escape'));
    ok('Esc com o rail recolhido expande e persiste "full"',
      bEsc.els.sidebar.getAttribute('data-rail') === 'off'
      && bEsc.sandbox.localStorage.getItem('gcon-sidebar-v1') === 'full');
    bEsc.doc._ls.keydown(ev({ tagName: 'INPUT' }, 'Escape'));
    ok('Esc com foco num campo de texto não mexe no menu',
      bEsc.els.sidebar.getAttribute('data-rail') === 'off');
    bEsc.doc._ls.keydown(ev(null, 'a'));
    ok('outra tecla não faz nada', bEsc.els.sidebar.getAttribute('data-rail') === 'off');
    bEsc.doc._ls.keydown(ev(null, 'Escape'));
    ok('Esc com o rail já expandido é no-op (não alterna sozinho)',
      bEsc.els.sidebar.getAttribute('data-rail') === 'off');
    /* Bloqueio da revisão de arquitetura: em ≤768px o atributo está 'on' por LAYOUT, não por
       escolha. Sem o guard, o Esc gravava "full" por conta própria (apagando a
       preferência de desktop) e anunciava "Menu expandido" sem expandir, porque
       a media query manteria os 64px. */
    const cEsc = rodar(true, { 'gcon-sidebar-v1': 'rail' });
    cEsc.doc._ls.keydown(ev(null, 'Escape'));
    ok('Esc no celular não grava "full" nem anuncia (o rail é layout, não escolha)',
      cEsc.els.sidebar.getAttribute('data-rail') === 'on'
      && cEsc.sandbox.localStorage.getItem('gcon-sidebar-v1') === 'rail'
      && cEsc.els['rail-status'].textContent === '',
      [cEsc.els.sidebar.getAttribute('data-rail'),
        cEsc.sandbox.localStorage.getItem('gcon-sidebar-v1'),
        cEsc.els['rail-status'].textContent].join(' / '));
  }
}

// ══════════════════════════════════════════════════════════════
grupo('13.1 · LEITOR DE PDF: chave com estrutura, rótulo como valor, nome por CNPJ');
// ══════════════════════════════════════════════════════════════
/* Tudo aqui é sintético e roda em ~1 ms: a bancada (285 campos) depende de
   amostras/ e de OCR, então numa clonagem nova ela não existe. Estes casos
   congelam as regras que a bancada provou em PDFs reais, sem dado de cliente.

   Origem de cada regra: a bancada com 14 notas (2 emissores, camada de texto e
   escaneadas) expôs 4 defeitos que davam 99% de confiança em dado errado:
   - o código de barras colado no endereço cria um run de 48 dígitos e TRÊS janelas
     de 44 passam no módulo 11; as duas erradas têm cUF/AAMM impossíveis;
   - "NATUREZA DA OPERAÇÃO" casado pela metade devolvia "ÇÃO" como natureza;
   - o rotulo da própria tabela ("BAIRRO / DISTRITO CEP ...") virava endereço;
   - o CNPJ impresso com máscara não era encontrado, zerando os nomes.

   O sandbox carrega o ModPDFIsolado INTEIRO (fatia do IIFE até o </script>, com o
   return reescrito), e não função por função. O recorte `function N\([\s\S]*?\n\}`
   só funciona em função multi-linha: a maioria do módulo é one-liner, então a
   captura vazava até a próxima função que fecha na coluna 1 — `d` (linha 71) puxava
   `vC`, `vH`, `chaveEstrutural` e `eC` inteiro, e a mesma peça era colada cinco
   vezes. A asserção de tamanho (`mod.length > 2000`) media essa duplicação, não
   cobertura. E o recorte não alcança `parseFull`, que é onde moram três das seis
   correções deste diff. */
{
  const ini = html.indexOf('window.ModPDFIsolado=(()=>{');
  const fim = html.indexOf('</script>', ini);
  ok('o módulo ModPDFIsolado existe e fecha no </script>', ini > 0 && fim > ini, ini + '..' + fim);
  const EXPORTAR = ['d', 'vC', 'vH', 'chaveEstrutural', 'chaveOk', 'reparaChave', 'isNoiseNum', 'ehRotulo',
    'idxCnpj', 'nomePertoCnpj', 'eNome', 'eDatas', 'eVenc', 'eNatOp', 'eEndereco', 'eSerie',
    'eJ', 'eN', 'eC', 'decodChave', 'parseFull', 'finalizar', 'mergeExtracao',
    /* O 13.2 exercita `cnpjsNoTexto` direto: é onde está o O(n²) corrigido, e
       a prova de equivalência precisa da função, não só de `eJ`. */
    'cnpjsNoTexto', 'spansCodigoBarras'];
  let mod = ini > 0 ? html.slice(ini, fim) : '';
  const mRet = mod.match(/return\s*\{[^}]*extrair[^}]*\}\s*;/);
  ok('o return do ModPDFIsolado é encontrado (o contrato mudou?)', !!mRet);
  const faltando = EXPORTAR.filter((n) => !new RegExp('function ' + n + '\\s*\\(').test(mod));
  ok('toda função exercitada por este grupo existe no módulo', faltando.length === 0, faltando.join(','));
  if (mRet) mod = mod.replace(mRet[0], 'return{' + EXPORTAR.join(',') + '};');
  const sb = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    /* createElement LANÇA de propósito: um caso que alcance ocrPDF/tC morre com
       mensagem, em vez de devolver texto vazio e passar por construção. */
    document: { createElement: () => { throw new Error('canvas indisponível no gate'); } },
    setTimeout, clearTimeout, Date, Math, JSON, Intl, Promise,
  };
  vm.createContext(sb);
  let carregou = '';
  try { vm.runInContext(mod, sb, { filename: 'index.html#ModPDFIsolado' }); carregou = 'ok'; }
  catch (e) { carregou = e.message; }
  ok('o módulo do leitor de PDF carrega no sandbox', carregou === 'ok', carregou);
  const M = sb.window.ModPDFIsolado;
  if (M) {
    const CHAVE_OK = '35260911222333000181550010000001231123456783';
    /* Janelas forjadas com a MESMA forma do defeito real: no PDF "NF 900000101" o
       codigo de barras sai colado no endereco ("... - 100 3326 0806 ... 1-SAIDA 1")
       e forma um run de 48 digitos; tres janelas de 44 passam no modulo 11 e duas
       tem estrutura impossible. Aqui as duas janelas falsas foram recalculadas por
       busca (vH true + estrutura falsa + CNPJ interno com DV invalido), a partir da
       chave sintetica acima: cUF plausivel, mes 91 e mod 50 na primeira; cUF 43,
       mes 60 e mod 15 na segunda. */
    const JANELAS_FALSAS = [
      '52609112223330001815500100000012311234567835',
      '43526091122233300018155001000000123112345678',
    ];
    ok('a chave de verdade passa no DV e na estrutura', M.chaveOk(CHAVE_OK) === true);
    JANELAS_FALSAS.forEach((j, i) => {
      ok('janela falsa #' + (i + 1) + ' passa no DV puro (por isso o DV não basta)', M.vH(j) === true, j);
      ok('janela falsa #' + (i + 1) + ' é rejeitada pela estrutura da chave', M.chaveEstrutural(j) === false,
        'cUF=' + j.slice(0, 2) + ' AAMM=' + j.slice(2, 6) + ' mod=' + j.slice(20, 22));
    });
    ok('estrutura: cUF fora de 11..53 é rejeitada', M.chaveEstrutural('00260911222333000181550010000001231123456783') === false);
    ok('estrutura: mês 00 ou 13 é rejeitado', M.chaveEstrutural('35260011222333000181550010000001231123456783') === false);
    ok('estrutura: modelo diferente de 55/65 é rejeitado', M.chaveEstrutural('35260911222333000181500010000001231123456783') === false);
    ok('o reparaChave exige estrutura, não só DV', /\bok=\(c\)=>chaveOk\(c\)&&vC\(c\.slice\(6,20\)\)/.test(html));

    ok('rótulo de tabela não vira endereço',
      M.eEndereco('ENDEREÇO BAIRRO / DISTRITO CEP ROD QR 325 Nr SN - EMPRESA') === '',
      JSON.stringify(M.eEndereco('ENDEREÇO BAIRRO / DISTRITO CEP ROD QR 325 Nr SN - EMPRESA')));
    ok('endereço com número e CFOP depois volta só o logradouro',
      M.eEndereco('ENDEREÇO: RUA EXEMPLO - 100 1- SAÍDA [1] 3326 0806 0203 1800') === 'RUA EXEMPLO - 100',
      JSON.stringify(M.eEndereco('ENDEREÇO: RUA EXEMPLO - 100 1- SAÍDA [1] 3326 0806 0203 1800')));

/* Texto plano: rótulo, depois o ruído do protocolo e da IE, depois o valor.
       O número de 15 dígitos e a data são SINTÉTICOS: este texto veio de uma
       nota real, e protocolo + natureza de operação + endereço de emitente são
       dado fiscal tanto quanto o CNPJ. A barreira é o gate que cruza protocolo e
       chave 44 do gabarito contra TODO arquivo versionado — este bloco é
       exatamente onde o dado real entrou da última vez. */
    /* Natureza de operação e IE SINTÉTICAS. Este texto veio de uma nota real, e
       os dois identificam a operação fiscal: a natureza diz o que foi
       vendido e para quem, a IE localiza o contribute. Dado fiscal não é só
       o que identifica a empresa — é o que identifica a operação. */
    const NAT = 'NATUREZA DA OPERAÇÃO PROTOCOLO DE AUTORIZAÇÃO DE USO VENDA EXEMPLO COMERCIO EXEMPLO DESTINATÁRIO 100200300400501 09/09/2026 10:47:37 INSCRIÇÃO ESTADUAL';
    ok('natureza da operação pula o rótulo do protocolo e lê o valor',
      M.eNatOp(NAT) === 'VENDA EXEMPLO COMERCIO EXEMPLO DESTINATÁRIO', JSON.stringify(M.eNatOp(NAT)));
    const NAT_OCR = 'NATUREZA DA OPERAÇÃO INSCRIÇÃO ESTADUAL TNSCR ESTADUAL SUBSTITUTO TRIBUTÁRIO VENDA PRODUÇÃO ESTAB.DESTINADA A NÃO CONTRIBUINT 98000014 DESTINATÁRIO';
    ok('natureza da operação sobrevive ao OCR que leu "INSCR.ESTADUAL" como "TNSCR ESTADUAL"',
      M.eNatOp(NAT_OCR) === 'VENDA PRODUÇÃO ESTAB.DESTINADA A NÃO CONTRIBUINT', JSON.stringify(M.eNatOp(NAT_OCR)));
    ok('sem verbo de operação no rotulo, a natureza volta vazia (não "ÇÃO")',
      M.eNatOp('NATUREZA DA OPERAÇÃO 98000014 DESTINATÁRIO') === '', JSON.stringify(M.eNatOp('NATUREZA DA OPERAÇÃO 98000014 DESTINATÁRIO')));
    ok('o rótulo da natureza é casado inteiro (não deixa o "ÇÃO" solto)',
      /NATUREZA\\s\*DA\\s\*OPERA\[CÇ\]\[AÃ\]O/i.test(html));

    ok('o CNPJ é localizado mesmo impresso com máscara', M.idxCnpj('EMITENTE 11.222.333/0001-81 AUTORIZADA', '11222333000181') > 0);
    ok('CNPJ com espaço entre os grupos também é localizado', M.idxCnpj('REF 11 222 334 0001 26 FIM', '11222334000126') > 0);
    ok('CNPJ com separador duplo não quebra nem vira regex inválida',
      M.idxCnpj('CNPJ 11.222.333//0001-81', '11222333000181') >= 0);

    /* nome: a razão social do destinatário vem ANTES do CNPJ dele, e o nome do
       emitente numa DANFE de conta de terceiro é o da fábrica — o teste do CNPJ
       mais próximo é o que separa um do outro. */
    const JANELA = 'DADOS DO EMITENTE TRANSPORTES EXEMPLO INDUSTRIA E COMERCIO LTDA EMITENTE CNPJ/CPF 11.222.333/0001-81 DESTINATÁRIO NOME / RAZÃO SOCIAL CÓD. DEALER CNPJ / CPF EXEMPLO SERVICOS LTDA 000004844 11.222.334/0001-26';
    ok('nome do destinatário aceito: sufixo empresarial + CNPJ mais próximo é o dele',
      M.nomePertoCnpj(JANELA, '11222334000126') === 'EXEMPLO SERVICOS LTDA', JSON.stringify(M.nomePertoCnpj(JANELA, '11222334000126')));
    ok('nome de empresa com "SERVICOS" no meio não é cortado como rótulo',
      /EXEMPLO SERVICOS LTDA/.test(M.nomePertoCnpj(JANELA, '11222334000126')));
    ok('a fábrica não é devolvida como nome do revendedor (CNPJ diferente por perto)',
      M.nomePertoCnpj(JANELA, '11222333000181') !== 'INDUSTRIA E COMERCIO DE VEICULOS LTDA',
      JSON.stringify(M.nomePertoCnpj(JANELA, '11222333000181')));
    ok('"SA" dentro de "SANTO" não casa como sufixo empresarial',
      M.nomePertoCnpj('FAZENDA SANTO ANTONIO LTDA 11.222.333/0001-81', '11222333000181') === 'FAZENDA SANTO ANTONIO LTDA',
      JSON.stringify(M.nomePertoCnpj('FAZENDA SANTO ANTONIO LTDA 11.222.333/0001-81', '11222333000181')));
    ok('CNPJ com máscara não entra no nome (o token tem 6+ dígitos)',
      M.nomePertoCnpj('11.222.335/0001-70 EXEMPLO MANUTENCAO LTDA 11.222.336/0001-15', '11222336000115') === 'EXEMPLO MANUTENCAO LTDA',
      JSON.stringify(M.nomePertoCnpj('11.222.335/0001-70 EXEMPLO MANUTENCAO LTDA 11.222.336/0001-15', '11222336000115')));
    ok('eNome não acha nome sem CNPJ (sinal de que a nota não tem o campo)',
      M.eNome('NATUREZA DA OPERAÇÃO VENDA LTDA', [], '') === '');

    /* data de saída: sem o rótulo, o leitor não chega a 2ª data do documento */
    const DT = 'DATA DA EMISSÃO 17/09/2026 11:34:18 HORA DA SAÍDA 1 VENCIMENTO 06.09.2026';
    const dts = M.eDatas(DT);
    ok('data de emissão vem do rótulo', dts.data === '17/09/2026', dts.data);
    ok('data de saída sem rótulo fica vazia (não é a 2ª data qualquer)',
      dts.dataSaida === '', JSON.stringify(dts.dataSaida));
    ok('vencimento vem do rótulo', dts.vencimento === '06.09.2026', dts.vencimento);

    ok('o código de barras (15 dígitos) não engole o número colado nele',
      /\.replace\(\/\\d\{14,\}\/g,' '\)/.test(html),
      (/\.replace\(\/\\d\{1[0-9],?\}\/g,' '\)/.exec(html) || [''])[0]);
    /* Este caso e de INTENCAO declarada: ele casa o literal do fonte, e nao o
       comportamento. O fuzz diferencial (16.928 entradas) mostrou que trocar
       \d{15,} por \d{14,} nao muda o numero lido em nenhuma entrada - a janela
       ja barra runs de 11+ digitos. O literal fica para documentar a intencao; se
       alguem reverter o codigo, este caso acusa, mas quem decide se o numero sai
       certo e o caso 6 do 13.2 (comportamento). */
  }

  // ══════════════════════════════════════════════════════════════
  grupo('13.2 · LEITOR DE PDF: os ramos que a bancada NÃO alcança');
  // ══════════════════════════════════════════════════════════════
  /* chaveValida=false é 0/14 nas notas reais, então a bancada de 2,5 min não alcança
     nenhum destes ramos. A revisão de testes rodou as asserções do 13.1 contra 7
     mutantes — cada correção revertida — e NENHUMA quebrou: os casos congelavam
     intenção, não comportamento. Aqui os seis casos são de comportamento, e cada um
     morre quando a correção que o motivou volta. Todos sintéticos, sem dado de
     cliente, e sem browser/OCR (rodam no mesmo vm do 13.1). */
  if (M) {
    const EMIT = '11222333000181';   // CNPJ do emitente
    const TOM = '11222334000126';    // CNPJ do destinatário
    /* Janela de 44 forjada com a forma do defeito real: cUF plausível, AAMM com mês
       impossível (80) e o CNPJ do OUTRO participante nas posições 7-20, com DV válido.
       O DV foi calculado pelo módulo 11, então a janela passa no DV por construção e
       é rejeitada pela estrutura. Era exatamente isto que fazia o emitente virar
       tomador com `garantia = "CNPJ+número OK"`. */
    const JANELA = '35268011222334000126550019000001011123456784';
    const CHAVE_OK = '35260911222333000181550010000001231123456783';

    ok('a janela forjada está armada: DV passa, estrutura falha, e o CNPJ interno é do tomador',
      M.vH(JANELA) === true && M.chaveEstrutural(JANELA) === false && M.chaveOk(JANELA) === false
      && M.vC(JANELA.slice(6, 20)) === true && JANELA.slice(6, 20) === TOM);

    const PDF = 'DADOS DO EMITENTE NOME / RAZÃO SOCIAL DISTRIBUIDORA EXEMPLO LTDA CNPJ / CPF 11.222.333/0001-81 '
      + 'DESTINATÁRIO NOME / RAZÃO SOCIAL COMERCIO DE VEICULOS LTDA CNPJ / CPF 11.222.334/0001-26 '
      + 'CODIGO DE BARRAS ' + JANELA + ' DATA DA EMISSÃO 17/09/2026 NOTA FISCAL Nº 900000101';
    const r = M.finalizar(M.parseFull(PDF, [], 'texto'), PDF, 'texto', false, '');

    /* 1 · o CNPJ das posições 7-20 só vale com chave validada. */
    ok('chave não validada: o prestador NÃO vem das posições 7-20 (que são do tomador)',
      r.chaveValida === false && r.cnpjPrestador === EMIT && r.cnpjFonte !== 'chave 44',
      'prest=' + r.cnpjPrestador + ' fonte=' + r.cnpjFonte);
    ok('e as duas pontas não se trocam (prest=emitente, tom=destinatário)',
      r.cnpjPrestador === EMIT && r.cnpjTomador === TOM,
      'prest=' + r.cnpjPrestador + ' toma=' + r.cnpjTomador);

    /* 1b · a MESMA janela, pelo lado da confiança. `chaveConf` mede o DV, e uma
       janela que só passa no DV entrava com 70 na média — o que fazia a linha
       sair verde no filtro "Alta" (>=70) sem chave válida nenhuma. A chave pesa
       zero enquanto `chaveValida` for falso, pelo mesmo motivo pelo qual o CNPJ
       das posições 7-20 não vale sem chave validada: DV válido não é chave. */
    ok('chave não validada: o confMedio não pode entrar na faixa "Alta" (>=70)',
      r.chaveValida === false && r.confMedio < 70,
      'confMedio=' + r.confMedio + ' chaveConf=' + r.chaveConf + ' numeroConf=' + r.numeroConf + ' cnpjConf=' + r.cnpjConf);
    ok('e a média ponderada é MENOR que a média crua (a chave estava pesando DV)',
      r.confMedio < r.confMedioComChaveInvalida,
      'ponderada=' + r.confMedio + ' crua=' + r.confMedioComChaveInvalida);
    ok('o peso é da chave, não da média quebrada: com DV válido a chave sozinha daria >=70',
      r.chaveConf >= 70, 'chaveConf=' + r.chaveConf);
    /* Com chave VALIDADA a ponderação é neutra: uma chave real tem de continuar
       contando, senão a correção vira "abaixa a confiança de tudo". */
    const rOk = M.finalizar(M.parseFull(
      'DADOS DO EMITENTE NOME / RAZÃO SOCIAL DISTRIBUIDORA EXEMPLO LTDA CNPJ / CPF 11.222.333/0001-81 '
      + 'CODIGO DE BARRAS ' + CHAVE_OK + ' DATA DA EMISSÃO 17/09/2026 NOTA FISCAL Nº 900000101',
      [], 'texto'), 'CODIGO DE BARRAS ' + CHAVE_OK + ' NOTA 900000101 CNPJ 11.222.333/0001-81', 'texto', false, '');
    ok('chave validada: a confiança NÃO é penalizada (a ponderação só cobre chave inválida)',
      rOk.chaveValida === true && rOk.confMedio === rOk.confMedioComChaveInvalida && rOk.confMedio >= 70,
      'valida=' + rOk.chaveValida + ' media=' + rOk.confMedio + ' crua=' + rOk.confMedioComChaveInvalida);

    /* 2 · eJ: fragmento de 14 dígitos do código de barras não é CNPJ de ninguém. */
    const listaCnpj = M.eJ('CODIGO DE BARRAS ' + CHAVE_OK + ' NOTA 900000101').lista;
    ok('eJ: nenhum fragmento de 14 sai do código de barras de 44',
      listaCnpj.length === 0, JSON.stringify(listaCnpj.map((c) => c.dig)));
    ok('eJ: o CNPJ impresso ao lado do rótulo SOBREVIVE ao corte por span',
      M.eJ('CODIGO DE BARRAS ' + CHAVE_OK + ' CNPJ / CPF 11.222.333/0001-81').prest === EMIT);

    /* 2b · o código de barras da DANFE tem 15 dígitos (CNPJ+número+"SAS"), não 44.
       Com o span em 44+, o RE_CNPJ casava os 14 primeiros desse código, o módulo
       11 fechava por acaso e o leitor devolvia aquele número como emitente com
       confiança 95 e garantia VERDE — as duas pontas trocadas, em silêncio.
       Este caso é a medida direta do defeito: prestador tem que ser o CNPJ
       impresso ao lado, nunca o DV do código de barras. */
    const BARRAS = '123451234512345';
    ok('o caso está armado: os 14 primeiros dígitos do código de barras fecham DV',
      M.vC(BARRAS.slice(0, 14)) === true, 'dig=' + BARRAS.slice(0, 14));
    const rBarras = M.eJ('CONTROLE ' + BARRAS + ' 11.222.333/0001-81 11.222.334/0001-26');
    ok('eJ: o DV do código de barras de 15 NÃO vira CNPJ de ninguém',
      !rBarras.lista.some((c) => c.dig === BARRAS.slice(0, 14)),
      JSON.stringify(rBarras.lista.map((c) => c.dig)));
    ok('eJ: com o código de barras presente, o prestador é o CNPJ impresso ao lado',
      rBarras.prest === EMIT && rBarras.conf === 95,
      'prest=' + rBarras.prest + ' conf=' + rBarras.conf);

    /* 2c · o O(n²) de `cnpjsNoTexto`. A implementação com `spans.some(...)` por
       candidato custava O(candidatos × spans) — 47 ms em 800 KB, com 16x de
       entrada para 31,8x de tempo. Agora os dois percursos avançam juntos, e o
       predicado é o mesmo ("candidato contido no span").

       O gate não mede tempo (timer varia por máquina): ele mede a ORDEM dos
       percursos, que é o que torna a complexidade linear. Um gate de tempo aqui
       reprovaria em CI lento e passaria em máquina rápida — o oposto de um
       portão. */
    {
/* O gate NÃO fixa a forma do laço, e é deliberado: `i++` → `i+=1` é
         equivalente, e um gate que exige `i++` reprova uma correção sem
         comportamento. O que ele mede é o que faz o custo ser linear: a
         varredura quadrática não está lá. Se o `while` não existe, a
         equivalência por exaustão abaixo morre (medido: 5 asserções), e é ela
         que segura. */
      const brutoCnpj = html.slice(html.indexOf('function cnpjsNoTexto'), html.indexOf('function eJ('));
      const corpoCnpj = brutoCnpj.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').split(/\r?\n/);
      ok('cnpjsNoTexto não faz varredura quadrática (sem `spans.some` por candidato)',
        !corpoCnpj.some((l) => /spans\.some\(/.test(l)),
        corpoCnpj.filter((l) => /spans\.some\(/.test(l)).join(' | ') || 'nenhuma varredura por candidato');
      /* O comportamento tem de ser IDÊNTICO: o predicado "contido no span" com
         dois ponteiros só é equivalente se o `while` pula span que termina antes
         do candidato — sem ele, um candidato depois de um span longo seria
         comparado com o span errado. */
      const textoLongo = 'CODIGO DE BARRAS ' + CHAVE_OK + ' NOTA 1 CNPJ 11.222.333/0001-81 '
        + 'CODIGO DE BARRAS ' + CHAVE_OK + ' NOTA 2 CNPJ 11.222.334/0001-26 '
        + 'CODIGO DE BARRAS ' + JANELA + ' NOTA 3 CNPJ 11.222.337/0001-83';
      const lido = M.cnpjsNoTexto(textoLongo);
      ok('dois ponteiros: os três CNPJs ao lado do rótulo sobrevivem (3 spans antes)',
        lido.length === 3 && lido[0].dig === EMIT && lido[1].dig === TOM && lido[2].dig === '11222337000183',
        JSON.stringify(lido.map((c) => c.dig)));
      /* E o que o `while` descarta: o CNPJ DENTRO do código de barras some,
         mesmo vindo depois de outros. */
      const colado = M.cnpjsNoTexto('X ' + CHAVE_OK + ' Y CNPJ 11.222.333/0001-81 Z ' + JANELA + ' W');
      ok('e o CNPJ colado no código de barras continua descartado (o `while` pula o span certo)',
        !colado.some((c) => c.idx >= 2 && c.idx < 2 + CHAVE_OK.length) && colado.some((c) => c.dig === EMIT),
        JSON.stringify(colado.map((c) => c.dig + '@' + c.idx)));

/* Equivalência por DIFERENÇA, não por borda escolhida à mão. Dois ponteiros
         só substituem `spans.some` se derem o mesmo resultado em TODA
         entrada, e escolher "a borda" na mão erra: o `spansCodigoBarras` é
         guloso e só atravessa `[\s.\-]`, então a "/" do CNPJ mascarado o
         para e a borda que eu imaginei (`fim<=`) não existe no texto que eu
         construí. A verificação vai por exaustão: casos montados mais texto
         aleatório com semente fixa, e os dois lados comparados. */
      {
        /* Compara (dig, idx), não o objeto inteiro: o `antigo` reimplementado
           aqui não calcula `valida`, e comparar o JSON inteiro acusava 229
           divergências que eram o campo a menos. Comparar o que a decisão
           produz é o que interessa. */
        const antigo = (t) => {
          const spans = M.spansCodigoBarras(t), out = [];
          const RE = /\d{2}[\.\s]?\d{3}[\.\s]?\d{3}[\/\s]?\d{4}[\-\s]?\d{2}/g;
          for (const m of t.matchAll(RE)) {
            if (spans.some(([a, b]) => m.index >= a && m.index + m[0].length <= b)) continue;
            const dig = m[0].replace(/\D/g, '');
            if (dig.length !== 14) continue;
            out.push(dig + '@' + m.index);
          }
          return out.join(',');
        };
        const novo = (t) => M.cnpjsNoTexto(t).map((c) => c.dig + '@' + c.idx).join(',');
        const PIECAS = [CHAVE_OK, JANELA, BARRAS, '11.222.333/0001-81', '11.222.334/0001-26', ' CNPJ / CPF ',
          'NOTA 900000101', '11.222.337/0001-83', '.', '-', ' ', '\n', '0.001.001/0001-81', 'CODIGO DE BARRAS '];
        let semente = 20260902, difs = 0, casos = 0;
        /* O caso que pega a borda direita, escrito à mão porque a exaustão só
           acha por acaso: chave repetida colada, onde o último candidato
           termina exatamente no último dígito do span. `fim<` deixa esse CNPJ
           passar. */
        const repetida = CHAVE_OK.repeat(7) + '  CNPJ / CPF ';
        casos++;
        ok('candidato que termina no último dígito do span é descartado (borda `fim<=`)',
          antigo(repetida) === novo(repetida) && novo(repetida) === '',
          'antigo=[' + antigo(repetida) + '] novo=[' + novo(repetida) + ']');
        const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente; };
        /* 3000 casos, não 400: a borda que separa `fim<=` de `fim<` aparece
           em ~1 caso de 1500 (medido), porque depende do `spansCodigoBarras`
           guloso e de onde o `matchAll` do RE_CNPJ cai. Com 400 casos o gate
           era cego a essa mutação — eu a rodei 1500 vezes antes de achar o
           caso que a pega. */
        for (let i = 0; i < 3000; i++) {
          const partes = [];
          const quantas = 1 + rnd() % 9;
          for (let k = 0; k < quantas; k++) partes.push(PIECAS[rnd() % PIECAS.length]);
          const t = partes.join(rnd() % 3 === 0 ? '' : ' ');
          casos++;
          const a = antigo(t), b = novo(t);
          if (a !== b) { difs++; if (difs <= 2) ok('equivalência do cnpjsNoTexto no caso ' + casos, false, 'antigo=[' + a + '] novo=[' + b + '] em ' + JSON.stringify(t.slice(0, 80))); }
        }
        ok('cnpjsNoTexto com dois ponteiros = `spans.some`, por exaustão (' + casos + ' casos)',
          difs === 0, difs + ' divergência(s)');
      }
    }
    /* O span não pode engolir o CNPJ real: sozinho tem 14 dígitos e é contado. */
    ok('eJ: um CNPJ isolado (14 dígitos) continua sendo lido',
      M.eJ('11.222.333/0001-81 NOTA FISCAL Nº 12345').prest === EMIT);
    /* Com o piso em 44, o run de 23 dígitos ("000004844 11.222.333/0001-81")
       NÃO era bloqueado, apesar de o comentário do código afirmar que era: o
       span exige separador entre dígitos e a "/" do CNPJ não é separador, então
       o span terminava antes do CNPJ. Incluir a "/" no separador resolveria,
       mas medido: quebrou a bancada (262/285) e dois casos de nome. Então o
       contador de formulário continua sendo lido como CNPJ — comportamento
       antigo e conhecido, registrado aqui para não virar surpresa. O que
       estava em jogo (o DV do código de barras de 15) está resolvido acima. */
    ok('eJ: contador de 9 dígitos + CNPJ ainda é lido (comportamento antigo, fora do escopo)',
      M.eJ('000004844 11.222.333/0001-81').prest === EMIT,
      JSON.stringify(M.eJ('000004844 11.222.333/0001-81').lista.map((c) => c.dig)));
    ok('eJ: a chave de 44 colada no CNPJ não impede a leitura do CNPJ ao lado',
      M.eJ(CHAVE_OK + ' 11.222.333/0001-81').prest === EMIT);

    /* 3 · nomePertoCnpj: run cortado volta vazio, nunca a cauda do nome. */
    const LONGO = 'DADOS DO EMITENTE INDUSTRIA E COMERCIO DE VEICULOS NOVOS E USADOS LTDA '
      + 'CNPJ / CPF 11.222.333/0001-81 DESTINATARIO EXEMPLO SERVICOS LTDA 11.222.334/0001-26';
    const nomeLongo = M.nomePertoCnpj(LONGO, EMIT);
    ok('nome com mais de 8 tokens volta vazio (nunca a cauda "… NOVOS E USADOS LTDA")',
      nomeLongo !== 'E COMERCIO DE VEICULOS NOVOS E USADOS LTDA' && !/USADOS LTDA$/.test(nomeLongo),
      JSON.stringify(nomeLongo));

    /* 4 · o nome do destinatário não pode responder pelo emitente. O bloco do
       destinatário cai fora dos 60 caracteres à direita da janela, e o "CNPJ mais
       próximo antes" virava o do emitente: eNome devolvia o nome do tomador como
       nome do emitente. Só o CNPJ que vem DEPOIS do nome pode validá-lo. */
    ok('o nome do tomador NÃO vira o nome do emitente',
      M.eNome(LONGO, [], EMIT) !== 'EXEMPLO SERVICOS LTDA',
      'eNome(emit) devolveu ' + JSON.stringify(M.eNome(LONGO, [], EMIT)));
    ok('e o nome do emitente segue saindo quando é curto e colado no CNPJ dele',
      M.nomePertoCnpj('DADOS DO EMITENTE DISTRIBUIDORA EXEMPLO LTDA 11.222.333/0001-81', EMIT) === 'DISTRIBUIDORA EXEMPLO LTDA',
      JSON.stringify(M.nomePertoCnpj('DADOS DO EMITENTE DISTRIBUIDORA EXEMPLO LTDA 11.222.333/0001-81', EMIT)));

    /* 5 · numeroAncora: DV válido + estrutura ruim = "chave não validada". */
    const ra = M.parseFull('CONTEUDO DA NOTA ' + JANELA + ' DATA DA EMISSAO 17/09/2026', [], 'texto');
    ok('âncora diz "chave não validada" (o DV era válido; o que falhou foi a estrutura)',
      ra.chaveValida === false && ra.numeroAncora.includes('não validada')
      && !ra.numeroAncora.includes('DV inválido'), JSON.stringify(ra.numeroAncora));

    /* 6 · eN: o número colado no código de barras é lido (comportamento, não literal). */
    const en = M.eN('NÚMERO DA NOTA  123456789012345 900000101', []);
    ok('número colado num código de 15 dígitos é lido com confiança alta',
      en.valor === '900000101' && en.conf >= 90, JSON.stringify(en.valor) + ' conf ' + en.conf);

    /* 7 · a chave autêntica não regride: fonte "chave 44" e confiança 98/99.
       A chave sintética tem nNF = 000000123, então o número esperado é 123 —
       a âncora "NOTA 56783" do texto existe de propósito e NÃO pode ganhar. */
    const okRec = M.parseFull('CODIGO DE BARRAS ' + CHAVE_OK + ' DATA DA EMISSÃO 17/09/2026 NOTA 56783', [], 'texto');
    ok('chave autêntica: chaveValida, prestador pela chave, número da chave e confiança 98/99',
      okRec.chaveValida === true && okRec.cnpjFonte === 'chave 44' && okRec.cnpjConf === 98
      && okRec.numeroConf === 99 && okRec.numero === '123',
      'fonte=' + okRec.cnpjFonte + ' cConf=' + okRec.cnpjConf + ' nConf=' + okRec.numeroConf + ' n=' + okRec.numero);
  }

  // ══════════════════════════════════════════════════════════════
  grupo('13.3 · CONTRATOS que a revisão estreitou');
  // ══════════════════════════════════════════════════════════════
  /* Cada linha aqui é um ponto em que uma revisão encontrou um furo e a
     correção não tinha caso: sem caso, a próxima mudança reintroduz. */
  if (M) {
    const EMIT = '11222333000181';
    const CHAVE_OK = '35260911222333000181550010000001231123456783';

    /* Ano: o guard anterior (ano<0||ano>99) era inalcançável — `+slice(2,4)` de uma
       string de dígitos é sempre 0..99 — e o README dizia "ano e mês plausíveis".
       A NF-e existe desde 2006, então abaixo de 6 não é chave. */
    ok('estrutura: ano abaixo de 2006 é rejeitado (o guard antigo era inalcançável)',
      M.chaveEstrutural('35' + '0309' + EMIT + '55' + '001' + '000000001' + '1' + '12345678'.slice(0, 0) + '12345678') === false,
      M.chaveEstrutural('35' + '0309' + EMIT + '55' + '001' + '000000001' + '1' + '12345678'));
    ok('estrutura: ano plausível continua aceito', M.chaveEstrutural(CHAVE_OK) === true);

    /* idxCnpj: o try/catch nao e a guarda. `new RegExp` so lanca em entrada
       invalida; metacaractere compila e devolve regex ERRADO em silencio
       (medido na revisão: "6.0(2)0" virava regex com grupo). A guarda e o
       /^\d{14}$/ sobre a entrada. */
    ok('idxCnpj recusa entrada que nao sao 14 dígitos (metacaractere não vira regex)',
      M.idxCnpj('TEXTO QUALQUER', '6.0(2)0') === -1 && M.idxCnpj('TEXTO', '1122233300018') === -1
      && M.idxCnpj('TEXTO', '') === -1, 'o catch nunca entrava nesses casos');
    ok('idxCnpj ainda acha o CNPJ de 14 dígitos', M.idxCnpj('EMITENTE 11.222.333/0001-81 FIM', EMIT) > 0);

    /* Um leitor de CNPJ só, com uma política de ocorrência só. Antes o mesmo
       literal vivia em eJ e em nomePertoCnpj, e idxCnpj montava o dele — as três
       discordavam sobre "qual impressão deste CNPJ vale". */
    ok('o leitor de CNPJ do documento é um só (eJ, idxCnpj e nomePertoCnpj usam o mesmo)',
      /\/\* Leitor de CNPJ do documento, em UM lugar so/.test(html) && /const RE_CNPJ=/.test(html)
      && /const cnpjs=\(txt\)=>cnpjsNoTexto\(txt\)/.test(html) && /const cand=cnpjsNoTexto\(full\)/.test(html),
      'cnpjsNoTexto=' + (html.match(/cnpjsNoTexto\(/g) || []).length + ' usos');
    ok('CNPJ impresso dentro do código de barras é descartado, o ao lado do rótulo não',
      M.eJ('CODIGO DE BARRAS ' + CHAVE_OK + ' CNPJ / CPF 11.222.333/0001-81').prest === EMIT
      && M.eJ('CODIGO DE BARRAS ' + CHAVE_OK + ' NOTA 1234').lista.length === 0);

    /* Listas de rótulo por consumidor: cabeçalho de tabela x ficha do participante.
       "EXCEL"/"EMISSORA"/"BANCO" são razão social e não podem quebrar o nome. */
    ok('razão social que começa com palavra de cabeçalho de tabela NÃO é descartada',
      M.nomePertoCnpj('DADOS DO EMITENTE EXCEL COMERCIO LTDA 11.222.333/0001-81', EMIT) === 'EXCEL COMERCIO LTDA',
      JSON.stringify(M.nomePertoCnpj('DADOS DO EMITENTE EXCEL COMERCIO LTDA 11.222.333/0001-81', EMIT)));
    ok('e "BANCO … S/A" também (SA é sufixo empresarial, não rótulo)',
      M.nomePertoCnpj('DADOS DO EMITENTE BANCO DO EXEMPLO S/A 11.222.333/0001-81', EMIT) === 'BANCO DO EXEMPLO S/A',
      JSON.stringify(M.nomePertoCnpj('DADOS DO EMITENTE BANCO DO EXEMPLO S/A 11.222.333/0001-81', EMIT)));
    ok('mas a linha de rótulos ainda quebra o nome (NOME / RAZÃO SOCIAL …)',
      M.nomePertoCnpj('DADOS DO EMITENTE NOME / RAZÃO SOCIAL EXEMPLO COMERCIO LTDA 11.222.333/0001-81', EMIT) === 'EXEMPLO COMERCIO LTDA',
      JSON.stringify(M.nomePertoCnpj('DADOS DO EMITENTE NOME / RAZÃO SOCIAL EXEMPLO COMERCIO LTDA 11.222.333/0001-81', EMIT)));

    /* A UI que a revisão de design apontou: badge verde exige segundo sinal, KPI conta o
       predicado do rótulo, e a célula vazia carrega o porquê. Aqui é contrato de
       fonte (o painel-check confere as afirmações do painel contra a fonte). */
    ok('o badge verde exige emitente confirmado (chave validada OU nome colado no CNPJ)',
      /const emitenteConfirmado=\(r\)=>r\.cnpjFonte==='chave 44'\|\|!!r\.nomePrestador;/.test(html)
      && /emissor não confirmado/.test(html));
    ok('o KPI "Com chave 44 · validadas" conta o mesmo predicado do rótulo',
      /pdfiso-k-chave'\)\.textContent=DBpdf\.filter\(r=>r\.chaveValida\)/.test(html)
      && !/pdfiso-k-chave'\)\.textContent=DBpdf\.filter\(r=>r\.chave\)/.test(html));
    ok('a célula vazia da tabela explica o porquê (não é "—" mudo)',
      /const celVazia=\(txt,tip\)=>/.test(html) && /não lido nesta extra/.test(html));
    ok('o glifo de chave não validada tem nome acessível (não é glifo solto)',
      /aria-label="Chave de 44 dígitos lida, mas não validada/.test(html));
  }

  // ══════════════════════════════════════════════════════════════
  grupo('13.4 · CNPJ ALFANUMÉRICO (NT 2026.004) no leitor de PDF');
  // ══════════════════════════════════════════════════════════════
  /* O CNPJ passa a aceitar letra A-Z nas 12 primeiras posições, com os 2 DVs
     numéricos; no DV cada caractere vale (código - 48). Na chave de 44 a letra
     só cabe nas posições 7-18. Todos os valores daqui são sintéticos e estão
     declarados na lista do gate de privacidade (grupo 2): o CNPJ é o exemplo
     público da Receita, e a chave foi montada em cima dele. */
  if (M) {
    const ALFA = '12ABC34501DE35';
    const ALFA_MASC = '12.ABC.345/01DE-35';
    const ALFA_DV_ERRADO = '12.ABC.345/01DE-36';
    const CH_ALFA = '35260912ABC34501DE35550010000001231123456784';
    const CH_ALFA_DV_ERRADO = '35260912ABC34501DE35550010000001231123456783';
    const CHAVE_NUM = '35260911222333000181550010000001231123456783';
    const em4 = (s) => s.match(/.{1,4}/g).join(' ');

    ok('vC aceita o CNPJ alfanumérico (cru, mascarado e em minúscula)',
      M.vC(ALFA) === true && M.vC(ALFA_MASC) === true && M.vC(ALFA.toLowerCase()) === true);
    ok('vC recusa o alfanumérico com DV trocado', M.vC(ALFA_DV_ERRADO) === false);
    ok('vC recusa letra na posição do DV (os 2 últimos são sempre número)',
      M.vC(ALFA.slice(0, 13) + 'A') === false && M.vC(ALFA.slice(0, 12) + 'A5') === false);
    ok('vC numérico continua igual (válido aceito, DV trocado recusado)',
      M.vC('11222333000181') === true && M.vC('11.222.333/0001-81') === true
      && M.vC('11222333000103') === false && M.vC('11111111111111') === false);
    ok('vC recusa tamanho errado mesmo com letra', M.vC(ALFA.slice(1)) === false && M.vC(ALFA + '1') === false);

    ok('vH aceita a chave com CNPJ alfanumérico e ela passa na estrutura',
      M.vH(CH_ALFA) === true && M.chaveEstrutural(CH_ALFA) === true && M.chaveOk(CH_ALFA) === true);
    ok('vH recusa a chave alfanumérica com DV trocado', M.vH(CH_ALFA_DV_ERRADO) === false);
    ok('vH recusa letra fora das posições 7-18 (UF, AAMM, DV do CNPJ, resto da chave)',
      M.vH('A' + CH_ALFA.slice(1)) === false
      && M.vH(CH_ALFA.slice(0, 18) + 'A' + CH_ALFA.slice(19)) === false
      && M.vH(CH_ALFA.slice(0, 30) + 'A' + CH_ALFA.slice(31)) === false);
    ok('vH numérico continua igual', M.vH(CHAVE_NUM) === true
      && M.vH(CHAVE_NUM.slice(0, 43) + '4') === false);
    ok('vH não aceita o prefixo do atributo Id ("NFe" + chave)', M.vH('NFe' + CH_ALFA) === false);

    const dec = M.decodChave(CH_ALFA);
    ok('decodChave tira o CNPJ alfanumérico das posições 7-20',
      !!dec && dec.cnpj === ALFA && dec.nNFInt === '123' && dec.mod === '55',
      JSON.stringify(dec));

    const eCcorrida = M.eC('CHAVE DE ACESSO ' + CH_ALFA + ' CONSULTE');
    ok('eC acha a chave alfanumérica corrida', eCcorrida.valor === CH_ALFA && eCcorrida.valida === true,
      JSON.stringify(eCcorrida));
    const eCblocos = M.eC('CHAVE DE ACESSO ' + em4(CH_ALFA) + ' CONSULTE');
    ok('eC acha a chave alfanumérica impressa em blocos de 4', eCblocos.valor === CH_ALFA && eCblocos.valida === true,
      JSON.stringify(eCblocos));
    const eCruim = M.eC('CHAVE DE ACESSO ' + CH_ALFA_DV_ERRADO + ' CONSULTE');
    ok('eC não valida chave alfanumérica com DV trocado', !(eCruim.valida === true && eCruim.valor === CH_ALFA_DV_ERRADO),
      JSON.stringify(eCruim));
    ok('eC numérica não mudou', M.eC('CHAVE ' + em4(CHAVE_NUM)).valor === CHAVE_NUM);

    ok('eJ lê o CNPJ alfanumérico mascarado como emitente', M.eJ('EMITENTE CNPJ ' + ALFA_MASC + ' FIM').prest === ALFA,
      JSON.stringify(M.eJ('EMITENTE CNPJ ' + ALFA_MASC + ' FIM').lista));
    ok('eJ lê o CNPJ alfanumérico sem máscara', M.eJ('CNPJ ' + ALFA + ' FIM').prest === ALFA);
    ok('alfanumérico de DV inválido não entra na lista (seria palavra, não CNPJ)',
      M.cnpjsNoTexto('CNPJ ' + ALFA_DV_ERRADO + ' FIM').length === 0);
    ok('alfanumérico encostado em letra não é CNPJ', M.cnpjsNoTexto('X' + ALFA + ' FIM').length === 0);
    ok('o CNPJ alfanumérico de dentro da chave não vira CNPJ impresso',
      M.cnpjsNoTexto('CODIGO ' + CH_ALFA + ' NOTA 1').length === 0);
    ok('alfanumérico e numérico juntos saem na ordem do texto',
      M.cnpjsNoTexto('EMIT ' + ALFA_MASC + ' DEST 11.222.333/0001-81').map((c) => c.dig).join(',') === ALFA + ',11222333000181');
    ok('idxCnpj acha o CNPJ alfanumérico mascarado', M.idxCnpj('EMITENTE ' + ALFA_MASC + ' FIM', ALFA) > 0);
    ok('o nome do emitente sai colado ao CNPJ alfanumérico',
      M.nomePertoCnpj('DADOS DO EMITENTE EXEMPLO ALFA LTDA ' + ALFA_MASC, ALFA) === 'EXEMPLO ALFA LTDA',
      JSON.stringify(M.nomePertoCnpj('DADOS DO EMITENTE EXEMPLO ALFA LTDA ' + ALFA_MASC, ALFA)));

    const pf = M.parseFull('DANFE CHAVE DE ACESSO ' + em4(CH_ALFA) + ' DESTINATARIO CNPJ 11.222.333/0001-81', [], 'texto');
    ok('parseFull: emitente alfanumérico vem da chave validada',
      pf.chaveValida === true && pf.cnpjPrestador === ALFA && pf.cnpjFonte === 'chave 44' && pf.cnpjValido === true,
      'prest=' + pf.cnpjPrestador + ' fonte=' + pf.cnpjFonte);
    ok('parseFull: o destinatário numérico continua lido', pf.cnpjTomador === '11222333000181', pf.cnpjTomador);

    /* Falso positivo medido: o DV de 2 dígitos aprova ~1% de qualquer token de
       14 posições. Os dois tokens abaixo FECHAM o DV (pré-condição conferida),
       então só a regra de forma (máscara completa, ou rótulo CNPJ antes do cru)
       os separa de um CNPJ. */
    const COD_NFSE = 'CS9Q9XK8QIOT18', PALAVRA = 'DESTINATARIO04';
    ok('pré-condição: os dois tokens fecham o DV (senão o caso abaixo não prova nada)',
      M.vC(COD_NFSE) === true && M.vC(PALAVRA) === true);
    const nfse = M.parseFull('NFS-e Nº 456 CODIGO DE VERIFICACAO ' + COD_NFSE
      + ' PRESTADOR DE SERVICOS CNPJ 11.222.333/0001-81 EXEMPLO LTDA TOMADOR CNPJ 11.222.334/0001-26', [], 'texto');
    ok('o código de verificação da NFS-e não vira CNPJ do prestador',
      nfse.cnpjPrestador === '11222333000181' && nfse.cnpjTomador === '11222334000126',
      'prest=' + nfse.cnpjPrestador + ' toma=' + nfse.cnpjTomador);
    ok('palavra em maiúscula com 2 dígitos que fecha o DV não é CNPJ',
      M.cnpjsNoTexto('OBS ' + PALAVRA + ' X').length === 0);
    ok('o alfanumérico cru vale com o rótulo CNPJ antes (CNPJ:, CNPJ/CPF)',
      M.cnpjsNoTexto('CNPJ: ' + ALFA).length === 1 && M.cnpjsNoTexto('CNPJ/CPF ' + ALFA).length === 1
      && M.cnpjsNoTexto('CNPJ ' + PALAVRA).length === 1
      && M.cnpjsNoTexto('CNPJ – ' + ALFA).length === 1 && M.cnpjsNoTexto('CNPJ No.: ' + ALFA).length === 1
      && M.cnpjsNoTexto('CNPJ Nº ' + ALFA).length === 1);
    ok('o mascarado vale com o rótulo colado (texto de OCR)',
      M.cnpjsNoTexto('CNPJ/CPF' + ALFA_MASC).map((c) => c.dig).join() === ALFA);
    ok('máscara pela metade não basta sem o rótulo', M.cnpjsNoTexto('OBS 12ABC345/01DE-35 X').length === 0);
    ok('eC recusa a chave alfanumérica em minúscula (a forma oficial é maiúscula)',
      M.eC('CHAVE ' + CH_ALFA.toLowerCase()).valida !== true);
  }
}

// ══════════════════════════════════════════════════════════════
grupo('15 · RENDER XML: o dado do arquivo no DOM (executa os renders de verdade)');
// ══════════════════════════════════════════════════════════════
/* A revisão anterior consertou os sinks do LEITOR DE PDF e deixou o render XML
   inteiro cru: `cellsTable`, o detalhe do item da NF-e (hoje `nfeDanfe`/`dnfItemAberto`), `renderNFE` e `renderNFSe`
   interpolavam o campo do XML direto no innerHTML. Medido aqui: 40 <img> no
   card de NF-e e 34 no de NFS-e com o payload em cada campo de texto.

   Este grupo CRUZA as duas metades, porque nenhuma fecha sozinha:

     (a) EXECUÇÃO — os dois renders rodam de verdade, com o script real e um stub
         de DOM, e o innerHTML resultante é medido. Um gate que só lê o fonte
         passa verde com o payload vivo se o `esc` estiver no lugar errado, que
         foi exatamente o defeito do <option> no commit anterior.
     (b) FONTE — a lista de campos vem do FONTE dos renders, não de um literal
         escrito à mão. Fixture escrita à mão é lista com buraco: campo novo
         entra no render, não entra no fixture, e o gate passa com o sink novo a
        ceso. Medido na revisão: 3 sinks (`Item`, `UF_Prestador`,
         `Mun_Prestador`) eram exatamente os campos que o fixture deixou de
         fora, e revertê-los mantinha a regressão verde.

   E a forma, não o token: comparar com um render de valor benigno. `img` e
   `onerror` são o payload do autor do gate; `<svg onload>`, `<a
   href=javascript:>`, `<script>` e `<iframe>` são o mesmo ataque com outra
   forma, e medir só `<img` é medir o payload em vez de medir a falha. O que
   se compara é que o render com payload tem a MESMA FORMA do render com
   valor benigno: mesmas tags, nenhum handler, nenhum `<script>`.

   O universo é derivado do FONTE com um marcador de seção, não de um `\n}\n`
   (o arquivo é CRLF, esse padrão não acha) nem de "até o fim do arquivo" (vaza
   para o módulo de CNPJ e de PDF, e o gate passa a exigir payload em campo que
   nenhum render lê). Mutação medida: um campo NOVO lido cru reprova 5 asserções. */
{
  const PAY = '"><img src=x onerror="window.__XSS=1">';
  const BENIGNO = 'EXEMPLO';

  /* Os renders, do fonte: é o trecho do DANFE (a partir de `DNF_COLS`, a primeira
     declaração dele) até o fim de `renderNFSe`. A âncora antiga (`cellsTable`) saiu
     do código com o DANFE; âncora em função removida zerava o universo. */
  const iniRender = html.indexOf('const DNF_COLS=[');
  /* O fim dos 4 renders é o marcador da seção seguinte, não um `}`: procurar
     `\n}\n` não acha (o arquivo tem CRLF) e o fallback "até o fim do arquivo"
     fazia o universo de campos vazar para o módulo de CNPJ e de PDF — o gate
     passaria a exigir payload em campo que nenhum render lê. */
  const FIM_RENDER = '// ═══ EVENT DELEGATION';
  const fimNFSe = html.indexOf(FIM_RENDER, html.indexOf('function renderNFSe('));
  const fonteRender = iniRender < 0 || fimNFSe < 0 ? '' : html.slice(iniRender, fimNFSe);

  /* (b) O universo de campos: todo `p.X`/`n.X`/`g.X` lido pelos 4 renders. O `g.`
     entra porque o rodapé do NF-e lê `g.itens[0].Arquivo_Origem` — com só `p.`/`n.`
     ele entraria no universo por acaso (via o NFS-e) e o dia que o rodapé do NFS-e
     saísse o campo sumiria do fixture com o sink cru vivo. `length` é membro de
     array, não campo do XML. A condição da cobertura por construção é esta
     sintática: um destructuring (`const {X}=n`) tiraria o literal do fonte. */
  const camposDoFonte = [...fonteRender.matchAll(/\b[png]\.([A-Za-z_]\w*)/g)]
    .map((m) => m[1]).filter((c) => c !== 'length');
  const unicos = [...new Set(camposDoFonte)].sort();
  /* O fixture é DERIVADO: todo campo que o render lê recebe o payload. Um
     `Item: '1'` (valor "realista") trocava o payload pela própria prova — por
     isso aqui não há nenhum valor literal no registro de texto. */
  const registro = (valor) => {
    const r = { Status_NFe: 'Autorizada' };
    for (const c of unicos) r[c] = valor;
    return r;
  };
  const linha = (extra, valor) => Object.assign(registro(valor === undefined ? PAY : valor), extra || {});
  const benigno = (extra) => Object.assign(registro(BENIGNO), extra || {});
  /* Um só registro serve aos dois renders: a lista vem do fonte, então nenhum
     campo fica de fora por esquecimento de transcrição — que foi como
     `UF_Prestador`/`Mun_Prestador` saíram do fixture do NFS-e. */
  const servico = linha();

  /* O bloco que declara renderNFE/renderNFSe: o MAIOR script inline do arquivo.
     O grupo 8 roda o ÚLTIMO (a IIFE de tema, 64 linhas) — são blocos diferentes e
     heuristics diferentes para perguntas diferentes; não são o mesmo sandbox. */
  function stubRender() {
    const els = {};
    function el(id) {
      if (els[id]) return els[id];
      const self = {
        id, value: '', textContent: '', innerHTML: '', hidden: false, style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] || null; },
        removeAttribute(k) { delete this.attrs[k]; }, addEventListener() {}, appendChild() {},
        querySelector() { return null; }, querySelectorAll() { return []; },
      };
      self.parentElement = { hidden: false, classList: self.classList, querySelector: () => null, querySelectorAll: () => [] };
      els[id] = self;
      return self;
    }
    const navs = [{ lastElementChild: { textContent: 'Importar XMLs' }, _ev: {}, addEventListener(_, f) { this._ev.click = f; } }];
    const janela = {
      matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
      addEventListener() {}, removeEventListener() {}, GCON_CDN_TESSERACT: 0,
    };
    const sandbox = {
      document: {
        documentElement: { attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } },
        getElementById: el,
        querySelectorAll: (s) => (s === '.nav-btn' ? navs : []),
        querySelector: (s) => (s === '.nav-btn.active' ? navs[0] : null),
        createElement: () => el('__criado'),
        body: { appendChild() {}, removeChild() {} },
        addEventListener() {},
      },
      localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
      getComputedStyle: () => ({ getPropertyValue: () => '' }),
      setTimeout, clearTimeout, Date, Math, JSON, console, window: janela,
    };
    janela.matchMedia = sandbox.window.matchMedia;
    sandbox.window.GCON = {};
    vm.createContext(sandbox);
    vm.runInContext(scriptRender, sandbox, { filename: 'index.html#render' });
    vm.runInContext(';this.__DB=DB;', sandbox);
    return sandbox;
  }
  const scriptRender = scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
  let sb = null, erroRender = '';
  try { sb = stubRender(); } catch (e) { erroRender = e.message; }
  ok('o script do render XML sobe com o stub de DOM', sb !== null && erroRender === '', erroRender);

  if (sb) {
    /* A medição é de FORMA: quantas tags o HTML tem, quantos handlers em
       posição de atributo, e se há `<script>`. Um render é "da mesma forma que
       o benigno" quando não ganhou tag nenhuma por causa do dado. */
    const forma = (h) => ({
      tags: (h.match(/<[a-zA-Z]/g) || []).length,
      /* Qualquer `on...=` seguido de aspas é handler em atributo. O payload
         escapado vira `onerror=&quot;`, que não casa — texto não reprova. */
      handler: (h.match(/\son[a-z]+\s*=\s*["']/gi) || []).length,
      script: (h.match(/<script/gi) || []).length,
      img: (h.match(/<img/gi) || []).length,
      escapado: (h.match(/&lt;/g) || []).length,
    });
    const conta = (alvo, fn, registros) => {
      const id = alvo + '-list';
      try {
        /* O corpo da NF-e (o DANFE) só é desenhado com a nota aberta: o gate abre
           todas as notas antes, senão mediria só o header e o payload do corpo
           passaria sem ser lido. */
        const abre = alvo === 'nfe' ? 'for(const p of __DB.nfe)dnfUI(p.Chave_NFe||"?").nota=true;' : '';
        vm.runInContext(`(()=>{__DB.${alvo}=${JSON.stringify(registros)};${abre}${fn}()})()`, sb);
      } catch (e) { return { erro: e.message }; }
      return { h: vm.runInContext(`document.getElementById('${id}').innerHTML`, sb) };
    };
    const par = (alvo, fn, extra, valor) => {
      const p = conta(alvo, fn, [linha(extra, valor)]);
      const b = conta(alvo, fn, [benigno(extra)]);
      return { p: p.erro ? p : Object.assign(forma(p.h), { h: p.h }), b: b.erro ? b : forma(b.h), erro: p.erro || b.erro };
    };
    const cmp = (n, r) => ok(n, !r.erro && r.p.tags === r.b.tags && r.p.handler === r.b.handler && r.p.script === 0 && r.p.img === 0,
      r.erro || `payload ${r.p.tags} tag(s)/${r.p.handler} handler vs benigno ${r.b.tags} tag(s)/${r.b.handler} handler`);
    const a = par('nfe', 'renderNFE');
    const b = par('nfse', 'renderNFSe');
    cmp('renderNFE: o payload não ganha nenhuma tag (mesma forma do render benigno)', a);
    cmp('renderNFSe: o payload não ganha nenhuma tag (mesma forma do render benigno)', b);
    /* A asserção negativa: o dado tem que CONTINUAR na tela. Sem ela, um `esc`
       que devolve vazio passa em `tags == b.tags`. */
    ok('o payload continua na tela como texto escapado (não sumiu, não executou)',
      !a.erro && !b.erro && a.p.escapado > 0 && b.p.escapado > 0,
      'nfe=' + a.p.escapado + ' nfse=' + b.p.escapado);
    ok('o render benigno NÃO produz entidade (o texto normal passa limpo)',
      !a.erro && !b.erro && a.b.escapado === 0 && b.b.escapado === 0,
      'nfe=' + a.b.escapado + ' nfse=' + b.b.escapado);

    /* Forma alternativa do mesmo ataque. `img`/`onerror` são o payload do autor
       do gate; com o sink cru, `<svg onload>` e `<script>` também executam e
       `<img onerror>` mediria 0. Cada forma tem que reprovar — nos DOIS renders,
       porque um campo exclusivo do NFS-e que trunca em 80 chars neutraliza o
       `PAY` curto e não neutraliza `<svg onload>`. */
    const FORMAS = ['<svg onload="window.__XSS=1">', '<a href="javascript:window.__XSS=1">x</a>',
      '</span><script>window.__XSS=1</script>', '<iframe src="javascript:1"></iframe>'];
    FORMAS.forEach((formaPay, i) => {
      [['nfe', 'renderNFE'], ['nfse', 'renderNFSe']].forEach(([alvo, fn]) => {
        const r = par(alvo, fn, undefined, formaPay);
        ok('a forma #' + (i + 1) + ' (' + formaPay.slice(0, 18) + '…) não vira HTML em ' + fn,
          !r.erro && r.p.tags === r.b.tags && r.p.handler === r.b.handler && r.p.script === 0,
          r.erro || `tags=${r.p.tags} vs benigno=${r.b.tags}`);
      });
    });

    /* O `catch` do renderNFE é um sink com `esc` e o caminho nunca era
       exercitado: o desenho do DANFE (`nfeDanfe`) não lança, e o `conta` engole erro. Um
       objeto com `toString` hostil força a exceção de verdade — e tem de entrar
       pelo sandbox, porque serializado o `toString` customizado vira `{}`. */
    {
      sb.__DB.nfe = [Object.assign({}, linha())];
      /* O payload vai LITERAL no código do VM: `PAY` é uma variável do host e
         não existe dentro dele — por isso o erro saiu "PAY is not defined" e o
         gate mediu a mensagem errada. */
      vm.runInContext('__DB.nfe[0].Nome_Emitente={toString(){throw new Error(' + JSON.stringify(PAY) + ')}}', sb);
      let h = '';
      try { vm.runInContext('renderNFE()', sb); } catch (e) { h = 'LANCOU: ' + e.message; }
      const veio = vm.runInContext("document.getElementById('nfe-list').innerHTML", sb);
      const f = forma(veio);
      ok('o catch do renderNFE escapa a mensagem (o erro também é dado de arquivo)',
        !h && /Erro ao renderizar/.test(veio) && f.img === 0 && f.handler === 0 && f.escapado > 0,
        h || ('tags=' + f.tags + ' escapado=' + f.escapado));
      vm.runInContext('__DB.nfe=[]', sb);
    }

    /* Os ramos de estado vazio são alcançáveis pelo filtro e só guardam
       literal — mas literal de hoje é interpolação de amanhã. */
    {
      vm.runInContext('__DB.nfe=[];__DB.nfse=[]', sb);
      vm.runInContext('renderNFE()', sb);
      const v1 = vm.runInContext("document.getElementById('nfe-list').innerHTML", sb);
      vm.runInContext('renderNFSe()', sb);
      const v2 = vm.runInContext("document.getElementById('nfse-list').innerHTML", sb);
      ok('o estado vazio dos dois renders não carrega dado (ramo sem sessão)',
        /empty-state/.test(v1) && /empty-state/.test(v2)
        && !/<img|on[a-z]+\s*=\s*["']|<script/i.test(v1 + v2),
        'nfe=' + v1.slice(0, 90));
    }

    /* dnfVal é o sink que cobre as células do DANFE (tabela de itens, painel de
       impostos, produto, financeiro, veículo): todas leem p[c] por ele. EXECUTADO,
       não regex de forma: o valor hostil passa por cada tipo e tem de sair como
       texto escapado — em 't' e 'v:' o dado volta inteiro (não sumiu); em 'm'/'p'/'q'
       o número formatado não pode carregar tag. */
    {
      const tipos = ['t', 'v:tpComb', 'm', 'p', 'q'];
      const saida = tipos.map((tp) => [tp, vm.runInContext('dnfVal(' + JSON.stringify(PAY) + ',' + JSON.stringify(tp) + ').h', sb)]);
      const escPay = vm.runInContext('esc(' + JSON.stringify(PAY) + ')', sb);
      const cru = saida.filter(([, h]) => /<|"/.test(h));
      ok('dnfVal escapa o valor hostil em todo tipo (o sink das células do DANFE)',
        cru.length === 0 && saida[0][1] === escPay && saida[1][1].includes(escPay),
        cru.map(([tp, h]) => tp + '=' + h.slice(0, 40)).join(' | ') || saida.map(([tp, h]) => tp + '=' + h.slice(0, 30)).join(' | '));
    }
    /* Regra NEGATIVA, não literal positivo: "todo `.slice(` de dado de arquivo
       tem o `esc` DENTRO". Listar `xProd` e `xDescServ` (e esquecer
       `Desc_Servico`, que tem o mesmo formato) trava refactor legítimo e
       deixa passar o caso irmão. */
    {
      const slices = [...fonteRender.matchAll(/\$\{[^}]*\.slice\([^)]*\)[^}]*\}/g)].map((x) => x[0]);
      /* O `esc` tem de estar ABERTO quando o `.slice` acontece. Contar o
         balanceamento de parênteses diz isso sem listar campo: em
         `${esc(x).slice(0,40)}` a profundidade já é 0 no `.slice` (entidade
         partida); em `${esc(x.slice(0,40))}` ainda é 1 (texto truncado, depois
         escapado). */
      const sliceFora = slices.filter((s) => {
        const i = s.indexOf('esc(');
        if (i < 0) return true;
        let p = 1; // o parêntese do próprio `esc(`
        for (let k = i + 4; k < s.length; k++) {
          if (s[k] === '(') p++;
          else if (s[k] === ')') p--;
          else if (s[k] === '.' && s.startsWith('.slice(', k)) return p <= 0;
        }
        return true;
      });
      ok('todo truncamento de dado de arquivo tem o esc DENTRO do slice (nenhum por fora)',
        slices.length >= 2 && sliceFora.length === 0, /* DANFE completo: a descrição deixou de ser cortada; restam os slices do NFS-e */
        sliceFora.join(' | ') || (slices.length + ' slice(s) no fonte'));
    }
    /* `dataBr` escapa, e por isso não pode aparecer em export: lá o `&`
     viraria `&amp;` na coluna de data do arquivo da cliente. Hoje nenhum usa —
     o gate é para o dia em que alguém plugar. */
    ok('nenhum export usa dataBr (escapar no CSV/XLSX mudaria o arquivo da cliente)',
      !/function export(CSV|XLSX)\(tipo\)\{[\s\S]{0,900}?\bdataBr\(/.test(html)
      && (html.match(/dataBr\(/g) || []).length === 2, /* 1 definição + 1 consumidor de render (o header do NF-e; o DANFE usa dnfData e a lista da NFS-e esc(dataHoraBr), que também escapam) */
      (html.match(/dataBr\(/g) || []).length + ' ocorrência(s) de dataBr');
    /* dataBr com data legítima: escapa não pode virar "escapa a data também". */
    ok('dataBr devolve a data, não a entidade',
      vm.runInContext("dataBr('2026-09-17T10:20:30-03:00')", sb) === '2026-09-17',
      vm.runInContext("dataBr('2026-09-17T10:20:30-03:00')", sb));
    /* A COBERTURA do fixture é por construção (o universo vem do fonte); o que esta
       asserção detecta é a DERIVAÇÃO colapsar — o gate 8 voltar a rodar outro
       bloco, ou o marcador de seção mudar de lugar. Por isso o nome mede a
       derivação, não a cobertura: nome que promete cobertura vira crença. */
    ok('a derivação do universo não colapsou (o gate lê os 4 renders, não outro bloco)',
      unicos.length >= 60 && fonteRender.length > 4000,
      unicos.length + ' campos em ' + fonteRender.length + ' chars de fonte');
    /* A cobertura por construção vale sob a condição sintática da derivação:
       `p.X`/`n.X`. Um `g.itens[0].X` ou um destructuring escapariam dela — por
       isso `g.` também entra, e o campo do rodapé do NF-e é lido por `g.` */
    /* ── veicProd (veículo novo) ─────────────────────────────────────────
       Os campos Veic_* entram no fixture de XSS por construção (lidos como p.X
       no render). Aqui: o chassi aparece na linha sem abrir nada, a seção
       existe só para item de veículo, e o código hostil não resolve pelo
       protótipo do mapa de descrições. */
    /* DANFE completo: as colunas da tabela de itens saem de DNF_COLS e são lidas
       como p[c] — fora do universo p.X acima. Por isso aqui o DANFE é desenhado
       com o payload em TODOS os campos da exportação (HNFE) e comparado com o
       render benigno: mesma forma, nenhuma tag nova, nenhum handler. */
    {
      const camposHNFE = (/const HNFE=\[([\s\S]*?)\];/.exec(html)[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
      const montar = (v) => { const r = {}; camposHNFE.forEach((c) => { r[c] = v; }); r.Chave_NFe = 'K'; r.Item = '1'; return r; };
      let fp = null, fb = null, erro = '';
      try {
        vm.runInContext('__R=' + JSON.stringify({ p: montar(PAY), b: montar('1') }), sb);
        // o item aberto é onde todos os campos aparecem: abre antes de desenhar
        vm.runInContext('dnfUI("K").abertos.add("0")', sb); // identidade do item = posição na nota
        fp = forma(vm.runInContext('nfeDanfe("K",{info:__R.p,itens:[__R.p]})', sb));
        fb = forma(vm.runInContext('nfeDanfe("K",{info:__R.b,itens:[__R.b]})', sb));
      } catch (e) { erro = e.message; }
      ok('DANFE completo: payload em todos os ' + camposHNFE.length + ' campos não vira tag nem handler (mesma forma do benigno)',
        !erro && fp.tags === fb.tags && fp.handler === 0 && fp.script === 0 && fp.img === 0 && fp.escapado > 0,
        erro || `payload ${fp && fp.tags}/${fp && fp.handler} vs benigno ${fb && fb.tags}`);
      const colunas = vm.runInContext('DNF_COLS.reduce((a,g)=>a.concat(g[1].map(c=>c[0])),[])', sb);
      const daNota = ['Tipo_Nota', 'Chave_NFe', 'Numero_NFe', 'Serie_NFe', 'Mod_NFe', 'NatOp', 'Tp_NF', 'Data_Emissao', 'CNPJ_Emitente', 'Nome_Emitente', 'NomeFantasia_Emit', 'IE_Emitente', 'UF_Emitente', 'Mun_Emitente', 'CNPJ_Destinatario', 'CPF_Destinatario', 'Nome_Destinatario', 'IE_Destinatario', 'UF_Destinatario', 'Mun_Destinatario', 'Status_NFe', 'Motivo_Status_NFe', 'vFrete', 'vSeg', 'vDesc', 'vOutro', 'vNF', 'vTotTrib', 'infCpl', 'Arquivo_Origem'];
      const falta = camposHNFE.filter((c) => !colunas.includes(c) && !daNota.includes(c));
      ok('o DANFE cobre os ' + camposHNFE.length + ' campos da exportação (colunas dos itens + cabeçalho da nota)', falta.length === 0, falta.join(','));
      const fonte = html.slice(html.indexOf('function nfeDanfe('), html.indexOf('function renderNFE('));
      ok('cada campo do cabeçalho da nota está no DANFE', daNota.every((c) => fonte.includes('n.' + c)), daNota.filter((c) => !fonte.includes('n.' + c)).join(','));
    }
    {
      const veic = { Chave_NFe: 'KV', Item: '1', xProd: 'CAMINHAO EXEMPLO', Status_NFe: 'Autorizada', Veic_Chassi: '9BWZZZ377VT004251', Veic_tpComb: '03', Veic_cCorDENATRAN: '04', Veic_tpVeic: '14', Veic_AnoFab: '2026', Veic_AnoMod: '2027' };
      const pecaComum = { Chave_NFe: 'KP', Item: '1', xProd: 'FILTRO', Status_NFe: 'Autorizada' };
      vm.runInContext('dnfUI("KV").abertos.add("0");dnfUI("KP").abertos.add("0")', sb);
      const hv = conta('nfe', 'renderNFE', [veic]).h || '';
      const hp = conta('nfe', 'renderNFE', [pecaComum]).h || '';
      ok('o chassi aparece embaixo da descrição, na coluna fixa',
        /Chassi: <b>9BWZZZ377VT004251<\/b>/.test(hv) && !/Chassi: <b>/.test(hp), hv.slice(0, 200));
      ok('o item aberto traz o veículo com a descrição dos códigos; item comum diz que não consta',
        /03 - Diesel/.test(hv) && /04 - Branca/.test(hv) && /14 - Caminhão/.test(hv) && /<dd[^>]*>2026<\/dd>/.test(hv)
        && !/Diesel|Caminhão/.test(hp) && /Veículo novo: não consta/.test(hp) && !/Veículo novo: não consta/.test(hv));
      const r = vm.runInContext("[veicRot('tpComb','constructor'),veicRot('tpComb','__proto__'),veicRot('tpComb',''),veicRot('tpComb','99')]", sb);
      ok('código hostil no veicProd não resolve pelo protótipo (sai só o código)',
        r[0] === 'constructor' && r[1] === '__proto__' && r[2] === '' && r[3] === '99', JSON.stringify(r));
    }
    /* infAdProd é filho de <det> (irmão de <prod>). O extrator procurava dentro de
       <prod> e a coluna saía SEMPRE vazia, em toda nota. */
    ok('o extrator lê infAdProd de <det>, não de <prod>',
      /infAdProd:t\(det,'infAdProd'\)/.test(html) && !/infAdProd:t\(prod,/.test(html));
    {
      vm.runInContext('dnfUI("KA").abertos.add("0");dnfUI("KB").abertos.add("0")', sb);
      const h1 = conta('nfe', 'renderNFE', [{ Chave_NFe: 'KA', Item: '1', xProd: 'CAMINHAO', Status_NFe: 'Autorizada', infAdProd: 'VW 9180 175cv 6M' }]).h || '';
      const h2 = conta('nfe', 'renderNFE', [{ Chave_NFe: 'KB', Item: '1', xProd: 'FILTRO', Status_NFe: 'Autorizada' }]).h || '';
      ok('as informações adicionais do item aparecem no item aberto (— quando não vêm no XML)',
        /<dt>Inf\. adicionais do item<\/dt><dd[^>]*>VW 9180 175cv 6M<\/dd>/.test(h1)
        && /<dt>Inf\. adicionais do item<\/dt><dd[^>]*>—<\/dd>/.test(h2) && !/VW 9180/.test(h2), h1.slice(0, 160));
      ok('os dados adicionais da nota vêm depois dos produtos',
        h1.indexOf('Dados dos produtos') > 0 && h1.indexOf('Dados adicionais') > h1.indexOf('Dados dos produtos'));
      const hf = conta('nfe', 'renderNFE', [{ Chave_NFe: 'KF', Item: '1', xProd: 'X', Status_NFe: 'Autorizada' }]).h || '';
      ok('item fechado não desenha o detalhe; item aberto desenha a tabela de impostos',
        hf.includes('dnf-it') && !/dnf-trib/.test(hf) && /class="dnf-trib"/.test(h1) && /aria-expanded="true"/.test(h1));
      /* Painel lateral: o item aberto vai para um painel ao lado (um só), nada
         cresce no meio da tabela, e abrir outro item troca o conteúdo do painel. */
      ok('o item aberto aparece no painel lateral, não no meio da tabela',
        (h1.match(/class="dnf-painel"/g) || []).length === 1 && !/dnf-det/.test(h1) && !/class="dnf-painel"/.test(hf));
      ok('só um item aberto por vez (abrir outro substitui) e Esc fecha',
        /function dnfAbreSo\(x,k\)\{const ant=\[\.\.\.x\.u\.abertos\]\[0\];x\.u\.abertos\.clear\(\);/.test(html) && /e\.key==='Escape'/.test(html));
      /* DANFE completo: bordas do painel, executadas. */
      {
        let r = null, erro = '';
        try {
          r = vm.runInContext(`(()=>{
            const its=[{Item:'1',xProd:'A'},{Item:'1',xProd:'A2'},{Item:'2',xProd:'B'}].map((p,i)=>[p,i]);
            const pDup=dnfPainel(its,{abertos:new Set(['0'])});
            const pUm=dnfPainel([[{Item:'7',xProd:'S'},0]],{abertos:new Set(['0'])});
            const info={Chave_NFe:'KZ',Item:'1',xProd:'CAMINHAO',Status_NFe:'Autorizada'};
            const u=dnfUI('KZ');u.abertos.clear();u.abertos.add('0');
            const hVisivel=nfeDanfe('KZ',{info,itens:[info]});u.abertos.clear();
            /* clique fora: painel de mentira dentro de um cartão de mentira */
            const card={dataset:{chave:'KZ'},isConnected:true,querySelector:()=>null};
            const pn={closest:(s)=>s==='.nota-card[data-chave]'?card:null};
            const alvo=(dentro,ligado)=>({isConnected:ligado,closest:(s)=>dentro&&s==='.dnf-painel'?pn:null});
            const q0=document.querySelector;document.querySelector=(s)=>s==='.dnf-painel'?pn:q0.call(document,s);
            const fora={};
            u.abertos.add('0');dnfForaClique({target:alvo(true,true)});fora.dentro=u.abertos.size;
            dnfForaClique({target:alvo(false,false)});fora.solto=u.abertos.size;
            window.getSelection=()=>'trecho arrastado';dnfForaClique({target:alvo(false,true)});fora.selecao=u.abertos.size;delete window.getSelection;
            const linha={isConnected:true,closest:(s)=>s==='.dnf-prod tbody tr.dnf-it'?{}:null};dnfForaClique({target:linha});fora.linha=u.abertos.size;
            dnfForaClique({target:alvo(false,true)});fora.fora=u.abertos.size;
            document.querySelector=q0;
            __DB.nfe=[];let lancou='';
            try{dnfRepinta({ch:'KZ',card:{isConnected:true,querySelector:()=>{throw new Error('desenhou nota que saiu do DB')}},u});}catch(e){lancou=e.message;}
            return {pDup,pUm,hVisivel,lancou,fora};
          })()`, sb);
        } catch (e) { erro = e.message; }
        ok('nItem repetido: o "próximo" do painel vai para a LINHA seguinte (índice 1), mesmo com o mesmo nItem',
          !erro && /data-ir="1"[^>]*>próximo/.test(r.pDup) && /<b>Item 1<\/b><span class="dnf-painel-nome">A<\/span>/.test(r.pDup), erro || (r && r.pDup.slice(0, 300)));
        ok('nota com 1 item: anterior e próximo desabilitados',
          !erro && (r.pUm.match(/disabled/g) || []).length === 2 && !/data-ir=/.test(r.pUm), erro);
        ok('sem barra de filtro acima dos produtos: nenhum campo de filtro',
          !erro && /dnf-painel/.test(r.hVisivel) && !/dnf-filtro/.test(r.hVisivel) && !/class="dnf-q"/.test(r.hVisivel), erro);
        ok('sem barra de filtro acima dos produtos: nem contagem nem texto de instrução',
          !erro && !/Filtrar itens/.test(r.hVisivel) && !/\d+ de \d+ itens/.test(r.hVisivel), erro);
        ok('o clique fora está ligado ao documento (sem a ligação, o handler nunca roda)',
          /document\.addEventListener\('click',dnfForaClique\)/.test(html));
        ok('clique fora do painel fecha o item; dentro do painel, em alvo já repintado ou ao fim de uma seleção de texto, não fecha',
          !erro && r.fora.dentro === 1 && r.fora.solto === 1 && r.fora.selecao === 1 && r.fora.linha === 1 && r.fora.fora === 0, erro || JSON.stringify(r.fora));
        ok('repintar com a nota já fora do DB não lança (dnfRepinta sai cedo)',
          !erro && r.lancou === '', erro || r.lancou);
        ok('Esc que fechou o item do DANFE não expande também o menu recolhido',
          /if\(e\.key!=='Escape'\)return;\s*if\(e\.defaultPrevented\)return;[^\n]*\n\s*if\(ehCelular\(\)\)return;\s*if\(sb\.getAttribute\('data-rail'\)/.test(html));
        ok('o Esc só age quando o painel está na tela',
          /x0\.card\.querySelector\('\.dnf-painel'\)/.test(html));
      }
      /* Aviso da revisão de segurança: a chave sintética de nota sem chave ('?'+índice) não pode
         colidir com um Id forjado no XML (ex.: Id="NFe?0" vira Chave_NFe '?0'). */
      {
        let g = null, erro = '';
        try {
          g = vm.runInContext(`(()=>{const ant=__DB.nfe;
            __DB.nfe=[{Chave_NFe:'',Arquivo_Origem:'a.xml',Item:'1',xProd:'SEM CHAVE'},{Chave_NFe:'?0',Arquivo_Origem:'b.xml',Item:'1',xProd:'FORJADA'}];
            const t=dnfGrupos(),r=Object.keys(t).map(k=>k+':'+t[k].itens.map(p=>p.xProd).join('+'));__DB.nfe=ant;return r;})()`, sb);
        } catch (e) { erro = e.message; }
        ok('nota com Id forjado "?0" não se funde com a nota sem chave (dois grupos, um item cada)',
          !erro && g.length === 2 && g.every((s) => !s.includes('+')), erro || JSON.stringify(g));
      }
      /* Bloqueio da revisão de testes (F1/F2): notas sem chave não se fundem, o filtro de
         CNPJ é por linha, e o item é a LINHA (índice), não o valor de nItem. */
      {
        let r = null, erro = '';
        try {
          r = vm.runInContext(`(()=>{
            const cards=(h)=>(h.match(/class="nota-card"/g)||[]).length;
            __DB.nfe=[{Chave_NFe:'',Arquivo_Origem:'a.xml',CNPJ_Emitente:'11',Numero_NFe:'1',Item:'1',xProd:'DA NOTA A',Status_NFe:'Autorizada'},
                      {Chave_NFe:'',Arquivo_Origem:'b.xml',CNPJ_Emitente:'22',Numero_NFe:'2',Item:'1',xProd:'DA NOTA B',Status_NFe:'Autorizada'}];
            const grupos=Object.keys(dnfGrupos());
            renderNFE();const dois=cards(document.getElementById('nfe-list').innerHTML);
            document.getElementById('filtro-nfe-cnpj').value='22';renderNFE();
            const hc=document.getElementById('nfe-list').innerHTML;
            /* filtro por LINHA: a mesma chave em linhas de emitentes diferentes (DB permite) — a 2ª linha basta */
            __DB.nfe=[{Chave_NFe:'KM',CNPJ_Emitente:'33',Numero_NFe:'7',Item:'1',Status_NFe:'Autorizada'},{Chave_NFe:'KM',CNPJ_Emitente:'44',Numero_NFe:'7',Item:'2',Status_NFe:'Autorizada'}];
            document.getElementById('filtro-nfe-cnpj').value='44';renderNFE();
            const porLinha=cards(document.getElementById('nfe-list').innerHTML);document.getElementById('filtro-nfe-cnpj').value='';
            /* mesma nota, duas linhas com o mesmo nItem */
            const A={Chave_NFe:'KD',Item:'1',xProd:'PRIMEIRA',Status_NFe:'Autorizada'},B={Chave_NFe:'KD',Item:'1',xProd:'SEGUNDA',Status_NFe:'Autorizada'},C={Chave_NFe:'KD',Item:'2',xProd:'TERCEIRA',Status_NFe:'Autorizada'};
            const u=dnfUI('KD');u.abertos.clear();u.abertos.add('1');
            const hd=nfeDanfe('KD',{info:A,itens:[A,B,C]});
            /* setas de verdade: dnfTecla com um cartão de mentira (3 linhas) */
            __DB.nfe=[A,B,C];u.abertos.clear();u.abertos.add('0');
            const corpo={innerHTML:'',childElementCount:1};
            const linhas=['0','1','2'].map(k=>({dataset:{it:k}}));
            const card={dataset:{chave:'KD'},isConnected:true,querySelector:(s)=>s==='.body-detail'?corpo:null,querySelectorAll:(s)=>s==='tr.dnf-it'?linhas:[]};
            document.activeElement={tagName:'BUTTON',closest:()=>card};
            const tecla=(key)=>{dnfTecla({key,preventDefault(){}});return [...u.abertos][0];};
            const seq=[tecla('ArrowDown'),tecla('ArrowDown'),tecla('ArrowDown'),tecla('ArrowUp')];
            document.activeElement=null;u.abertos.clear();
            /* item sem nItem: abre pela posição */
            const S={Chave_NFe:'KS',xProd:'SEM NITEM',Status_NFe:'Autorizada'};
            const us=dnfUI('KS');us.abertos.clear();us.abertos.add('0');
            const hs=nfeDanfe('KS',{info:S,itens:[S]});us.abertos.clear();
            __DB.nfe=[];
            return {grupos,dois,hc,porLinha,hd,seq,hs};
          })()`, sb);
        } catch (e) { erro = e.message; }
        ok('duas notas sem chave de acesso viram 2 cards (não se fundem em "?")',
          !erro && r.dois === 2 && r.grupos.length === 2, erro || JSON.stringify(r && r.grupos));
        ok('filtro por CNPJ do emitente da 2ª nota sem chave mostra a 2ª',
          !erro && (r.hc.match(/class="nota-card"/g) || []).length === 1 && /DA NOTA B|— 2/.test(r.hc) && !/— 1 /.test(r.hc), erro || (r && r.hc.slice(0, 300)));
        ok('filtro por CNPJ olha as linhas da nota, não só a 1ª (g.info)',
          !erro && r.porLinha === 1, erro || ('cards=' + (r && r.porLinha)));
        ok('mesmo nItem em duas linhas: abrir a 2ª mostra a 2ª no painel e só uma linha fica aberta',
          !erro && /class="dnf-painel-nome">SEGUNDA</.test(r.hd) && (r.hd.match(/class="dnf-it[^"]*aberto"/g) || []).length === 1
          && /data-it="1"[^>]*>[\s\S]{0,400}?aria-expanded="true"/.test(r.hd) && /data-ir="2"[^>]*>próximo/.test(r.hd) && /data-ir="0"[^>]*>◂ anterior/.test(r.hd),
          erro || (r && r.hd.slice(0, 200)));
        ok('↓ ↓ ↓ ↑ percorre as linhas pela posição (0→1→2, para no fim, volta para 1)',
          !erro && JSON.stringify(r.seq) === '["1","2","2","1"]', erro || JSON.stringify(r && r.seq));
        ok('item sem nItem abre pela posição (painel com a linha certa)',
          !erro && /class="dnf-painel-nome">SEM NITEM</.test(r.hs), erro);
      }
      /* Revisão de arquitetura: um só painel na tela, corpo só da nota aberta,
         e a tabela de impostos desenhada de uma lista só (DNF_TRIB). */
      {
        let r = null, erro = '';
        try {
          r = vm.runInContext(`(()=>{
            const a=dnfUI('KX1'),b=dnfUI('KX2');a.abertos.clear();b.abertos.clear();a.abertos.add('1');b.abertos.add('3');
            dnfFechaOutras('KX2');
            const so=[a.abertos.size,b.abertos.size];a.abertos.clear();b.abertos.clear();
            __DB.nfe=[{Chave_NFe:'KL',Item:'1',xProd:'X',Status_NFe:'Autorizada'}];dnfUI('KL').nota=false;renderNFE();
            const fechada=document.getElementById('nfe-list').innerHTML;
            dnfUI('KL').nota=true;renderNFE();
            const aberta=document.getElementById('nfe-list').innerHTML;dnfUI('KL').nota=false;__DB.nfe=[];
            return {so,fechada,aberta};
          })()`, sb);
        } catch (e) { erro = e.message; }
        ok('abrir item numa nota fecha o item aberto das outras (um painel fixo só)',
          !erro && r.so[0] === 0 && r.so[1] === 1
          && /function dnfAbreSo\(x,k\)\{[^\n]*if\(k!=null\)\{dnfFechaOutras\(x\.ch\);/.test(html), erro || JSON.stringify(r && r.so));
        ok('nota fechada não desenha o DANFE (só o header); nota aberta desenha',
          !erro && /class="nota-card"/.test(r.fechada) && !/dnf-prod/.test(r.fechada) && /dnf-prod/.test(r.aberta), erro);
        ok('abrir a nota pelo header (clique e teclado) desenha o corpo',
          (html.match(/toggleNota\(h\);dnfGaranteCorpo\(h\);/g) || []).length === 2 && !/dnfSinc/.test(html));
        /* Cobertura por construção: todo campo de imposto do item está em DNF_TRIB... */
        const trib = vm.runInContext('JSON.stringify(DNF_TRIB)', sb);
        const imp = vm.runInContext("DNF_COLS.filter(g=>['ICMS','IPI','PIS','COFINS','IBS / CBS'].includes(g[0])).reduce((a,g)=>a.concat(g[1].map(c=>c[0])),[])", sb);
        const foraTrib = imp.filter((c) => !trib.includes('"' + c + '"'));
        ok('todo campo de imposto do DNF_COLS (ICMS/IPI/PIS/COFINS/IBS-CBS) está no DNF_TRIB', imp.length >= 45 && foraTrib.length === 0, foraTrib.join(','));
        /* ...e o que está em DNF_TRIB é o que sai na tela: cada campo, sozinho com
           um valor-marcador, aparece dentro da tabela de impostos desenhada. */
        const naoDesenha = vm.runInContext(`(()=>{const out=[];for(const c of ${JSON.stringify(imp)}){
            const h=dnfItemAberto({Item:'1',[c]:'7777'});const t=(h.match(/<table class="dnf-trib">[\\s\\S]*?<\\/table>/)||[''])[0].replace(/<tr class="tot">[\\s\\S]*?<\\/tr>/,'');
            if(!/7\\.?777/.test(t))out.push(c);}return out;})()`, sb);
        ok('cada campo de imposto aparece na tabela de impostos desenhada (dnfItemAberto lê o DNF_TRIB)',
          naoDesenha.length === 0 && /DNF_TRIB\.map\(/.test(html), naoDesenha.join(','));
        ok('o aviso de veículo ausente conta os campos da lista (sem número escrito à mão)',
          /\(\$\{veic\.length\} campos zerados\)/.test(html) && !/24 campos zerados/.test(html));
        ok('o painel usa variáveis de tema para topo e sombra (declaradas no claro e no escuro)',
          /\.dnf-painel\{[^}]*top:var\(--painel-topo\)[^}]*box-shadow:var\(--shadow-painel\)/.test(html)
          && (html.match(/--shadow-painel:/g) || []).length === 2);
      }
    }
    /* ── CT-e ─────────────────────────────────────────────────────────────────
       A aba CT-e (lista + painel aberto + quadro "Para conferir") roda com o
       payload em TODO campo que ela lê. O universo vem do FONTE do módulo
       (c./pt./d./v./k./q.), como no NF-e/NFS-e: campo novo lido cru reprova sem
       ninguém mexer no fixture. Dois registros: o segundo com tomador "4 - Outros",
       que desenha o bloco do tomador (ramo que o primeiro não percorre). */
    {
      const iniC = html.indexOf('// ═══ CT-e (modelo 57) ═══');
      const iniTela = html.indexOf('/* ── Tela:', iniC);
      const fimC = html.indexOf('function cteAbre(', iniC);
      const fonteCte = iniC < 0 || iniTela < 0 || fimC < 0 ? '' : html.slice(iniTela, fimC);
      const NAO_CAMPO = ['length', 'map', 'filter', 'some', 'concat', 'join', 'slice', 'reduce', 'flatMap'];
      const campos = (pref) => [...new Set([...fonteCte.matchAll(new RegExp('\\b' + pref + '\\.([A-Za-z_]\\w*)', 'g'))].map((m) => m[1]))]
        .filter((k) => !NAO_CAMPO.includes(k));
      const topo = campos('c');
      const daParte = [...new Set(campos('pt').concat(['doc', 'nome', 'email', 'fone']))];
      const objDe = (pref, val) => Object.fromEntries(campos(pref).map((k) => [k, val]));
      const regCte = (val, extra) => {
        const r = {};
        for (const k of topo) r[k] = val;
        for (const k of ['emit', 'rem', 'exped', 'receb', 'dest', 'tomaOutro', 'resp']) r[k] = Object.fromEntries(daParte.map((x) => [x, val]));
        r.comp = [objDe('k', val)]; r.infQ = [objDe('q', val)]; r.veic = [objDe('v', val)]; r.dup = [objDe('d', val)];
        r.docs = [Object.assign(objDe('d', val), { tipo: 'NF-e', chave: val }), objDe('d', val)];
        for (const k of ['docAnt', 'occ', 'obsCont', 'obsFisco']) r[k] = [val];
        r.fat = [val, val, val, val];
        return Object.assign(r, extra || {});
      };
      ok('CT-e: o universo de campos do render vem do fonte (e não está vazio)',
        topo.length >= 60 && daParte.length >= 7 && campos('d').length >= 7 && campos('v').length >= 6, 'c.=' + topo.length + ' pt.=' + daParte.length);
      const medeCte = (val, aberto) => {
        try {
          vm.runInContext(`(()=>{__DB.cte=${JSON.stringify([regCte(val), regCte(val, { toma: '4' })])};__DB.nfe=[];CTE_UI.aberto=${aberto};renderCTe();})()`, sb);
          return vm.runInContext("document.getElementById('cte-list').innerHTML+document.getElementById('cte-alertas').innerHTML", sb);
        } catch (e) { return 'ERRO: ' + e.message; }
      };
      for (const ab of [0, 1]) {
        const hp = medeCte(PAY, ab), hb = medeCte(BENIGNO, ab), fp = forma(hp), fb = forma(hb);
        ok('renderCTe com o painel ' + (ab ? 'do tomador "outros"' : 'aberto') + ': o payload não ganha tag nem handler e continua como texto',
          !/^ERRO/.test(hp) && /cte-painel/.test(hp) && fp.tags === fb.tags && fp.handler === fb.handler && fp.script === 0 && fp.img === 0 && fp.escapado > 0 && fb.escapado === 0,
          /^ERRO/.test(hp) ? hp : `payload ${fp.tags} tag(s)/${fp.handler} handler vs benigno ${fb.tags}/${fb.handler}`);
      }
      FORMAS.forEach((formaPay, i) => {
        const fp = forma(medeCte(formaPay, 0)), fb = forma(medeCte(BENIGNO, 0));
        ok('a forma #' + (i + 1) + ' (' + formaPay.slice(0, 18) + '…) não vira HTML em renderCTe',
          fp.tags === fb.tags && fp.handler === fb.handler && fp.script === 0, `tags=${fp.tags} vs benigno=${fb.tags}`);
      });
      /* Campo que não veio no XML aparece como "não consta no XML", não some. */
      const vazio = medeCte('', 0);
      ok('CT-e: campo ausente no XML aparece como "não consta no XML" no painel',
        (vazio.match(/não consta no XML/g) || []).length >= 40, (vazio.match(/não consta no XML/g) || []).length + ' ocorrência(s)');
      /* A exportação: o cteLinha devolve exatamente as colunas do HCTE, na ordem. */
      const colunas = vm.runInContext(`Object.keys(cteLinha(${JSON.stringify(regCte('X'))})).join('|')`, sb);
      ok('CT-e: cada linha exportada tem exatamente as colunas do HCTE, na mesma ordem',
        colunas === vm.runInContext("HCTE.join('|')", sb), colunas.slice(0, 120));
      /* A detecção: o CT-e não cai mais em "nfe" (virava "0 produto(s)"). */
      const det = vm.runInContext(`[detectType('<?xml version="1.0"?><cteProc versao="4.00"><CTe>'),detectType('<CTe xmlns="x"><infCte Id="CTe1">'),
        detectType('<?xml version="1.0"?><nfeProc versao="4.00"><NFe>'),detectType('<CompNFe><NFe>'),detectType('<NFSe versao="1.00"><infNFSe>')].join()`, sb);
      ok('detectType reconhece CT-e e mantém NF-e e NFS-e', det === 'cte,cte,nfe,nfse,nfse', det);
      ok('cteRot não resolve código pelo protótipo (o código vem do XML)',
        vm.runInContext("cteRot('toma','constructor')+'|'+cteRot('toma','3')", sb) === 'constructor|3 - Destinatário');
      /* O quadro "Para conferir": salto na numeração, NF-e não carregada, chassi e
         NF-e repetidos entre CT-e, CT-e sem autorização. Chaves sintéticas. */
      /* Montadas em tempo de execução (nenhuma chave de 44 dígitos fica escrita no arquivo). */
      const nfChave = (n) => '35' + '2610' + '11222334000126' + '55' + '001' + String(n).padStart(9, '0') + '1' + '00000001' + '1';
      const nfA = nfChave(100), nfB = nfChave(200);
      /* Os campos de ligação (Chave_CTe, chCTeSub) são zerados/únicos: com o mesmo valor
         em tudo, todo CT-e "substituiria" a si mesmo. O 45 substitui o 40 e é autorizado
         fora de prazo (150), que conta como autorizado. */
      const base = (n, chs, chassi, st, sub) => regCte('X', { Numero: n, Serie: '1', cStat: st, xMotivo: 'M', Chave_CTe: 'CT' + n, chCTeSub: sub || '',
        emit: { doc: '11222333000181' }, rem: { doc: '11222333000181' }, docs: chs.map((ch) => ({ tipo: 'NF-e', chave: ch })), veic: [{ chassi }] });
      const alertas = vm.runInContext(`cteAlertas(${JSON.stringify([base('40', [nfA], 'CH1', '100'), base('41', [nfB], 'CH1', '100'), base('44', [nfA], 'CH2', ''), base('45', [], 'CH3', '150', 'CT40')])},new Set(['${nfA}']))`, sb);
      const txt = alertas.join(' || ');
      ok('CT-e: o quadro "Para conferir" aponta salto, NF-e faltando, repetições, substituto e falta de autorização',
        alertas.length === 7 && /emitente 11222333000181, série 1\): faltam 42 a 43/.test(txt) && /substituto importado junto com o original \(o frete contaria duas vezes\): 45\./.test(txt)
        && /1 de 3 NF-e vinculadas não foram carregadas: NF 200 \(CT-e 41\)/.test(txt)
        && /NF-e vinculada a mais de um CT-e: NF 100 \(CT-e 40, 44\)/.test(txt) && /Chassi em mais de um CT-e: CH1 \(CT-e 40, 41\)/.test(txt)
        && /3 CT-e com a própria transportadora como remetente/.test(txt) && /1 CT-e sem autorização de uso: 44 \(Sem protocolo\)/.test(txt), txt);
      /* CSV do CT-e: toda célula (inclusive as compostas, juntadas com " | ") passa pela
         neutralização de fórmula depois de montada. */
      /* O helper do CSV mora em outro script da página: sobe o mesmo trecho que o teste de NF-e usa. */
      { const iG = html.indexOf('window.GCON={csvCelula:'); vm.runInContext(html.slice(iG, html.indexOf('\n', iG)), sb); }
      const celulas = vm.runInContext(`(()=>{const r=cteLinha(${JSON.stringify(regCte('=HYPERLINK("x")', { comp: [{ nome: '=1+1', valor: '1' }] }))});
        return HCTE.map(h=>window.GCON.csvCelula?window.GCON.csvCelula(formatoBr(r[h])):null);})()`, sb);
      const crua = celulas.filter((x) => x !== null && /^"[=+\-@]/.test(x));
      ok('CT-e: o CSV neutraliza fórmula em toda coluna (inclusive as listas juntadas)',
        celulas.every((x) => x !== null) && crua.length === 0 && celulas.some((x) => x.startsWith('"\'=HYPERLINK')), crua.slice(0, 3).join(' | ') || String(celulas[0]));
      ok('o botão copiar só aparece para chave de 44 dígitos',
        vm.runInContext("cteCopiar('12345')+'|'+(cteCopiar('1'.repeat(44)).includes('data-copiar'))", sb) === '|true');
      vm.runInContext('__DB.cte=[];CTE_UI.aberto=-1', sb);
    }
    /* ── NFS-e: leitura completa, conferência e painel ─────────────────────────
       O teste não tem navegador: um DOMParser mínimo (só o que os extratores usam:
       seletor de descendente, atributo, texto, filhos) lê o XML sintético dentro do
       mesmo sandbox do render. A chave de 50 posições é montada em tempo de
       execução; os CNPJs são os sintéticos declarados na lista do gate de privacidade. */
    {
      class El {
        constructor(tag, attrs, pai) { this.tagName = tag; this.attrs = attrs; this.children = []; this.pai = pai; this.txt = ''; }
        get textContent() { return this.txt + this.children.map((c) => c.textContent).join(''); }
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
        todos() { const out = []; const anda = (e) => { for (const c of e.children) { out.push(c); anda(c); } }; anda(this); return out; }
        querySelectorAll(sel) {
          const partes = sel.trim().split(/\s+/);
          return this.todos().filter((e) => {
            if (e.tagName !== partes[partes.length - 1]) return false;
            let k = partes.length - 2, a = e.pai;
            while (k >= 0 && a) { if (a.tagName === partes[k]) k--; a = a.pai; }
            return k < 0;
          });
        }
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
      }
      const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
      class MiniDOMParser {
        parseFromString(xml) {
          const raiz = new El('#doc', {}, null);
          let cur = raiz;
          for (const m of xml.matchAll(/<\?[^>]*>|<\/?[^>]+>|[^<]+/g)) {
            const tk = m[0];
            if (tk.startsWith('<?')) continue;
            if (tk.startsWith('</')) { cur = cur.pai; continue; }
            if (tk.startsWith('<')) {
              const auto = tk.endsWith('/>');
              const corpo = tk.slice(1, auto ? -2 : -1).trim();
              const tag = corpo.split(/\s/)[0];
              const attrs = {};
              for (const a of corpo.matchAll(/([\w:.-]+)="([^"]*)"/g)) attrs[a[1]] = ent(a[2]);
              const e = new El(tag, attrs, cur);
              cur.children.push(e);
              if (!auto) cur = e;
              continue;
            }
            cur.txt += ent(tk);
          }
          return { documentElement: raiz.children[0], querySelector: (s) => raiz.querySelector(s) };
        }
      }
      sb.DOMParser = MiniDOMParser;
      const X = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const tg = (nome, filhos) => '<' + nome + '>' + filhos + '</' + nome + '>';
      const PREST = '11222333000181', TOMA = '12345678000195', INTERM = '00000000000191';
      /* Chave da NFS-e: município (7) + ambiente + tipo de inscrição + CNPJ (14) + número (13) + AAMM + código (9) + DV. */
      const chave = (num) => '3509502' + '2' + '2' + PREST + String(num).padStart(13, '0') + '2611' + String(num * 7 + 13).padStart(9, '0') + '7';
      const DESC = Array.from({ length: 12 }, (_, i) => 'Linha ' + (i + 1) + ' da discriminação do serviço prestado conforme contrato').join('\n');
      const MAL = '<img src=x onerror="window.__XSS=1">';
      const nfseXml = (o) => '<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.00">'
        + '<infNFSe Id="NFS' + chave(o.num) + '">'
        + tg('xLocEmi', 'Campinas') + tg('xLocPrestacao', 'Barueri') + tg('nNFSe', String(o.num)) + tg('cLocIncid', '3505708') + tg('xLocIncid', 'Barueri')
        + tg('xTribNac', 'Suporte técnico em informática') + tg('xTribMun', 'Suporte técnico') + tg('xNBS', 'Serviços de suporte em TI') + tg('verAplic', 'SefinNac_1.4.0')
        + tg('ambGer', '2') + tg('tpEmis', '1') + tg('procEmi', '1') + tg('cStat', '100') + tg('dhProc', '2026-11-03T10:42:00-03:00') + tg('nDFSe', '880' + o.num)
        + tg('emit', tg('CNPJ', PREST) + tg('IM', '98765') + tg('xNome', 'ALFA SERVICOS DE EXEMPLO LTDA') + tg('xFant', 'Alfa Exemplo')
          + tg('enderNac', tg('xLgr', 'Rua das Flores') + tg('nro', '100') + tg('xBairro', 'Centro') + tg('cMun', '3509502') + tg('UF', 'SP') + tg('CEP', '13010000'))
          + tg('fone', '1930000000') + tg('email', 'fiscal@alfa.exemplo'))
        + tg('valores', tg('vCalcDR', '50.00') + (o.semVBC ? '' : tg('vBC', '9850.00')) + tg('pAliqAplic', '2.00') + tg('vISSQN', '197.00') + tg('vTotalRet', o.vTotalRet || '1012.25') + (o.vLiq == null ? '' : tg('vLiq', o.vLiq)))
        + (o.semDPS ? '' : tg('DPS', '<infDPS Id="DPS1">' + tg('tpAmb', '1') + tg('dhEmi', '2026-11-03T10:15:00-03:00') + tg('verAplic', 'ERP 2.0') + tg('serie', '900') + tg('nDPS', '5' + o.num)
          + tg('dCompet', o.compet || '2026-11-03') + tg('tpEmit', '1') + tg('cLocEmi', '3509502')
          + tg('subst', tg('chSubstda', chave(o.num - 1)) + tg('cMotivo', '99') + tg('xMotivo', 'Erro no valor do contrato'))
          + tg('prest', tg('CNPJ', PREST) + tg('IM', '98765') + tg('fone', '1930000000') + tg('regTrib', tg('opSimpNac', o.sn || '1') + tg('regApTribSN', '1') + tg('regEspTrib', '0')))
          + tg('toma', tg('CNPJ', TOMA) + tg('IM', '7777') + tg('xNome', 'TOMADOR DE EXEMPLO LTDA')
            + tg('end', tg('endNac', tg('cMun', o.munToma) + tg('CEP', '01000000')) + tg('xLgr', 'Av. Exemplo') + tg('nro', '123') + tg('xBairro', 'Bela Vista'))
            + tg('fone', '1133334444') + tg('email', 'fiscal@tomador.exemplo'))
          + tg('interm', tg('CNPJ', INTERM) + tg('xNome', 'INTERMEDIARIO DE EXEMPLO SA') + tg('end', tg('endNac', tg('cMun', '3505708') + tg('CEP', '06454000')) + tg('xLgr', 'Al. Exemplo') + tg('nro', '500')))
          + tg('serv', tg('locPrest', tg('cLocPrestacao', '3505708')) + tg('cServ', tg('cTribNac', '010701') + tg('cTribMun', '107') + tg('xDescServ', X(DESC)) + tg('cNBS', '115013000'))
            + tg('obra', tg('cObra', 'OB-77')) + tg('infoCompl', tg('idDocTec', 'DT-1') + tg('docRef', 'Pedido 42') + tg('xInfComp', X(o.inf || 'Contrato de exemplo'))))
          + tg('valores', tg('vServPrest', tg('vReceb', '0.00') + tg('vServ', '10000.00')) + tg('vDescCondIncond', tg('vDescIncond', '100.00') + tg('vDescCond', '0.00'))
            + tg('vDedRed', tg('vDR', '50.00'))
            + tg('trib', tg('tribMun', tg('tribISSQN', o.trib || '1') + tg('tpImunidade', '') + tg('exigSusp', tg('tpSusp', '1') + tg('nProcesso', 'PROC-9')) + tg('pAliq', o.aliq || '2.00') + tg('tpRetISSQN', o.ret))
              + tg('tribFed', tg('piscofins', tg('CST', '01') + tg('vBCPisCofins', '10000.00') + tg('pAliqPis', '0.65') + tg('pAliqCofins', '3.00') + tg('vPis', '65.00') + tg('vCofins', '300.00') + tg('tpRetPisCofins', o.retPC || '1'))
                + tg('vRetCP', '110.00') + tg('vRetIRRF', '150.00') + tg('vRetCSLL', '100.00'))
              + tg('totTrib', tg('vTotTrib', tg('vTotTribFed', '1345.00') + tg('vTotTribEst', '0.00') + tg('vTotTribMun', '200.00')))))
          + tg('IBSCBS', tg('finNFSe', '0') + tg('cIndOp', '020101') + tg('valores', tg('trib', tg('gIBSCBS', tg('CST', '000') + tg('cClassTrib', '000001'))))) + '</infDPS>'))
        + '</infNFSe></NFSe>';
      /* ISS não retido: 10000 − 100 (desconto) − 65 − 300 − 110 − 150 − 100 = 9175,00 */
      const ler = (xml) => {
        vm.runInContext('__X=' + JSON.stringify(xml), sb);
        return vm.runInContext('(()=>{const r=extrairNFSe("a.xml",__X);return r.ok?r.notas[0]:r;})()', sb);
      };
      let d = null, d2 = null, erro = '';
      try {
        d = ler(nfseXml({ num: 1042, munToma: '3509502', ret: '1', vLiq: '9175.00' }));
        d2 = ler(nfseXml({ num: 1043, munToma: '4106902', ret: '2', vLiq: '8978.00', inf: MAL }));
      } catch (e) { erro = e.message; }
      ok('NFS-e Nacional: o leitor sobe o XML sintético (DOMParser mínimo no sandbox)', !erro && d && d.Numero_NFSe === '1042', erro || JSON.stringify(d).slice(0, 160));
      if (!erro && d) {
        const hnfseCols = vm.runInContext('HNFSE', sb);
        ok('NFS-e: o registro lido tem todas as colunas do HNFSE (nenhuma fica de fora da exportação)',
          hnfseCols.every((c) => Object.prototype.hasOwnProperty.call(d, c)), hnfseCols.filter((c) => !(c in d)).join(','));
        const esperado = {
          Chave_NFSe: chave(1042), Numero_DFSe: '8801042', Data_Processamento: '2026-11-03T10:42:00-03:00', cStat_NFSe: '100', Ambiente: '1', Tipo_Emitente: '1',
          Cod_Local_Emissao: '3509502', Local_Emissao: 'Campinas', Versao_Aplicativo: 'SefinNac_1.4.0', Numero_DPS: '51042', Serie_RPS: '900', Tipo_Emissao: '1',
          Chave_Substituida: chave(1041), Motivo_Substituicao: '99', Desc_Motivo_Substituicao: 'Erro no valor do contrato',
          cTribNac: '010701', Cod_Servico_Mun: '107', Desc_Servico_Mun: 'Suporte técnico', Cod_Local_Prestacao: '3505708', Municipio_Prestacao: 'Barueri', Obra: 'obra OB-77',
          Valor_Bruto: '10000.00', Valor_Recebido: '0.00', Desc_Incondicionado: '100.00', Desc_Condicionado: '0.00', Deducoes_Reducoes: '50.00', Valor_Total_Retido: '1012.25', Valor_Liquido: '9175.00',
          Trib_ISSQN: '1', Cod_Mun_Incidencia: '3505708', Mun_Incidencia: 'Barueri', Exig_Suspensa: '1', Processo_Suspensao: 'PROC-9', Regime_Especial: '0', Apuracao_SN: '1',
          PISCOFINS_CST: '01', Aliq_PIS: '0.65', Aliq_COFINS: '3.00', Ret_PISCOFINS: '1', Valor_PIS: '65.00', Valor_COFINS: '300.00', Valor_INSS: '110.00', Valor_IRRF: '150.00', Valor_CSLL: '100.00',
          IBSCBS_CST: '000', cClassTrib: '000001', cIndOp: '020101', vTotTrib_Fed: '1345.00', vTotTrib_Mun: '200.00',
          Endereco_Prestador: 'Rua das Flores, 100, Centro · CEP 13010000', Cod_Mun_Prestador: '3509502', Fone_Prestador: '1930000000', UF_Prestador: 'SP',
          Endereco_Tomador: 'Av. Exemplo, 123, Bela Vista · CEP 01000000', Fone_Tomador: '1133334444',
          CNPJ_Intermediario: INTERM, Nome_Intermediario: 'INTERMEDIARIO DE EXEMPLO SA', Cod_Mun_Intermediario: '3505708', Mun_Intermediario: 'Barueri',
          Info_Complementar: 'Contrato de exemplo', Doc_Tecnico: 'DT-1', Doc_Referencia: 'Pedido 42',
        };
        const difere = Object.keys(esperado).filter((k) => d[k] !== esperado[k]);
        ok('NFS-e Nacional: o leitor lê identificação, DPS, serviço, valores, ISS, PIS/COFINS, IBS/CBS, aproximados, partes e complemento',
          difere.length === 0, difere.map((k) => k + '=' + JSON.stringify(d[k]) + ' (esperado ' + JSON.stringify(esperado[k]) + ')').join(' | '));
        ok('NFS-e: a chave sai sem espaço nenhum, com as 50 posições', /^\d{50}$/.test(d.Chave_NFSe), d.Chave_NFSe);
        ok('NFS-e: a discriminação inteira é guardada (com as quebras de linha); a coluna antiga continua em 200',
          d.Descricao_Completa === DESC && DESC.length > 600 && d.xDescServ.length === 200 && d.Discriminacao.length === 200, d.Descricao_Completa.length + '/' + d.xDescServ.length);
        ok('NFS-e: o município do tomador é o do endereço dele, não o local da prestação',
          d.Mun_Tomador === 'Campinas' && d.UF_Tomador === 'SP' && d.Cod_Mun_Tomador === '3509502' && d.Municipio_Prestacao === 'Barueri'
          && d2.Mun_Tomador === '' && d2.UF_Tomador === 'PR' && d2.Cod_Mun_Tomador === '4106902',
          [d.Mun_Tomador, d.UF_Tomador, d2.Mun_Tomador, d2.UF_Tomador].join('|'));
        const ret = vm.runInContext("['1','2','3','9','','constructor'].map(c=>nfseCod('tpRetISSQN',c)).map(x=>x.h+(x.z?'#z':''))", sb);
        ok('tpRetISSQN sai por extenso, com o código ao lado; código fora da tabela sai cru, vazio sai —',
          /^Não retido <span class="nfse-cod">\(1\)<\/span>$/.test(ret[0]) && /^Retido pelo tomador/.test(ret[1]) && /^Retido pelo intermediário/.test(ret[2])
          && ret[3] === '9' && ret[4] === '—#z' && ret[5] === 'constructor', ret.join(' | '));
        ok('opSimpNac, tribISSQN e regEspTrib também saem por extenso',
          vm.runInContext("[nfseCod('opSimpNac','3').h,nfseCod('tribISSQN','3').h,nfseCod('regEspTrib','6').h].join('|')", sb)
          === 'Optante ME/EPP <span class="nfse-cod">(3)</span>|Exportação de serviço <span class="nfse-cod">(3)</span>|Sociedade de profissionais <span class="nfse-cod">(6)</span>');

        /* O painel: os blocos na ordem pedida, a chave inteira numa linha, a descrição inteira. */
        let hp = '', hv = '';
        try {
          vm.runInContext('__DB.nfse=' + JSON.stringify([d, d2]) + ';NFSE_UI.aberto=0;NFSE_UI.conf=false;renderNFSe();', sb);
          hp = vm.runInContext("document.getElementById('nfse-list').innerHTML", sb);
          vm.runInContext('NFSE_UI.aberto=1;renderNFSe();', sb);
          hv = vm.runInContext("document.getElementById('nfse-list').innerHTML", sb);
        } catch (e) { hp = 'ERRO: ' + e.message; }
        const BLOCOS = ['Tributos', 'Valores', 'Identificação', 'DPS (declaração do prestador)', 'Serviço', 'ISS', 'PIS / COFINS', 'IBS / CBS',
          'Tributos aproximados (Lei 12.741)', 'Prestador', 'Tomador', 'Intermediário', 'Informações complementares'];
        const pos = BLOCOS.map((b) => hp.indexOf('<h5 class="dnf-sub">' + b + '</h5>'));
        ok('painel da NFS-e: os 13 blocos aparecem, na ordem pedida', pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), BLOCOS.filter((b, i) => pos[i] < 0).join(',') || pos.join(','));
        ok('painel da NFS-e: a chave aparece inteira, sem espaço, num span de uma linha só',
          hp.includes('<span class="nfse-ch">' + chave(1042) + '</span>') && /\.nfse-ch\{[^}]*white-space:nowrap/.test(html), hp.slice(0, 120));
        const TRIB = ['ISS', 'PIS', 'COFINS', 'CSLL', 'IRRF', 'INSS (CP)', 'IBS UF', 'IBS município', 'CBS'];
        const tab = (hp.match(/<table class="nfse-trib">[\s\S]*?<\/table>/) || [''])[0];
        ok('painel da NFS-e: a tabela de tributos tem Tributo | CST | Base | Alíquota | Valor | Detalhes, uma linha por tributo e o total retido',
          /<th>Tributo<\/th><th>CST<\/th><th class="n">Base<\/th><th class="n">Alíquota<\/th><th class="n">Valor<\/th><th>Detalhes<\/th>/.test(tab)
          && TRIB.every((x) => tab.includes('<td class="nome">' + x + '</td>')) && /<tr class="tot"><td class="nome">Total retido<\/td>[\s\S]*?<td class="n">725,00<\/td>/.test(tab)
          && /Retido <b>não<\/b> · Incidência <b>Barueri\/SP \(3505708\)<\/b>/.test(tab), tab.slice(0, 300));
        const linhaTrib = (nome) => (tab.match(new RegExp('<tr><td class="nome">' + nome.replace(/[()]/g, '\\$&') + '</td>[\\s\\S]*?</tr>')) || [''])[0];
        const baseAliq = (nome) => (linhaTrib(nome).match(/<td class="n(?: z)?">[^<]*<\/td>/g) || []).slice(0, 2);
        const vazias = ['CSLL', 'IRRF', 'INSS (CP)'].map((x) => [x, baseAliq(x)]);
        ok('painel da NFS-e: base/alíquota ausente sai 0,00 em cinza em todas as linhas (CSLL igual a IRRF/INSS), nunca —',
          vazias.every(([, c]) => c.length === 2 && c.every((td) => td === '<td class="n z">0,00</td>'))
          && !/<td class="n z">—<\/td>/.test(tab), vazias.map(([x, c]) => x + ':' + c.join('')).join(' | '));
        ok('painel da NFS-e: alíquota presente sai com %, sem cinza (o padrão não apaga o que veio)',
          baseAliq('PIS')[1] === '<td class="n">0,65%</td>' && baseAliq('COFINS')[1] === '<td class="n">3,00%</td>', baseAliq('PIS').join(''));
        ok('painel da NFS-e: Competência no bloco Identificação sai MM/AAAA, igual à coluna Compet. da lista',
          /<dt>Competência<\/dt><dd class="txt">11\/2026<\/dd>/.test(hp) && !/<dt>Competência<\/dt><dd[^>]*>\d{2}\/\d{2}\/\d{4}/.test(hp),
          (hp.match(/<dt>Competência<\/dt><dd[^>]*>[^<]*<\/dd>/) || [''])[0]);
        ok('painel da NFS-e: a descrição do serviço sai inteira (sem corte de 80/200), em texto pré-formatado',
          hp.includes('<p class="nfse-txt">' + DESC + '</p>') && /\.nfse-txt\{[^}]*white-space:pre-wrap/.test(html));
        ok('painel da NFS-e: o que não veio no XML sai 0,00 (valor) ou — (texto) em cinza, nunca some',
          /<dt>Valor recebido \(intermediário\)<\/dt><dd class="z">0,00<\/dd>/.test(hp) && /<dt>Telefone<\/dt><dd class="txt z">—<\/dd>/.test(hp)
          && /<dt>Inscrição municipal<\/dt><dd class="txt z">—<\/dd>/.test(hp), (hp.match(/<dt>Telefone<\/dt><dd[^>]*>[^<]*<\/dd>/g) || []).join(' '));
        ok('painel da NFS-e: tomador com o município do endereço; ISS retido pelo tomador aparece com quem reteve',
          /<dt>Município<\/dt><dd class="txt">Campinas\/SP \(3509502\)<\/dd>/.test(hp) && /<dt>Município<\/dt><dd class="txt">PR \(4106902\)<\/dd>/.test(hv)
          && /Retido <b>sim, pelo tomador<\/b>/.test(hv));
        ok('painel da NFS-e: o texto hostil do XML (informações complementares) sai escapado',
          hv.includes(vm.runInContext('esc(' + JSON.stringify(MAL) + ')', sb)) && !/<img/i.test(hv));
        ok('painel da NFS-e: cabeçalho com anterior/próximo, título, dica e Fechar; a 1ª nota tem o anterior desabilitado',
          /<button type="button" class="nfse-ir" data-lado="ant" disabled aria-label="NFS-e anterior">◂ anterior<\/button><b>NFS-e 1042 · Alfa Exemplo<\/b><button type="button" class="nfse-ir" data-lado="prx" data-ir="1"/.test(hp)
          && /↑ ↓ passam de NFS-e · Esc fecha/.test(hp) && /class="nfse-fechar"/.test(hp) && /data-lado="prx" disabled/.test(hv), hp.slice(hp.indexOf('<aside'), hp.indexOf('<aside') + 300));

        /* A situação: só o estado do documento; a substituída é apontada pela substituta. */
        const subst = vm.runInContext(`(()=>{const a=${JSON.stringify(d)},b=Object.assign({},a,{Numero_NFSe:'1043',Chave_NFSe:'K1043',Chave_Substituida:a.Chave_NFSe});
          __DB.nfse=[a,b];NFSE_UI.aberto=-1;renderNFSe();return document.getElementById('nfse-list').innerHTML;})()`, sb);
        const pills = (subst.match(/<span class="cte-pill[^"]*">[^<]*<\/span>/g) || []);
        ok('lista da NFS-e: situação é "autorizada" ou "substituída pela N", sem pílula de aviso',
          pills.length === 2 && pills[0] === '<span class="cte-pill cte-falta">substituída pela 1043</span>' && pills[1] === '<span class="cte-pill cte-ok">autorizada</span>', pills.join(' '));
        ok('lista da NFS-e: uma linha por nota, com as 12 colunas pedidas',
          /<th>NFS-e<\/th><th>Emissão<\/th><th>Compet\.<\/th><th>Prestador<\/th><th>Tomador<\/th><th>Serviço<\/th><th class="n">Valor serviço<\/th><th class="n">ISS<\/th><th>Retido\?<\/th><th class="n">Ret\. federais<\/th><th class="n">Líquido<\/th><th>Situação<\/th>/.test(subst)
          && (subst.match(/<tr data-i="/g) || []).length === 2 && /<td>11\/2026<\/td>/.test(subst) && /11\.222\.333\/0001-81/.test(subst));

        /* O botão "Conferir valores": nasce fechado; abre o quadro só a pedido. */
        const conf = vm.runInContext(`(()=>{NFSE_UI.conf=false;renderNFSe();const bt=document.getElementById('nfse-conf'),box=document.getElementById('nfse-alertas');
          const fechado=[bt.hidden,box.hidden,bt.textContent,bt.getAttribute('aria-expanded')];
          NFSE_UI.conf=true;nfseConfRender(__DB.nfse);const aberto=[box.hidden,bt.getAttribute('aria-expanded'),box.innerHTML];
          NFSE_UI.conf=false;__DB.nfse=[];renderNFSe();const vazio=[bt.hidden,box.hidden];return {fechado,aberto,vazio};})()`, sb);
        ok('"Conferir valores (N)" aparece com NFS-e carregada e o quadro nasce fechado; sem NFS-e o botão some',
          conf.fechado[0] === false && conf.fechado[1] === true && /^Conferir valores \(\d+\)$/.test(conf.fechado[2]) && conf.fechado[3] === 'false'
          && conf.vazio[0] === true && conf.vazio[1] === true, JSON.stringify(conf.fechado));
        ok('o clique no botão abre o quadro "Para conferir" (aria-expanded acompanha)',
          conf.aberto[0] === false && conf.aberto[1] === 'true' && /<b>Para conferir<\/b><ul>/.test(conf.aberto[2]), JSON.stringify(conf.aberto).slice(0, 200));
        ok('o quadro de conferência não tem handler inline e o botão é ligado por addEventListener',
          /<button type="button" id="nfse-conf" class="nfse-conf" aria-expanded="false" aria-controls="nfse-alertas" hidden>/.test(html)
          && /getElementById\('nfse-conf'\)\.addEventListener\('click'/.test(html));

        /* A conferência: cada regra com um caso que dispara e o caso limpo que não dispara. */
        const base = Object.assign({}, d, { Chave_Substituida: '' });
        const nota = (o) => Object.assign({}, base, o);
        const lote = [
          nota({ Numero_NFSe: '10', Chave_NFSe: 'C10' }),
          nota({ Numero_NFSe: '12', Chave_NFSe: 'C12', Valor_Liquido: '9325.00' }),
          nota({ Numero_NFSe: '13', Chave_NFSe: 'C13', Aliq_ISS: '1.50' }),
          nota({ Numero_NFSe: '14', Chave_NFSe: 'C14', Simples_Nacional: '3' }),
          nota({ Numero_NFSe: '15', Chave_NFSe: 'C15', Data_Competencia: '2026-09-01' }),
          nota({ Numero_NFSe: '16', Chave_NFSe: 'C16', Chave_Substituida: 'C10' }),
          nota({ Numero_NFSe: '17', Chave_NFSe: 'C17', tpRetISSQN: '2', Valor_Liquido: '8978.00', Cod_Mun_Incidencia: '3505708', Cod_Mun_Prestador: '3509502' }),
        ];
        /* O líquido declarado (vLiqXML) é propriedade não enumerável gravada pelo leitor: o
           JSON da ida ao sandbox a perde, então o lote a recebe de volta lá dentro. */
        vm.runInContext('var __comLiq=(L)=>{L.forEach(n=>Object.defineProperty(n,"vLiqXML",{value:n.Valor_Liquido}));return L;}', sb);
        const al = vm.runInContext('nfseAlertas(__comLiq(' + JSON.stringify(lote) + '))', sb);
        const txt = al.join(' || ');
        ok('conferência da NFS-e: salto, líquido, alíquota, Simples, competência, substituída e ISS fora do município — cada uma uma vez',
          al.length === 7 && /prestador ALFA SERVICOS DE EXEMPLO LTDA · 11222333000181, NFSe Nacional\): faltam 11 no que foi importado/.test(txt)
          && /O líquido não fecha[^|]*NFS-e 12 \(XML R\$ 9\.325,00, a conta dá R\$ 9\.175,00\)\./.test(txt)
          && /Alíquota de ISS fora[^|]*NFS-e 13 \(1,50%\)\./.test(txt) && /Simples Nacional \(ME\/EPP\)[^|]*NFS-e 14\./.test(txt)
          && /Competência em mês diferente[^|]*NFS-e 15 \(competência 09\/2026, emitida em 03\/11\/2026\)\./.test(txt)
          && /NFS-e 10 substituída pela 16\./.test(txt) && /ISS retido pelo tomador[^|]*NFS-e 17 \(devido em Barueri\/SP \(3505708\), prestador em Campinas\/SP \(3509502\)\)\./.test(txt), txt);
        const limpo = vm.runInContext('nfseAlertas(__comLiq(' + JSON.stringify([nota({ Numero_NFSe: '20', Chave_NFSe: 'C20' }), nota({ Numero_NFSe: '21', Chave_NFSe: 'C21', Valor_Liquido: '9175.01' })]) + '))', sb);
        ok('conferência da NFS-e: nota que fecha (tolerância de 1 centavo) não gera aviso nenhum', limpo.length === 0, limpo.join(' || '));
        const cond = vm.runInContext('nfseAlertas(__comLiq(' + JSON.stringify([nota({ Numero_NFSe: '30', Chave_NFSe: 'C30', Desc_Condicionado: '25.00', Valor_Liquido: '9150.00' })]) + '))', sb);
        ok('conferência da NFS-e: o desconto condicionado descontado do líquido (regra do leiaute) não é apontado', cond.length === 0, cond.join(' || '));
        /* O quadro com dado hostil: o aviso cita o número da nota e o nome do prestador. */
        const hal = vm.runInContext(`(()=>{__DB.nfse=${JSON.stringify(lote.map((x) => Object.assign({}, x, { Nome_Prestador: MAL })))};NFSE_UI.conf=true;nfseConfRender(__DB.nfse);
          const h=document.getElementById('nfse-alertas').innerHTML;NFSE_UI.conf=false;__DB.nfse=[];return h;})()`, sb);
        const fa = forma(hal);
        ok('o quadro "Para conferir" da NFS-e escapa o dado do arquivo', fa.img === 0 && fa.handler === 0 && fa.script === 0 && fa.escapado > 0, JSON.stringify(fa));
        /* O botão de navegação: o texto visível está contido no nome acessível (WCAG 2.5.3),
           para quem comanda por voz dizer o que vê. */
        const irs = [...hp.matchAll(/<button type="button" class="nfse-ir"[^>]*aria-label="([^"]*)">([^<]*)<\/button>/g)];
        const foraDoNome = irs.filter((m) => !(m[2].toLowerCase().match(/[a-zà-ú-]+/g) || []).every((w) => m[1].toLowerCase().includes(w)));
        ok('painel da NFS-e: o texto visível de anterior/próxima está contido no nome acessível ("próxima ▸" / "Próxima NFS-e")',
          irs.length === 2 && foraDoNome.length === 0 && irs[1][2] === 'próxima ▸', irs.map((m) => m[2] + ' ⇢ ' + m[1]).join(' | '));

        /* A base do ISS só vem do XML: nota imune sem vBC fica com a base vazia. */
        let im = null;
        try { im = ler(nfseXml({ num: 2001, munToma: '3509502', ret: '1', vLiq: '9175.00', trib: '2', semVBC: true })); } catch (e) { im = { erro: e.message }; }
        ok('NFS-e imune sem vBC: BC_ISS sai vazia (não herda o valor do serviço)',
          im && im.BC_ISS === '' && im.Trib_ISSQN === '2' && im.Valor_Bruto === '10000.00', im && (im.erro || 'BC_ISS=' + JSON.stringify(im.BC_ISS)));

        /* O líquido só é conferido quando o XML o declarou e a DPS foi lida. */
        const alDe = (n) => { sb.__n = n; return vm.runInContext('nfseAlertas([__n])', sb); };
        const liqDe = (al) => al.filter((a) => /O líquido não fecha/.test(a));
        let semLiq = null, semDps = null, errado = null;
        try {
          semLiq = ler(nfseXml({ num: 2002, munToma: '3509502', ret: '1' }));
          semDps = ler(nfseXml({ num: 2003, munToma: '3509502', ret: '1', vLiq: '9175.00', semDPS: true }));
          errado = ler(nfseXml({ num: 2004, munToma: '3509502', ret: '1', vLiq: '9325.00' }));
        } catch (e) { semLiq = { erro: e.message }; }
        ok('o líquido declarado fica numa propriedade fora das colunas (não exporta, não entra na busca)',
          d.vLiqXML === '9175.00' && !Object.keys(d).includes('vLiqXML') && !vm.runInContext('HNFSE', sb).includes('vLiqXML'), String(d.vLiqXML));
        ok('NFS-e sem a tag vLiq: Valor_Liquido continua preenchido para a planilha, e a conferência não acusa líquido',
          semLiq && semLiq.Valor_Liquido === '10000.00' && semLiq.vLiqXML === undefined && liqDe(alDe(semLiq)).length === 0,
          semLiq && (semLiq.erro || liqDe(alDe(semLiq)).join(' | ')));
        ok('NFS-e sem DPS (retenções não lidas): nenhum alerta falso de líquido',
          semDps && !semDps.erro && semDps.vLiqXML === undefined && liqDe(alDe(semDps)).length === 0, semDps && (semDps.erro || liqDe(alDe(semDps)).join(' | ')));
        ok('NFS-e com vLiq e DPS que não fecham: o alerta de líquido continua saindo',
          errado && liqDe(alDe(errado)).length === 1 && /NFS-e 2004 \(XML R\$ 9\.325,00, a conta dá R\$ 9\.175,00\)/.test(liqDe(alDe(errado))[0]),
          errado && liqDe(alDe(errado)).join(' | '));

        /* Salto de numeração: por CNPJ e por formato; sem CNPJ, pelo nome; sem nada, fora. */
        const salto = (ns) => vm.runInContext('nfseAlertas(' + JSON.stringify(ns) + ')', sb).filter((a) => /^Numeração com salto/.test(a));
        const s1 = salto([{ CNPJ_Prestador: PREST, Nome_Prestador: 'A', Formato: 'NFSe Nacional', Numero_NFSe: '5' },
          { CNPJ_Prestador: PREST, Nome_Prestador: 'A', Formato: 'CompNFe', Numero_NFSe: '9' }]);
        const s2 = salto([{ CNPJ_Prestador: PREST, Nome_Prestador: 'A', Formato: 'NFSe Nacional', Numero_NFSe: '5' },
          { CNPJ_Prestador: PREST, Nome_Prestador: 'A', Formato: 'NFSe Nacional', Numero_NFSe: '9' }]);
        const s3 = salto([{ Nome_Prestador: 'X', Formato: 'CompNFe', Numero_NFSe: '1' }, { Nome_Prestador: 'Y', Formato: 'CompNFe', Numero_NFSe: '3' },
          { Formato: 'CompNFe', Numero_NFSe: '7' }, { Formato: 'CompNFe', Numero_NFSe: '9' }]);
        const s4 = salto([{ Nome_Prestador: 'X', Formato: 'CompNFe', Numero_NFSe: '1' }, { Nome_Prestador: 'X', Formato: 'CompNFe', Numero_NFSe: '3' }]);
        ok('salto de numeração: Nacional nº 5 + CompNFe nº 9 do mesmo CNPJ não é salto (séries diferentes)', s1.length === 0, s1.join(' | '));
        ok('salto de numeração: o mesmo CNPJ e formato com 5 e 9 continua acusando 6 a 8', s2.length === 1 && /faltam 6 a 8/.test(s2[0]), s2.join(' | '));
        ok('salto de numeração: prestadores sem CNPJ não se juntam (nem por nome diferente, nem sem nome)', s3.length === 0, s3.join(' | '));
        ok('salto de numeração: sem CNPJ, o mesmo nome no mesmo formato é a mesma série', s4.length === 1 && /prestador X, CompNFe\): faltam 2 /.test(s4[0]), s4.join(' | '));

        /* Total retido zerado sai em cinza, igual às outras células vazias da tabela. */
        const zero = vm.runInContext("nfsePainel({Numero_NFSe:'1'},-1,-1,null)", sb);
        ok('linha "Total retido" com zero sai 0,00 em cinza (mesmo helper de célula)',
          /<tr class="tot"><td class="nome">Total retido<\/td><td><\/td><td><\/td><td><\/td><td class="n z">0,00<\/td>/.test(zero), (zero.match(/<tr class="tot">[\s\S]*?<\/tr>/) || [''])[0]);

        /* A mesma alíquota sai igual na lista e no painel (2 casas). */
        const aliq = vm.runInContext(`(()=>{__DB.nfse=[Object.assign(${JSON.stringify(d)},{Aliq_ISS:'2.5025'})];NFSE_UI.aberto=0;renderNFSe();
          const h=document.getElementById('nfse-list').innerHTML;__DB.nfse=[];NFSE_UI.aberto=-1;return h;})()`, sb);
        const issLin = (aliq.match(/<tr><td class="nome">ISS<\/td>[\s\S]*?<\/tr>/) || [''])[0];
        ok('alíquota: a lista e o painel usam o mesmo formatador (2 casas)',
          /<div class="cte-sub">2,50%<\/div>/.test(aliq) && /<td class="n">2,50%<\/td>/.test(issLin) && !/2,5025/.test(aliq), issLin.slice(0, 200));

        /* A frase de retenção do ISS tem uma fonte só (NFSE_RET_POR) e as três telas concordam. */
        const ret3 = vm.runInContext(`(()=>{const n={tpRetISSQN:'3',Valor_ISS:'197.00'};return [nfseCod('tpRetISSQN','3').h,nfseRetCel(n),nfsePainel(n,-1,-1,null)];})()`, sb);
        const secNfse = html.slice(html.indexOf('const NFSE_UI='), html.indexOf('// ═══ CT-e (modelo 57)'));
        ok('retenção do ISS: rótulo do código, célula da lista e tabela de tributos saem da mesma fonte',
          /^Retido pelo intermediário/.test(ret3[0]) && ret3[1] === '<b>sim</b><div class="cte-sub">intermediário</div>' && /Retido <b>sim, pelo intermediário<\/b>/.test(ret3[2])
          && (secNfse.match(/'tomador'/g) || []).length === 1 && (secNfse.match(/'intermediário'/g) || []).length === 1 && !/(pelo|sim, pelo) (tomador|intermediário)'/.test(secNfse),
          ret3[1]);

        /* Retenções: tpRetISSQN 3 (intermediário) é ISS retido; tpRetPisCofins 2 (não retidos) fica fora do total. */
        let rr = null;
        try { rr = ler(nfseXml({ num: 2005, munToma: '3509502', ret: '3', retPC: '2', vLiq: '9118.00' })); } catch (e) { rr = { erro: e.message }; }
        const kk = rr && !rr.erro ? vm.runInContext('nfseConta(' + JSON.stringify(rr) + ')', sb) : {};
        ok('tpRetISSQN=3 (intermediário) conta como ISS retido no total',
          kk.issRet === 197 && vm.runInContext("nfseIssRet({tpRetISSQN:'3'})&&!nfseIssRet({tpRetISSQN:'1'})&&!nfseIssRet({tpRetISSQN:'constructor'})", sb), JSON.stringify(kk));
        ok('tpRetPisCofins=2 (não retidos): PIS e COFINS ficam fora do total retido',
          rr && rr.Ret_PISCOFINS === '2' && kk.fed === 360 && kk.tot === 557, JSON.stringify(kk));

        /* CompNFe: a discriminação inteira e a herança da DPS (só no que o leiaute não tem). */
        const DISC = Array.from({ length: 8 }, (_, i) => 'Item ' + (i + 1) + ' do contrato de manutenção mensal').join('\n');
        const compXml = (comDps) => '<?xml version="1.0"?><CompNFe><NFe>' + tg('NumeroNFe', '9') + tg('CodigoVerificador', 'ABCD1234') + tg('DataEmissaoNFe', '2026-11-03T10:00:00')
          + tg('CodigoServicoMunicipal', '0107') + tg('ValorNFe', '500.00') + tg('Discriminacao', X(DISC))
          + tg('Prestador', tg('CnpjCpf', PREST) + tg('RazaoSocialNome', 'ALFA SERVICOS DE EXEMPLO LTDA')) + tg('Tomador', tg('CnpjCpf', TOMA) + tg('RazaoSocialNome', 'TOMADOR DE EXEMPLO LTDA'))
          + (comDps ? tg('DPS', tg('infDPS', tg('tpAmb', '1') + tg('nDPS', '77')
            + tg('toma', tg('end', tg('endNac', tg('cMun', '4106902'))))
            + tg('serv', tg('cServ', tg('cTribMun', '999') + tg('xDescServ', 'descrição da DPS')))
            + tg('valores', tg('trib', tg('tribMun', tg('tribISSQN', '1') + tg('tpRetISSQN', '2') + tg('pAliq', '3.00')))))) : '')
          + '</NFe></CompNFe>';
        let c1 = null, c2 = null;
        try { c1 = ler(compXml(false)); c2 = ler(compXml(true)); } catch (e) { c1 = { erro: e.message }; }
        ok('CompNFe gera Descricao_Completa (a discriminação inteira, com as quebras de linha)',
          c1 && c1.Formato === 'CompNFe' && c1.Descricao_Completa === DISC && DISC.length > 200 && c1.Discriminacao.length === 200 && !/\n/.test(c1.Discriminacao),
          c1 && (c1.erro || JSON.stringify(c1.Descricao_Completa).slice(0, 80)));
        ok('CompNFe com DPS herda os campos dela, sem passar por cima do que o próprio leiaute traz',
          c2 && c2.Numero_DPS === '77' && c2.Ambiente === '1' && c2.Trib_ISSQN === '1' && c2.Cod_Mun_Tomador === '4106902' && c2.tpRetISSQN === '2'
          && c2.Cod_Servico_Mun === '0107' && c2.Descricao_Completa === DISC && c1.Numero_DPS === '',
          c2 && (c2.erro || [c2.Numero_DPS, c2.Trib_ISSQN, c2.Cod_Mun_Tomador, c2.Cod_Servico_Mun].join('|')));

        /* formatoBr: o mesmo conjunto de textos da regex antiga, em tempo linear. */
        {
          const antigo = (v) => { if (v === null || v === undefined || v === '') return ''; const s = String(v).trim(); if (/^\d+\.?\d*$/.test(s)) return s.replace('.', ','); return s; };
          const casos = ['5', '5.', '5.25', '.5', '5..2', '  7.10 ', 'a1', '1e5', '-3.2', '', null, 0, 12.5, '0012.300'];
          const novo = vm.runInContext('(' + JSON.stringify(casos) + ').map(formatoBr)', sb);
          const dif = casos.filter((c, i) => novo[i] !== antigo(c));
          ok('formatoBr devolve o mesmo que a regex antiga em todos os formatos de número', dif.length === 0, dif.map((c) => JSON.stringify(c)).join(','));
          let ms = -1, r = '';
          try {
            sb.__longo = '1'.repeat(100000) + 'x';
            const t0 = Date.now();
            r = vm.runInContext('formatoBr(__longo)', sb, { timeout: 2000 });
            ms = Date.now() - t0;
          } catch (e) { r = e.message; }
          ok('formatoBr com 100 mil dígitos e uma letra no fim responde rápido (sem retrocesso quadrático)',
            ms >= 0 && ms < 200 && r.length === 100001, ms < 0 ? r : ms + ' ms');
          delete sb.__longo;
        }

        /* ── NFS-e na tela: abrir, trocar, fechar, teclado, aba e tela estreita ──────────
           O stub acima guarda o innerHTML como texto; os gestos precisam de árvore. Este
           DOM mínimo monta a árvore do HTML que o render escreve (tags, atributos, texto),
           com seletor de tag/classe/id/atributo, descendente e filho, closest, foco (que
           respeita inert e disabled) e eventos que sobem até o document. A marcação da aba
           é a do próprio index.html; o script é o mesmo do render. */
        {
          const VAZIAS = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'wbr', 'col', 'source']);
          const desEnt = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
          const attrEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
          const doc = { activeElement: null, _ls: {} };
          const compostos = new Map();
          const composto = (c) => {
            if (compostos.has(c)) return compostos.get(c);
            let r = null;
            if (!/:/.test(c)) {
              const m = /^([a-zA-Z][\w-]*|\*)?(.*)$/.exec(c);
              const partes = [...m[2].matchAll(/([#.])([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/g)];
              if (partes.map((p) => p[0]).join('') === m[2]) r = { tag: m[1] && m[1] !== '*' ? m[1].toUpperCase() : null, partes };
            }
            compostos.set(c, r);
            return r;
          };
          const casaComp = (el, c) => {
            const k = composto(c);
            if (!k || !el || !el.attrs) return false;
            if (k.tag && el.tagName !== k.tag) return false;
            for (const p of k.partes) {
              if (p[1] === '#' && el.attrs.id !== p[2]) return false;
              if (p[1] === '.' && !(el.attrs.class || '').split(/\s+/).includes(p[2])) return false;
              if (p[3] && (!Object.prototype.hasOwnProperty.call(el.attrs, p[3]) || (p[4] !== undefined && el.attrs[p[3]] !== p[4]))) return false;
            }
            return true;
          };
          const casaDe = (el, ps, i) => {
            if (!casaComp(el, ps[i])) return false;
            if (i === 0) return true;
            if (ps[i - 1] === '>') return casaDe(el.parentElement, ps, i - 2);
            for (let a = el.parentElement; a; a = a.parentElement) if (casaDe(a, ps, i - 2)) return true;
            return false;
          };
          const casa = (el, sel) => sel.split(',').some((s) => {
            const ps = s.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/);
            const seq = [];
            for (const p of ps) { if (p === '>') seq.push('>'); else { if (seq.length && seq[seq.length - 1] !== '>') seq.push(' '); seq.push(p); } }
            return casaDe(el, seq, seq.length - 1);
          });
          let raiz = null;
          class E {
            constructor(tag, attrs) { this.tagName = tag.toUpperCase(); this.attrs = attrs || {}; this.kids = []; this.parentNode = null; this._ls = {}; this.inert = false; this.style = {}; this._valor = null; this.escritas = 0; }
            get children() { return this.kids.filter((k) => k instanceof E); }
            get parentElement() { return this.parentNode instanceof E ? this.parentNode : null; }
            get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
            get nextElementSibling() { const p = this.parentNode; if (!p) return null; const c = p.children; return c[c.indexOf(this) + 1] || null; }
            get id() { return this.attrs.id || ''; }
            get className() { return this.attrs.class || ''; }
            get classList() {
              const el = this, lista = () => (el.attrs.class || '').split(/\s+/).filter(Boolean), grava = (l) => { el.attrs.class = l.join(' '); };
              return {
                contains: (c) => lista().includes(c),
                add: (...cs) => grava([...new Set(lista().concat(cs))]),
                remove: (...cs) => grava(lista().filter((x) => !cs.includes(x))),
                toggle: (c, f) => { const tem = lista().includes(c), on = f === undefined ? !tem : !!f; if (on && !tem) grava(lista().concat(c)); if (!on && tem) grava(lista().filter((x) => x !== c)); return on; },
              };
            }
            getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
            setAttribute(k, v) { this.attrs[k] = String(v); }
            removeAttribute(k) { delete this.attrs[k]; }
            hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
            get hidden() { return this.hasAttribute('hidden'); }
            set hidden(v) { if (v) this.attrs.hidden = ''; else delete this.attrs.hidden; }
            get disabled() { return this.hasAttribute('disabled'); }
            get value() { return this._valor != null ? this._valor : (this.attrs.value || ''); }
            set value(v) { this._valor = String(v); }
            get dataset() { const o = {}; for (const k of Object.keys(this.attrs)) if (k.startsWith('data-')) o[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = this.attrs[k]; return o; }
            get textContent() { return this.kids.map((k) => (k instanceof E ? k.textContent : desEnt(k.t))).join(''); }
            set textContent(v) { this.kids = [{ t: X(v) }]; }
            get innerHTML() { return this.kids.map(serial).join(''); }
            set innerHTML(h) { this.escritas++; if (doc.activeElement && doc.activeElement !== this && this.contains(doc.activeElement)) doc.activeElement = body; for (const k of this.kids) if (k instanceof E) k.parentNode = null; this.kids = []; monta(this, String(h)); }
            appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.kids.push(c); return c; }
            removeChild(c) { this.kids = this.kids.filter((k) => k !== c); c.parentNode = null; return c; }
            remove() { if (this.parentNode) this.parentNode.removeChild(this); }
            contains(o) { for (let a = o; a; a = a.parentNode) if (a === this) return true; return false; }
            get isConnected() { let a = this; while (a.parentNode) a = a.parentNode; return a === raiz; }
            addEventListener(t, f) { (this._ls[t] = this._ls[t] || []).push(f); }
            removeEventListener() {}
            focus() { for (let a = this; a; a = a.parentNode) if (a.inert) return; if (this.disabled || !this.isConnected) return; doc.activeElement = this; }
            blur() {}
            scrollIntoView() {}
            matches(sel) { return casa(this, sel); }
            closest(sel) { for (let a = this; a; a = a.parentElement) if (casa(a, sel)) return a; return null; }
            querySelectorAll(sel) { const out = []; const anda = (e) => { for (const c of e.children) { if (casa(c, sel)) out.push(c); anda(c); } }; anda(this); return out; }
            querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
          }
          const serial = (k) => {
            if (!(k instanceof E)) return k.t;
            const tag = k.tagName.toLowerCase(), at = Object.keys(k.attrs).map((a) => ' ' + a + (k.attrs[a] === '' && a !== 'value' ? '' : '="' + attrEsc(k.attrs[a]) + '"')).join('');
            return '<' + tag + at + '>' + (VAZIAS.has(tag) ? '' : k.kids.map(serial).join('') + '</' + tag + '>');
          };
          const monta = (pai, h) => {
            let cur = pai;
            for (const m of h.matchAll(/<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+/g)) {
              const tk = m[0];
              if (tk.startsWith('<!--')) continue;
              if (tk.startsWith('</')) {
                const tag = tk.slice(2, -1).trim().toUpperCase();
                for (let a = cur; a && a !== pai.parentNode; a = a.parentNode) if (a.tagName === tag) { cur = a.parentNode; break; }
                continue;
              }
              if (tk.startsWith('<')) {
                const corpo = tk.slice(1, tk.endsWith('/>') ? -2 : -1), tag = corpo.split(/[\s/]/)[0], attrs = {};
                for (const a of corpo.slice(tag.length).matchAll(/([^\s=/]+)(?:\s*=\s*"([^"]*)")?/g)) attrs[a[1]] = a[2] === undefined ? '' : desEnt(a[2]);
                const e = new E(tag, attrs);
                cur.appendChild(e);
                if (!VAZIAS.has(tag.toLowerCase()) && !tk.endsWith('/>')) cur = e;
                continue;
              }
              cur.kids.push({ t: tk });
            }
          };
          raiz = new E('html');
          const body = new E('body');
          raiz.appendChild(body);
          const soltos = new Map(), limbo = new E('div');
          const solto = (id) => { if (!soltos.has(id)) { const e = new E('div', { id }); limbo.appendChild(e); soltos.set(id, e); } return soltos.get(id); };
          Object.assign(doc, {
            documentElement: raiz, body,
            getElementById: (id) => raiz.querySelector('#' + id) || solto(id),
            querySelector: (s) => raiz.querySelector(s), querySelectorAll: (s) => raiz.querySelectorAll(s),
            createElement: (t) => new E(t), createTextNode: (t) => ({ t: X(t) }),
            addEventListener(t, f) { (doc._ls[t] = doc._ls[t] || []).push(f); }, removeEventListener() {},
          });
          /* Evento que sobe do alvo até o document; o clique num elemento inerte não acontece. */
          const fire = (alvo, tipo, extra) => {
            if (!alvo) return null;
            if (tipo === 'click' && !(extra && extra.programatico)) for (let a = alvo; a; a = a.parentNode) if (a.inert) return null;
            const ev = Object.assign({ type: tipo, target: alvo, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.parou = true; } }, extra || {});
            for (let a = alvo; a && !ev.parou; a = a.parentNode) for (const f of (a._ls[tipo] || [])) f.call(a, ev);
            if (!ev.parou) for (const f of (doc._ls[tipo] || [])) f(ev);
            return ev;
          };
          const tecla = (key) => fire(doc.activeElement || body, 'keydown', { key });
          const iT = html.indexOf('<div class="tab-content" id="tab-nfse">'), fT = html.indexOf('<div id="nfse-list"></div>', iT);
          const iC = html.indexOf('<div class="tab-content" id="tab-cte">'), fC = html.indexOf('<div id="cte-list"></div>', iC);
          body.innerHTML = '<nav id="sidebar"><button class="nav-btn" data-tab="importar"><span>Importar XMLs</span></button><button class="nav-btn active" data-tab="nfse"><span>NFS-e</span></button>'
            + '<button class="nav-btn" data-tab="cte"><span>CT-e</span></button></nav>'
            + '<div id="topbar"><span class="c-cur" id="crumb-cur"></span></div>'
            + '<div class="tab-content" id="tab-importar"></div>'
            + html.slice(iT, fT).replace('class="tab-content"', 'class="tab-content active"') + '<div id="nfse-list"></div></div>'
            + html.slice(iC, fC) + '<div id="cte-list"></div></div>';
          const mql = { matches: false, ls: [], addEventListener(t, f) { if (t === 'change') this.ls.push(f); }, addListener(f) { this.ls.push(f); } };
          const largura = (estreita) => { mql.matches = estreita; mql.ls.forEach((f) => f({ matches: estreita })); };
          const janela = {
            matchMedia: (q) => (/max-width:900px/.test(q) ? mql : { matches: false, addEventListener() {}, addListener() {} }),
            addEventListener() {}, removeEventListener() {}, GCON_CDN_TESSERACT: 0, GCON: {},
          };
          const sbT = {
            document: doc, window: janela, DOMParser: MiniDOMParser,
            localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
            getComputedStyle: () => ({ getPropertyValue: () => '' }),
            setTimeout, clearTimeout, Date, Math, JSON, console,
          };
          let erroT = '';
          try { vm.createContext(sbT); vm.runInContext(scriptRender, sbT, { filename: 'index.html#tela-nfse' }); vm.runInContext(';this.__DB=DB;', sbT); } catch (e) { erroT = e.message; }
          ok('NFS-e na tela: o script sobe sobre o DOM mínimo com a marcação real da aba', erroT === '' && !!doc.querySelector('#tab-nfse .filter-bar #filtro-nfse') && !!doc.querySelector('#tab-cte #cte-list'), erroT);
          if (!erroT) try {
            const R = (c) => vm.runInContext(c, sbT);
            const lista = doc.getElementById('nfse-list');
            const tr = (i) => lista.querySelector('tr[data-i="' + i + '"]');
            const aberto = () => R('NFSE_UI.aberto');
            const painel = () => lista.querySelector('.nfse-painel');
            const sel = () => lista.querySelectorAll('tr.sel').map((x) => x.dataset.i + (x.getAttribute('aria-current') === 'true' ? '*' : '')).join(',');
            /* Quatro notas; a 2ª (índice 1) é de outro prestador, para o filtro. */
            const notas = [0, 1, 2, 3].map((i) => Object.assign({}, d, { Numero_NFSe: String(3001 + i), Chave_NFSe: 'K' + i, Chave_Substituida: '', CNPJ_Prestador: i === 1 ? TOMA : PREST }));
            R('__DB.nfse=' + JSON.stringify(notas) + ';NFSE_UI.aberto=-1;NFSE_UI.conf=false;renderNFSe();');
            const tabela = lista.querySelector('table.nfse-tab');
            const box = doc.getElementById('nfse-alertas');
            R('var __nAl=0,__alOrig=nfseAlertas;nfseAlertas=function(l){__nAl++;return __alOrig(l);};');
            const escritasBox = box.escritas;

            /* Enter e Espaço na linha abrem com o foco no Fechar; a marca da linha acompanha. */
            tr(0).focus(); const evE = tecla('Enter');
            const r1 = { ab: aberto(), pn: !!painel(), foco: doc.activeElement && doc.activeElement.className, sel: sel(), prev: evE.defaultPrevented };
            ok('NFS-e na tela: Enter na linha abre o painel com o foco no Fechar e marca a linha (sel + aria-current)',
              r1.ab === 0 && r1.pn && r1.foco === 'nfse-fechar' && r1.sel === '0*' && r1.prev, JSON.stringify(r1));
            tecla('Escape');
            tr(2).focus(); tecla(' ');
            ok('NFS-e na tela: Espaço na linha também abre', aberto() === 2 && sel() === '2*' && !!painel(), 'aberto=' + aberto());

            /* Trocar de nota não redesenha a tabela: a mesma tabela, só a marca anda. */
            tr(2).focus(); tecla('ArrowUp');
            ok('NFS-e na tela: ↑ com o foco na lista troca de nota, move a marca e o foco para a linha nova, sem redesenhar a tabela',
              aberto() === 1 && sel() === '1*' && lista.querySelector('table.nfse-tab') === tabela && doc.activeElement === tr(1), 'aberto=' + aberto() + ' sel=' + sel());
            fire(lista.querySelector('.nfse-ir[data-lado="prx"]'), 'click');
            ok('NFS-e na tela: "próxima ▸" troca de nota sem redesenhar a tabela e o foco fica no próprio botão',
              aberto() === 2 && sel() === '2*' && lista.querySelector('table.nfse-tab') === tabela && doc.activeElement && doc.activeElement.dataset.lado === 'prx', 'aberto=' + aberto());

            /* O corpo do painel rola pelo teclado: recebe foco e as setas não trocam de nota. */
            const corpo = lista.querySelector('.nfse-painel .cte-painel-corpo');
            corpo.focus(); const evC = tecla('ArrowDown');
            ok('NFS-e na tela: o corpo do painel tem foco (tabindex, rótulo) e ↑ ↓ nele rolam em vez de trocar de nota',
              corpo.getAttribute('tabindex') === '0' && corpo.getAttribute('aria-label') === 'Detalhe da NFS-e' && doc.activeElement === corpo
              && aberto() === 2 && !evC.defaultPrevented, 'aberto=' + aberto() + ' prevented=' + evC.defaultPrevented);

            /* Esc fecha e devolve o foco à linha. */
            lista.querySelector('.nfse-fechar').focus(); const evX = tecla('Escape');
            ok('NFS-e na tela: Esc fecha o painel, tira a marca e devolve o foco à linha',
              aberto() === -1 && !painel() && sel() === '' && doc.activeElement === tr(2) && evX.defaultPrevented, 'aberto=' + aberto() + ' sel=' + sel());

            /* "◂ anterior" e "próxima ▸": o foco fica no botão do mesmo lado, e no Fechar quando o
               botão fica desabilitado na ponta (o foco pedido a um botão desabilitado se perde). */
            {
              const irN = (lado) => lista.querySelector('.nfse-painel .nfse-ir[data-lado="' + lado + '"]');
              const ladoN = (b) => (b ? (b.disabled ? 'off' : b.getAttribute('data-ir')) : 'sem');
              const passoN = () => [aberto(), ladoN(irN('ant')), ladoN(irN('prx')),
                doc.activeElement === lista.querySelector('.nfse-painel .nfse-fechar') ? 'fechar' : doc.activeElement === irN('ant') ? 'ant'
                  : doc.activeElement === irN('prx') ? 'prx' : doc.activeElement === body ? 'body' : 'outro'].join('/');
              fire(tr(1), 'click');
              const passosN = [];
              for (const l of ['ant', 'prx', 'prx', 'prx', 'ant']) { fire(irN(l), 'click'); passosN.push(passoN()); }
              const pN = passosN.join(' ');
              ok('NFS-e: "◂ anterior" e "próxima ▸" passam de nota, desabilitam nas pontas e o foco fica no botão do mesmo lado (no Fechar, quando ele desabilita)',
                pN === '0/off/1/fechar 1/0/2/prx 2/1/3/prx 3/2/off/fechar 2/1/3/ant', pN);
              /* Clique com o mouse no campo de busca com o painel aberto: o clique fora fecha, mas
                 não puxa o foco para a linha (o que se digita em seguida iria para a lista). */
              const campoN = doc.getElementById('filtro-nfse');
              campoN.focus(); fire(campoN, 'click');
              ok('NFS-e na tela larga: clicar no campo de busca com o painel aberto fecha o painel e o foco fica no campo',
                aberto() === -1 && !painel() && sel() === '' && doc.activeElement === campoN,
                'aberto=' + aberto() + ' foco=' + (doc.activeElement ? doc.activeElement.tagName + '#' + doc.activeElement.id : 'nenhum'));
            }

            /* Filtro: ↑ ↓ e próxima andam só pelo que está na tela. */
            doc.getElementById('filtro-nfse-cnpj').value = PREST; R('renderNFSe()');
            const tabF = lista.querySelector('table.nfse-tab');
            fire(tr(0), 'click');
            const prx0 = lista.querySelector('.nfse-ir[data-lado="prx"]').getAttribute('data-ir');
            lista.querySelector('.nfse-fechar').focus(); tecla('ArrowDown');
            const depoisSeta = aberto();
            fire(lista.querySelector('.nfse-ir[data-lado="prx"]'), 'click');
            const prxB = lista.querySelector('.nfse-ir[data-lado="prx"]'), depoisPrx = aberto(), prxFim = !!prxB && prxB.disabled;
            lista.querySelector('.nfse-fechar').focus(); tecla('ArrowUp'); tecla('ArrowUp');
            ok('NFS-e na tela: com filtro, ↑ ↓ e "próxima" pulam a nota filtrada (0 → 2 → 3, e voltam 3 → 2 → 0)',
              !tr(1) && prx0 === '2' && depoisSeta === 2 && depoisPrx === 3 && prxFim && aberto() === 0 && lista.querySelector('table.nfse-tab') === tabF,
              [prx0, depoisSeta, depoisPrx, prxFim, aberto()].join(','));

            /* A conferência não é refeita ao filtrar/abrir/trocar, e o quadro role=status não é reescrito. */
            ok('NFS-e na tela: abrir, trocar e filtrar não refazem a conferência nem reescrevem o quadro "Para conferir"',
              R('__nAl') === 0 && box.escritas === escritasBox, 'nfseAlertas chamada ' + R('__nAl') + 'x, quadro reescrito ' + (box.escritas - escritasBox) + 'x');
            R('__DB.nfse=__DB.nfse.slice(0,3);renderNFSe();');
            ok('NFS-e na tela: a conferência é refeita quando DB.nfse muda', R('__nAl') === 1, 'chamadas=' + R('__nAl'));
            R('nfseAlertas=__alOrig;');
            doc.getElementById('filtro-nfse-cnpj').value = '';
            R('__DB.nfse=' + JSON.stringify(notas) + ';NFSE_UI.aberto=-1;renderNFSe();');

            /* Trocar de aba fecha o painel; voltar não o reabre. */
            fire(tr(1), 'click');
            const abriu = aberto();
            fire(doc.querySelector('.nav-btn[data-tab="importar"]'), 'click');
            const fora = { ab: aberto(), pn: !!painel() };
            fire(doc.querySelector('.nav-btn[data-tab="nfse"]'), 'click');
            ok('NFS-e na tela: trocar de aba fecha o painel, e voltar à aba não o reabre',
              abriu === 1 && fora.ab === -1 && !fora.pn && aberto() === -1 && !painel(), JSON.stringify(fora));

            /* Abaixo de 900px: o que fica por baixo do painel é inerte enquanto ele está aberto. */
            const inertes = () => [doc.querySelector('#tab-nfse .filter-bar'), doc.getElementById('nfse-conf'), doc.getElementById('nfse-alertas'), lista.querySelector('.cte-tab-wrap')].map((e) => !!(e && e.inert));
            const menu = () => [doc.querySelector('nav#sidebar'), doc.querySelector('#topbar')].map((e) => !!(e && e.inert));
            largura(true);
            fire(tr(2), 'click');
            const est = { in: inertes(), menu: menu(), modal: painel() && painel().getAttribute('aria-modal'), foco: !!painel() && doc.activeElement === painel().querySelector('.nfse-fechar') };
            ok('NFS-e na tela estreita: com o painel aberto, filtros, "Conferir valores", quadro e tabela ficam inertes; o painel é modal e recebe o foco',
              est.in.every(Boolean) && est.modal === 'true' && est.foco, JSON.stringify(est));
            const cliqueInerte = fire(tr(0), 'click');
            ok('NFS-e na tela estreita: a lista inerte não responde ao clique', cliqueInerte === null && aberto() === 2, 'aberto=' + aberto());
            lista.querySelector('.nfse-fechar').focus(); tecla('ArrowDown');
            ok('NFS-e na tela estreita: ↓ troca de nota e mantém o foco no painel (a lista está inerte)',
              aberto() === 3 && inertes().every(Boolean) && !!painel() && doc.activeElement === painel().querySelector('.nfse-fechar'), 'aberto=' + aberto());
            largura(false);
            const larga = { in: inertes(), modal: painel() && painel().getAttribute('aria-modal') };
            ok('NFS-e na tela: ao alargar a janela com o painel aberto, o inert e o aria-modal saem',
              larga.in.every((x) => !x) && larga.modal === null && !!painel(), JSON.stringify(larga));
            const menuLargo = menu();
            largura(true);
            tr(3).focus();
            const reaplica = inertes().every(Boolean), menuReaplica = menu();
            ok('NFS-e na tela estreita: alargar e estreitar de novo com a NFS-e aberta devolve e reaplica o inert no menu e na barra do topo (o painel do CT-e, fechado, não o desfaz)',
              menuLargo.every((x) => !x) && menuReaplica.every(Boolean), JSON.stringify({ menuLargo, menuReaplica }));
            lista.querySelector('.nfse-fechar').focus(); tecla('Escape');
            const menuFechado = menu();
            ok('NFS-e na tela estreita: estreitar de novo reaplica o inert, e fechar o painel o remove (foco volta à linha)',
              reaplica && inertes().every((x) => !x) && aberto() === -1 && doc.activeElement === tr(3), 'reaplica=' + reaplica + ' depois=' + JSON.stringify(inertes()));
            {
              ok('NFS-e na tela estreita: o menu lateral e a barra do topo, que o painel também cobre, entram no inert e saem ao fechar',
                est.menu.every(Boolean) && menuFechado.every((x) => !x), JSON.stringify({ aberto: est.menu, fechado: menuFechado }));
              ok('NFS-e: no CompNFe o painel chama o identificador de "Código de verificação", não de chave de acesso',
                /n\.Formato==='CompNFe'\?'Código de verificação':'Chave de acesso'/.test(html));
            }
            largura(false);

            /* Painéis laterais: a consulta de largura e o "estreito" têm nome neutro (servem à
               NFS-e e ao CT-e) e moram num bloco só, antes das duas seções. */
            {
              const iMq = html.indexOf('const PAINEL_MQ='), iEst = html.indexOf('function painelEstreito('), iCob = html.indexOf('function painelCobreTela(');
              const iNfse = html.indexOf('// ═══ RENDER NFS-e'), iCte = html.indexOf('// ═══ CT-e (modelo 57)');
              const bloco = iMq >= 0 && iNfse > iMq ? html.slice(html.lastIndexOf('/*', iMq), iNfse) : '';
              const exec = R('typeof PAINEL_MQ!=="undefined"&&typeof painelEstreito==="function"&&typeof painelCobreTela==="function"?[PAINEL_MQ,painelEstreito()]:null');
              const exec2 = (largura(true), R('typeof painelEstreito==="function"?painelEstreito():null'));
              largura(false);
              ok('Painéis laterais: PAINEL_MQ, painelEstreito e painelCobreTela juntos num bloco antes da NFS-e e do CT-e, sem o nome antigo, e painelEstreito segue a largura',
                !!exec && exec[0] === mql && exec[1] === false && exec2 === true
                && iMq < iEst && iEst < iCob && iCob < iNfse && iNfse < iCte && /^\/\* Painéis laterais/.test(bloco)
                && (bloco.match(/\bfunction /g) || []).length === 2 && !/NFSE_MQ|nfseEstreito/.test(html),
                JSON.stringify({ iMq, iEst, iCob, iNfse, exec2 }));
            }

            /* Estreitar a janela com o foco fora da aba (menu lateral ou body): o foco não pode
               ficar no que acabou de ficar inerte, vai ao Fechar do painel. */
            {
              fire(tr(1), 'click');
              const abriuF = aberto();
              doc.querySelector('.nav-btn[data-tab="cte"]').focus();
              const noMenu = doc.activeElement === doc.querySelector('.nav-btn[data-tab="cte"]');
              largura(true);
              const doMenu = !!painel() && doc.activeElement === painel().querySelector('.nfse-fechar');
              largura(false);
              doc.activeElement = body;
              largura(true);
              const doBody = !!painel() && doc.activeElement === painel().querySelector('.nfse-fechar');
              ok('NFS-e: estreitar a janela com o foco no menu lateral ou no body leva o foco ao Fechar do painel (não fica no que ficou inerte)',
                abriuF === 1 && noMenu && doMenu && doBody, JSON.stringify({ abriuF, noMenu, doMenu, doBody }));
              lista.querySelector('.nfse-fechar').focus(); tecla('Escape');
              largura(false);
            }
            R('__DB.nfse=[];NFSE_UI.aberto=-1;renderNFSe();');

            /* ── CT-e na tela: a mesma regra do painel da NFS-e na tela estreita, sobre a
               marcação real de #tab-cte. Três CT-e; o clique na linha abre, Esc fecha. */
            const listaC = doc.getElementById('cte-list');
            const trC = (i) => listaC.querySelector('tr[data-i="' + i + '"]');
            const abertoC = () => R('CTE_UI.aberto');
            const painelC = () => listaC.querySelector('.cte-painel');
            const fecharC = () => listaC.querySelector('.cte-painel .cte-fechar');
            const modalC = () => (painelC() ? painelC().getAttribute('aria-modal') : 'sem painel');
            /* Menu lateral, barra do topo, busca, quadro "Para conferir" e tabela (a tabela some quando a lista esvazia). */
            const inertesC = () => [doc.getElementById('sidebar'), doc.getElementById('topbar'), doc.querySelector('#tab-cte .filter-bar'), doc.getElementById('cte-alertas'), listaC.querySelector('.cte-tab-wrap')]
              .map((e) => (e ? !!e.inert : null));
            const todosC = (v) => inertesC().every((x) => x === v || (x === null && !v));
            const ctes = [0, 1, 2].map((i) => ({
              Numero: String(501 + i), Serie: '1', Modelo: '57', Chave_CTe: 'C' + i, Data_Emissao: '2026-11-0' + (i + 1) + 'T10:00:00-03:00',
              Mun_Ini: 'Origem', UF_Ini: 'SP', Mun_Fim: 'Destino', UF_Fim: 'RJ', proPred: 'Veículo', vTPrest: '100', vCarga: '1000', ICMS_CST: '00',
              docs: [], veic: [], comp: [], infQ: [], dup: [], fat: [], docAnt: [], occ: [], obsCont: [], obsFisco: [],
            }));
            R('__DB.cte=' + JSON.stringify(ctes) + ';__DB.nfe=[];CTE_UI.aberto=-1;');
            doc.getElementById('filtro-cte').value = '';
            fire(doc.querySelector('.nav-btn[data-tab="cte"]'), 'click');
            ok('CT-e na tela: a aba sobe com a marcação real e desenha as três linhas',
              !!trC(0) && !!trC(2) && doc.getElementById('tab-cte').classList.contains('active') && !!doc.querySelector('#tab-cte .filter-bar #filtro-cte'),
              'linhas=' + listaC.querySelectorAll('tr[data-i]').length);

            /* O quadro "Para conferir" do CT-e é role=status: abrir, trocar de CT-e, fechar e
               redesenhar sem mudança não o reescrevem (o leitor de tela repetiria tudo). */
            {
              const avC = doc.getElementById('cte-alertas'), escC = avC.escritas;
              fire(trC(0), 'click'); fecharC().focus(); tecla('ArrowDown'); tecla('Escape'); R('renderCTe()');
              const semMudar = { n: avC.escritas - escC, ab: abertoC(), tem: /Para conferir/.test(avC.innerHTML), hid: avC.hidden };
              R('__DB.cte=__DB.cte.slice(0,2);renderCTe()');
              const mudou = avC.escritas - escC;
              R('__DB.cte=' + JSON.stringify(ctes) + ';CTE_UI.aberto=-1;renderCTe()');
              ok('CT-e: abrir, trocar, fechar e redesenhar sem mudança não reescrevem o quadro "Para conferir" (role=status); mudar a lista reescreve',
                semMudar.n === 0 && semMudar.ab === -1 && semMudar.tem && semMudar.hid === false && mudou === 1, JSON.stringify({ semMudar, mudou }));
            }

            /* Abrir e trocar de CT-e não redesenham a tabela (a linha clicada continua a mesma,
               com o foco nela); "◂ anterior" e "próximo ▸" andam pela lista à mostra, o foco
               fica no botão do mesmo lado e cai no Fechar quando ele fica desabilitado na ponta. */
            {
              const selC = () => listaC.querySelectorAll('tr.sel').map((x) => x.dataset.i + (x.getAttribute('aria-current') === 'true' ? '*' : '')).join(',');
              const irC = (lado) => listaC.querySelector('.cte-painel .cte-ir[data-lado="' + lado + '"]');
              const estado = () => ({ ab: abertoC(), ant: irC('ant') ? (irC('ant').disabled ? 'off' : irC('ant').getAttribute('data-ir')) : 'sem', prx: irC('prx') ? (irC('prx').disabled ? 'off' : irC('prx').getAttribute('data-ir')) : 'sem',
                foco: doc.activeElement === fecharC() ? 'fechar' : doc.activeElement === irC('ant') ? 'ant' : doc.activeElement === irC('prx') ? 'prx' : doc.activeElement === body ? 'body' : 'outro' });
              const tabC = listaC.querySelector('table.cte-tab');
              trC(1).focus(); fire(trC(1), 'click');
              const clique = { ab: abertoC(), mesma: listaC.querySelector('table.cte-tab') === tabC, linha: doc.activeElement === trC(1), body: doc.activeElement === body, sel: selC() };
              ok('CT-e na tela larga: o clique na linha abre o painel sem redesenhar a tabela (a mesma), marca a linha (sel + aria-current) e o foco fica na linha, não cai no body',
                clique.ab === 1 && clique.mesma && clique.linha && !clique.body && clique.sel === '1*', JSON.stringify(clique));
              const bts = painelC() ? painelC().querySelectorAll('.cte-painel-cab .cte-ir') : [];
              const rot = bts.map((b) => [b.textContent, b.getAttribute('aria-label'), b.getAttribute('type')]);
              ok('CT-e: o cabeçalho do painel tem "◂ anterior" e "próximo ▸", e o nome acessível de cada um contém o texto visível ("CT-e anterior" / "Próximo CT-e")',
                rot.length === 2 && rot[0][0] === '◂ anterior' && rot[0][1] === 'CT-e anterior' && rot[1][0] === 'próximo ▸' && rot[1][1] === 'Próximo CT-e'
                && rot.every(([t, a, ty]) => ty === 'button' && a.toLowerCase().includes(t.replace(/[◂▸]/g, '').trim().toLowerCase())), JSON.stringify(rot));
              ok('CT-e: os botões do painel usam a regra de botão do cabeçalho (área de toque de 44px) e a de desabilitado da NFS-e, sem cor nova',
                /(^|[,}\n])[^{}]*\.cte-ir[^{}]*\{[^}]*min-height:44px/.test(html) && /\.cte-ir:disabled[^{]*\{color:var\(--text3\)/.test(html));
              const passos = [];
              fire(irC('prx'), 'click'); passos.push(estado());
              fire(irC('ant'), 'click'); passos.push(estado());
              fire(irC('ant'), 'click'); passos.push(estado());
              fire(irC('prx'), 'click'); passos.push(estado());
              const p = passos.map((s) => [s.ab, s.ant, s.prx, s.foco].join('/')).join(' ');
              ok('CT-e: "próximo ▸" e "◂ anterior" passam de CT-e, desabilitam nas pontas e o foco fica no botão do mesmo lado (no Fechar, quando ele desabilita)',
                p === '2/1/off/fechar 1/0/2/ant 0/off/1/fechar 1/0/2/prx', p);
              ok('CT-e: trocar pelos botões não redesenha a tabela e a marca anda com o painel',
                listaC.querySelector('table.cte-tab') === tabC && selC() === '1*', 'sel=' + selC());
              fecharC().focus(); const evXL = tecla('Escape');
              ok('CT-e na tela larga: Esc fecha o painel, tira a marca, mantém a tabela e devolve o foco à linha',
                abertoC() === -1 && !painelC() && selC() === '' && evXL.defaultPrevented && listaC.querySelector('table.cte-tab') === tabC && doc.activeElement === trC(1),
                'aberto=' + abertoC() + ' sel=' + selC());
              /* ↑ ↓ com o foco numa linha da lista (tela larga): troca de CT-e e o foco anda para a
                 linha nova, sem redesenhar a tabela; com o foco no Fechar, o foco fica no painel. */
              const ondeC = () => (doc.activeElement === fecharC() ? 'fechar' : doc.activeElement && doc.activeElement.tagName === 'TR' && listaC.contains(doc.activeElement)
                ? 'tr' + doc.activeElement.dataset.i : doc.activeElement === body ? 'body' : 'outro');
              trC(1).focus(); fire(trC(1), 'click');
              const setas = [];
              tecla('ArrowDown'); setas.push([abertoC(), selC(), ondeC()].join('/'));
              tecla('ArrowUp'); setas.push([abertoC(), selC(), ondeC()].join('/'));
              fecharC().focus(); tecla('ArrowUp'); setas.push([abertoC(), selC(), ondeC()].join('/'));
              const sC = setas.join(' ');
              ok('CT-e na tela larga: ↑ ↓ com o foco na linha trocam de CT-e e levam o foco à linha nova (sem redesenhar a tabela); com o foco no Fechar, ele fica no Fechar',
                sC === '2/2*/tr2 1/1*/tr1 0/0*/fechar' && listaC.querySelector('table.cte-tab') === tabC, sC);
              /* A situação vem do XML ("cStat - xMotivo") e pode ser longa: no cabeçalho do painel o
                 white-space que vale (cascata das regras do <style> sobre o elemento desenhado) é
                 normal; na tabela a pill continua numa linha só. */
              {
                const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
                const regras = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, o) => ({ sels: m[1].trim().split(','), decl: m[2], o }));
                const espec = (sl) => (sl.match(/#[\w-]+/g) || []).length * 100 + (sl.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length * 10
                  + (sl.replace(/[.#:][\w-]+|\[[^\]]*\]/g, ' ').match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) || []).length;
                const espaco = (el) => {
                  let m0 = null;
                  for (const r of regras) {
                    const m = /(?:^|;)\s*white-space\s*:\s*([^;!]+)/.exec(r.decl); if (!m) continue;
                    for (const sl of r.sels) {
                      let bate = false; try { bate = el.matches(sl.trim()); } catch (e) { bate = false; }
                      if (!bate) continue;
                      const e = espec(sl.trim());
                      if (!m0 || e > m0.e || (e === m0.e && r.o >= m0.o)) m0 = { e, o: r.o, v: m[1].trim() };
                    }
                  }
                  return m0 ? m0.v : 'normal';
                };
                const pillCab = painelC() && painelC().querySelector('.cte-painel-cab .cte-pill');
                const pillTab = trC(0) && trC(0).querySelector('.cte-pill');
                const ws = { cab: pillCab ? espaco(pillCab) : 'sem pill', tab: pillTab ? espaco(pillTab) : 'sem pill' };
                ok('CT-e: a situação no cabeçalho do painel quebra linha (o texto longo do XML não estoura o cabeçalho em 375px nem empurra o Fechar); na tabela continua numa linha',
                  ws.cab === 'normal' && ws.tab === 'nowrap', JSON.stringify(ws));
              }
              /* Clique com o mouse no campo de busca com o painel aberto: fecha sem puxar o foco. */
              const campoC = doc.getElementById('filtro-cte');
              campoC.focus(); fire(campoC, 'click');
              ok('CT-e na tela larga: clicar no campo de busca com o painel aberto fecha o painel e o foco fica no campo',
                abertoC() === -1 && !painelC() && selC() === '' && doc.activeElement === campoC,
                'aberto=' + abertoC() + ' foco=' + (doc.activeElement ? doc.activeElement.tagName + '#' + doc.activeElement.id : 'nenhum'));
              /* As NF-e carregadas saem de um lugar só (lista e painel contam pelo mesmo conjunto). */
              {
                R('__DB.nfe=[{Chave_NFe:"N1"},{Chave_NFe:""},{Chave_NFe:"N2"}]');
                const carr = R('typeof cteCarregadas==="function"?[...cteCarregadas()].join(","):"sem"');
                R('__DB.nfe=[]');
                const secC = html.slice(html.indexOf('// ═══ CT-e (modelo 57)'), html.indexOf('// ═══ DASHBOARD'));
                const montagens = (secC.match(/new Set\(DB\.nfe\b/g) || []).length, usos = (secC.match(/cteCarregadas\(\)/g) || []).length;
                ok('CT-e: o conjunto de NF-e carregadas é montado só em cteCarregadas(), usado pela lista e pelo painel',
                  carr === 'N1,N2' && montagens === 1 && usos === 3, JSON.stringify({ carr, montagens, usos }));
              }
              /* Com a busca, os botões pulam o CT-e que ficou de fora (o 2º não tem "veículo"). */
              const ctesB = [0, 1, 2, 3].map((i) => Object.assign({}, ctes[0], { Numero: String(601 + i), Chave_CTe: 'B' + i, proPred: i === 1 ? 'Moto' : 'Veículo' }));
              R('__DB.cte=' + JSON.stringify(ctesB) + ';CTE_UI.aberto=-1;');
              doc.getElementById('filtro-cte').value = 'veículo'; R('renderCTe()');
              fire(trC(0), 'click');
              const busca = [estado()];
              fire(irC('prx'), 'click'); busca.push(estado());
              fire(irC('prx'), 'click'); busca.push(estado());
              fire(irC('ant'), 'click'); busca.push(estado());
              const b = busca.map((s) => [s.ab, s.ant, s.prx].join('/')).join(' ');
              ok('CT-e com busca: os botões andam só pelo que está na tela (0 → 2 → 3 e volta para 2), desabilitados na primeira e na última à mostra',
                !trC(1) && b === '0/off/2 2/0/3 3/2/off 2/0/3', b);
              /* Redesenho com o painel aberto (a busca mudou e o CT-e continua à mostra): a
                 marca e os vizinhos saem do render inteiro iguais aos do troca-painel. */
              R('renderCTe()');
              const re = estado();
              ok('CT-e com busca: redesenhar com o painel aberto mantém a marca (sel + aria-current) e os vizinhos da lista à mostra nos botões',
                re.ab === 2 && re.ant === '0' && re.prx === '3' && selC() === '2*', JSON.stringify(re) + ' sel=' + selC());
              fecharC().focus(); tecla('Escape');
              doc.getElementById('filtro-cte').value = '';
              R('__DB.cte=' + JSON.stringify(ctes) + ';CTE_UI.aberto=-1;renderCTe()');
            }

            /* Tela larga: o painel abre ao lado da lista e nada fica inerte. */
            fire(trC(1), 'click');
            const largaC = { ab: abertoC(), in: inertesC(), modal: modalC() };
            ok('CT-e na tela larga: o painel aberto não deixa nada inerte nem se declara modal',
              largaC.ab === 1 && todosC(false) && largaC.modal === null, JSON.stringify(largaC));
            fecharC().focus(); tecla('Escape');

            /* Tela estreita: o clique abre, tudo por baixo fica inerte e o foco vai ao Fechar. */
            largura(true);
            fire(trC(1), 'click');
            const estC = { ab: abertoC(), in: inertesC(), modal: modalC() };
            ok('CT-e na tela estreita: com o painel aberto, menu lateral, barra do topo, busca, quadro e tabela ficam inertes e o painel é modal',
              estC.ab === 1 && todosC(true) && estC.modal === 'true', JSON.stringify(estC));
            ok('CT-e na tela estreita: o clique na linha leva o foco ao Fechar do painel',
              !!fecharC() && doc.activeElement === fecharC(), 'foco=' + (doc.activeElement ? doc.activeElement.tagName + '.' + doc.activeElement.className : 'nenhum'));

            /* ↑ ↓ com o foco no corpo do painel rolam o texto; no Fechar, passam de CT-e. */
            const corpoC = listaC.querySelector('.cte-painel .cte-painel-corpo');
            corpoC.focus();
            const evCC = tecla('ArrowDown');
            const noCorpo = { ab: abertoC(), prev: evCC.defaultPrevented, foco: doc.activeElement === corpoC };
            fecharC().focus(); tecla('ArrowDown');
            ok('CT-e na tela: ↑ ↓ com o foco no corpo do painel (focável e rotulado) não trocam de CT-e; no Fechar, trocam',
              corpoC.getAttribute('tabindex') === '0' && corpoC.getAttribute('aria-label') === 'Detalhe do CT-e' && noCorpo.foco
              && noCorpo.ab === 1 && !noCorpo.prev && abertoC() === 2 && todosC(true) && doc.activeElement === fecharC(),
              JSON.stringify(noCorpo) + ' depois=' + abertoC());
            /* No estreito a lista está inerte: mesmo com o foco ainda numa linha, a seta leva ao Fechar. */
            doc.activeElement = trC(2); tecla('ArrowUp');
            const estSeta = { ab: abertoC(), fechar: doc.activeElement === fecharC() };
            fecharC().focus(); tecla('ArrowDown');
            ok('CT-e na tela estreita: ↑ ↓ com o foco numa linha levam o foco ao Fechar do painel (a lista está inerte)',
              estSeta.ab === 1 && estSeta.fechar && abertoC() === 2, JSON.stringify(estSeta));

            /* Esc fecha, tira o inert e devolve o foco à linha. */
            fecharC().focus();
            const evXC = tecla('Escape');
            ok('CT-e na tela estreita: Esc fecha o painel, tira o inert e devolve o foco à linha',
              abertoC() === -1 && !painelC() && evXC.defaultPrevented && todosC(false) && doc.activeElement === trC(2),
              'aberto=' + abertoC() + ' in=' + JSON.stringify(inertesC()));

            /* Alargar com o painel aberto devolve; estreitar reaplica e leva ao painel o foco que estava na lista. */
            fire(trC(0), 'click');
            largura(false);
            const largouC = { ab: abertoC(), in: inertesC(), modal: modalC() };
            trC(0).focus();
            largura(true);
            const estreitouC = { in: inertesC(), modal: modalC(), foco: doc.activeElement === fecharC() };
            ok('CT-e na tela: alargar a janela com o painel aberto tira o inert e o aria-modal',
              largouC.ab === 0 && largouC.in.every((x) => x === false) && largouC.modal === null, JSON.stringify(largouC));
            ok('CT-e na tela: estreitar de novo reaplica o inert e o aria-modal, e o foco que estava na lista vai ao Fechar',
              estreitouC.in.every((x) => x === true) && estreitouC.modal === 'true' && estreitouC.foco, JSON.stringify(estreitouC));
            {
              largura(false);
              doc.querySelector('.nav-btn[data-tab="nfse"]').focus();
              const noMenuC = doc.activeElement === doc.querySelector('.nav-btn[data-tab="nfse"]');
              largura(true);
              const doMenuC = doc.activeElement === fecharC();
              largura(false);
              doc.activeElement = body;
              largura(true);
              const doBodyC = doc.activeElement === fecharC();
              ok('CT-e: estreitar a janela com o foco no menu lateral ou no body leva o foco ao Fechar do painel',
                abertoC() === 0 && noMenuC && doMenuC && doBodyC, JSON.stringify({ ab: abertoC(), noMenuC, doMenuC, doBodyC }));
            }

            /* Trocar de aba (pelo .click() do próprio script, que o inert não barra) devolve tudo. */
            fire(doc.querySelector('.nav-btn[data-tab="importar"]'), 'click', { programatico: true });
            const foraC = { ab: abertoC(), in: inertesC(), modal: modalC(), pn: !!painelC(), sel: listaC.querySelectorAll('tr.sel').length,
              focoNaLista: !!(doc.activeElement && listaC.contains(doc.activeElement)) };
            ok('CT-e na tela estreita: trocar de aba com o painel aberto fecha (o painel sai do DOM, a linha perde a marca, o foco não vai à lista escondida) e tira o inert de tudo, inclusive do menu e da barra do topo',
              foraC.ab === -1 && foraC.in.every((x) => x === false) && foraC.modal === 'sem painel' && !foraC.pn && foraC.sel === 0 && !foraC.focoNaLista, JSON.stringify(foraC));
            fire(doc.querySelector('.nav-btn[data-tab="cte"]'), 'click');

            /* A busca (ou a lista) que fica vazia com o painel aberto tira o inert; limpar a busca não reabre. */
            fire(trC(1), 'click');
            const antesBusca = todosC(true);
            doc.getElementById('filtro-cte').value = 'nenhum-cte-tem-isto'; R('renderCTe()');
            const buscaVazia = { ab: abertoC(), in: inertesC() };
            doc.getElementById('filtro-cte').value = ''; R('renderCTe()');
            const limpou = { ab: abertoC(), pn: !!painelC() };
            fire(trC(1), 'click');
            const antesVazio = todosC(true);
            R('__DB.cte=[];renderCTe()');
            const listaVazia = { ab: abertoC(), in: inertesC() };
            ok('CT-e na tela estreita: busca sem resultado (ou lista vazia) com o painel aberto fecha o painel e tira o inert; limpar a busca não reabre',
              antesBusca && buscaVazia.ab === -1 && buscaVazia.in.every((x) => x !== true) && limpou.ab === -1 && !limpou.pn
              && antesVazio && listaVazia.ab === -1 && listaVazia.in.every((x) => x !== true),
              JSON.stringify({ antesBusca, buscaVazia, limpou, antesVazio, listaVazia }));
            largura(false);
            R('__DB.cte=[];CTE_UI.aberto=-1;renderCTe();');
          } catch (e) {
            ok('NFS-e na tela: os gestos rodam sem exceção', false, e.message);
          }
        }
      }

      /* O painel aberto com o payload em TODO campo que o render lê (o mesmo universo do
         grupo 15): mesma forma do benigno, nenhum handler, o dado continua como texto. */
      const medeNfse = (val) => {
        try {
          vm.runInContext(`(()=>{__DB.nfse=${JSON.stringify([linha(undefined, val)])};NFSE_UI.aberto=0;renderNFSe();})()`, sb);
          return vm.runInContext("document.getElementById('nfse-list').innerHTML", sb);
        } catch (e) { return 'ERRO: ' + e.message; }
      };
      {
        const hp = medeNfse(PAY), hb = medeNfse(BENIGNO), fp = forma(hp), fb = forma(hb);
        ok('renderNFSe com o painel aberto: o payload não ganha tag nem handler e continua como texto',
          !/^ERRO/.test(hp) && /nfse-painel/.test(hp) && fp.tags === fb.tags && fp.handler === fb.handler && fp.script === 0 && fp.img === 0 && fp.escapado > 0 && fb.escapado === 0,
          /^ERRO/.test(hp) ? hp : `payload ${fp.tags} tag(s)/${fp.handler} handler vs benigno ${fb.tags}/${fb.handler}`);
        FORMAS.forEach((formaPay, i) => {
          const f1 = forma(medeNfse(formaPay)), f2 = forma(medeNfse(BENIGNO));
          ok('a forma #' + (i + 1) + ' (' + formaPay.slice(0, 18) + '…) não vira HTML no painel da NFS-e',
            f1.tags === f2.tags && f1.handler === f2.handler && f1.script === 0, `tags=${f1.tags} vs benigno=${f2.tags}`);
        });
      }
      vm.runInContext('__DB.nfse=[];NFSE_UI.aberto=-1;NFSE_UI.conf=false', sb);
    }
    ok('o extrator lê o grupo veicProd de dentro de <prod>',
      /const veic=prod\.querySelector\('veicProd'\)/.test(html) && /["']chassi["']/.test(html));
    ok('o universo inclui campo lido por `g.` (o rodapé de Arquivo_Origem do NF-e)',
      /\bg\./.test(fonteRender) && unicos.includes('Arquivo_Origem'));
  }
}
// ══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(58));
console.log('REGRESSÃO: ' + passou + ' passaram, ' + falhou + ' falharam');
if (falhou) {
  console.log('\nFALHAS:');
  falhas.forEach(f => console.log('  ✗ ' + f));
}
console.log('='.repeat(58));
process.exit(falhou ? 1 : 0);
