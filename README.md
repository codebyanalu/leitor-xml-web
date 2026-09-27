# GCON/SIAN — Leitor NF-e / NFS-e (Web)

Processador de XML e PDF de notas fiscais brasileiras **100% no navegador**. Sem servidor, sem instalação — único arquivo HTML. Hospedável no GitHub Pages.

> **Nota**: Os arquivos `agente-*.md` são documentação de processo para equipes de desenvolvimento e NÃO devem ser commits no repositório. Apenas `index.html`, `README.md` e assets são o projeto source code.

## Como usar

Abra `index.html` no navegador ou acesse via GitHub Pages.

## Funcionalidades

- **Importação XML**: arraste múltiplos XMLs — detecção automática NF-e (55) e NFS-e (CompNFe / Nacional)
- **Leitura PDF**: extrai chave 44 (DV válido), número/série da chave, CNPJs validados, datas, valores totais e emitente — **garantia de CNPJ + número da nota** (chave 44 → texto → OCR de reforço quando faltar um dos dois) — **agora suporta PDFs imagens (OCR via Tesseract.js)** — tabela limpa em tela cheia
- **Separar PDF**: divide PDF por nota (auto/página) com File System Access API + ZIP fallback
- **Consultar CNPJ**: aba Ferramentas → consulta `publica.cnpj.ws` (grátis, CORS) — razão social, fantasia, situação, IE/contribuinte ICMS, Simples/MEI com datas, endereço, contato, sócios com faixa etária — cache local
- **Visualização NF-e/NFS-e**: cards com emitente/destinatário, itens, impostos detalhados (ICMS/IPI/PIS/COFINS/IBS/CBS/ISS/CSRF)
- **Dashboard**: KPIs + 6 gráficos Chart.js
- **Exportação**: CSV e XLSX completos (40 colunas PDF, 71 NF-e, 56 NFS-e)
- **Busca**: filtro por texto/CNPJ/confiança

## Funcionalidade Nova: Leitura de PDFs Imagens (OCR)

Gracias à integração da biblioteca [Tesseract.js](https://tesseract.projectnap.org/), o GCON/SIAN agora pode ler PDFs escaneados (imagens) usando reconhecimento óptico de caracteres (OCR) 100% no navegador.

- O PDF é renderizado em canvas em alta resolução (escala 3 — `ESC=3`)
- Tesseract.js processa cada página buscando texto em português e inglês
- Os resultados são combinados com os padrões de extração existentes
- Dados extraídos via OCR têm nível de confiança reportado

## Campos PDF extraídos

`chave, chaveValida, serie, numero, CNPJs, datas, valor, Protocolo, NatOp, IE, Endereço/CEP/Mun/UF, Base/Valor ICMS, Valor Produtos/Total`

### Garantia de CNPJ + número da nota

A leitura de PDF só é dada como completa quando **CNPJ e número** foram localizados. Cadência de fallback:

1. **Chave 44** (DV válido) → número nas posições 26-34 e CNPJ do emitente nas posições 7-20 (fonte `chave 44`);
2. **Texto do PDF** → âncoras como "Número da nota", "Nº", "Nº RPS" + CNPJ validado por dígito verificador (fonte `texto`);
3. **OCR de reforço (Tesseract)** → disparado automaticamente quando faltar CNPJ, CNPJ com DV inválido ou número (fonte `OCR`);
4. Se ainda assim faltar, a linha aparece em **vermelho** com aviso “falta CNPJ/número”, badge `✗`, coluna `Garantia` e banner de alerta na tabela.

Colunas de auditoria na exportação: `Garantia`, `NumeroOk`, `CNPJ_Ok`, `CNPJ_Fonte`, `Numero_Ancora`, `OCR_Reforco`. CNPJs placeholder (`00.000.000/0000-00`) e trechos das próprias 44 posições da chave são descartados para evitar falso positivo.

## Stack

| Tecnologia | Uso |
|---|---|
| JavaScript vanilla | Lógica |
| pdf.js / pdf-lib / jszip | Leitura e separação PDF |
| Chart.js (CDN) | Gráficos |
| SheetJS/xlsx (CDN) | Excel |
| Tesseract.js (CDN) | OCR para PDFs imagem |
| publica.cnpj.ws | Consulta CNPJ |

## Licença

MIT
