---
name: passeio-agentes
description: Execute o passeio obrigatório pelos 7 agentes do GCON/SIAN (Desenvolvedor → Arquiteto → Tester → QA → DevSecOps → Infraestrutura → Designer) antes de considerar qualquer mudança pronta. Use quando o usuário pedir "passeio pelos agentes", "revisão completa", "checklist dos agentes", "rodar os agentes", "aprovar a change/PR" ou quando uma tarefa de código terminar e deva ser validada.
---

# Passeio pelos Agentes (Conveyor Belt)

Nenhuma mudança no GCON/SIAN é considerada pronta sem passar pelos 7 subagents, nesta ordem:

1. `desenvolvedor` — implementa/corrige (único com permissão de edição)
2. `arquiteto` — estrutura, schema HNFE/HNFSE, single-file
3. `tester` — casos de teste e edge cases
4. `qa` — padrões, documentação, manutenibilidade
5. `devsecops` — segurança (varreduras obrigatórias)
6. `infraestrutura` — deploy, CDNs/fallback, performance, storage
7. `designer` — UI/UX, contraste AA, focus, responsivo 375/768/1440

## Como executar

- Invoque os subagents via Task, **em ordem**, um de cada vez (os review-only não podem rodar em paralelo com o desenvolvedor, pois dependem do código final).
- Passe a cada um: o diff/arquivos alterados, o objetivo da mudança, e o caminho da sua base de conhecimento (`conhecimento/<nome>.md`).
- Agents de revisão têm `edit: deny` — eles apenas emitem APROVO/BLOQUEIO.

## Regras de bloqueio (não negociáveis)

- `console.log/warn/error` no código = bloqueio (DevSecOps)
- `innerHTML` com dado de XML/PDF/OCR = bloqueio (DevSecOps)
- Secret/chave/token hardcoded = bloqueio (DevSecOps)
- Cor/radius/sombra hardcoded em CSS novo = bloqueio (QA/Designer)
- CDN nova sem fallback = bloqueio (Infraestrutura/Arquiteto)
- Schema HNFE/HNFSE quebrado = bloqueio (Arquiteto)
- Focus removido ou contraste < 4.5:1 = bloqueio (Designer)
- XML malformado sem erro "XML inválido ou malformado" = bloqueio (Tester/QA)

Se algum agente bloquear: o `desenvolvedor` corrige e o ciclo reinicia **da etapa correspondente**. Três ou mais bloqueios na mesma mudança → eleve para revisão de processo.

## Saída final (obrigatória)

Ao fim, gere exatamente este checklist, preenchendo com ✓ ou ✗:

```
## 👁‍🗨 Passeio pelos Agentes

- [ ] **Desenvolvedor**: Lógica implementada e testes unitários passam
- [ ] **Arquiteto**: Estrutura de dados e patterns são consistentes
- [ ] **Tester**: Casos de teste cobertos, incluindo edge cases
- [ ] **QA/Quality**: Padrões de código, documentação e maintainability
- [ ] **DevSecOps**: Validação de segurança, CSP, dependências
- [ ] **Infraestrutura**: Deploy compatível, CDNs ok, performance
- [ ] **Designer**: UI/UX, acessibilidade, responsive, design system

> ⚠️ Sem o checkmark em TODOS os itens acima, a mudança não está pronta.
```

Acrescente: decisões de cada agente, achados abertos e os "Aprendizados" coletados (que devem ser gravados na base de conhecimento via comando `/alimentar`).
