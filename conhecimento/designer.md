# Base de Conhecimento — Designer

> Alimentada diariamente via `/alimentar`. Itens mais recentes no topo da seção de registros.

## Decisões firmes
- Paleta: `--primary:#1a4b8c`, `--accent:#f59e0b`, `--success:#10b981`, `--err:#ef4444`, `--warn:#f59e0b`, `--info:#3b82f6`.
- Raios `--radius:10px` / `-sm:6px` / `-lg:14px`; espaçamento em escala 4px; tipografia Inter (base 13px).
- Breakpoints fixos: 375px, 768px, 1440px. Contraste mínimo AA (4.5:1). Focus visível sempre.
- Fluxo: Importar → Separar/Extrair → Visualizar → Exportar.

## Armadilhas conhecidas
- Remover outline no `:focus` quebra acessibilidade — nunca fazer.
- Tabelas largas quebram no mobile; checar scroll/compactação.

## Registros

### 2026-09-26 — Contraste de status, badges e live regions
- `--err` (#ef4444) em texto 11px bold dá 3.76:1 em branco (<4.5): usar `--err-ink` (#991b1b, 8.3:1) como padrão de texto de erro; `--err` só para bordas/ícones (≥3:1).
- Badges/botões com fundo saturado + texto branco 9–11px falham (2.0–3.8:1): escurecer para `#15803d`/`#b45309`/`#b91c1c` (badges) e gradiente `#15803d→#047857` (`.btn-ok`) — todos ≥4.5:1.
- `#ec4899` (`--kpi-garantia`) =3.53:1 só é seguro em número ≥18.66px bold; nunca em texto pequeno.
- `role="status"` injetado junto com o conteúdo no mesmo `innerHTML` pode não ser anunciado — live region deve existir no DOM antes da atualização (container persistente, trocar só o interno).
- Borda `var(--warn)` (2.15:1) como único contorno de caixa âmbar falha 1.4.11 — usar `--warn-ink`/`#b45309`.
