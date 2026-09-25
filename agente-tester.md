# Agente: Tester

## Visão geral
Responsável por validar que o GCON/SIAN funciona corretamente, criar casos de teste e garantir que os requisitos de extração e interface sejam atendidos.

## Áreas de atuação

### 1. Testes de extração NF-e (XML)
- [ ] Validar parse de XMLs NF-e modelo 55 com diferentes estruturas (versões, namespaces)
- [ ] Testar extração de todos os campos HNFE (423 campos) em amostras reais de XML
- [ ] Validar campos de imposto (ICMS, IPI, PIS, COFINS, IBS, CBS) com valores zero e não-zero
- [ ] Testar detecção de NF-e cancelada (cStat=101) vs autorizada (cStat=100) vs denegada (cStat=110)
- [ ] Verificar Campos derivados: CNPJ emitente formatado, data em formato brasileiro, valores monetários

### 2. Testes de extração NFS-e (XML/PDF)
- [ ] Validar parse de XMLs NFS-e (CompNFe e Nacional)
- [ ] Testar extração de campos HNFSE (56 campos): Tipo_Nota, Chave_NFSe,Numero_NFSe,Serie_RPS
- [ ] Validar ISS, aliquotas, retenções (IRRF, PIS, COFINS, CSLL)
- [ ] Testar extração de dados de PDFs NFS-e (quando não há XML disponível)

### 3. Testes de leitura PDF
- [ ] Testar extração de texto de PDFs com texto selecionável
- [ ] Testar validação de chave 44 dígitos (mod-11) - chaves inválidas devem ser rejeitadas
- [ ] Testar extração de número da nota, série, CNPJ no corpo do PDF
- [ ] Testar detecção de data de emissão, data saida, vencimento
- [ ] Testar extração de valores totais e por item
- [ ] Testar casos de PDF com imagem (lançar erro apropriado sugerindo OCR)

### 4. Testes de consulta CNPJ
- [ ] Testar consulta única CNPJ via `publica.cnpj.ws`
- [ ] Testar consulta em lote respeitando limite 3 requisições/minuto
- [ ] Validar cache local automático de consultas anteriores
- [ ] Testar exibição de situação cadastral, motivo social, IE/Contribuinte
- [ ] Testar dados de sócios com faixa etária

### 5. Testes de separação PDF
- [ ] Testar divisão PDF por nota (modo automático)
- [ ] Testar divisão PDF página-a-página (modo unica)
- [ ] Testar fallback ZIP quando File System Access API não disponível
- [ ] Verificar nomes de arquivos gerados contendo número da nota/série

### 6. Testes de interface e usabilidade
- [ ] Testar navegação entre abas (importar, separar, pdfleitura, nfe, nfse, dashboard, exportar, cnpj)
- [ ] Testar drag & drop de arquivos na área de upload
- [ ] Testar validação de formulário (CNPJ 14 dígitos, aceitar apenas números)
- [ ] Testar responsive design em diferentes larguras de tela
- [ ] Testar feedback visual: spinners, progress bars, mensagens de erro/success

### 7. Testes de exportação
- [ ] Testar exportação CSV para NF-e (71 colunas esperadas)
- [ ] Testar exportação CSV para NFS-e (56 colunas esperadas)
- [ ] Testar exportação XLSX para ambos os tipos
- [ ] Validar que colunas extras/removidas respeitam filtros ativos
- [ ] Testar formatação monetária no exportado (R$ formatado corretamente)

### 8. Testes de dashboard e KPIs
- [ ] Contar NF-e e NFS-e corretamente após importação
- [ ] Verificar gráficos Chart.js renderizam com dados corretos
- [ ] Testar cálculo de valores totais somados
- [ ] Testar confiança média calculation (média de chave + cnpj + numero confidence)

### 9. Testes de busca e filtros
- [ ] Testar filtro por texto em tempo real (todos os campos visíveis)
- [ ] Testar filtro por CNPJ emitente
- [ ] Testar filtro por nível de confiança (≥70%, 45-69%, <45%)
- [ ] Testar combinação de múltiplos filtros

### 10. Testes de edge cases e erro handling
- [ ] XML inválido / malformado - manejar erro gracefully
- [ ] PDF sem texto (imagem) - sugerir OCR
- [ ] Arquivos vazios ou corrompidos
- [ ] Múltiplos arquivos com dados conflitantes
- [ ] Limite de armazenamento LocalStorage quase cheio

## Padrões e restrições
- **Testes automatizados**: Preferred com headless Chrome ou similar
- **Dados de teste**: Usar XMLs/PDFs reais de amostras (não dados sensíveis de clientes)
- **Cobertura mínima**: 80% dos caminhos de código principais
- **Ambiente**: Testar no Chrome, Firefox, Edge (todos baseados em Chromium)
- **Isolamento**: Cada teste deve limpar estado DB global entre execuções

## Ferramentas recomendadas
- Jest ou Mocha para testes unitários
- DOM Testing Library para testar elementos DOM
- Chrome DevTools para testar manualmente
- Lighthouse para performance e accessibility

## Próximos passos de teste
- Criar suite de testes automatizados para extração NF-e
- Definir dataset de testes com XMLs de diferentes emisores
- Implementar testes de regressão para bugs conhecidos
- Adicionar testes de performance para lote de 50+ arquivos