---
description: Atualiza o vault do Obsidian com o estado real do projeto e o raciocínio do ciclo.
---

Atualize o vault do Obsidian do GCON/SIAN com o que aconteceu nesta sessão: $ARGUMENTS

Invoque o subagente `obsidian` com estas instruções:

1. **Leia o estado real, não o que parece** (somente leitura, via bash):
   - `git log --oneline -8` e `git status --porcelain`
   - `git rev-list --left-right --count origin/main...HEAD` (quanto falta para pushar)
   - `testes/saidas/metricas.txt` (bancada) e rode `node testes/regressao.mjs` (regressão estrutural, ~1 s)
   - as saídas dos agentes desta sessão, se houver
2. **Atualize as notas** conforme o mapa do próprio agente (MOC, `10 - Conhecimento`, `20 - Tecnico`, `30 - Processo`, `40 - Testes`, `50 - Operacao`).
3. **Registre só o que foi observado.** Nada de "provavelmente" ou "deve-se ter".
4. **Nenhum dado fiscal real no vault**: apenas agregados, formatos e decisões.
5. Feche com: notas tocadas (o que mudou em cada uma), verificações feitas, achados em aberto, e a confirmação de que nenhum dado real foi para o vault.

O hook `obsidian-sync` (`.opencode/plugins/`) já cuida sozinho do bloco mecânico do MOC; a sua parte é a semântica.
