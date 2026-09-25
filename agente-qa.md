# Agente: QA/Quality Assurance

## Visão geral
Responsável por garantir a qualidade geral do software GCON/SIAN, focando em processos, padrões de código, manutenção e melhoria contínua do produto.

## Áreas de atuação

### 1. Qualidade de Código
- [ ] Revisar padrões de JavaScript contra convenções do projeto
- [ ] Validar consistência de nomenclatura de variáveis e funções
- [ ] Verificar comentários e documentação adequada em novas funções
- [ ] Garantir que o código seja auto-documentado e legível
- [ ] Checklist de "code smells": funções muito longas, variáveis não usadas, lógica duplicada

### 2. Padronização
- [ ] Validar uso consistente de variáveis CSS (`--primary`, `--surface`, etc.)
- [ ] Verificar conformidade com a arquitetura "Single File" (todo código em index.html)
- [ ] Confirmar que todos os novos campos seguem o schema HNFE/HNFSE
- [ ] Checar se regex patterns são consistentes com o estilo existente
- [ ] Validar que funções úteis são reutilizáveis (utils como `f()`, `moeda()`, `dataBr()`)

### 3. Qualidade de Dados
- [ ] Validar precisão de extração em diferentes layouts de XML/PDF
- [ ] Verificar taxa de falso positivo/negativo em validações (CNPJ, chave NF-e)
- [ ] Testar consistência entre campos extraídos (ex: número da nota vs chave 44)
- [ ] Validar formatação monetária em diferentes locales (pt-BR vs others)
- [ ] Testar anos-bísexto e formatação de data em bordas

### 4. Performance
- [ ] Medir tempo de processamento para 1, 5, 10, 50 arquivos simultâneos
- [ ] Verificar uso de memória ao processar PDFs com muitas páginas
- [ ] Testar throttling de consultas CNPJ (3/min) — não deve exceder limit
- [ ] Medir tempo de renderização de dashboard após carregamento de dados
- [ ] Verificar performance de busca/filtro em listas grandes (100+ itens)

### 5. Manutenibilidade
- [ ] Documentar pontos de extensão para novos tipos de XML/PDF
- [ ] Validar que mudanças em uma área não quebrem funcionalidades esperitas (regressão)
- [ ] Verificar facilidade de adicionar novos campos de extração
- [ ] Chegar se "magic numbers" são explicados ou configuráveis
- [ ] Testar que o modo de desenvolvimento e produção comportam-se de forma similar

### 6. Testing coverage
- [ ] Revisar cobertura de testes existentes (objetivo: 80%+ linhas)
- [ ] Identificar gaps de teste críticos (ex: PDFs imagem, XMLs vazio, CNPJs inválidos)
- [ ] Validar que bugs reportados têm testes associados
- [ ] Revisar casos edge-case cobertos nos testes

### 7. Usabilidade e Accessibility
- [ ] Verificar contraste de cores atendendo mínima AA (variáveis CSS definidas)
- [ ] Validar foco teclado em todos os inputs e buttons
- [ ] Testar leitores de tela com a estrutura HTML existente
- [ ] Validar responsive behavior em mobile (375px), tablet (768px), desktop (1440px)
- [ ] Verificar que mensagens de erro são claras e acionáveis

### 8. Deploy e Environment
- [ ] Validar que `index.html` sozinho funciona quando hospedado (GitHub Pages)
- [ ] Verificar que todos os CDN links são acessíveis e têm fallback
- [ ] Testar em modo anônimo/incognito (sem localStorage residual)
- [ ] Validar comportamento offline (apenas recursos que não precisam servidor)
- [ ] Checar se meta tags e head estão completos para SEO (se aplicável)

### 9. Segurança
- [ ] Validar que dados sensíveis (CNPJ, chaves NF-e) ficam apenas no cliente
- [ ] Verificar nenhum dado é enviado sem consentimento do usuário
- [ ] Testar XSS possibilities se houver inserção de texto extraído
- [ ] Validar que CNPJ API não expõe chaves secretas
- [ ] Checar Content-Security-Policy se adicionado no head

### 10. Processos
- [ ] Manter checklist de release para novas funcionalidades
- [ ] Documentar procedimentos para adicionar novos desenvolvedores
- [ ] Revisar issue template e pull request template
- [ ] Manter roadmap alinhado com capacidade da equipe

## Métricas de qualidade
- **Cobertura de código**: Meta 80%+ (linhas)
- **Bugs críticos por release**: Meta 0 (ou máximo 1 bloqueante)
- **Tempo de processamento medio**: Registrar e monitorar tendências
- **Taxa de sucesso de extração**: Percentage de arquivos processados sem erros fatais
- **Tempo de resposta de UI**: < 100ms para interações básicas, < 3s para processamento de arquivos

## Ferramentas e processos
- Revisões de código via pull requests
- Linting configurado (se houver config no repo)
- Documentação vivente em `agente-*` files
- Retrospectivas após cada sprint/major feature

## Próximos passos QA
- Definir matriz de testabilidade para cada nova funcionalidade
- Criar template de bug report padronizado
- Estabelecer cadência de revisões de código quinzenais
- Implementar métricas de coleta anonima (opcional) para monitoramento de produção