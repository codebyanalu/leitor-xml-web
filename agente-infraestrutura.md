# Agente: Infraestrutura

## Visão geral
Responsável por garantir que o GCON/SIAN esteja disponível, performático e escalável no ambiente de hospedagem. Foca no deployment, configuração de ambiente e operação do sistema.

## Áreas de atuação

### 1. Hospedagem e Deployment
- [ ] **GitHub Pages**: Estratégia de deploy principal — `index.html` puro, nenhum build step necessário
- [ ] **Branch configuration**: Deploy pode ser feito a partir de `main` ou `gh-pages` branch
- [ ] **Custom domain**: Suporte a domínios personalizados (ex: `gcon-sian.github.io`)
- [ ] **HTTPS**: Certificados automáticos via GitHub Pages (Let's Encrypt)

### 2. Configuração de Ambiente
- [ ] **CDN dependencies**: Todos os externos (Chart.js, pdf.js, jszip, xlsx) carregados via CDN — garantir uptime desses serviços
- [ ] **Meta tags**: charset, viewport, description para SEO básico
- [ ] ** favicon**: Ícone para a aba do navegador (currently usando favicon padrão)
- [ ] **Cache headers**: Configuração de cache control para recursos estáticos

### 3. Escabilidade
- [ ] **Static only**: Zero servidor — pode ser hospedado em qualquer provider static (Netlify, Vercel, Cloudflare Pages)
- [ ] **Rate limiting**: Limite de 3/min para consultas CNPJ — implementado client-side, não afeta servidor
- [ ] **Concurrent users**: Testado para múltiplos usuários simultâneos (dados isolados por sessaoId)
- [ ] **Storage limits**: LocalStorage limits (~5MB) — monitorar se dados de lote excedem

### 4. Gestão de Versões
- [ ] **Versionamento de arquivos**: `index.html` versão única — mudanças requerem novo deploy
- [ ] **Rollback**: Fazer deploy de versão anterior caso novo quebre funcionalidades
- [ ] **Changelog**: Documentar mudanças entre versões no README
- [ ] **Tags de release**: Marcar versões estáveis no git

### 5. Monitoramento e Observability
- [ ] **Usage analytics**: Pode adicionar analytics simples (plausible/ga lite) que não impacta performance
- [ ] **Error tracking**: Capturar erros JavaScript não tratados (window.onerror)
- [ ] **Performance metrics**: Lighthouse CI para verificar que performance não degrada
- [ ] **Uptime monitoring**: Verificar que a aplicação está disponível (uptime robot, etc.)

### 6. Backup and Recovery
- [ ] **Git repo backup**: O código fonte está no git — isso serve como backup
- [ ] **Deploy history**: Git history permite rollback a versões anteriores
- [ ] **Documentation**: README e agentes documentam como reproduzir o ambiente

### 7. Cross-browser compatibility
- [ ] **Chrome/Edge**: Versões atuais — principal foco (usado por ~80% dos usuários)
- [ ] **Firefox**: Versões atuais — testar extração NF-e/NFS-e
- [ ] **Safari**: Versões recentes — validar regex e PDF parsing
- [ ] **Mobile browsers**: Testar em iOS Safari e Android Chrome (responsive design)

### 8. Network considerations
- [ ] **CORS**: Consultas CNPJ para `publica.cnpj.ws` — já configurado com CORS headers
- [ ] **No external API required**: Funciona offline exceto consultas CNPJ
- [ ] **Timeout handling**: Tratar timeouts de rede graceful (especialmente consultas lote CNPJ)

### 9. Resource optimization
- [ ] **Minification**: `index.html` pode ser minificado antes de deploy production
- [ ] **Compression**: Gzip/Brotli automático do GitHub Pages/Netlify
- [ ] **Image optimization**: Assets (icons) devem ser SVG ou WebP para peso reduzido
- [ ] **Critical CSS**: CSS inline pode ser injetado para evitar FOUC

### 10. Compliance and Policies
- [ ] **Privacy policy**: Dados ficam no cliente — política de privacidade simplificada
- [ ] **Data retention**: Usuário pode limpar localStorage manualmente
- [ ] **Cookie policy**: Nenhum cookie usado (exceto possível session storage se necessário)

## Checklist de deploy
- [ ] `index.html` latest version no repo
- [ ] Todos os caminhos de CDN válidos e acessíveis
- [ ] Funcionamento testado em navegadores principais
- [ ] LocalStorage tests passed (quota sufficient)
- [ ] CNPJ API rate limit functioning
- [ ] Responsivo testado em 3 breakpoints minimum
- [ ] SSL/HTTPS ativo
- [ ] README atualizado com instruções de uso

## Estratégias de manutenção
- **Monthly**: Verificar se CDNs ainda estão disponíveis e versões mais recentes
- **Quarterly**: Fazer Lighthouse audit e reportar métricas
- **On-new-feature**: Validar que deploy não quebra funcionalidades existentes

## Ferramentas recomendadas
- GitHub Actions para CI/CD automático (opcional)
- Lighthouse CI para métricas de performance
- Webpage Test para testes de velocidade em diferentes localidades
- GitHub Projects para tracking de issues e deployments

## Próximos passos de infraestrutura
- Configurar GitHub Actions workflow para validação automatizada
- Adicionir Lighthouse CI para monitoramento de performance
- Documentar procedimento de backup do repositório
- Definir SLA de uptime e procedimento de emergência