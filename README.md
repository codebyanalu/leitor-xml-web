# GCON/SIAN — Leitor NF-e / NFS-e (Web)

Processador de XML e PDF de notas fiscais brasileiras **100% no navegador**. Sem servidor, sem instalação — único arquivo HTML. Hospedável no GitHub Pages.

## Source code

O que é versionado:

| Arquivo | O que é |
|---|---|
| `index.html` | o aplicativo inteiro (arquivo único, CSS + JS embutidos) |
| `painel-gerencial.html` | painel do estado do projeto, mesma linguagem visual do app |
| `README.md` | este arquivo |
| `testes/` | as três suítes de gate (ver [Testes](#testes)) |

O que **não** é versionado (continua na máquina, sai do índice do git):

| Grupo | Motivo |
|---|---|
| `amostras/`, `testes/verdade.json`, `testes/chaves-verdade.json`, `testes/montar-verdade.mjs` | PDFs e XMLs reais da cliente |
| `testes/node_modules/`, `testes/saidas/`, `*.traineddata`, `por.traineddata` | artefatos baixados / saída da bancada |
| `previews/`, `screenshots/`, `.opencode/plans/` | mockups e notas de sessão locais |
| `agente-*.md`, `conhecimento/*.md`, `.opencode/agent/`, `.opencode/command/`, `.opencode/skills/`, `workflow-rule.md`, `opencode.json` | documentação de processo: publicar só expõe a arquitetura interna de um sistema de cliente |
| `painel-estado.json` | estado do painel, gerado no navegador |

A lista completa e comentada está no `.gitignore`. O `git rm --cached` mantém tudo funcionando na máquina; o conteúdo continua no histórico, que é inofensivo (nenhum dado fiscal nele).

## Como usar

Abra `index.html` no navegador ou acesse via GitHub Pages.

## Funcionalidades

- **Importação XML**: arraste múltiplos XMLs — detecção automática NF-e (55) e NFS-e (CompNFe / Nacional)
- **Leitura PDF**: extrai chave 44 (DV válido), número/série da chave, CNPJs validados, datas, valores totais e emitente — **garantia de CNPJ + número da nota** (chave 44 → texto → OCR de reforço quando faltar um dos dois) — **agora suporta PDFs imagens (OCR via Tesseract.js)** — tabela limpa em tela cheia
- **Separar PDF**: divide PDF por nota (auto/página) com File System Access API + ZIP fallback — **nomeia pelo número da nota mesmo quando ele só aparece a partir da 2ª página**, e pede confirmação explícita acima de 150 páginas ou 200 MB
- **Consultar CNPJ**: aba Ferramentas → consulta `publica.cnpj.ws` (grátis, CORS) — razão social, fantasia, situação, IE/contribuinte ICMS, Simples/MEI com datas, endereço, contato, sócios com faixa etária — cache local
- **Consulta em Lote**: importa XLSX/CSV com coluna `CNPJ` e consulta **3 por minuto** (20 s entre uma e outra), com cache automático de 30 dias, barra de progresso, ETA, log por linha, painel de cota do navegador e exportação do resultado (CSV ou XLSX). Inclui um gerador de planilha modelo. O CSV neutraliza injeção de fórmula (um nome que comece com `=`, `+`, `-` ou `@` é prefixado com `'`)
- **Painel gerencial**: `painel-gerencial.html` mostra o estado do projeto — o que foi entregue, o que os gates provam, o que depende de decisão de quem contrata, e onde o leitor roda. Aceita salvar/carregar um `painel-estado.json` pelo próprio navegador (sem servidor); no GitHub Pages o arquivo não é publicado, então a leitura automática é desabilitada e o caminho é o seletor de arquivo
- **Visualização NF-e/NFS-e**: cards com emitente/destinatário, itens, impostos detalhados (ICMS/IPI/PIS/COFINS/IBS/CBS/ISS/CSRF)
- **Dashboard**: KPIs + 6 gráficos Chart.js
- **Exportação**: CSV e XLSX completos (40 colunas PDF, 93 NF-e, 56 NFS-e)
- **Busca**: filtro por texto/CNPJ/confiança
- **Interface**: tema claro/escuro persistente, breadcrumb de navegação, ícones SVG vetoriais (zero emoji) e layout responsivo (desktop/tablet/mobile)

## Privacidade

Todo o processamento acontece **no navegador**. Nada é enviado a servidor algum por este sistema: os XMLs e PDFs nunca saem da máquina. As únicas requisições externas são (1) as CDNs das bibliotecas e (2) a consulta de CNPJ ao `publica.cnpj.ws`, que recebe apenas o CNPJ digitado. Os resultados de CNPJ ficam em `localStorage` **por 30 dias** e podem ser apagados a qualquer momento pelo botão "Limpar cache" (Ferramentas → Consultar CNPJ). O cache usa o namespace versionado `cnpj_v2_`; as entradas do namespace antigo `cnpj_` são expurgadas no boot, porque uma versão anterior gravava a resposta da API sem escapar.

## Design tokens

Todas as cores, raios e sombras vivem como variáveis CSS em `:root` (tema claro) e `:root[data-theme="dark"]` (tema escuro). Para criar um novo tema, basta declarar o mesmo conjunto de variáveis em outro seletor — **nenhum valor de cor deve ser escrito à mão em `<style>` ou em `style=""`**. JS que precisa de cor (Chart.js) lê o token via `getComputedStyle(root).getPropertyValue('--x')`, nunca um literal.

## Funcionalidade Nova: Leitura de PDFs Imagens (OCR)

Graças à integração da biblioteca [Tesseract.js](https://tesseract.projectnap.org/), o GCON/SIAN agora pode ler PDFs escaneados (imagens) usando reconhecimento óptico de caracteres (OCR) 100% no navegador.

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

## Testes

Três suítes, todas em `testes/`, sem browser e sem OCR (fora a bancada). Cada uma sai com código diferente de zero quando algo falha, então servem de portão de entrada:

| Comando | O que faz | Depende de `amostras/` |
|---|---|---|
| `node regressao.mjs` | regressão estrutural do `index.html` (~1 s): sintaxe de cada bloco, segurança, CDNs/SRI, acessibilidade, contraste WCAG medido, chave 44, regras do projeto, agrupamento e **nomeação** do separador, módulo de CNPJ executado num `vm` | não |
| `node painel-check.mjs` | prova do `painel-gerencial.html`: roda o script do painel num `vm` com stub de DOM (inclusive o clique que filtra a lista), invariantes estruturais, e roda a regressão para conferir o KPI do painel | não |
| `node rodar.mjs` | bancada de extração: renderiza cada PDF de `amostras/`, faz OCR e compara com `verdade.json` (100% exigido, sai com 1 se não bater) | **sim** |

Ou, de dentro de `testes/`:

```bash
npm test          # regressao + painel-check + bancada
npm run test:rapido   # só as duas suítes de ~1 s
npm run painel    # só o painel-check
npm run bancada   # só a bancada de extração
```

`painel-check.mjs` e `regressao.mjs` resolvem os caminhos por `__dirname`, então rodam da raiz ou de dentro de `testes/`. Sem `amostras/` e `verdade.json` (ambos gitignored) a bancada sai com "Nenhum PDF em amostras/" e código 1 — é o comportamento esperado em clone novo, não uma falha do gate.

## Stack

| Tecnologia | Uso |
|---|---|
| JavaScript vanilla | Lógica |
| pdf.js / pdf-lib / jszip | Leitura e separação PDF |
| Chart.js (CDN) | Gráficos |
| SheetJS/xlsx (CDN) | Excel |
| Tesseract.js (CDN) | OCR para PDFs imagem |
| publica.cnpj.ws | Consulta CNPJ |
| Inter via Google Fonts (CDN) | Tipografia (400–800); cai para Segoe UI/system-ui se a CDN falhar |

## Licença

MIT
