import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import mupdf from 'mupdf';

// Recorta uma região de um PDF em alta resolução e devolve PNG (sem canvas).
// coords em pixels do render na escala `scale` (ex.: escala 2.5 do harness).
export function recortar(pdfPath, { page = 0, scale = 2.5, x = 0, y = 0, w = 200, h = 60 } = {}) {
  const doc = mupdf.Document.openDocument(new Uint8Array(fs.readFileSync(pdfPath)), 'application/pdf');
  try {
    const pg = doc.loadPage(page);
    const pix = pg.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false);
    const W = pix.getWidth(), H = pix.getHeight(), stride = pix.getStride(), n = pix.getNumberOfComponents();
    const px = pix.getX(), py = pix.getY();
    const src = pix.getPixels();
    x = Math.max(0, Math.round(x - px)); y = Math.max(0, Math.round(y - py));
    w = Math.min(Math.round(w), W - x); h = Math.min(Math.round(h), H - y);
    const rows = [];
    for (let j = 0; j < h; j++) {
      const row = Buffer.alloc(1 + w * 3);
      row[0] = 0;
      const base = (y + j) * stride + x * n;
      for (let i = 0; i < w; i++) {
        const o = base + i * n;
        row[1 + i * 3] = src[o];
        row[2 + i * 3] = src[o + 1];
        row[3 + i * 3] = src[o + 2];
      }
      rows.push(row);
    }
    pix.destroy();
    return png(w, h, Buffer.concat(rows));
  } finally { doc.destroy(); }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, scanlines) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
