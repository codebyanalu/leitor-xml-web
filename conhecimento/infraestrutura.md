# Base de Conhecimento — Infraestrutura

> Alimentada diariamente via `/alimentar`. Itens mais recentes no topo da seção de registros.

## Decisões firmes
- Deploy: GitHub Pages, `index.html` puro, sem build step; HTTPS garantido.
- Toda CDN precisa de fallback; offline exceto consulta CNPJ.
- Metas: 50 arquivos ≤ 30s; localStorage ~4MB com aviso/limpeza.

## Armadilhas conhecidas
- File System Access API não existe em todos os navegadores — sempre testar o fallback ZIP.
- Tesseract.js é o recurso mais pesado; monitorar impacto em lote.

## Registros

### 2026-09-26 — Custo e travamento do Tesseract em lote
- tesseract.js v4: `Tesseract.recognize` cria/destrói worker por chamada, sem timeout e sem logger por default; `tsv` já vem no output padrão (o 4º argumento é ignorado). Mitigação aplicada: uma única chamada + `Promise.race` de 90s por página (erro propaga para `ocrErro`).
- Custo de OCR é dominado por escala e nº de páginas: escala 3 ≈ 2,25× de px vs 2 (mantida — medida: chave de 44 dígitos truncava com escala menor; documentada no README); reforço com teto de 3 páginas (`ocrPDF(file,3)`) + 1 tentativa por arquivo.
- Lacuna de cobertura: a bancada em `testes/` não exercita `ocrPDF` do index.html (harness usa mupdf + worker próprio; `document.createElement('canvas')` lança no harness) — 160/160 valida parse/ESC=3, não o race/cap.
- Pendências: CDNs (tesseract@4, pdf.js, chart, pdf-lib, jszip, xlsx) e tessdata sem fallback; worker da v4 não sofre `terminate()` no timeout do race (segue rodando até concluir).
