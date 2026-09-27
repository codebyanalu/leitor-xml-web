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
const { createCanvas } = require('@napi-rs/canvas');

const pdfOpts = {
  isEvalSupported: false,
  useWorkerFetch: false,
  cMapUrl: path.join(__dirname, 'node_modules', 'pdfjs-dist', 'cmaps') + path.sep,
  cMapPacked: true,
  standardFontDataUrl: path.join(__dirname, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep,
};

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
  src = src.replace(/return\s*\{[^}]*extrair[^}]*\}\s*;/, 'return{extrair,parseFull,mergeExtracao,finalizar,tC};');
  const sandbox = {
    window: {}, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, clear() {} },
    document: { createElement: () => { throw new Error('canvas indisponível no harness'); } },
    setTimeout, clearTimeout, Date, Math, JSON, Intl, Promise,
  };
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
const arquivos = fs.readdirSync(AMOSTRAS).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
console.log(`${arquivos.length} PDF(s) em amostras/`);

const worker = await Tesseract.createWorker('por', 1, { logger: () => {} });
const resultados = [];
const dirPag = path.join(SAIDAS, 'paginas'); fs.mkdirSync(dirPag, { recursive: true });

for (const nome of arquivos) {
  const buf = fs.readFileSync(path.join(AMOSTRAS, nome));
  const t0 = Date.now();
  let textoOCR = '', nPag = 0;
  const itensOCR = [];
  try {
    const pngs = await renderPaginas(buf, 3);
    nPag = pngs.length;
    for (let i = 0; i < pngs.length; i++) {
      fs.writeFileSync(path.join(dirPag, `${nome}--p${i + 1}.png`), pngs[i]);
      const { data } = await worker.recognize(new Uint8Array(pngs[i]), {}, { tsv: true });
      textoOCR += (data.text || '') + '\n';
      if (data.tsv) itensOCR.push(...itensTsv(data.tsv, 3, i + 1));
    }
  } catch (e) { console.log(` ✗ ${nome}: render/OCR: ${e.message}`); }

  let textoCamada = '';
  let itensCamada = [];
  try { const r = await M.tC({ arrayBuffer: async () => new Uint8Array(buf) }); textoCamada = r.full; itensCamada = r.items || []; } catch { /* sem camada de texto */ }

  const fonte = textoCamada.trim() ? 'texto' : 'ocr';
  const full = textoCamada.trim() ? textoCamada : textoOCR;
  const itens = fonte === 'texto' ? itensCamada : itensOCR;
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

// ---------- métricas contra verdade (verdade.json) ----------
const verdPath = path.join(__dirname, 'verdade.json');
if (fs.existsSync(verdPath) && !soOCR) {
  const verdade = JSON.parse(fs.readFileSync(verdPath, 'utf8'));
  const campos = Object.keys(verdade[Object.keys(verdade)[0]] || {});
  let ok = 0, tot = 0; const porCampo = {};
  for (const r of resultados) {
    const v = verdade[r.nome]; if (!v) continue;
    for (const c of campos) {
      tot++; porCampo[c] = porCampo[c] || { ok: 0, tot: 0 };
      porCampo[c].tot++;
      const obt = String(r?.[c] ?? '').trim(), esp = String(v[c] ?? '').trim();
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
      const igual = esp === ''
        ? obt === ''
        : (c === 'chave' ? obt === esp
          : (obt.replace(/\D/g, '') && obt.replace(/\D/g, '') === esp.replace(/\D/g, ''))
          || fuzzy(obt, esp));
      if (igual) { ok++; porCampo[c].ok++; }
    }
  }
  const linhas = [`\n=== MÉTRICAS (${tot} campos) ===`, `Acurácia global: ${ok}/${tot} = ${Math.round(ok / tot * 100)}%`];
  for (const [c, v] of Object.entries(porCampo)) linhas.push(`  ${c}: ${v.ok}/${v.tot} = ${Math.round(v.ok / v.tot * 100)}%`);
  const texto = linhas.join('\n');
  fs.writeFileSync(path.join(SAIDAS, 'metricas.txt'), texto);
  console.log(texto);
}
