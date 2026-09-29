// Bancada de validação do módulo de leitura de PDF (GCON/SIAN)
// Uso: node rodar.mjs [--ocr-somente]
// Renderiza cada página (igual ao navegador), faz OCR e roda parseFull/finalizar do index.html real
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const AMOSTRAS = path.join(RAIZ, 'amostras');
const SAIDAS = path.join(__dirname, 'saidas');
const require = createRequire(import.meta.url);

fs.mkdirSync(SAIDAS, { recursive: true });

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const Tesseract = require('tesseract.js');

const pdfOpts = {
  isEvalSupported: false,
  useWorkerFetch: false,
  cMapUrl: path.join(__dirname, 'node_modules', 'pdfjs-dist', 'cmaps') + path.sep,
  cMapPacked: true,
  standardFontDataUrl: path.join(__dirname, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep,
};

/* Integridade do harness, verificada ANTES de qualquer leitura. O passeio
   (Infraestrutura) reproduziu o modo silencioso: com os cmaps/fontes apontando
   para path inexistente, o pdf.js so emite warning no console, o tC devolve texto
   vazio, as 14 amostras caem no OCR e a bancada continua imprimindo 100% com
   exit 0. "Ausência de dado" e "quebra do instrumento" precisam de assertivo
   proprio, porque a métrica é a mesma nos dois casos. */
const CMAPS = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'cmaps');
const FONTES = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'standard_fonts');
const faltandoHarness = [!fs.existsSync(CMAPS) ? 'pdfjs-dist/cmaps' : '', !fs.existsSync(FONTES) ? 'pdfjs-dist/standard_fonts' : '']
  .filter(Boolean);
if (faltandoHarness.length) {
  console.error('\n✗ HARNESS INCOMPLETO: faltou ' + faltandoHarness.join(' e ') + ' em testes/node_modules.');
  console.error('  Rode `npm install` dentro de testes/. Sem esses arquivos o pdf.js devolve');
  console.error('  texto vazio em silencio e a bancada mediria so OCR — ou pior, nada.');
  process.exit(1);
}

// ---------- render (espelha o navegador: página -> raster -> OCR) ----------
const mupdf = await import('mupdf');
async function renderPaginas(fileBuf, scale = 2.5) {
  const doc = mupdf.Document.openDocument(new Uint8Array(fileBuf), 'application/pdf');
  const pngs = [];
  for (let p = 0; p < doc.countPages(); p++) {
    const page = doc.loadPage(p);
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    pngs.push(Buffer.from(pix.asPNG()));
    pix.destroy(); page.destroy();
  }
  doc.destroy();
  return pngs;
}

// ---------- módulo real do index.html ----------
function carregarModulo() {
  const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const ini = html.indexOf('window.ModPDFIsolado=(()=>{');
  if (ini < 0) throw new Error('módulo ModPDFIsolado não encontrado em index.html');
  const fim = html.indexOf('</script>', ini);
  let src = html.slice(ini, fim);
  /* Este rewrite precisa acompanhar o contrato real do index.html: vC/vH são
     parte da superfície pública (o importador da Consulta em Lote, que é outra
     IIFE, valida o DV com vC()). Reescrever para uma lista menor aqui fazia a
     bancada passar enquanto o app real estourava "vC is not defined". */
  const mRet = src.match(/return\s*\{[^}]*extrair[^}]*\}\s*;/);
  if (!mRet) throw new Error('return do ModPDFIsolado não encontrado (contrato mudou?)');
  src = src.replace(mRet[0], 'return{extrair,parseFull,mergeExtracao,finalizar,tC,vC,vH};');
  const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    document: { createElement: () => { throw new Error('canvas indisponível no harness'); } },
    setTimeout, clearTimeout, Date, Math, JSON, Intl, Promise,
  };
  /* O navegador tem cmaps e fontes padrao pela CDN do pdf.js; no node eles nao
     vem junto. Sem isto o tC devolvia texto vazio em TODAS as amostras e a
     bancada media so o caminho de OCR - os 14 PDFs passaram por OCR, inclusive
     os 5 que tem camada de texto. O harness agora espelha o navegador. */
  sandbox.pdfjsLib = { getDocument: (o) => pdfjs.getDocument({ ...o, ...pdfOpts }), GlobalWorkerOptions: {} };
  sandbox.window.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'index.html#ModPDFIsolado' });
  return sandbox.window.ModPDFIsolado;
}

