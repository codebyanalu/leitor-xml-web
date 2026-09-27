# Base de Conhecimento — Tester

> Alimentada diariamente via `/alimentar`. Itens mais recentes no topo da seção de registros.

## Decisões firmes
- Matriz mínima: NF-e XML, NFS-e (CompNFe/Nacional), PDF texto/imagem, CNPJ API, separação PDF, exportação, edge cases.
- Garantia CNPJ+número: linha só é válida com `CNPJ_Ok` e `NumeroOk`.
- Cada teste limpa o estado global `DB`.

## Armadilhas conhecidas
- Chaves 44 com DV inválido devem ser rejeitadas, não "aceitas com aviso".
- Lote de 50 arquivos é o gargalo de performance (limite 30s).

## Registros

### 2026-09-26 — Precisão do leitor PDF: bancada 160/160 e o que ela mascarou
- Acurácia global de 100% na bancada não prova que cada camada funciona: `valorColuna` estava inerte (bound usava o próprio valor como "próximo rótulo") e os campos vinham dos fallbacks de texto. Correção de caminho interno exige teste sintético do caminho afetado, não só conferir as saídas finais.
- Mudança de precedência em `eC` testar nos dois sentidos: cadeia corrompida 45/46 dígitos → repair (conf 88) e cadeia íntegra espaçada → conf 99. Ordem: janelas DV válido → repair → all → spaced.
- As 8 amostras são só DANFE: `eValor` (rótulos NFS-e "VALOR DO SERVIÇO"/"DEDUÇÕES") e a prioridade `bv.total||eValor` nunca são exercitadas — manter fixtures sintéticas para os rótulos fora do DANFE (casos "TOTAL A PAGAR", "VALOR TOTAL DOS PRODUTOS").
