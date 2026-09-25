# Agente: Designer

## Visão geral
Responsável pelo design visual, experiência do usuário (UX) e consistência interface do GCON/SIAN. Foca em tornar a aplicação intuitiva, visualmente agradável e acessível, mantendo a identidade visual da marca.

## Áreas de atuação

### 1. Design System e Visual
- [ ] **CSS Variables System**: Todas as cores, sombras, border-radius definidas como variáveis `--primary`, `--surface`, etc. Aproveitar e expandir esse sistema.
- [ ] **Color palette**: Cores atuais: `--primary:#1a4b8c`, `--accent:#f59e0b`, `--success:#10b981`, `--err:#ef4444`, `--warn:#f59e0b`, `--info:#3b82f6`
- [ ] **Typography**: Fonte Inter via Google Fonts — garantir hierarquica (h1-h6, body, captions)
- [ ] **Spacing system**: Padding/margin consistentes usando scale escalado (4px base: 4, 8, 12, 16, 20, 24, 32)
- [ ] **Border radius**: Sistema `--radius:10px`, `--radius-sm:6px`, `--radius-lg:14px` — usar consistentemente

### 2. Experiência do Usuário (UX)
- [ ] **Fluxo de trabalho**: Etapas claras: Importar → Separar/Extrair → Visualizar/Exportar
- [ ] **Progress indication**: Barra de progresso (`#barra-inner`), spinners, KPIs atualizados — dar feedback sobre status de processamento
- [ ] **Error handling**: Mensagens de erro claras (ex: "PDF sem texto (imagem) — precisa OCR") — acionáveis
- [ ] **Empty states**: Estados vazios com ícones e mensagens explicativas em todas as abas
- [ ] **Confirmation actions**: Botões de excluir/limpar/confirmar com feedback visual

### 3. Interface e Abas (Tabs)
- [ ] **Nav section structure**: Seções divididas por `nav-section` com labels (IMPORTAR, FERRAMENTAS, VISUALIZAR, EXPORTAR)
- [ ] **Active state**: Botão ativo tem `background:rgba(26,75,140,.3)` e `border-right-color:var(--accent)`
- [ ] **Data-tab attribute**: Navegação via `data-tab="nome-da-aba"` — manter padrão
- [ ] **Tab animation**: `fadeUp` animation para aparecer/ocultar conteúdo das abas

### 4. Componentes de Interface
- [ ] **KPI cards**: Grid responsivo `grid-template-columns:repeat(auto-fit,minmax(180px,1fr))` — manter consistência
- [ ] **Dashboard charts**: 6 gráficos Chart.js com configurações padronizadas
- [ ] **Filter bar**: Inputs com `border-radius:var(--radius-sm)`, focus state with `var(--primary-light)`
- [ ] **Data tables**: `border-collapse:separate`, `border-spacing:0`, zebra striping (`tr:nth-child(even)`)
- [ ] **Badges**: Para status (ok/err) com cores de fundo diferenciadas

### 5. Drag & Drop e Upload
- [ ] **Upload area**: `#upload-area` com border `var(--border)` dashed, background `var(--card)`
- [ ] **Drag over state**: `border-color:var(--primary-light)`, `background:#f0f4fe`, `box-shadow:0 0 0 4px rgba(26,75,140,.08)`
- [ ] **Icon animation**: `transform:scale(1.12) translateY(-2px)` on hover do ícone
- [ ] **Subtext**: Mensagens auxiliares com tamanho de fonte reduzido (`font-size:11px`/`10px`)

### 6. Responsividade e Mobile
- [ ] **Breakpoints**: Mobile (~375px), Tablet (~768px), Desktop (~1440px)
- [ ] **Grid wrapping**: KPIs e dash cards se ajustam automaticamente via `auto-fit` minmax
- [ ] **Font size scaling**: `font-size:13px` base, mas ajusta em telas menores
- [ ] **Touch targets**: Botões e inputs com tamanho mínimo recomendado (44px ou equivalente)

### 7. Acessibilidade (Accessibility)
- [ ] **Contrast ratio**: Cores atuais — validar mínima AA (texto sobre var(--surface): `#0f172a` sobre `#f8fafc`)
- [ ] **Focus visible**:inputs e buttons têm outline/focus state definido (via `:focus` CSS)
- [ ] **Semantic HTML**: Uso de `header`, `nav`, `main`, `section`, `button`, `input` apropriados
- [ ] **ARIA labels**: Onde necessário (inputs de busca, selects)
- [ ] **Screen reader**: Textos alternativos em ícones (`.icon` com `aria-label` ou text content significativo)

### 8. Feedback Visual e Micro-interactions
- [ ] **Hover states**: Botões mudam `transform:translateY(-1px)` e `box-shadow:var(--shadow-md)`
- [ ] **Active state**: Botões pressionados `transform:translateY(0)`
- [ ] **Loading states**: Overlay `#loading-overlay` com spinner animado
- [ ] **Status messages**: `#status-bar`, `#import-log`, `#sep-card` — feedback consistente
- [ ] **Toast/notifications**: Mensagens temporárias de sucesso/erro

### 9. Export Design
- [ ] **Export buttons**: `.btn-prim`, `.btn-ok`, `.btn-sec` — consistência visual em todas as abas
- [ ] **File download**: `exportCSV()`, `exportXLSX()` — indicador de download concluído
- [ ] **Progress during export**: Barra de progresso durante geração de arquivos

### 10. Design System Documentation
- [ ] **Component guide**: Documentar cada tipo de card, badge, button, input
- [ ] **Color usage guide**: Quando usar `--primary` vs `--accent` vs `--success`
- [ ] **Spacing guide**: Valores permitidos para padding/margin
- [ ] **Responsive guide**: Como cada componente se comporta em diferentes telas

## Checklist de design por release
- [ ] Paleta de cores consistente em todos os componentes
- [ ] Tipografia hierárquica corre e legível
- [ ] Estados de hover/focus/active definidos para todos os interativos
- [ ] Componentes responsivos testados em 3+ breakpoints
- [ ] Contraste de cores validado (AA minimum)
- [ ] Feedback visual em todas as ações do usuário
- [ ] Ícones significativos e descrições alternativas
- [ ] Sistema de espaçamento e raio de border consistente

## Ferramentas recomendadas
- **Figma** ou **Sketch** para design system (se houver necessidade de redesign)
- **Chrome DevTools** para inspecionar computed styles e contrast
- **Contrast Ratio Checkers** (ex: WebAIM contrast checker)
- **BrowserStack** para testar em reais dispositivos móveis

## Próximos passos Designer
- Criar documento de design system resumido para a equipe
- Definir nova paleta caso seja necessária expansão de cores
- Criar componentes reutilizáveis documentation (mesmo sendo vanilla JS)
- Audit de acessibilidade automatizado (axe, lighthouse)
- Definir diretrizes de micro-interactions para novos componentes