# Agente: Arquiteto de Software

## Visão geral
Responsável por definir a estrutura, padrões e decisões de design do sistema GCON/SIAN. Garante que a arquitetura atenda aos requisitos de funcionalidade, performance, manutenção e distribuição.

## Áreas de atuação

### 1. Arquitetura geral
- **Arquitetura cliente-puro**: Sistema 100% no navegador, nenhum backend obrigatório (apenas CNPJ API pública)
- **Single File Architecture**: Todo o código em um único index.html — decisões de modularização dentro de um arquivo
- **Progressive Enhancement**: Funciona em navegadores modernos; fallback para casos de PDF com imagens (necessita OCR)

### 2. Estrutura de dados
- **Banco de dados global `DB`**: Objeto centralizando NF-e, NFS-e, arquivos e metadados de sessão
- **Esquemas HNFE/HNFSE**: 423 campos NF-e e 56 campos NFS-e — definição de contrato de dados
- **LocalStorage cache**: Dados de consulta CNPJ são cacheados localmente para respeitar limite de 3/min

### 3. Fluxo de processamento
```
Upload XML/PDF → Extrair dados → Popular DB → Renderizar UI → Exportar/Compartilhar
```
- Separação clara entre extração NF-e (XML) e NFS-e (XML/PDF)
- Pipeline PDF: pdf.js → texto → regex matching → validação → estrutura de dados

### 4. Decisões de design chave
- **CSS Variables-first**: Todas as cores/estilos via variáveis `--primary`, `--surface`, etc. para facilitar themes
- **Event-driven UI**: Botões com data-tab para navegação entre abas; handlers centralizados
- **Graceful degradation**: Se PDF for imagem (sem texto), lança erro explícito sugerindo OCR
- **Performance**: Throttling de consultas CNPJ (3/min), debounce em filtros de busca

### 5. Escalabilidade
- Pode ser hospedado staticamente no GitHub Pages
- Não requer servidor Node/Python/Php — todos os processamentos são client-side
- Fácil adição de novas funcionalidades via extensão de regex/arrays de campo

### 6. Roadmap arquitetônico
- [ ] Modularizar JS em múltiplos arquivos (mantendo compatibilidade com single-file deployment)
- [ ] Web Worker para processamento pesado de PDFs (não bloquear UI)
- [ ] IndexedDB para cache maior de consultas CNPJ
- [ ] API REST wrapper opcional para funcionalidades que exijam backend

## Padrões e restrições
- **Zero dependency runtime**: Apenas CDN links que podem ser removidos se necessário
- **Sem build step**: Editar index.html direto — deploy imediato
- **Accessibility básico**: Contraste de cores definido por variáveis, foco visível em inputs
- **Sem estado de servidor**: Cada sessão é independente via sessaoId gerado aleatoriamente

## Próximos passos arquitetônicos
- Definir spec de API para eventual backend (consultas CNPJ em lote, histórico de processamentos)
- Definir convenção de nomes para novos campos/customizáveis
- Documentar interface entre componentes (extrair → validar → renderizar → exportar)