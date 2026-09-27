# Base de Conhecimento — Arquiteto

> Alimentada diariamente via `/alimentar`. Itens mais recentes no topo da seção de registros.

## Decisões firmes
- Arquitetura 100% client-side, sem backend; única exceção: `publica.cnpj.ws`.
- Contratos de dados: HNFE (423 campos NF-e) e HNFSE (56 campos NFS-e).
- Pipeline: Upload → Extrair → Popular `DB` → Renderizar → Exportar.
- CSS variables-first e navegação por `data-tab` são padrão, não estilo.

## Armadilhas conhecidas
- Toda "simplificação" que introduz arquivo/dependência externa quebra o deploy estático.

## Registros
