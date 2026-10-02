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
import { fileURLToPath } from 'url';
/* O gate anti-vazamento lê `git ls-files`: a lista de publicação é o índice do
   git, não uma lista escrita à mão aqui — que foi exatamente como o segundo
   vazamento escapou (o primeiro estava no index.html, o seguinte em testes/). */
import { execFileSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/* Documentação de processo (workflow-rule.md, agente-*.md, conhecimento/*.md)
   saiu do índice do git: continua na máquina, mas não existe em clone novo nem
   em CI. Ler esses arquivos sem guarda fazia o gate passar aqui e ESTOURAR lá,
   com ENOENT, antes do primeiro teste. */
const FORA_DO_GIT = ['workflow-rule.md', 'opencode.json', 'conhecimento/desenvolvedor.md'];
function lerOpcional(nome) {
  const p = path.join(RAIZ, nome);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

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
grupo('2 · SEGURANÇA (bloqueios do DevSecOps)');
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
   vazamento (protocolo + natureza de operação, achado pelo DevSecOps depois do
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
  const SINT_14 = ['00000000000000', '11222333000181', '11222334000126', '11222337000183',
    '11222338000172', '12345678000195', '00000000000191', '00000000000004'];
  const SINT_15 = ['100200300400501', '3526011222333000181550010000001231123456783'];
  const SINT_44 = ['35260911222333000181550010000001231123456783',
    '35268011222334000126550019000001011123456780',
    '52609112223330001815500100000012311234567835',
    '43526091122233300018155001000000123112345678'];
  const SINT_MASC = ['00.000.000/0000-00', '11.222.333/0001-81', '11.222.334/0001-26',
    '11.222.337/0001-83', '11.222.338/0001-72', '12.345.678/0001-95'];

  if (!fs.existsSync(VERDADE)) {
    console.log('  ! sem verdade.json: cruzamento impossível; valida só os sintéticos conhecidos');
    const fora = [...[...cnpjMasc.keys()].filter((x) => !SINT_MASC.includes(x)),
      ...[...cnpjCru.keys()].filter((x) => !SINT_14.includes(x)),
      ...[...protocolo.keys()].filter((x) => !SINT_15.includes(x)),
      ...[...chave44.keys()].filter((x) => !SINT_44.includes(x))];
    ok('sem gabarito: todo CNPJ/protocolo/chave nos versionados é sintético conhecido',
      fora.length === 0, fora.join(', ') || 'todos sintéticos');
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
    /* sintéticos independentes do gabarito: os que o FONTE CORRETO usa como
       exemplo. Uma lista viva aqui, e não importada, porque deriva do que está
       escrito no index.html/README — que é o que este gate protege. */
    const SINT_CNPJ = new Set(['00000000000000', '11222333000181', '11222334000126',
      '11222335000170', '11222336000115', '11222337000183', '11222338000172',
      '12345678000195', '00000000000191', '00000000000004', '11111111111111']);
    const cnpjValidosNaoSinteticos = [...cnpjCru.keys()]
      .filter((x) => /^\d{14}$/.test(x))
      .filter((x) => !SINT_CNPJ.has(x))
      .filter((x) => dvCnpjFecha(x))
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
ok('sprite tem 22 símbolos', simbolos.size === 22, 'achou ' + simbolos.size);
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
ok('header de nota é botão acessível', (html.match(/class="header" role="button" tabindex="0" aria-expanded="false"/g) || []).length >= 2);
ok('det-title é botão acessível', (html.match(/class="det-title" role="button" tabindex="0" aria-expanded="false"/g) || []).length >= 9);
ok('Enter/Espaço dispara o toggle (nota)', /addEventListener\('keydown'[\s\S]{0,600}?toggleNota/.test(html));
ok('Enter/Espaço dispara o toggle (det)', /addEventListener\('keydown'[\s\S]{0,600}?toggleDet/.test(html));
ok('Enter/Espaço abre a dropzone', /upload-area'\)\.addEventListener\('keydown'/.test(html));
ok('live region do PDF é container permanente no HTML', /id="pdfiso-avisos" role="status" aria-live="polite"/.test(html));
ok('a live region recebe conteúdo fora do innerHTML da tabela', /getElementById\('pdfiso-avisos'\)\.innerHTML=aviso/.test(html));
ok('toggleDet sincroniza aria-expanded', /setAttribute\('aria-expanded'/.test(html));
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
  ok('badge sobre CTA no claro usa alpha (medido 5.15:1 na auditoria do Designer)',
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

// ══════════════════════════════════════════════════════════════
grupo('10 · REGRAS DO PROJETO');
// ══════════════════════════════════════════════════════════════
ok('erro de XML malformado é específico', /XML inválido ou malformado/.test(html));
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
ok('HNFE tem 93 campos', nHnfe === 93, 'achou ' + nHnfe);
ok('HNFSE tem 56 campos', nHnfse === 56, 'achou ' + nHnfse);
ok('README diz 93 colunas NF-e (bate com o código)', /93 NF-e/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')));
// A asserção precisa ser "pulado OU conferido": o arquivo é gitignored, então
// num clone novo lerOpcional devolve '' e o teste virava no-op (sempre verde).
const regra = lerOpcional('workflow-rule.md');
if (regra) {
  ok('nenhum texto fala 423 campos (README e doc de processo, arquivo presente)',
    !/423/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')) && !/423/.test(regra));
} else {
  console.log('  (workflow-rule.md ausente — checagem de "423" pulada; arquivo é gitignored)');
}
FORA_DO_GIT.forEach((nome) => {
  const p = path.join(RAIZ, nome);
  let erro = '';
  try { fs.readFileSync(p, 'utf8'); } catch (e) { erro = e.code || String(e); }
  ok('leitura opcional tolera "' + nome + '" ausente (gitignored)', erro === '' || erro === 'ENOENT', p + ' -> ' + erro);
});
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
  ok('README reenumera os grupos ignorados pelo .gitignore (não só agente-*.md)',
    /amostras\//.test(readme) && /testes\/node_modules\//.test(readme) && /\.opencode\/agent\//.test(readme)
    && /painel-estado\.json/.test(readme) && /\.opencode\/plans\//.test(readme));
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
    + '\n    this.__lote = { cnpjsDoTexto, renderLote, registrar: registra, avisoCache, lista: () => lista, resultados: () => resultados };\n  '
    + html.slice(ultimo + 'avisoCache();'.length, fim)
    + '\n  this.__t = { consultar, render, lerCache, gravarCache, cacheResumo, expurgarCacheLegado, CHAVE_CACHE, CHAVE_CACHE_LEGADO };\n  })();';
}
function stubEl(id) {
  const el = {
    id, value: '', textContent: '', innerHTML: '', disabled: false, dataset: {},
    style: {}, files: null,
    scrollTop: 0, scrollHeight: 0, classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    addEventListener() { }, removeEventListener() { },
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
    'cnpj-lote-table', 'cnpj-cache-aviso'];
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
    ok('consultar() com ' + n + ' dígitos mostra a mensagem de 14 dígitos',
      /14 dígitos/.test(html14) && !/undefined/.test(html14), html14.slice(0, 160));
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
    /* Passeio (DevSecOps): o escape do CSV do lote morava dentro da IIFE dele e o
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
    ok('o export do LOTE de CNPJ usa o helper compartilhado', /const q=window\.GCON\.csvCelula;/.test(html));
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
    && /barra\.hidden=!\(DB\.nfe\.length\+DB\.nfse\.length\+DB\.arquivos>0\)/.test(html));
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
  /const meuGer=ger;/.test(html) && (html.match(/if\(meuGer!==ger\)return;/g) || []).length >= 3);
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
   grupo('14 · ALVOS DE TOQUE, ESCALA E TOKENS (bloqueios do Designer)');
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
  ok('o consumidor do CNPJ verifica o contrato antes de chamar (não ReferenceError cru)',
    /typeof window\.consultarCNPJ!=='function'/.test(html) && /onclick="return abrirConsultaCNPJ\(/.test(html));
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
  ok('o toggle também tem alvo de 44px (o Designer mediu 42px nos botões do rail)',
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
  /* A marca some INTEIRA no rail (Designer): o primeiro item de uma coluna de
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
        && /border:1px solid var\(--border\)/.test(decl);
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
  /* O achado do Designer, que nenhum dos gates acima pegava: `border-color` não
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
      const temBorda = (c) => /border:1px solid var\(--border\)/.test(c);
      /* E nenhuma delas pode voltar a_border-color_: sem border-style, não pinta. */
      const soCor = (c) => /border-color:/.test(c) && !temBorda(c);
      return temBorda(btn) && temBorda(out) && temBorda(sep)
        && !soCor(btn) && !soCor(out) && !soCor(sep);
    })(),
    'border-color sem border-style nao desenha nada');
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
     cabia em 64px, além de uma regra CSS sem efeito. */
  ok('o toggle não tem span nem regra morta: o nome vem do aria-label do JS',
    !/id="btn-rail"[^>]*>[\s\S]{0,200}?<span/.test(html)
    && /btn\.setAttribute\('aria-label',txt\);btn\.setAttribute\('title',txt\);/.test(html)
    && !/#btn-rail>span\{/.test(css) && !/#sidebar\[data-rail="on"\] #btn-rail>span\{/.test(css));
  const titulosRail = [...html.matchAll(/class="nav-btn[^"]*" data-tab="[^"]+" title="([^"]+)"/g)].map((m) => m[1]);
  ok('os 8 itens do menu têm title (nome no rail, onde o rótulo é visually-hidden)',
    titulosRail.length === 8, 'achou ' + titulosRail.length + ': ' + titulosRail.join(', '));
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
    /* O 3º parâmetro existe por causa do Tester: sem ele, o stub de
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
       leitura que o QA apontou nesta rodada). */
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
    /* Bloqueio do Arquiteto: em ≤768px o atributo está 'on' por LAYOUT, não por
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
    'eJ', 'eN', 'eC', 'decodChave', 'parseFull', 'finalizar', 'mergeExtracao'];
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
     nenhum destes ramos. O passeio (Tester) rodou as asserções do 13.1 contra 7
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
  grupo('13.3 · CONTRATOS que o passeio estreitou');
  // ══════════════════════════════════════════════════════════════
  /* Cada linha aqui é um ponto em que um dos sete agentes encontrou um furo e a
     correção não tinha caso: sem caso, o próximo passeio reintroduz. */
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
       (medido no passeio: "6.0(2)0" virava regex com grupo). A guarda e o
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

    /* A UI que o Designer apontou: badge verde exige segundo sinal, KPI conta o
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
