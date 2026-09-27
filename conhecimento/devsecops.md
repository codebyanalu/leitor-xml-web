# Base de Conhecimento — DevSecOps

> Alimentada diariamente via `/alimentar`. Itens mais recentes no topo da seção de registros.

## Decisões firmes
- Varreduras de bloqueio a cada mudança: `console.*` = 0, secrets regex = 0, `innerHTML` com dado de entrada = 0.
- Dado de XML/PDF/OCR só via `textContent`/`createTextNode`.
- Aviso de localStorage obrigatório; sem analytics/tracking sem opt-in.
- CDN nova: versão pinada + `integrity`/`crossorigin` ou risco registrado.

## Armadilhas conhecidas
- Regex de extração com backtracking perigoso (ReDoS) em entradas longas.
- Consulta CNPJ por caminho novo pode furar o rate limit de 3/min.

## Registros

### 2026-09-26 — XSS em atributos de templates novos e escopo do helper
- O perigo não é só `innerHTML` direto: dado de entrada (nome de arquivo `file.name`, âncora OCR `numeroAncora`) interpolado em `title="..."` de template é XSS (fecha atributo com `"`). Regra: escapar também atributos, não só tags — helper `esc()` (&<>"') e aplicar no texto do nó E no atributo.
- O helper precisa nascer no mesmo escopo IIFE onde é chamado (módulo PDF `(() => {` L1731) ou vira `ReferenceError` no render; fora do IIFE usar escape inline.
- No diff, separar BLOQUEIO (sink novo) de AVISO (sink pré-existente idêntico: `e.message` em innerHTML, `title` com `nomePrestador`) — corrigir os dois, mas só o novo bloqueia.
- ReDoS: regex com classes disjuntas (`\d` vs `[\s\.\-]`) é linear mesmo com `{28,}` — backtracking catastrófico exige sobreposição de classes/quantificadores aninhados.
- Pendência registrada: export CSV/XLSX sem neutralização de fórmula (`=`/`+`/`-`/`@`).
