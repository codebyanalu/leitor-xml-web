# Regora de Processo: Todas as Implementações Passam por Todos os Agentes

## Visão Geral
Estabelecer que **nenhuma mudança, feature, bug fix ou documentação** será considerada completa ou aprovada até passar por todas as 7 perspectivas de agentes definidas no projeto GCON/SIAN. Isso garante cobertura multidisciplinar em todas as decisões.

## Fluxo de Conveyor Belt (Cintura de Transporte)

Todo trabalho segue esta sequência obrigatória:

```
1. Requisição/Issue
          ↓
2. Desenvolvedor (implementação)
          ↓
3. Arquiteto (revisão de estrutura/design)
          ↓
4. Tester (validação de funcionalidades)
          ↓
5. QA/Quality (garantia de qualidade/standards)
          ↓
6. DevSecOps (revisão de segurança)
          ↓
7. Infraestrutura (verificação de deploy/environment)
          ↓
8. Designer (revisão de UI/UX)
          ↓
9. FECHADO - Aprovado para release
```

## Regra Oficial

### 📋 PR/Issue Template Obrigatório

Todo Pull Request ou Issue deve conter este checklist no final:

```
## 👁‍🗨 Passeio pelos Agentes

- [ ] **Desenvolvedor**: Lógica implementada e testes unitários passam
- [ ] **Arquiteto**: Estrutura de dados e patterns são consistentes
- [ ] **Tester**: Casos de teste cobertos, incluindo edge cases
- [ ] **QA/Quality**: Padrões de código, documentação e maintainability
- [ ] **DevSecOps**: Validação de segurança, CSP, dependências
- [ ] **Infraestrutura**: Deploy compatível, CDNs ok, performance
- [ ] **Designer**: UI/UX, acessibilidade, responsive, design system

> ⚠️ Sem o checkmark em TODOS os itens acima, o PR não será merged.
```

### 🔄 Processo de Workflow

1. **Criação da Issue**: O pedido é criado e atribuído a todos os agentes simultaneamente (via etiquetas/milestones)

2. **Desenvolvedor**: Implementa a feature/fix no `index.html`. Commit com descrição detalhada do que foi alterado.

3. **Arquiteto**: Revisa se a alteração se encaixa na arquitetura global, schema HNFE/HNFSE, e se não quebra padrões estabelecidos.

4. **Tester**: Cria e executa testes para validar a funcionalidade. Documenta resultados. Pode solicitar regressões.

5. **QA/Quality**: Faz revisão de código, valida padrões, cobertura de teste, legibilidade, documentation.

6. **DevSecOps**: Verifica segurança - XSS, validação de entrada, dependências CDN, rate limiting, privacy.

7. **Infraestrutura**: Confirma que o deploy funcionará - CDNs acessíveis, GitHub Pages compatível, performance monitorada.

8. **Designer**: Revisa visual - contrastes, responsive, componentes, micro-interactions, accessibility.

9. **Aprovação Final**: Apenas quando TODOS os checks estão verdes o código é merged para main branch.

### 🛡️ Exceções e Tratamento de Bloqueios

- Se algum agente **bloqueia** a passagem, o retorno ocorre com issues específicas.
- O desenvolvedor corrige e o ciclo reinicia da etapa correspondente.
- Em caso de urgência crítica, pode ser solicitada exceção via issue separada com justificativa e aprovação de pelo menos 5 dos 7 agentes.

### 📊 Métricas de Processo

- **Tempo médio de ciclo**: Tempo desde criação da issue até approval
- **Taxa de retorno por agente**: Quantas vezes cada agente devolve o trabalho
- **Gaps identificados**: Padrões de quais agentes mais reclamam/retornam
- **Tempo de feedback médio** por agente

## 🛡️ Regras de Segurança com Travamentos Obrigatórios

Estas regras NÃO podem ser ignoradas e IMPOSSIBILITAM o merge caso não sejam atendidas:

### 1. Segurança do Lado do Cliente (Client-Side Security - DevSecOps)
- [BLOQUEIO] **Nenhum console.log em produção**: Remover todos os `console.log`, `console.warn`, `console.error` do código antes do deploy. O DevSecOps fará varredura automática.
- [BLOQUEIO] **XSS Prevention validation**: Todas as strings extraídas de XML/PDF devem ser sanitizadas antes de serem inseridas no DOM via `innerHTML`. Apenas `textContent` é permitido, ou usar elementos `createTextNode`.
- [BLOQUEIO] **LocalStorage consent**: O código deve ter explícito aviso ao usuário de que dados ficam no navegador (localStorage). Ausência desse aviso bloqueia o merge.
- [BLOQUEIO] **No hardcoded secrets**: Busca por padrões de chaves API, senhas, tokens no código. Regex: `(?i)(api[_-]?key|secret|token|password).{0,20}=[^"'\\s]+` deve retornar 0 matches.

### 2. Validação de Dados e Entrada (Tester/QA)
- [BLOQUEIO] **Validação de chave NF-e**: Qualquer nova funcionalidade que lide com chave 44 dígitos deve passar pelo validador `vH()` existente. Caso uso de nova regex, deve ser validada contra 10 chaves reais e 10 falsas.
- [BLOQUEIO] **Rate limit CNPJ**: O código deve respeitar limite de 3 requisições/min para `publica.cnpj.ws`. Testes devem confirmar que mais de 3 req em 1 minuto bloqueia ou throttles corretamente.
- [BLOQUEIO] **XML malformed handling**: O código deve lançar erro específico "XML inválido ou malformado" quando o parser encontrar erros, e NÃO mostrar erro genérico ou quebrar a UI.

