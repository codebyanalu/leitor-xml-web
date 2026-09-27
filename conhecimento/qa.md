# Base de Conhecimento — QA

> Alimentada diariamente via `/alimentar`. Itens mais recentes no topo da seção de registros.

## Decisões firmes
- Sem cores hardcoded: só `--primary`, `--surface`, `--text`, `--radius*` etc.
- Reutilizar `f()`, `moeda()`, `pct()`, `dataBr()`, `vH()` — nunca reimplementar.
- Feature nova sem atualizar `README.md` é bloqueio.

## Armadilhas conhecidas
- Funções de extração tendem a crescer demais — checar duplicação e magic numbers.

## Registros

### 2026-09-26 — Cores em diff, README x código e o que só informativa
- Hex em estilo inline novo (HTML) é bloqueio mesmo com o bloco `<style>` intacto: trocar por `var(--err)/var(--warn)/var(--err-ink)` + variáveis novas no `:root` (`--err-bg`, `--warn-bg`, `--kpi-garantia`). Antes de bloquear, filtrar do diff os hex idênticos ao HEAD (`#1e293b` do debug, cores de `isoLog`) — são falso positivo.
- Ler README no mesmo ciclo do diff: "2.5x scale" documentava `ESC=3` real — drift entre doc e código é achado de QA.
- Stubs mortos (`eValorApos`), CSS órfão (`.pdfiso-card`) e campo não consumido (`r.ausentes`) = informativo; bloquear só por isso transforma veredito em barulho.