// ---------- execução ----------
function itensTsv(tsv, esc, page) {
  const out = [];
  for (const ln of String(tsv).split('\n')) {
    const c = ln.split('\t');
    if (c.length < 12 || c[0] !== '5') continue;
    const t = c[11];
    if (!t || !t.trim()) continue;
    const x = parseFloat(c[6]), y = parseFloat(c[7]), w = parseFloat(c[8]);
    if (!isFinite(x) || !isFinite(y)) continue;
    out.push({ str: t, x: x / esc, y: -y / esc, w: isFinite(w) ? w / esc : 0, page });
  }
  return out;
}

const M = carregarModulo();
const soOCR = process.argv.includes('--ocr-somente');
const soEstrutura = process.argv.includes('--so-estrutura');

/* --so-estrutura: so a regressao estrutural (1 s, sem OCR). A bancada completa
   depende de amostras/ e leva ~2 min por 8 PDFs. */
if (soEstrutura) {
  console.log('rodar.mjs: use `node regressao.mjs` para a regressao estrutural.');
  process.exit(0);
}

const arquivos = fs.readdirSync(AMOSTRAS).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
console.log(`${arquivos.length} PDF(s) em amostras/`);
if (!arquivos.length) {
  console.error('\n✗ Nenhum PDF em amostras/. A bancada nao tem o que validar.');
  console.error('  (amostras/ e gitignored por conter notas reais da cliente)');
  process.exit(1);
}

const worker = await Tesseract.createWorker('por', 1, { logger: () => {} });
const resultados = [];
const dirPag = path.join(SAIDAS, 'paginas'); fs.mkdirSync(dirPag, { recursive: true });
/* O catch mudo é o que transformava "biblioteca ausente" em "PDF escaneado".
   Todo erro do tC é registrado e impresso no fim. */
const diagT = [];

for (const nome of arquivos) {
  const buf = fs.readFileSync(path.join(AMOSTRAS, nome));
  const t0 = Date.now();

  // A camada de texto primeiro: ela decide se o OCR e necessario.
  let textoCamada = '';
  let itensCamada = [];
  let nPag = 0;
  try {
    const r = await M.tC({ arrayBuffer: async () => new Uint8Array(buf) });
    textoCamada = r.full; itensCamada = r.items || [];
    nPag = itensCamada.reduce((m, i) => Math.max(m, i.page || 0), 0);
  } catch (e) { diagT.push(`${nome}: ${e && e.message ? e.message : e}`); }
  const temTexto = !!textoCamada.trim();

  /* O OCR so roda quando o PDF nao tem camada de texto (ou com --ocr-somente).
     Antes rodava em todas as amostras: 8 DANFEs de 1 pagina gastavam ~2 min
     renderizando e reconhecendo para provar um caminho que o app nem usa nelas
     (no app o OCR so entra como reforco quando falta CNPJ ou numero). */
  let textoOCR = '', nPagRastro = 0;
  const itensOCR = [];
  if (!temTexto || soOCR) {
    try {
      const pngs = await renderPaginas(buf, 3);
      nPagRastro = pngs.length;
      for (let i = 0; i < pngs.length; i++) {
        fs.writeFileSync(path.join(dirPag, `${nome}--p${i + 1}.png`), pngs[i]);
        const { data } = await worker.recognize(new Uint8Array(pngs[i]), {}, { tsv: true });
        textoOCR += (data.text || '') + '\n';
        if (data.tsv) itensOCR.push(...itensTsv(data.tsv, 3, i + 1));
      }
    } catch (e) { console.log(` ✗ ${nome}: render/OCR: ${e.message}`); }
  }
  if (!nPag) nPag = nPagRastro;

  /* --ocr-somente precisa FORCAR o caminho de OCR: antes a flag gerava o
     reconhecimento e descartava o resultado (fonte continuava 'texto'), e o
     bloco de metricas nem rodava por causa do `!soOCR`. A flag que nao muda o
     que e medido e armadilha: dava sensacao de cobertura de OCR a custo de
     10-15 s por PDF. */
  const usarOCR = soOCR || !temTexto;
  const fonte = usarOCR ? 'ocr' : 'texto';
  const full = usarOCR ? textoOCR : textoCamada;
  const itens = usarOCR ? itensOCR : itensCamada;
  fs.writeFileSync(path.join(SAIDAS, nome + '.ocr.txt'), textoOCR);
  fs.writeFileSync(path.join(SAIDAS, nome + '.camada.txt'), textoCamada);

  let r = null, erro = '';
  try {
    if (!full.trim()) throw new Error('sem texto (OCR vazio)');
    r = M.parseFull(full, itens, fonte);
    r.arquivo = nome;
    r = M.finalizar(r, full, fonte, fonte === 'ocr', '');
    r._paginas = nPag; r._ms = Date.now() - t0; r._fonte = fonte; r._chars = full.length;
  } catch (e) { erro = e.message; }
  fs.writeFileSync(path.join(SAIDAS, nome + '.json'), JSON.stringify(r || { erro }, null, 2));
  resultados.push(r ? { nome, ...r } : { nome, erro });
  console.log(` ✓ ${nome} [${fonte}, ${nPag}p] ${r ? `nº:${r.numero || '—'} chave:${r.chave ? 'sim' : '—'} cnpj:${r.cnpjPrestador || '—'} valor:${r.valor || '—'} conf:${r.confMedio}%` : 'ERRO ' + erro} (${Date.now() - t0}ms)`);
}
await worker.terminate();
fs.writeFileSync(path.join(SAIDAS, 'resumo.json'), JSON.stringify(resultados, null, 2));
if (diagT.length) {
  console.log('\nERROS do tC (PDF sem camada de texto NAO costuma lançar; se apareceu aqui, é harness):');
  diagT.forEach((d) => console.log('   - ' + d));
}

