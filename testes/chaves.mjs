// Extrai a chave de acesso (recorte em alta resoluÃ§Ã£o) e valida DV + nÃºmero do arquivo
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mupdf = await import('mupdf');
const Tesseract = require('tesseract.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

function d(s) { return (s || '').replace(/\D/g, ''); }
function vH(ch) { ch = d(ch); if (ch.length !== 44) return false; const b = ch.slice(0, 43); let s = 0, p = 2; for (let i = b.length - 1; i >= 0; i--) { s += +b[i] * p; p = p === 9 ? 2 : p + 1; } const dv = 11 - s % 11, calc = dv >= 10 ? 0 : dv; return calc === +ch[43]; }

const dir = path.join(__dirname, '..', 'amostras');
const worker = await Tesseract.createWorker('por', 1, { logger: () => {} });
const saida = {};
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.pdf')).sort()) {
  const doc = mupdf.Document.openDocument(new Uint8Array(fs.readFileSync(path.join(dir, f))), 'application/pdf');
  const page = doc.loadPage(0);
  const pix = page.toPixmap(mupdf.Matrix.scale(4, 4), mupdf.ColorSpace.DeviceRGB, false);
  const tmp = path.join(__dirname, 'saidas', 'tmp4x.png');
  fs.writeFileSync(tmp, Buffer.from(pix.asPNG())); doc.destroy();
  const img = await loadImage(tmp);
  const c = createCanvas(2400, 300); const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 2400, 300);
  // faixa da chave (4x): x 1450..2350, y ~ 260..380
  ctx.drawImage(img, 1250, 255, 1130, 130, 0, 0, 2400, 300);
  const { data } = await worker.recognize(new Uint8Array(c.toBuffer('image/png')));
  const nums = (data.text || '').match(/\d[\d\s]{30,}/g) || [];
  const bruto = nums.map(n => d(n)).filter(x => x.length >= 44);
  const numArq = (f.match(/\d{6}/) || [''])[0];
  let melhor = '';
  for (const dig of bruto) {
    for (let i = 0; i <= dig.length - 44 && !melhor; i++) {
      const c44 = dig.slice(i, i + 44);
      if (vH(c44) && c44.slice(25, 34).replace(/^0+/, '') === numArq) melhor = c44;
    }
  }
  saida[f] = melhor;
  console.log(`${f}\n  melhor: ${melhor || '(sem candidato)'}  dv=${melhor ? 'OK' : '-'}  numeroEsperado=${numArq}`);
}
await worker.terminate();
fs.writeFileSync(path.join(__dirname, 'chaves-verdade.json'), JSON.stringify(saida, null, 2));

