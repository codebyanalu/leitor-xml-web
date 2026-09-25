# Agente: DevSecOps

## Visão geral
Responsável por garantir que o GCON/SIAN seja desenvolvido e mantido com práticas de segurança integradas, desde o código até o deployment. Foca em proteger dados sensíveis e prevenir vulnerdades em um ambiente 100% client-side.

## Áreas de atuação

### 1. Segurança do Lado do Cliente (Client-Side Security)
- [ ] **XSS Prevention**: O código injeta textos extraídos de XML/PDF diretamente no DOM (`textContent`, `innerText`). Validar que nenhum código executável é injetado.
- [ ] **Data Exposure**: Verificar se chaves NF-e, CNPJs, valores financeiros são exibidos/armazenados de forma segura.
- [ ] **LocalStorage Security**: Dados ficam no LocalStorage — garantir que não há vazamento entre sessões diferentes.
- [ ] **Dependency Risks**: CDN links (Chart.js, pdf.js, jszip, xlsx) podem ser comprometidos — monitorar versões e hashes.

### 2. Validação de Entrada e Sanitização
- [ ] **XML parsing**: Usar `DOMParser` com `rmNS` para remover namespaces — validar que não há XXE (XML External Entity) vulnerabilities.
- [ ] **Regex Safety**: Muitas regexs no código (`A` array, validation patterns) — testar contra entradas maliciosas que causem ReDoS (Regular Expression Denial of Service).
- [ ] **Input sanitization**: Valores de formulário (CNPJ input) — garantir que apenas números são aceitos, prevenindo injeção de padrões.

### 3. Dependencies e Supply Chain
- [ ] **CDN Integrity**: Adicionver `integrity` e `crossorigin` attributes nos script tags das CDNs (currently missing — avaliar se adicionar ou aceitar risco)
- [ ] **Version pinning**: Versões específicas no código (ex: `chart.js@4.4.7`) — evitar atualizações automáticas que quebrem funcionalidades.
- [ ] **Vulnerability scanning**: Rodar `npm audit` ou equivalente se houver build step; para caso vanilla, verificar public CVEs das versões usadas.
- [ ] **Fallback strategies**: Se CDN cair, aplicação quebra — definir estratégias de fallback.

### 4. Cryptographic Practices
- [ ] **CNPJ validation**: Algoritmo de dígito verificador em JavaScript — garantir que implementação é segura e testada.
- [ ] **Chave NF-e validation**: Módulo 11 sobre 44 dígitos — validar implementação `vH()` function.
- [ ] **No weak crypto**: Aplicação não realiza criptografia — verificar se não há uso de algoritmes fracos.

### 5. Segurança de Deployment
- [ ] **HTTPS only**: Garantir que deployment seja obrigatoriamente via HTTPS (GitHub Pages força isso).
- [ ] **Content Security Policy (CSP)**: Considerar adicionar header CSP no deploy para restringir sources de scripts.
- [ ] **Subresource Integrity (SRI)**: Adicionar hashes de integridade para scripts CDN críticos.
- [ ] **Secure headers**: Verificar que headers de segurança são adequados (mesmo sendo static-only).

### 6. Privacy and Data Protection
- [ ] **Data minimization**: Apenas dados necessários são coletados — nenhum dado de cliente é enviado sem consentimento.
- [ ] **LocalStorage consent**: Usuário deve ser informado que dados ficam no navegador (explicado no README).
- [ ] **No analytics by default**: Nenhum tracking analytics coletado sem opt-in.
- [ ] **Data export transparency**: Exportação CSV/XLSX contém dados do usuário — garantir que usuário compreende o que está exportando.

### 7. Segurança de Operações
- [ ] **Rate limiting**: Limite 3/min para CNPJ queries já implementado — validar que não pode ser burlado.
- [ ] **Error handling**: Erros de rede devem ser tratados sem expor informações sensíveis.
- [ ] **Session isolation**: Cada sessão tem `sessaoId` aleatório — validar que dados não são misturados entre usuários diferentes.
- [ ] **Console logging**: `console.log` presente no código — remover ou tornar opcional para production.

### 8. Code Review Security Checklist
- [ ] Input validation covering all entry points (file upload, CNPJ input, search queries)
- [ ] No eval() usage (verificar código - parece que não há eval)
- [ ] Safe regex patterns (testar contra strings enormes que causem backtracking)
- [ ] No hardcoded secrets/keys (confirmação - não há secrets no código visível)
- [ ] Error messages user-friendly vs. developer-info

### 9. Testing Security
- [ ] **Fuzz testing**: Testar regexs e parsers com entradas extremas/aleatórias
- [ ] **Origin testing**: Testar em diferentes origens (protocolos, ports)
- [ ] **Storage testing**: Verificar LocalStorage não vaza entre abas/tabs
- [ ] **Console error testing**: Garantir que erros não quebrem a UI silenciosamente

### 10. Incident Response
- [ ] **Vulnerability disclosure**: Canal para reportar bugs de segurança encontrados
- [ ] **Emergency rollback**: Proceder para versão anterior se nova release introduzir vulnerabilidade
- [ ] **Communication plan**: Informar usuários se há necessidade de ação (ex: CDN cair, API mudar)

## Checklist de segurança por release
- [ ] XSS vectors tested across all input points
- [ ] CDN integrity validated (or risk accepted)
- [ ] No new console.log statements left in production code
- [ ] LocalStorage usage documented and consented
- [ ] Rate limits functioning correctly
- [ ] Error messages don't leak internal information
- [ ] CSP considered (even if permissive)

## Ferramentas recomendadas
- **Snyk** ou **GitHub Dependabot** para monitoring de dependencies (apesar de vanilla JS)
- **OWASP ZAP** para testing de segurança de web apps (modo manual)
- **FFUF** ou **gobuster** para discovery de rotas se houver backend futuramente
- **Custom scripts** para testar ReDoS em regexs críticas

## Próximos passos DevSecOps
- Adicionir `integrity` attributes aos script tags CDN críticos
- Criar script de fuzz testing para as regexs principais
- Documentar threat model do aplicativo
- Implementar Content Security Policy (CSP) header no deployment
- Agendar quarterly security review do código