/* Gate do harness: a bancada precisa provar que exercitou o caminho que se
   propõe a provar. O sintoma observavel de que o tC voltou vazio nao e a metrica
   (que fica 100%), e o tempo por PDF (0,15 s -> 11-20 s) e a contagem por fonte. */
const porFonte = resultados.reduce((a, r) => { const k = r._fonte || (r.erro ? 'erro' : 'desconhecida'); a[k] = (a[k] || 0) + 1; return a; }, {});
console.log(`\n=== ORIGEM DA LEITURA === ${JSON.stringify(porFonte)}`);
if (!soOCR) {
  const minTexto = Number(process.env.GCON_MIN_CAMADA_TEXTO ?? 5);
  if ((porFonte.texto || 0) < minTexto) {
    console.error(`\n✗ HARNESS: so ${porFonte.texto || 0}/${resultados.length} PDF(s) foram pela camada de texto `
      + `(minimo ${minTexto}). Ou os cmaps/fontes sumiram, ou o tC engoliu erro — a metrica acima `
      + 'mediria so OCR e continuaria verde.');
    process.exit(1);
  }
}

// ---------- métricas contra verdade (verdade.json) ----------
const verdPath = path.join(__dirname, 'verdade.json');
if (fs.existsSync(verdPath) && !soOCR) {
  const verdade = JSON.parse(fs.readFileSync(verdPath, 'utf8'));
  /* O universo de campos vem do CONTRATO DE EXPORTACAO, nao da verdade. Antes
     vinha de Object.keys(verdade[primeira]): um campo que a verdade esqueceu nunca
     era iterado e sumia sem rastro — foi assim que o nomePrestador (vazio em 14/14
     notas) ficou sem nenhuma medicao. Pegando as chaves `r.xxx` da linha de export
     do leitor de PDF, o gate acompanha o produto: coluna nova no export entra
     sozinha na conta, e campo interno (confianca, _ms, fullPreview) fica de fora. */
  const htmlIndex = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const linhaExport = (htmlIndex.match(/\{Arquivo:r\.arquivo[\s\S]{0,4000}?\}\[h\]/) || [''])[0];
  const colunas = [...new Set([...linhaExport.matchAll(/[{,]\s*[A-Za-z_0-9]+:r\.([A-Za-z_][A-Za-z_0-9]*)/g)].map((m) => m[1]))];
  /* Se o contrato de exportacao mudar de forma (ou o indice casar errado), a
     metrica abaixo mede um universo que nao e o do produto. Melhor reprovar. */
  if (colunas.length < 30) {
    console.error(`\n✗ HARNESS: o universo de campos saiu do export do leitor de PDF com ${colunas.length} `
      + `colunas (esperado 40). O gate mediria um universo errado. Achado: ${colunas.join(',')}`);
    process.exit(1);
  }
  console.log(`universo de medicao: ${colunas.length} colunas do export do leitor de PDF`);
  const r0 = resultados.find((r) => r && !r.erro) || {};
  /* `arquivo` e a identidade da amostra (a chave do verdade.json), nao um valor
     medido. As colunas de auditoria ficam na lista abaixo, com o porque. */
  const campos = [...new Set([...colunas.filter((c) => c !== 'arquivo'),
    ...Object.keys(verdade[Object.keys(verdade)[0]] || {})])];
  /* Campos que a bancada NAO mede, por decisao. Declarar aqui e obrigatorio: um
     campo que caia a zero referencias sem estar nesta lista REPROVA, em vez de
     sumir. Cada linha e uma divida declarada ou uma tautologia declarada. */
  const SEM_VERDADE_OK = [
    'dataSaida',    // a nota nao imprime a data ao lado do rotulo; a correcao do eDatas esta em teste sintetico
    'baseST',       // campo em branco com 0,00 impresso: o leitor devolve vazio (lacuna do README)
    'valorST',      // idem
    'nomePrestador',// razao social do emitente vem interleada com cabecalho de coluna: exige leitura geometrica
    // Colunas de auditoria: a saida e o proprio calculo do leitor, entao a "verdade"
    // seria tautologia. O que importa nelas (fonte da chave, texto da ancora, confianca
    // por campo) e fixado em caso sintetico no grupo 13.2 da regressao.
    'confMedio', 'numeroConf', 'chaveConf', 'cnpjConf',
    'garantia', 'numeroGarantido', 'cnpjGarantido', 'cnpjFonte', 'numeroAncora', 'ocrReforco',
  ];
  let ok = 0, tot = 0; const porCampo = {};
  /* Campo sem valor de referencia NAO conta: comparar "" com "" e aprovado por
     construcao e inflaria o numero. O que o leitor nao extrai de um layout fica
     fora da conta (e aparece no relatorio como "sem referencia"), nao como
     acerto. A verdade de cada campo novo e lida a mao na nota. */
  const semRef = [];
  const semRefPorCampo = {};
  const nomesVerdade = Object.keys(verdade);
  for (const r of resultados) {
    const v = verdade[r.nome]; if (!v) continue;
    for (const c of campos) {
      if (!(c in r) && !(c in v)) continue;                 // coluna que nem existe no registro
      const obt = String(r?.[c] ?? '').trim(), esp = String(v[c] ?? '').trim();
      if (!esp) {
        semRef.push(`${r.nome} :: ${c}` + (obt ? `  (leitor extraiu ${JSON.stringify(obt.slice(0, 40))})` : ''));
        (semRefPorCampo[c] = semRefPorCampo[c] || []).push(r.nome);
        continue;
      }
      tot++; porCampo[c] = porCampo[c] || { ok: 0, tot: 0 };
      porCampo[c].tot++;
      const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
      const lev = (a, b) => {
        const m = a.length, n = b.length;
        if (!m || !n) return Math.max(m, n);
        let prev = Array.from({ length: n + 1 }, (_, i) => i);
        for (let i = 1; i <= m; i++) {
          const cur = [i];
          for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
          prev = cur;
        }
        return prev[n];
      };
      const fuzzy = (a, b) => {
        const na = norm(a), nb = norm(b);
        if (na === nb) return true;
        if (na.length >= 10 && nb.length >= 10 && (na.startsWith(nb) || nb.startsWith(na))) return true;
        const r = 1 - lev(na, nb) / Math.max(na.length, nb.length);
        return r >= 0.92;
      };
      /* Campo so com digito (chave, protocolo, IE, CNPJ, numero, CEP, datas) nao
         pode usar a comparacao tolerante: ela aceita prefixo quando os dois tem 10+
         caracteres, e "13126789268476" (12 digitos) casava com a verdade de 13.
         Um digito a menos em protocolo e em inscricao estadual e exatamente o tipo
         de erro que entra em silencio. */
      const soDigitos = (s) => /^\d+$/.test(s.replace(/[^\d]/g, '')) && /\d/.test(s);
      const numerico = soDigitos(obt) && soDigitos(esp);
      const igual = (c === 'chave' || c === 'chaveValida' || numerico) ? obt === esp
        : (obt.replace(/\D/g, '') && obt.replace(/\D/g, '') === esp.replace(/\D/g, ''))
        || fuzzy(obt, esp);
      if (igual) { ok++; porCampo[c].ok++; }
    }
  }
  /* Campo sem referencia e nao declarado = buraco novo. Reprova. */
  const semVerdadeInesperado = campos.filter((c) => {
    const lista = semRefPorCampo[c];
    if (!lista) return false;
    return lista.length >= nomesVerdade.length && !SEM_VERDADE_OK.includes(c);
  });
  if (semVerdadeInesperado.length) {
    console.error(`\n✗ BANCADA REPROVADA: campo sem valor de referencia em toda a amostra e nao `
      + `declarado em SEM_VERDADE_OK: ${semVerdadeInesperado.join(', ')}`);
    console.error('  Ou a verdade esqueceu o campo, ou ele foi lido e nunca anotado. Adicione a '
      + 'referencia (lida a mao na nota) ou declare a divida em SEM_VERDADE_OK com o porque.');
    process.exit(1);
  }
  const linhas = [`\n=== MÉTRICAS (${tot} campos com referência) ===`, `Acurácia global: ${ok}/${tot} = ${Math.round(ok / tot * 100)}%`];
  for (const [c, v] of Object.entries(porCampo)) linhas.push(`  ${c}: ${v.ok}/${v.tot} = ${Math.round(v.ok / v.tot * 100)}%`);
  if (semRef.length) {
    /* Resumido por campo: listar 14 amostras x 10 colunas de auditoria nao diz
       nada. O que importa e QUAIS campos nao tem referencia, e em quantas das 14
       notas. "0/14" = nenhuma nota tem referencia; "2/14" = a verdade cobre duas
       notas e as outras doze sao caso sem rotulo naquele layout (legitimo). */
    const N = nomesVerdade.length;
    linhas.push(`  (sem valor de referência, fora da conta: ${semRef.length} pares em ${Object.keys(semRefPorCampo).length} campo(s), de ${Object.keys(porCampo).length} campos com referencia)`);
    for (const [c, lista] of Object.entries(semRefPorCampo).sort()) {
      const comRef = N - lista.length;
      /* Rotulo honesto: "sem referência em NENHUMA nota" e buraco (reprova);
         parcial e a situacao normal (a verdade cobre as notas em que o campo
         aparece naquele layout); declarado e o campo de auditoria ou a divida
         escrita em SEM_VERDADE_OK. */
      const tag = comRef === 0
        ? (SEM_VERDADE_OK.includes(c) ? 'sem referência, declarado' : 'SEM REFERENCIA E NAO DECLARADO')
        : (SEM_VERDADE_OK.includes(c) ? 'declarado' : 'parcial');
      linhas.push(`    - ${c}: referência em ${comRef}/${N} notas [${tag}]`);
    }
  }
  const texto = linhas.join('\n');
  fs.writeFileSync(path.join(SAIDAS, 'metricas.txt'), texto);
  console.log(texto);

  /* Gate de verdade: sem isso a bancada e um relatorio, nao um teste — um 0% de acuracia
     saia com exit 0 e o merge passava. A regra do projeto e 100% (160/160). */
  const esperado = Number(process.env.GCON_MIN_ACURACIA ?? 100);
  const pct = tot ? (ok / tot) * 100 : 0;
  if (pct < esperado) {
    console.error(`\n✗ BANCADA REPROVADA: ${ok}/${tot} = ${pct.toFixed(1)}% (minimo ${esperado}%)`);
    const reprovados = Object.entries(porCampo).filter(([, v]) => v.ok < v.tot)
      .map(([c, v]) => `    ${c}: ${v.ok}/${v.tot}`);
    console.error('  campos com falha:\n' + (reprovados.join('\n') || '    (nenhum campo individual falhou; o total e que nao bateu)'));
    process.exit(1);
  }
  console.log(`\n✓ BANCADA OK: ${ok}/${tot} = ${pct.toFixed(1)}% (minimo ${esperado}%)`);
}
