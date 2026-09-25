# GCON/SIAN — Leitor NF-e / NFS-e (Web)

Processador de XML e PDF de notas fiscais brasileiras **100% no navegador**. Sem servidor, sem instalação — único arquivo HTML. Hospedável no GitHub Pages.

> **Nota**: Os arquivos `agente-*.md` são documentação de processo para equipes de desenvolvimento e NÃO devem ser commits no repositório. Apenas `index.html`, `README.md` e assets são o projeto source code.

## Como usar

Abra `index.html` no navegador ou acesse via GitHub Pages.

## Funcionalidades

- **Importação XML**: arraste múltiplos XMLs — detecção automática NF-e (55) e NFS-e (CompNFe / Nacional)
- **Leitura PDF**: extrai chave 44 (DV válido), número/série da chave, CNPJs validados, datas, valores totais e emitente — **agora suporta PDFs imagens (OCR via Tesseract.js)** — tabela limpa em tela cheia
- **Separar PDF**: divide PDF por nota (auto/página) com File System Access API + ZIP fallback
- **Consultar CNPJ**: aba Ferramentas → consulta `publica.cnpj.ws` (grátis, CORS) — razão social, fantasia, situação, IE/contribuinte ICMS, Simples/MEI com datas, endereço, contato, sócios com faixa etária — cache local
- **Visualização NF-e/NFS-e**: cards com emitente/destinatário, itens, impostos detalhados (ICMS/IPI/PIS/COFINS/IBS/CBS/ISS/CSRF)
- **Dashboard**: KPIs + 6 gráficos Chart.js
- **Exportação**: CSV e XLSX completos (34 colunas PDF, 71 NF-e, 56 NFS-e)
- **Busca**: filtro por texto/CNPJ/confiança

## Funcionalidade Nova: Leitura de PDFs Imagens (OCR)

Gracias à integração da biblioteca [Tesseract.js](https://tesseract.projectnap.org/), o GCON/SIAN agora pode ler PDFs escaneados (imagens) usando reconhecimento óptico de caracteres (OCR) 100% no navegador.

- O PDF é renderizado em canvas em alta resolução (2.5x scale)
- Tesseract.js processa cada página buscando texto em português e inglês
- Os resultados são combinados com os padrões de extração existentes
- Dados extraídos via OCR têm nível de confiança reportado

## Campos PDF extraídos

`chave, chaveValida, serie, numero, CNPJs, datas, valor, Protocolo, NatOp, IE, Endereço/CEP/Mun/UF, Base/Valor ICMS, Valor Produtos/Total`

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
