# Base de Conhecimento — Desenvolvedor

> Alimentada diariamente via `/alimentar`. Itens mais recentes no topo da seção de registros.

## Decisões firmes
- Arquivo único `index.html`; JS vanilla; CDNs: Chart.js, pdf.js, pdf-lib, jszip, xlsx, Tesseract.js.
- Helpers reutilizáveis: `f()`, `moeda()`, `pct()`, `dataBr()`, `vH()` (chave 44 mod-11), validador de CNPJ.
- Extração em pipeline: parse → validação → estrutura `DB` → render → export.

## Armadilhas conhecidas
- CNPJ placeholder `00.000.000/0000-00` e trechos da própria chave 44 geram falso positivo — descartar.
- PDF sem texto exige OCR (Tesseract) para garantir CNPJ + número.

## Registros
