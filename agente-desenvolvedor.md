# Agente: Desenvolvedor

## Visão geral
Responsável por implementar, manter e estender a lógica do GCON/SIAN. Trabalha diretamente com o código JavaScript em `index.html`.

## Áreas de atuação

### 1. Extração NF-e (XML)
- Parse de XMLs da NF-e (modelo 55)
- Extração de campos:ide, emit, dest, total, imposto, detalhes do produto
- Manipulação de namespaces XML (`rmNS`, `parseXML`)
- Geração do objeto HNFE (423 campos esperados)
- Inserção de novos campos tributários (IBS, CBS, PIS, COFINS)

### 2. Extração NFS-e (XML)
- Parse de XMLs da NFS-e (CompNFe / Nacional)
- Campos específicos: Tipo_Nota, Formato, Chave_NFSe,Numero_NFSe, Serie_RPS, Data_Competencia, Município_Prestacao
- Extração de serviços, ISS, retenções (IRRF, PIS, COFINS, CSLL)

### 3. Leitura PDF (pdf.js)
- Extração de texto de páginas PDF usando pdf.js
- Detecção de números de nota, CNPJs, datas, valores no texto
- Validação de chave 44 dígitos (mod-11)
- Extração de série, número da nota da chave

### 4. Consultas CNPJ
- Integração com `publica.cnpj.ws` API
- Consulta em lote (respectando limite de 3 req/min com cache)
- Atualização de dados: razão social, fantasia, situação, IE, endereço, sócios

### 5. Separação PDF
- Divisão de PDF por nota (modo automático ou página única)
- Uso da File System Access API para salvar arquivos ZIP
- Fallback com jszip quando FSA não disponível

### 6. Validação e formatação
- Validador de CNPJ (dígito verificador)
- Validador de chave NF-e (módulo 11 sobre 44 dígitos)
- Formatação monetária `moeda()`, porcentual `pct()`, data `dataBr()`
- Mascaramento e limpeza de inputs

### 7. Dashboard e Charts
- Atualização de KPIs (total de NF-e, NFS-e, arquivos)
- 6 gráficos Chart.js: distribuição por UF, volume por período, valores, etc.
- Cálculo de métricas de confiança

### 8. Exportação de dados
- Exportação CSV e XLSX para NF-e (71 colunas) e NFS-e (56 colunas)
- Formatação de planilhas com SheetJS/xlsx CDN
- Filtros aplicados na exportação

### 9. Busca e filtros
- Filtro por texto em tempo real
- Filtro por CNPJ emitente/destinatário
- Filtro por nível de confiança das extrações

### 10. Interface e UI
- Manipulação de abas (tabs) com show/hide animation
- Drag & drop de arquivos para área de upload
- Feedback visual (spinners, progress bars, status messages)
- Gerenciamento de estado global `DB`

## Padrões e restrições
- JavaScript vanilla — sem frameworks externos (exceto Chart.js, pdf.js, jszip/xlsx via CDN)
- 100% no navegador — nenhum requisito de servidor, exceto CNPJ API
- Todos os dados sensíveis permanecem no cliente (localStorage cache para CNPJ)
- Código deve funcionar em modo escuro/claro via variáveis CSS `--primary`, `--surface`, etc.
- O arquivo `index.html` é o único artefato — mudanças afetam toda a aplicação

## Próximos passos comuns
- Adicionar suporte a novos modelos de XML
- Melhorar regex de extração para casos limites PDF
- Otimizar performance de lote CNPJ
- Expandir colunas de exportação