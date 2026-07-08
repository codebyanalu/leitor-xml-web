# GCON/SIAN — Leitor NF-e / NFS-e (Web)

Processador de XML de notas fiscais brasileiras **100% no navegador**. Sem servidor, sem instalação, sem dependências — único arquivo HTML.

## Como usar

Abra o arquivo `leitor_xml_web.html` no navegador (clicar duas vezes).

## Funcionalidades

- **Importação**: arraste ou clique para selecionar múltiplos XMLs
- **Detecção automática**: NF-e (modelo 55) e NFS-e (CompNFe municipal / NFSe Nacional)
- **Visualização NF-e**: notas com emitente, destinatário, tabela de produtos e impostos (ICMS, IPI, PIS, COFINS, IBS/CBS) — todos os campos detalhados em seções expansíveis + totais por nota
- **Visualização NFS-e**: notas com prestador, tomador, ISS, PIS, COFINS, CSLL, IRRF, INSS, IBS/CBS — todos os 56 campos
- **Dashboard**: gráficos de pizza e barras (Chart.js) — docs por tipo, retenção ISS, formato NFS-e, top prestadores
- **Exportação**: CSV e Excel (XLSX) completos
- **Busca**: filtro por texto e por CNPJ em cada aba

## Campos extraídos

### NF-e (71 campos por produto)
Nota, emitente, destinatário, produto (cProd, NCM, CEST, CFOP, etc), ICMS (14 campos), IPI (5), PIS (4), COFINS (4), IBS/CBS (10)

### NFS-e (56 campos por nota)
Nota, serviço (cTribNac, NBS, Lei 116), ISS (BC, alíquota, retenção), CSRF (PIS, COFINS, CSLL, IRRF, INSS), IBS/CBS, prestador, tomador

## Stack

| Tecnologia | Uso |
|---|---|
| JavaScript vanilla | Toda a lógica |
| Chart.js (CDN) | Gráficos do dashboard |
| SheetJS/xlsx (CDN) | Exportação Excel |
| CSS puro | Estilo (sem frameworks) |

## Licença

MIT