### 3. Arquitetura e Estrutura (Arquiteto/Desenvolvedor)
- [BLOQUEIO] **Schema HNFE/HNFSE compliance**: Todos os campos novos devem seguir o padrão dos 423 campos NF-e e 56 campos NFS-e. Ausência de campo obrigatório que quebre o objeto de retorno bloqueia o merge.
- [BLOQUEIO] **Single File Architecture**: O `index.html` deve continuar sendo um arquivo auto-contido. Qualquer importação de JS externo (exceto CDNs já listados) deve ser aprovada por Arquiteto e DevSecOps.
- [BLOQUEIO] **CSS Variables usage**: Cores, sombras, border-radius devem usar as variáveis `--primary`, `--surface`, `--text`, etc. Uso de hardcoded cores (hex/rgb direto) em novos estilos bloqueia o merge.

### 4. Performance e Recursos (Infraestrutura/QA)
- [BLOQUEIO] **Tempo de processamento máximo**: Processamento de lote com 50 arquivos não deve exceder 30 segundos no Chrome. Teste de performance obrigatório.
- [BLOQUEIO] **LocalStorage quota**: Verificar se dados de lote não excedem ~4MB de LocalStorage. Se houver risco, implementar limpeza automática ou avisar usuário.
- [BLOQUEIO] **CDN fallback**: Se usar algum CDN externo, deve haver estratégia de fallback caso o CDN caia. Ausência de fallback bloqueia merge.

### 5. Design e Acessibilidade (Designer/QA)
- [BLOQUEIO] **Contrast ratio mínimo AA**: Todas as novas cores ou alterações de contraste devem ser validadas contra WebAIM contrast checker (mínimo 4.5:1 para texto normal).
- [BLOQUEIO] **Focus state em todos inputs**: Todo elemento `<input>` e `<button>` focável deve ter estilo `:focus` visível. Remoção acidental de outlines bloqueia merge.
- [BLOQUEIO] **Responsive em 3 breakpoints**: Layout deve ser testado em mobile (375px), tablet (768px) e desktop (1440px). Quebra em qualquer um bloqueia o merge.

## 🔒 Fluxo de Bloqueio (When Block Happens)

Se algum agente aplica um travamento (BLOQUEIO):

1. **O PR é imediatamente pausado** e não avança para a próxima etapa
2. **Issue criada** descrevendo qual agente bloqueou e o motivo
3. **Desenvolvedor deve corrigir** o problema e fazer novo commit
4. **O ciclo reinicia** da etapa correspondente (ou da etapa 2 se for código)
5. **Se 3 ou mais agentes bloquearem** na mesma PR, o caso é elevado para revisão de processo

## ⚠️ Exceções Críticas (Somente com aprovação de 6/7 agentes)

Em casos de urgência absolutamente crítica (bugs em produção, vazamento de dados), pode-se solicitar exceção via issue separada com:
- Justificativa detalhada do pourquoi da quebra da regra
- Plano de correção imediata (hotfix) após release
- Aprovação escrita de pelo menos 6 dos 7 agentes
- Documentação do que quebrou e por quê

Isso NÃO é o padrão e deve ser exceção, não regra.

### 🧪 Como Testaremos Este Processo

Vamos testar com uma feature de exemplo:

1. **Criar issue**: "Adicionar novo campo de imposto IBS na extração NF-e"
2. **Todos os agentes revisam** e marcam seu checklist
3. **Medir tempo** de cada etapa
4. **Identificar gargalos** (ex: DevSecOps demora mais por verificação de regex?)
5. **Ajustar processo** se necessário

## Exemplo Prático de Testes

### Teste 1: Nova Feature
```
Issue: "Adicionar suporte a campo ICMS-ST na extração NF-e"

Etapa 1 - Desenvolvedor: Adiciona campo nas 423 linhas HNFE, atualiza extração NF-e
Etapa 2 - Arquiteto: Verifica se novo campo segue padrão dos outros 423
Etapa 3 - Tester: Cria XMLs de teste com ICMS-ST preenchido e vazio
Etapa 4 - QA: Valida se comments e padrões estão ok
Etapa 5 - DevSecOps: Verifica se regexs novas não causam ReDoS
Etapa 6 - Infra: Confirma deploy no GitHub Pages não quebra
Etapa 7 - Designer: Verifica se tabela de impostos fica responsiva

Resultado: Todos aprovam → PR mergeado
```

### Teste 2: Bug Fix
```
Issue: "NF-e com chave inválida não mostra erro adequado"

Etapa 1-7: Todos validam o fix, testam casos edge, confirmam que erro agora aparece
Resultado: Aprovado
```

### Teste 3: Documentação
```
Issue: "Atualizar README com nova funcionalidade de separação PDF"

Etapa 1-7: Desenvolvedor documenta, outros validam precisão
Resultado: Aprovado
```

## 📝 Novo Checklist Padrão para Desenvolvedores

Antes de submeter um PR, o desenvolvedor deve:

1. ✅ Verificar se todas as 7 agências foram consultadas
2. ✅ Adicionar screenshots/descrição do que mudou
3. ✅ Executar testes manuais básicos
4. ✅ Verificar se não quebra funcionalidades existentes
5. ✅ Confirmar que `index.html` ainda é auto-contido

---

**Regra vigente a partir de agora**: Nenhuma alteração no projeto GCON/SIAN será considerada pronta sem a aprovação formal de todos os 7 agentes, seguindo o fluxo definido acima.

Isso será nosso processo padrão e será testado na próxima issue/feature que entrarmos.