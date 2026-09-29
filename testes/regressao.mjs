// Regressão estrutural do GCON/SIAN — SEM OCR, SEM browser, ~1 s.
// Uso: node regressao.mjs   (exit != 0 se algo falhar)
//
// Cobre o que a bancada de PDF (rodar.mjs) NÃO alcança: a bancada fatia o index.html
// do marcador do ModPDFIsolado até o primeiro </script>, ou seja, tudo que vem DEPOIS
// do fim desse módulo (tema, sprite, CSS, acessibilidade, CDNs, separador, CNPJ) é
// estruturalmente invisível para ela. Aqui essa parte é auditada de verdade.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

/* Documentação de processo (workflow-rule.md, agente-*.md, conhecimento/*.md)
   saiu do índice do git: continua na máquina, mas não existe em clone novo nem
   em CI. Ler esses arquivos sem guarda fazia o gate passar aqui e ESTOURAR lá,
   com ENOENT, antes do primeiro teste. */
const FORA_DO_GIT = ['workflow-rule.md', 'opencode.json', 'conhecimento/desenvolvedor.md'];
function lerOpcional(nome) {
  const p = path.join(RAIZ, nome);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

let passou = 0, falhou = 0;
const falhas = [];
function ok(nome, cond, detalhe) {
  if (cond) { passou++; return true; }
  falhou++; falhas.push(nome + (detalhe ? ' — ' + detalhe : ''));
  return false;
}
const grupo = (n) => console.log('\n' + n);

// ══════════════════════════════════════════════════════════════
grupo('1 · SINTAXE');
// ══════════════════════════════════════════════════════════════
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
ok('existe ao menos 3 bloco(s) inline', scripts.length >= 3, 'achou ' + scripts.length);
scripts.forEach((code, i) => {
  if (!code.trim()) return;
  let erro = '';
  try { new vm.Script(code, { filename: 'inline#' + (i + 1) }); } catch (e) { erro = e.message; }
  ok('bloco inline #' + (i + 1) + ' compila', !erro, erro);
});

/* ---------- 1.1 nenhuma função declarada duas vezes no mesmo script ----------
   Em script sloppy a última declaração de um function statement vence. Duas
   funções homônimas na mesma IIFE significam que todo call site da primeira
   está chamando a segunda em silêncio — foi assim que o filtro do painel
   morreu (marcar de filtro x marcar de estado) com o gate verde, porque o
   gate só contava texto. Este é o gate genérico que pega essa classe. */
{
  const fontes = scripts.map((code, i) => ({ i, code })).filter(f => f.code.trim());
  fontes.forEach(({ i, code }) => {
    const nomes = new Map();
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      const n = m[1];
      if (nomes.has(n)) nomes.set(n, nomes.get(n) + 1); else nomes.set(n, 1);
    }
    const dup = [...nomes].filter(([, c]) => c > 1).map(([n, c]) => n + '×' + c);
    ok('inline #' + (i + 1) + ': nenhuma função declarada duas vezes', dup.length === 0, dup.join(','));
  });
  // A checagem acima é por bloco; o mesmo nome em IIFEs diferentes é legal e
  // o acima não acusa. Confirma que o detector enxerga duplicata de verdade
  // (senão um gate que nunca falha é pior do que nenhum).
  const sentinela = 'function a(){}\nfunction b(){}\nfunction a(){}\n';
  const nomesS = new Map();
  for (const m of sentinela.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    nomesS.set(m[1], (nomesS.get(m[1]) || 0) + 1);
  }
  ok('o detector de duplicata realmente detecta (auto-teste do gate)',
    [...nomesS].filter(([, c]) => c > 1).map(([n]) => n).join(',') === 'a');
}

// ══════════════════════════════════════════════════════════════
grupo('2 · SEGURANÇA (bloqueios do DevSecOps)');
// ══════════════════════════════════════════════════════════════
const consoles = [...html.matchAll(/console\.(log|warn|error)/g)];
ok('nenhum console.log/warn/error', consoles.length === 0, 'achou ' + consoles.length);
ok('nenhum window._lastOCRDebug (vaza texto do PDF)', !/window\._lastOCRDebug/.test(html));
ok('nenhum outline:none / outline:0', !/outline\s*:\s*(none|0)\b/.test(html));
ok('nenhum segredo hardcoded', !/(api[_-]?key|secret|token|password).{0,20}=["'][^"'\s]+/i.test(html));
ok('esc() vive no escopo do script (não dentro de IIFE)', /function ESC\(/.test(html) && /const esc=ESC;/.test(html));
ok('esc() escapa aspas simples e duplas (atributos)', /replace\(\/"\/g,'&quot;'\)/.test(html) && /&#39;/.test(html));
ok('resposta de API externa é escapada no render (escProfundo existe e é usado lá)',
  /function escProfundo\(/.test(html) && /dados=escProfundo\(dados\)/.test(html));
ok('aviso de localStorage presente (LGPD)', /id="cnpj-privacidade"/.test(html));
ok('cache de CNPJ tem TTL', /CACHE_TTL\s*=/.test(html));
// O cache precisa de tratamento dedicado de cota. O try/catch da escrita mora
// em ARM.gravar e a política de liberação de espaço em gravarCache: os dois
// precisam existir, senão a falha de quota engole o erro e o cache para de
// funcionar em silêncio (o sintoma "só funciona em outro navegador").
ok('escrita do cache tem try/catch dedicado (quota)', /gravar\(k,v\)\{try\{localStorage\.setItem/.test(html));
ok('cache libera espaço quando a cota estoura', /function gravarCache[\s\S]{0,900}cacheEntradas\(\)/.test(html) && /function gravarCache[\s\S]{0,1400}ARM\.apagar\(/.test(html));
ok('cache degradado é reportado (não some em silêncio)', /ARM\.bloq=true/.test(html) && /cacheResumo/.test(html));
ok('ReDoS: PADROES_SEP sem \s* adjacentes', !/const PADROES_SEP[\s\S]*?\];/.exec(html)[0].includes('\\s*'));
ok('ReDoS: \s{0,4} presente como limite', /const PADROES_SEP[\s\S]*?\];/.exec(html)[0].includes('\\s{0,4}'));

// ══════════════════════════════════════════════════════════════
grupo('3 · CDNs E DEGRADAÇÃO');
// ══════════════════════════════════════════════════════════════
const cdn = [...html.matchAll(/<script src="([^"]+)"([^>]*)>/g)];
ok('exatamente 6 CDNs', cdn.length === 6, 'achou ' + cdn.length);
cdn.forEach(([, url, attrs], i) => {
  ok('CDN ' + (i + 1) + ' tem integrity', /integrity="sha384-[A-Za-z0-9+/=]+"/.test(attrs), url);
  ok('CDN ' + (i + 1) + ' tem crossorigin', /crossorigin="anonymous"/.test(attrs), url);
  // jsdelivr usa @1.2.3; cdnjs usa /1.2.3/ — as duas formas são versão exata
  ok('CDN ' + (i + 1) + ' com versão EXATA (sem @latest ou faixa)',
    /@\d+\.\d+\.\d+/.test(url) || /\/\d+\.\d+\.\d+\//.test(url), url);
});
ok('tesseract pinado em 4.1.4', /tesseract\.js@4\.1\.4/.test(html));
ok('corePath do OCR aponta para versão existente (4.0.4)', /tesseract\.js-core@v4\.0\.4/.test(html));
ok('corePath não aponta para 4.1.4 (404 comprovado)', !/tesseract\.js-core@4\.1\.4/.test(html));
ok('langPath do OCR declarado', /langPath:'https:\/\/tessdata\.projectnaptha\.com/.test(html));
ok('aviso de CDN ausente existe (#cdn-avisos)', /id="cdn-avisos"/.test(html));
ok('detecta as 6 bibliotecas ausentes', /esperado\s*=\s*\[/.test(html) &&
  ['chart.js', 'xlsx', 'pdfjs', 'pdf-lib', 'jszip', 'tesseract'].every(lib => html.includes("['" + lib + "',")));
ok('renderDashboard tem guard de Chart', /typeof Chart==='undefined'/.test(html));

// ══════════════════════════════════════════════════════════════
grupo('4 · SPRITE DE ÍCONES');
// ══════════════════════════════════════════════════════════════
const simbolos = new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]));
const usos = new Set([...html.matchAll(/<use href="#([^"]+)"/g)].map(m => m[1]));
ok('sprite tem 20 símbolos', simbolos.size === 20, 'achou ' + simbolos.size);
ok('todo use aponta para um símbolo existente', [...usos].every(u => simbolos.has(u)),
  [...usos].filter(u => !simbolos.has(u)).join(','));
ok('nenhum símbolo órfão (definido e nunca usado)', [...simbolos].every(s => usos.has(s)),
  [...simbolos].filter(s => !usos.has(s)).join(','));
ok('ícones de ação usam o sprite, não glifo', !/<span class="toggle">(?!<svg)/.test(html));

// ══════════════════════════════════════════════════════════════
grupo('5 · IDs E LABELS');
// ══════════════════════════════════════════════════════════════
const idsHtml = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const duplicados = idsHtml.filter((v, i) => idsHtml.indexOf(v) !== i);
ok('nenhum id duplicado', duplicados.length === 0, duplicados.join(','));
const getById = [...html.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const orfaosId = [...new Set(getById)].filter(id => !idsHtml.includes(id));
ok('todo getElementById tem elemento no HTML', orfaosId.length === 0, orfaosId.join(','));
ok('todo <label> tem for= ou input aninhado',
  [...html.matchAll(/<label(?![^>]*\bfor=)[^>]*>([\s\S]{0,120}?)<\/label>/g)]
    .filter(m => !/<input/i.test(m[1])).length === 0);

// ══════════════════════════════════════════════════════════════
grupo('6 · ACESSIBILIDADE');
// ══════════════════════════════════════════════════════════════
ok(':focus-visible global', /:focus-visible\{outline:2px solid var\(--focus\)/.test(html));
ok('focus visível tem override de cor na sidebar', /\.nav-btn:focus-visible/.test(html));
ok('theme-btn tem aria-pressed estático no HTML', /id="theme-btn"[^>]*aria-pressed="false"/.test(html));
ok('dropzone de XML é alcançável por teclado', /id="upload-area" role="button" tabindex="0"/.test(html));
ok('dropzone de PDF é alcançável por teclado', /id="pdfiso-upload" role="button" tabindex="0"/.test(html));
ok('header de nota é botão acessível', (html.match(/class="header" role="button" tabindex="0" aria-expanded="false"/g) || []).length >= 2);
ok('det-title é botão acessível', (html.match(/class="det-title" role="button" tabindex="0" aria-expanded="false"/g) || []).length >= 9);
ok('Enter/Espaço dispara o toggle (nota)', /addEventListener\('keydown'[\s\S]{0,600}?toggleNota/.test(html));
ok('Enter/Espaço dispara o toggle (det)', /addEventListener\('keydown'[\s\S]{0,600}?toggleDet/.test(html));
ok('Enter/Espaço abre a dropzone', /upload-area'\)\.addEventListener\('keydown'/.test(html));
ok('live region do PDF é container permanente no HTML', /id="pdfiso-avisos" role="status" aria-live="polite"/.test(html));
ok('a live region recebe conteúdo fora do innerHTML da tabela', /getElementById\('pdfiso-avisos'\)\.innerHTML=aviso/.test(html));
ok('toggleDet sincroniza aria-expanded', /setAttribute\('aria-expanded'/.test(html));
ok('prefers-reduced-motion presente', /@media \(prefers-reduced-motion:reduce\)/.test(html));
ok('barra de progresso não reintroduz transição no reduced-motion', /transition:none!important/.test(html));

// ══════════════════════════════════════════════════════════════
grupo('7 · CONTRASTE WCAG (implementado aqui, sem WebAIM)');
// ══════════════════════════════════════════════════════════════
function tokens(tema) {
  const re = tema === 'escuro'
    ? /:root\[data-theme="dark"\]\{([\s\S]*?)\}/
    : /:root\{([\s\S]*?)\n\}/;
  const m = re.exec(html);
  const out = {};
  if (!m) return out;
  // Casa o par direto: --nome: valor;  (o valor pode conter rgba(), que tem ponto e vírgula dentro)
  for (const d of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[d[1]] = d[2].replace(/!important/g, '').trim();
  }
  return out;
}
// O escuro SOBRESCREVE o claro; o que não é sobrescrito é HERDADO (cascata do CSS).
const claro = tokens('claro');
const escuro = { ...claro, ...tokens('escuro') };
ok('tema claro tem tokens', Object.keys(claro).length > 30, Object.keys(claro).length + ' tokens');
ok('tema escuro tem tokens', Object.keys(tokens('escuro')).length > 20, Object.keys(tokens('escuro')).length + ' tokens');
const sobrescritas = Object.keys(tokens('escuro'));
const semParDark = sobrescritas.filter(k => !/[a-z]/.test(k));
ok('todo token sobrescrito no escuro existe no claro', semParDark.length === 0, semParDark.join(','));
ok('tokens que mudam entre os temas estão declarados no escuro',
  ['--card', '--surface', '--text', '--text2', '--border', '--tint'].every(k => k in claro && k in escuro));
/* O log do lote depende dos --log-* nos DOIS temas: se só existissem no claro,
   o escuro herdaria o valor do claro e a medição do escuro seria fiction. */
ok('os 5 tokens --log-* existem nos DOIS temas (o escuro não herda o valor do claro)',
  ['--log-neutro', '--log-info', '--log-ok', '--log-aviso', '--log-err']
    .every(k => k in claro && k in tokens('escuro')),
  ['--log-neutro', '--log-info', '--log-ok', '--log-aviso', '--log-err']
    .filter(k => !(k in claro && k in tokens('escuro'))).join(','));
ok('TOM do lote aponta para os --log-*, não para tokens de superfície clara',
  /const TOM=\{neutro:'var\(--log-neutro\)',info:'var\(--log-info\)',ok:'var\(--log-ok\)',erro:'var\(--log-err\)',aviso:'var\(--log-aviso\)'\}/.test(html));
ok('nenhum log do lote usa literal de cor de superfície clara',
  !/loteLog\([^)]*'var\(--err\)'\)/.test(html) && !/loteLog\([^)]*'var\(--warn-ink\)'\)/.test(html));

function lum(cor) {
  if (typeof cor !== 'string') return null;
  let c = cor.trim();
  if (!c) return null;
  const m3 = /^#([0-9a-f]{3})$/i.exec(c);
  if (m3) c = '#' + m3[1].split('').map(x => x + x).join('');   // #fff -> #ffffff
  const m6 = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m6) return null;                                    // rgb()/rgba() não é usado em token de cor
  const v = [0, 2, 4].map(i => parseInt(m6[1].substr(i, 2), 16) / 255)
    .map(x => x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
  const la = lum(a), lb = lum(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
const paresTexto = [
  ['--text', '--card', 4.5], ['--text', '--surface', 4.5], ['--text', '--tint', 4.5],
  ['--text2', '--card', 4.5], ['--text2', '--surface', 4.5], ['--text2', '--tint', 4.5],
  ['--text3', '--card', 4.5], ['--text3', '--surface', 4.5], ['--text3', '--tint', 4.5],
  ['--primary-ink', '--card', 4.5], ['--primary-ink', '--card-2', 4.5],
  ['--err-ink', '--err-bg', 4.5], ['--warn-ink', '--warn-bg', 4.5],
  // o aviso de cache do lote (#cnpj-cache-aviso) é texto de 11px sobre --warn-bg
  ['--text2', '--warn-bg', 4.5],
  ['--err', '--card', 4.5], ['--success', '--card', 4.5],
  ['--code-fg', '--code-bg', 4.5],
  /* #cnpj-lote-log é a .code (fundo --code-bg, ardósia escura) onde o usuário lê
     o erro de um lote de 5,5 h. Os tokens --text2/--info/--success/--err são
     calibrados para superfície CLARA e davam de 2,06:1 a 3,98:1 a 10px aí.
     Os cinco --log-* passam de 7,7:1 a 10,2:1 nos dois temas. */
  ['--log-neutro', '--code-bg', 4.5], ['--log-info', '--code-bg', 4.5],
  ['--log-ok', '--code-bg', 4.5], ['--log-aviso', '--code-bg', 4.5],
  ['--log-err', '--code-bg', 4.5],
];
for (const tema of ['claro', 'escuro']) {
  const T = tema === 'claro' ? claro : escuro;
  for (const [fg, bg, min] of paresTexto) {
    const r = ratio(T[fg], T[bg]);
    ok(`contraste ${fg} sobre ${bg} (${tema}) >= ${min}`,
      r !== null && r >= min, r === null ? 'token não resolvido' : r.toFixed(2) + ':1');
  }
}
// botões: branco sobre o CTA (texto de 11px = texto normal, precisa 4.5:1)
for (const tema of ['claro', 'escuro']) {
  const T = tema === 'claro' ? claro : escuro;
for (const cta of ['--primary-cta', '--primary-cta-h', '--sec-cta', '--sec-cta-h',
  '--accent-cta', '--accent-cta-h', '--success-solid', '--success-solid-h', '--err-solid',
  '--badge-ok', '--badge-warn', '--badge-err']) {
  const r = ratio('#ffffff', T[cta]);
  ok(`branco sobre ${cta} (${tema}) >= 4.5`, r !== null && r >= 4.5,
    r === null ? 'token não resolvido: ' + T[cta] : r.toFixed(2) + ':1');
}
// --badge-on-cta é alpha no tema claro (sobre CTA escuro, medido 5.15:1) e sólido no
// escuro. Alpha não é computável isoladamente, então o claro é verificado por forma.
if (tema === 'claro') {
  ok('badge sobre CTA no claro usa alpha (medido 5.15:1 na auditoria do Designer)',
    /^rgba\(/.test(claro['--badge-on-cta']), claro['--badge-on-cta']);
} else {
  const r = ratio('#ffffff', escuro['--badge-on-cta']);
  ok('branco sobre --badge-on-cta (escuro) >= 4.5', r !== null && r >= 4.5,
    r === null ? 'token não resolvido' : r.toFixed(2) + ':1');
}
  const rBorder = ratio(T['--warn-ink'], T['--warn-bg']);
  ok(`borda de aviso (${tema}) >= 3:1 (1.4.11)`, rBorder !== null && rBorder >= 3,
    rBorder === null ? 'token não resolvido: ' + T['--warn-ink'] + ' / ' + T['--warn-bg'] : rBorder.toFixed(2) + ':1');
  const rInput = ratio(T['--border-input'], T['--card']);
  ok(`borda de input (${tema}) >= 3:1 (1.4.11)`, rInput !== null && rInput >= 3,
    rInput === null ? 'token não resolvido: ' + T['--border-input'] + ' / ' + T['--card'] : rInput.toFixed(2) + ':1');
}

// ══════════════════════════════════════════════════════════════
grupo('8 · TEMA NO BOOT (executa o script real com stub de DOM)');
// ══════════════════════════════════════════════════════════════
const scriptTema = scripts[scripts.length - 1];
function ambienteArmazenamento(falhaEm) {
  const dados = {};
  return {
    _d: dados,
    getItem(k) { if (falhaEm === 'get') throw new Error('SecurityError'); return Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null; },
    setItem(k, v) { if (falhaEm === 'set') { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } dados[k] = String(v); },
    removeItem(k) { delete dados[k]; },
    key() { return null; },
    get length() { return Object.keys(dados).length; },
    clear() { for (const k of Object.keys(dados)) delete dados[k]; },
  };
}
function stubDOM(atributoTema) {
  const navs = ['Importar XMLs', 'Separar PDF', 'Leitura PDF', 'Consultar CNPJ', 'NF-e (Peças)', 'NFS-e (Serviços)', 'Dashboard', 'Exportar Dados'];
  const botoes = navs.map(t => ({ lastElementChild: { textContent: t }, _ev: {}, addEventListener(_, f) { this._ev.click = f; } }));
  const cur = { textContent: '' };
  const btn = { attrs: { 'aria-pressed': 'false' }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(_, f) { this._f = f; } };
  const root = { attrs: {}, getAttribute(k) { return this.attrs[k] || null; }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } };
  if (atributoTema) root.attrs['data-theme'] = 'dark';
  return {
    documentElement: root,
    getElementById(id) { return id === 'theme-btn' ? btn : (id === 'crumb-cur' ? cur : null); },
    querySelectorAll(sel) { return sel === '.nav-btn' ? botoes : []; },
    querySelector(sel) { return sel === '.nav-btn.active' ? botoes[0] : null; },
    __btn: btn, __root: root, __cur: cur, __navs: botoes,
  };
}
function rodarTema({ temaSalvo, falhaStorage, comChart }) {
  const dom = stubDOM(temaSalvo === 'dark' ? 'dark' : null);
  const chartsFalsos = {};
  const sandbox = {
    document: dom,
    localStorage: ambienteArmazenamento(falhaStorage),
    getComputedStyle: () => ({ getPropertyValue: (n) => (claro[n] || '') }),
    setTimeout, clearTimeout, Date, Math, JSON,
    window: {},
  };
  if (comChart) {
    sandbox.Chart = {
      defaults: { color: null, borderColor: null, plugins: { tooltip: {} } },
      __n: 0,
    };
  }
  vm.createContext(sandbox);
  vm.runInContext(scriptTema, sandbox, { filename: 'tema#final' });
  return { dom, sandbox };
}

// boot com tema salvo -> atributo aplicado (via o script anti-FOUC) e Chart.defaults sincronizado
{
  const { dom, sandbox } = rodarTema({ temaSalvo: 'dark', comChart: true });
  ok('Chart.defaults sincronizado NO BOOT (bug do dashboard em dark)', sandbox.Chart.defaults.color !== null,
    'color=' + sandbox.Chart.defaults.color);
  ok('Chart.defaults recebeu cor lida do token', sandbox.Chart.defaults.color === claro['--text2'],
    sandbox.Chart.defaults.color + ' vs token ' + claro['--text2']);
  ok('aria-pressed coerente no boot', dom.__btn.attrs['aria-pressed'] === 'true', dom.__btn.attrs['aria-pressed']);
  ok('breadcrumb deriva do .nav-btn.active no boot (não de texto fixo)', dom.__cur.textContent === 'Importar XMLs', dom.__cur.textContent);
}
// boot sem tema salvo -> sem atributo, aria-pressed false
{
  const { dom } = rodarTema({ temaSalvo: null, comChart: true });
  ok('sem tema salvo: sem data-theme', dom.__root.getAttribute('data-theme') === null);
  ok('sem tema salvo: aria-pressed=false', dom.__btn.attrs['aria-pressed'] === 'false');
}
// toggle alterna e persiste
{
  const { dom, sandbox } = rodarTema({ temaSalvo: 'light', comChart: true });
  dom.__btn._f();
  ok('toggle aplica data-theme', dom.__root.getAttribute('data-theme') === 'dark');
  ok('toggle persiste em localStorage', sandbox.localStorage.getItem('gcon-theme') === 'dark');
  ok('toggle inverte aria-pressed', dom.__btn.attrs['aria-pressed'] === 'true');
  dom.__btn._f();
  ok('toggle volta (idempotente por par)', dom.__root.getAttribute('data-theme') === null);
  ok('toggle persiste light', sandbox.localStorage.getItem('gcon-theme') === 'light');
  const nav = dom.__navs[5];
  nav._ev.click();
  ok('breadcrumb acompanha o clique na aba', dom.__cur.textContent === 'NFS-e (Serviços)', dom.__cur.textContent);
}
// Chart.js ausente: nao pode explodir. Comeca sem tema salvo, entao um clique vai para dark.
{
  const { dom } = rodarTema({ temaSalvo: null, comChart: false });
  let explodiu = false;
  try { dom.__btn._f(); } catch (e) { explodiu = true; }
  ok('toggle funciona com Chart.js ausente (CDN fora)', !explodiu);
  ok('tema aplica mesmo sem Chart.js', dom.__root.getAttribute('data-theme') === 'dark',
    String(dom.__root.getAttribute('data-theme')));
}
// localStorage bloqueado: o app tem que seguir funcionando
{
  const { dom } = rodarTema({ temaSalvo: null, falhaStorage: 'set', comChart: true });
  let explodiu = false;
  try { dom.__btn._f(); } catch (e) { explodiu = true; }
  ok('setItem bloqueado não quebra o toggle (try/catch)', !explodiu);
  ok('tema aplica mesmo sem persistência', dom.__root.getAttribute('data-theme') === 'dark');
}
{
  const { dom } = rodarTema({ temaSalvo: null, falhaStorage: 'get', comChart: true });
  let explodiu = false;
  try { dom.__btn._f(); } catch (e) { explodiu = true; }
  ok('localStorage indisponível não quebra o app', !explodiu);
}

// ══════════════════════════════════════════════════════════════
grupo('9 · CHAVE DE ACESSO 44 (validador vH do próprio index.html)');
// ══════════════════════════════════════════════════════════════
// vH e vC dependem do helper d() do mesmo IIFE — extrai os tres juntos.
const sandboxChave = { d: (s) => (s || '').replace(/\D/g, '') };
vm.createContext(sandboxChave);
for (const nome of ['d', 'vC', 'vH']) {
  const re = nome === 'd'
    ? /function d\(s\)\{return\(s\|\|''\)\.replace\(\/\\D\/g,''\);\}/
    : new RegExp('function ' + nome + '\\([\\s\\S]*?\\n');
  const src = re.exec(html);
  ok('extraiu ' + nome + '() do index.html', !!src);
  if (src) vm.runInContext(src[0], sandboxChave, { filename: nome });
}
const vH = sandboxChave.vH, vC = sandboxChave.vC;
const caminhoV = path.join(__dirname, 'chaves-verdade.json');
if (fs.existsSync(caminhoV)) {
  const reais = Object.values(JSON.parse(fs.readFileSync(caminhoV, 'utf8')));
  ok('há chaves reais de referência', reais.length >= 8, reais.length + ' chaves');
  const invalidas = reais.filter(k => !vH(k));
  ok('todas as chaves reais passam em vH', invalidas.length === 0, invalidas.join(','));
  // alterações de 1 dígito no DV precisam falhar
  const adulteradas = reais.filter(k => {
    const d = k.slice(0, 43) + (k[43] === '0' ? '1' : '0');
    return vH(d);
  });
  ok('chave com DV trocado é rejeitada', adulteradas.length === 0, adulteradas.length + ' passaram errado');
} else {
  console.log('  (chaves-verdade.json ausente — validação de chave real pulada; arquivo é gitignored)');
}
const falsas = [
  '0'.repeat(44), '1'.repeat(44), '12345678901234567890123456789012345678901234',
  '3526091122233300018155001000000123112345678',   // 43
  '352609112223330001815500100000012311234567837', // 45
  'abcdefghijklmnopqrstuvwxyzabcdefghijklmnop', '', '   ',
  '352609112223330001815500100000012311234567 6',
];
falsas.forEach((k, i) => ok('chave falsa #' + (i + 1) + ' rejeitada por vH', vH(k) === false, JSON.stringify(k.slice(0, 20))));
ok('vH aceita chave válida sintética (controle positivo)',
  vH('35260911222333000181550010000001231123456783') === true);
ok('CNPJ placeholder rejeitado por vC', vC('00.000.000/0000-00') === false);
ok('CNPJ válido aceito por vC', vC('11.222.333/0001-81') === true);

// ══════════════════════════════════════════════════════════════
grupo('10 · REGRAS DO PROJETO');
// ══════════════════════════════════════════════════════════════
ok('erro de XML malformado é específico', /XML inválido ou malformado/.test(html));
ok('single-file: nenhum .js ou .css local', !/<script[^>]+src="(?!https:)[^"]+\.js"/.test(html));
// A fonte precisa estar carregada, mas por um caminho só: <link> no <head>
// (com preconnect, em paralelo) ou @import no <style>. Ter os dois fazia a
// mesma requisição duas vezes, e o @import só saía depois do primeiro paint.
const fonteLink = /<link[^>]+href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter[^"]*"/.test(html);
const fonteImport = /@import url\('https:\/\/fonts\.googleapis\.com[^']*'\)/.test(html);
ok('fonte Inter carregada', fonteLink || fonteImport, 'link=' + fonteLink + ' import=' + fonteImport);
ok('fonte Inter sem requisição duplicada', !(fonteLink && fonteImport), 'link e @import juntos');
const hnfe = /const HNFE=\[([\s\S]*?)\];/.exec(html)[1];
const hnfse = /const HNFSE=\[([\s\S]*?)\];/.exec(html)[1];
const nHnfe = (hnfe.match(/'[^']+'/g) || []).length;
const nHnfse = (hnfse.match(/'[^']+'/g) || []).length;
ok('HNFE tem 93 campos', nHnfe === 93, 'achou ' + nHnfe);
ok('HNFSE tem 56 campos', nHnfse === 56, 'achou ' + nHnfse);
ok('README diz 93 colunas NF-e (bate com o código)', /93 NF-e/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')));
// A asserção precisa ser "pulado OU conferido": o arquivo é gitignored, então
// num clone novo lerOpcional devolve '' e o teste virava no-op (sempre verde).
const regra = lerOpcional('workflow-rule.md');
if (regra) {
  ok('nenhum texto fala 423 campos (README e doc de processo, arquivo presente)',
    !/423/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')) && !/423/.test(regra));
} else {
  console.log('  (workflow-rule.md ausente — checagem de "423" pulada; arquivo é gitignored)');
}
FORA_DO_GIT.forEach((nome) => {
  const p = path.join(RAIZ, nome);
  let erro = '';
  try { fs.readFileSync(p, 'utf8'); } catch (e) { erro = e.code || String(e); }
  ok('leitura opcional tolera "' + nome + '" ausente (gitignored)', erro === '' || erro === 'ENOENT', p + ' -> ' + erro);
});
ok('todo var(--x) usado está definido em :root',
  [...new Set([...html.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))].every(v => claro[v]),
  [...new Set([...html.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))].filter(v => !claro[v]).join(','));
// "zero emoji" tem duas leituras e ambas valem:
//  1) nenhum EMOJI de verdade (blocos pictograficos) em lugar nenhum do arquivo
//  2) nenhum glifo (✓ ✗ ⚠) na INTERFACE — dentro dos logs em monospace eles são
//     marcador de texto legítimo, não ícone
const semLog = html.replace(/`(?:[^`\\]|\\.)*`/g, '``').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
ok('nenhum emoji (bloco pictográfico) no arquivo', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{FE0F}]/u.test(html));
ok('nenhum glifo (✓/✗/⚠) na interface (logs são exceções)',
  !/[\u2713\u2717\u26a0]/.test(semLog),
  (semLog.match(/.{0,40}[\u2713\u2717\u26a0].{0,30}/u) || [''])[0].replace(/\s+/g, ' '));
ok('breakpoints 1440/768/375 presentes',
  /min-width:1440px/.test(html) && /max-width:768px/.test(html) && /max-width:375px/.test(html));
ok('alturas de sidebar usam 100dvh com fallback 100vh', /height:100vh;height:100dvh/.test(html));

/* Documentação é bloqueio pela regra do projeto, então ela tem gate. */
{
  const readme = fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8');
  ok('README lista o que é versionado (index, painel, testes)',
    /\| `index\.html` \|/.test(readme) && /\| `painel-gerencial\.html` \|/.test(readme) && /\| `testes\/` \|/.test(readme));
  ok('README reenumera os grupos ignorados pelo .gitignore (não só agente-*.md)',
    /amostras\//.test(readme) && /testes\/node_modules\//.test(readme) && /\.opencode\/agent\//.test(readme)
    && /painel-estado\.json/.test(readme) && /\.opencode\/plans\//.test(readme));
  ok('README documenta a Consulta em Lote e o painel gerencial',
    /\*\*Consulta em Lote\*\*/.test(readme) && /\*\*Painel gerencial\*\*/.test(readme));
  ok('README tem a seção "Testes" com as três suítes e a ordem do npm test',
    /## Testes/.test(readme) && /node regressao\.mjs/.test(readme) && /node painel-check\.mjs/.test(readme)
    && /node rodar\.mjs/.test(readme) && /npm test/.test(readme));
  ok('README diz que o painel-check roda da raiz e de dentro de testes/',
    /__dirname/.test(readme) && /da raiz ou de dentro de `testes\/`/.test(readme));
  ok('README não promete o que não é verdade (o aviso de privacidade cita o CNPJ)',
    /publica\.cnpj\.ws/.test(readme) && !/Nada é enviado a nenhum servidor/.test(readme));
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  ok('npm test roda as DUAS suítes de ~1 s antes da bancada',
    /regressao\.mjs/.test(pkg.scripts.test) && /painel-check\.mjs/.test(pkg.scripts.test)
    && /rodar\.mjs/.test(pkg.scripts.test),
    pkg.scripts.test);
  ok('existe o atalho "painel" no package.json',
    pkg.scripts.painel === 'node painel-check.mjs', JSON.stringify(pkg.scripts));
  ok('as duas suítes resolvem caminho por __dirname (rodam da raiz e de testes/)',
    /__dirname/.test(fs.readFileSync(path.join(__dirname, 'painel-check.mjs'), 'utf8'))
    && /__dirname/.test(fs.readFileSync(path.join(__dirname, 'rodar.mjs'), 'utf8')));
}

// ══════════════════════════════════════════════════════════════
grupo('11 · SEPARADOR DE PDF (agrupamento de páginas em notas)');
// ══════════════════════════════════════════════════════════════
// sepAgrupar é a regra que mais errou: duas notas com o mesmo número iam
// parar no mesmo arquivo. Roda a função real do index.html num sandbox,
// sem browser e sem pdf.js.
{
  const m = /function sepAgrupar\([\s\S]*?\n\}/.exec(html);
  ok('sepAgrupar existe como função isolada', !!m);
  if (m) {
    const avisos = [];
    const sb = { sepLog: (t) => avisos.push(t), console, Set };
    vm.createContext(sb);
    try {
      vm.runInContext(m[0] + '\n;this.__g = sepAgrupar;', sb);
    } catch (e) { }
    const agrupar = sb.__g;
    ok('sepAgrupar carrega no sandbox', typeof agrupar === 'function');
    if (typeof agrupar === 'function') {
      const p = (g) => JSON.stringify(g);
      // caso real: nota 100 (2 pág), nota 200 (2 pág), nota 100 de novo (2 pág)
      // PDF de 0 página (ou contador corrompido) devolvia [[]] — um grupo
      // vazio que virava um PDF de 0 página chamado NF-nota_0001.pdf.
      ok('total 0 devolve lista vazia, não [[]]',
        p(agrupar([null, 200], 0, 'auto')) === p([]), p(agrupar([null, 200], 0, 'auto')));
      ok('total 0 no modo "uma página = uma nota" também devolve []',
        p(agrupar([], 0, 'unica')) === p([]), p(agrupar([], 0, 'unica')));
      ok('nenhum grupo devolvido é vazio (nunca [[]] em nenhum cenário)',
        [[null, 200, 200], [100, null, 100, null], ['1', '2'], [null, null, null]]
          .every((nums) => {
            const g = agrupar(nums, nums.length, 'auto');
            return g.every((grp) => Array.isArray(grp) && grp.length > 0);
          }));
      ok('número repetido vira nota nova (bug do "juntou tudo")',
        p(agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto')) === p([[0, 1], [2, 3], [4, 5]]),
        p(agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto')));
      avisos.length = 0;
      agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto');
      ok('número repetido é avisado no log (1 vez por repetição)',
        avisos.length === 1 && /já apareceu antes/.test(avisos[0]), avisos.join('|'));
      ok('nota única não quebra',
        p(agrupar(['777'], 1, 'auto')) === p([[0]]), p(agrupar(['777'], 1, 'auto')));
      ok('modo "uma página = uma nota" ignora o número',
        p(agrupar(['100', '100', '200'], 3, 'unica')) === p([[0], [1], [2]]));
      ok('página sem número herda a nota atual',
        p(agrupar(['100', null, null, '200'], 4, 'auto')) === p([[0, 1, 2], [3]]),
        p(agrupar(['100', null, null, '200'], 4, 'auto')));
      ok('nenhum número detectado = uma página por arquivo',
        p(agrupar([null, null, null], 3, 'auto')) === p([[0], [1], [2]]));
      ok('primeira página sem número não perde a primeira nota',
        p(agrupar([null, '200', '200'], 3, 'auto')) === p([[0, 1, 2]]),
        p(agrupar([null, '200', '200'], 3, 'auto')));
      const todas = agrupar(['1', '2', '3', '4', '5'], 5, 'auto');
      ok('sempre cobre todas as páginas, sem buraco nem repetição',
        todas.flat().length === 5 && todas.flat().every((x, i) => x === i), p(todas));
      ok('soma das páginas = total do PDF',
        agrupar(['100', '100', '200', '200', '100', '100'], 6, 'auto').flat().length === 6);
      // Invariante forte: qualquer entrada devolve cada página exatamente uma
      // vez, na ordem, e a soma é o total. Inclui os casos degenerados: PDF
      // sem número nenhum, PDF de 0 página (numPag só com 1 item) e numsPag
      // mais longo que o PDF.
      [[[], 0], [[null], 2], [['1', '2'], 1], [['100', null, '100', null], 4], [['9'], 3]]
        .forEach(([nums, tot], i) => {
          ['auto', 'unica'].forEach((md) => {
            let g = null, erro = '';
            try { g = agrupar(nums, tot, md); } catch (e) { erro = e.message; }
            const cob = g ? g.flat() : [];
            ok('invariante de páginas #' + (i + 1) + '/' + md + ': soma = total, ordem, sem repetição',
              !erro && cob.length === tot && cob.every((x, k) => x === k),
              JSON.stringify(nums) + ' total=' + tot + ' -> ' + (erro || JSON.stringify(g)));
            ok('invariante de páginas #' + (i + 1) + '/' + md + ': nenhum grupo vazio',
              !erro && g.every((grp) => grp.length > 0),
              JSON.stringify(nums) + ' total=' + tot + ' -> ' + JSON.stringify(g));
          });
        });
    }
  }
}

// ══════════════════════════════════════════════════════════════
grupo('11.1 · SEPARADOR: nomeação do arquivo (executa sepNomear de verdade)');
// ══════════════════════════════════════════════════════════════
/* O gate antigo conferia só o AGRUPAMENTO e nunca o NOME. SepAgrupar já
   decidia que a página sem número pertence à nota cujo número vem depois, e a
   nomeação lia numsPag[paginas[0]] — as duas coisas discordam, e 5 dos 14
   cenários saíam com o arquivo errado (NF-nota_0001.pdf para a nota 200).
   Tabela do tester, rodada como teste. */
{
  const mNomear = /function sepNomear\([\s\S]*?\n\}/.exec(html);
  const mSan = /function sepSanitizar\([\s\S]*?\n\}/.exec(html);
  ok('sepNomear existe como função isolada', !!mNomear);
  if (mNomear) {
    /* sepAgrupar entra no MESMO sandbox: a nomeação é consumidora do
       agrupamento, e testar as duas juntas é o que prova o contrato. */
    const sb = { Set, console, sepLog: () => {} };
    vm.createContext(sb);
    try {
      vm.runInContext(
        (mSan ? mSan[0] : '') + '\n'
        + (/function sepAgrupar\([\s\S]*?\n\}/.exec(html) || [''])[0] + '\n'
        + mNomear[0] + '\n;this.__n = sepNomear;', sb);
    } catch (e) { }
    const nomear = sb.__n;
    ok('sepNomear carrega no sandbox', typeof nomear === 'function');
    if (typeof nomear === 'function') {
      const cenario = (nums, esperado) => {
        const usados = new Set();
        const g = vm.runInContext(
          'JSON.stringify(sepAgrupar(' + JSON.stringify(nums) + ',' + nums.length + ',"auto"))',
          sb);
        const grupos = JSON.parse(g);
        const saida = grupos.map((pg) => nomear(nums, pg, true, usados).arquivo);
        ok('nomeação: [' + JSON.stringify(nums) + '] -> ' + esperado.join(', '),
          saida.join(', ') === esperado.join(', '), 'veio ' + JSON.stringify(saida));
      };
      // a mesma tabela do tester, agora como asserção
      cenario([null, '200', '200'], ['NF-200.pdf']);
      cenario([null, null, '200', '200', '201'], ['NF-200.pdf', 'NF-201.pdf']);
      cenario([null, '777'], ['NF-777.pdf']);
      cenario([null, null, null], ['NF-nota_0001.pdf', 'NF-nota_0002.pdf', 'NF-nota_0003.pdf']);
      cenario(['100', '100', '200', '200', '100', '100', '100', '100'],
        ['NF-100.pdf', 'NF-200.pdf', 'NF-100_2.pdf']);
      /* A linha da tabela do tester com ['100','100','200','200','100','100',
         '100','100'] -> 4 nomes é internamente inconsistente: o agrupamento
         (já travado pelo caso "número repetido vira nota nova") junta as
         páginas 4-7 numa nota só, porque o número 100 não mudou. A linha que
         exercita o sufixo _3 tem de ter uma interrupção de verdade: a nota 300
         entre as duas repetições do 100. */
      cenario(['100', '100', '200', '200', '100', '100', '300', '300', '100', '100'],
        ['NF-100.pdf', 'NF-200.pdf', 'NF-100_2.pdf', 'NF-300.pdf', 'NF-100_3.pdf']);
      // sem ler o número: nome por página
      {
        const usados = new Set();
        const g = JSON.parse(vm.runInContext('JSON.stringify(sepAgrupar([null,"200","200"],3,"auto"))', sb));
        const saida = g.map((pg) => nomear([null, '200', '200'], pg, false, usados).arquivo);
        ok('sem ler número: nome por página', saida[0] === 'NF-pagina_0001.pdf', JSON.stringify(saida));
      }
      ok('sepNomear devolve o numeroNota usado no log',
        nomear(['200', '200'], [0, 1], true, new Set()).numeroNota === '200');
    }
  }
  ok('a nomeação usa a PRIMEIRA página do grupo que tem número (não só a [0])',
    /const pNum = paginas\.find\(\(p\) => numsPag\[p\]\)/.test(html));
  ok('PDF de 0 página é barrado antes dos early returns',
    /if \(!\(total > 0\)\) return \[\];/.test(html));
}

// ══════════════════════════════════════════════════════════════
grupo('11.2 · MÓDULO DE CNPJ EXECUTADO (sandbox vm com DOM stub)');
// ══════════════════════════════════════════════════════════════
/* O gate antigo só lia texto. Os bloqueios B1/B3/B6 viviam exatamente aí:
   um ReferenceError numa interpolação de template, uma função de outra IIFE,
   e um cache gravado CRU — nada disso aparece num regex. Aqui a IIFE inteira
   do index.html é executada. */
function extrairCnpjModule() {
  const marca = '  const API="https://publica.cnpj.ws/cnpj/";';
  const i = html.indexOf(marca);
  if (i < 0) return null;
  const abre = html.lastIndexOf('(() => {', i);
  /* A IIFE de CNPJ tem duas: a externa e a do lote, aninhada. O fim é o
     `})();` que fecha a EXTERNA — o segundo depois do último avisoCache(). */
  const ultimo = html.lastIndexOf('avisoCache();');
  const fimLote = html.indexOf('})();', ultimo);
  const fim = html.indexOf('})();', fimLote + 1);   // +1: senão reacha a mesma
  if (abre < 0 || ultimo < 0 || fim < 0) return null;
  const corpo = html.slice(abre, ultimo);
  /* Exposição só para o harness: o código executado é o do index.html, com uma
     linha a mais em cada escopo que publica funções privadas. Sem isto o teste
     só poderia conferir a forma do texto — que é o que não prova nada.
     A linha do lote entra ANTES do fechamento da IIFE aninhada, porque
     cnpjsDoTexto/renderLote/registra vivem ali, e a da consulta antes do
     fechamento da externa. */
  return corpo
    + '\n    this.__lote = { cnpjsDoTexto, renderLote, registrar: registra, avisoCache, lista: () => lista, resultados: () => resultados };\n  '
    + html.slice(ultimo + 'avisoCache();'.length, fim)
    + '\n  this.__t = { consultar, render, lerCache, gravarCache, cacheResumo, expurgarCacheLegado, CHAVE_CACHE, CHAVE_CACHE_LEGADO };\n  })();';
}
function stubEl(id) {
  const el = {
    id, value: '', textContent: '', innerHTML: '', disabled: false, dataset: {},
    style: {}, files: null,
    scrollTop: 0, scrollHeight: 0, classList: { add() { }, remove() { }, toggle() { }, contains: () => false },
    addEventListener() { }, removeEventListener() { },
    appendChild(c) { (el._filhos = el._filhos || []).push(c); return c; },
    querySelectorAll: () => [],
    querySelector: () => null,
    click() { },
    setAttribute() { }, removeAttribute() { }, getAttribute: () => null,
  };
  return el;
}
/* Storage com key(i) de verdade: cacheEntradas/expurgarCacheLegado varrem por
   índice, e o stub do grupo 8 (tema) devolve null — o que faria o expurgo e o
   resumo de cache passarem por vazio sem provar nada. */
function storageReal(semente) {
  const dados = Object.assign({}, semente || {});
  return {
    _d: dados,
    getItem(k) { return Object.prototype.hasOwnProperty.call(dados, k) ? dados[k] : null; },
    setItem(k, v) { dados[k] = String(v); },
    removeItem(k) { delete dados[k]; },
    key(i) { return Object.keys(dados)[i] === undefined ? null : Object.keys(dados)[i]; },
    get length() { return Object.keys(dados).length; },
    clear() { for (const k of Object.keys(dados)) delete dados[k]; },
  };
}
function ambienteCnpj({ storage, fetchImpl, modPdf }) {
  const els = {};
  /* Os dois stubs de abaixo precisam ser reais: o painel de cache lê as
     entradas por localStorage.key(i) e é atualizado por um evento, não por
     chamada direta. */
  const ouvintes = {};
  const ids = ['cnpj-input', 'cnpj-btn', 'cnpj-limpar', 'cnpj-result', 'cnpj-raw', 'cnpj-status',
    'cnpj-lote-file', 'cnpj-lote-start', 'cnpj-lote-stop', 'cnpj-lote-export', 'cnpj-lote-modelo',
    'cnpj-lote-bar', 'cnpj-lote-bar-inner', 'cnpj-lote-info', 'cnpj-lote-eta', 'cnpj-lote-log',
    'cnpj-lote-table', 'cnpj-cache-aviso'];
  ids.forEach((i) => { els[i] = stubEl(i); });
  const doc = {
    getElementById: (i) => els[i] || null,
    createElement: () => stubEl('novo'),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(tipo, f) { (ouvintes[tipo] = ouvintes[tipo] || []).push(f); },
    dispatchEvent(ev) { (ouvintes[ev && ev.type] || []).forEach((f) => f(ev)); return true; },
    body: { appendChild() { }, removeChild() { } },
  };
  const sandbox = {
    document: doc, localStorage: storage, fetch: fetchImpl,
    CustomEvent: function CustomEvent(t) { this.type = t; },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON, Intl, Promise, Set, String, Number, Object, Array, Error,
    TextDecoder, console: { log() { }, warn() { }, error() { } },
    window: { ModPDFIsolado: modPdf, addEventListener() { }, XLSX: undefined },
    Blob: function Blob() { }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // helpers que vivem no script principal e são consumidos pelo módulo
  vm.runInContext(
    /function ESC\(s\)\{[\s\S]*?\n/.exec(html)[0] + '\nthis.esc=ESC;'
    + '\nfunction f(v){if(v===null||v===undefined)return 0;let s=String(v).replace(/[^0-9,\\-.]/g,\'\');if(s.includes(\',\')){s=s.replace(/\\./g,\'\').replace(\',\',\'.\');}const n=parseFloat(s);return isNaN(n)?0:n}'
    + '\nfunction moeda(v){return `R$ ${f(v).toLocaleString(\'pt-BR\',{minimumFractionDigits:2,maximumFractionDigits:2})}`}',
    sandbox);
  return { sandbox, els };
}
function rodarCnpj(opts) {
  const src = extrairCnpjModule();
  const { sandbox, els } = ambienteCnpj(opts);
  const erros = [];
  try {
    vm.runInContext(src, sandbox, { filename: 'index.html#cnpj' });
  } catch (e) {
    erros.push(e);
  }
  return { sandbox, els, erros, t: sandbox.__t };
}
await (async () => {
  const modPdf = (() => {
    const src = /function vC\(c\)\{[\s\S]*?\n/.exec(html)[0];
    const sb = { d: (s) => (s || '').replace(/\D/g, '') };
    vm.createContext(sb);
    vm.runInContext(src, sb);
    return sb.vC;
  })();
  const cnpjValido = '11.222.333/0001-81';

  // ── B3: CNPJ com 11/13/15 dígitos ──
  [11, 13, 15].forEach((n) => {
    const storage = storageReal();
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.reject(new Error('não deveria buscar')),
      modPdf: { vC: modPdf },
    });
    ok('módulo de CNPJ sobe sem exceção (base p/ ' + n + ' dígitos)', erros.length === 0,
      erros.map((e) => e.message).join('|'));
    if (erros.length) return;
    els['cnpj-input'].value = '1'.repeat(n);
    let r = '';
    try { t.consultar(); r = 'ok'; } catch (e) { r = e.constructor.name + ': ' + e.message; }
    ok('consultar() com ' + n + ' dígitos não lança ReferenceError', r === 'ok', r);
    const html14 = els['cnpj-result'].innerHTML;
    ok('consultar() com ' + n + ' dígitos mostra a mensagem de 14 dígitos',
      /14 dígitos/.test(html14) && !/undefined/.test(html14), html14.slice(0, 160));
  });

  // ── B1: vC vem do módulo de PDF, não de uma função livre ──
  {
    const storage = storageReal();
    const { sandbox, t, erros } = rodarCnpj({ storage, fetchImpl: () => Promise.reject(new Error('x')), modPdf: { vC: modPdf } });
    ok('módulo sobe para o teste de vC', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (!erros.length) {
      /* cnpjsDoTexto vive na IIFE aninhada do lote (ver extrairCnpjModule). */
      const cnpjsDoTexto = sandbox.__lote.cnpjsDoTexto;
      let achou = null, erro = '';
      try { achou = [...cnpjsDoTexto(cnpjValido)]; } catch (e) { erro = e.constructor.name + ': ' + e.message; }
      ok('cnpjsDoTexto() lê um CNPJ válido (vC resolvido, sem "vC is not defined")',
        erro === '' && achou.length === 1 && achou[0] === '11222333000181', erro || JSON.stringify(achou));
      let cov = [], erro2 = '';
      try { cov = [...cnpjsDoTexto('CNPJ 11.222.333/0001-81 e 11.111.111/1111-11')]; } catch (e) { erro2 = e.constructor.name + ': ' + e.message; }
      ok('cnpjsDoTexto() descarta CNPJ com DV inválido (não gasta taxa do lote)',
        erro2 === '' && cov.length === 1 && cov[0] === '11222333000181', erro2 || JSON.stringify(cov));
      /* O bug original: vC é função da OUTRA IIFE. Se alguém voltar a chamar
         vC() sem prefixar, este caso volta a falhar — com o nome do erro. */
      const semPrefixo = /[^.\w]vC\(soDigitos\)/.test(html);
      ok('cnpjsDoTexto chama vC pelo contrato do módulo (ModPDFIsolado.vC)',
        !semPrefixo && /window\.ModPDFIsolado\.vC\(soDigitos\)/.test(html));
      /* E o contrato precisa realmente publicar vC (foi o que faltou). */
      ok('o return de ModPDFIsolado publica vC e vH',
        /return\{extrair,parseFull,mergeExtracao,finalizar,tC,vC,vH\};/.test(html));
    }
  }

  // ── B3b: fetch rejeita com payload HTML na mensagem ──
  {
    const storage = storageReal();
    const evil = 'HTTP 500 <img src=x onerror="window.__pwn=1">';
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.reject(new Error(evil)), modPdf: { vC: modPdf },
    });
    ok('módulo sobe com fetch que rejeita', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (!erros.length) {
      els['cnpj-input'].value = cnpjValido;
      await t.consultar();
      const h = els['cnpj-result'].innerHTML;
      ok('mensagem de erro da API escapa o HTML (nada de <img onerror> cru)',
        !/<img/i.test(h) && /&lt;img/i.test(h), h.slice(0, 220));
      ok('a mensagem de erro aparece uma vez, com o marcador na frente',
        (h.match(/onerror/g) || []).length === 1 && h.indexOf('✗') < h.indexOf('HTTP 500'),
        h.slice(0, 220));
    }
  }

  // ── B6: cache legado gravado CRU é expurgado, e o render escapa ──
  {
    const storage = storageReal();
    const cru = {
      razao_social: '<img src=x onerror="window.__pwn=1"> LTDA',
      estabelecimento: { cnpj: '11222333000181', inscricoes_estaduais: [] },
      socios: [{ nome: 'Fulano', cpf_cnpj_socio: '123.456.789-00' }],
    };
    /* build 627b8e0: envelope {t,d} com d CRU, prefixo antigo */
    storage.setItem('cnpj_11222333000181', JSON.stringify({ t: Date.now(), d: cru }));
    storage.setItem('cnpj_v2_11222333000181', JSON.stringify({ t: Date.now(), d: cru }));
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.reject(new Error('não deve buscar: está em cache')),
      modPdf: { vC: modPdf },
    });
    ok('módulo sobe com cache semeado', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (erros.length) return;
    ok('o expurgo apaga a entrada do namespace legado (PII não fica órfão)',
      storage.getItem('cnpj_11222333000181') === null,
      String(storage.getItem('cnpj_11222333000181')).slice(0, 80));
    ok('o expurgo NÃO apaga a entrada nova (o cache continua funcionando)',
      storage.getItem('cnpj_v2_11222333000181') !== null);
    ok('a chave nova é versionada (cnpj_v2_) e a legada declarada',
      t.CHAVE_CACHE === 'cnpj_v2_' && t.CHAVE_CACHE_LEGADO === 'cnpj_');
    ok('o resumo de cache só enxerga a chave nova (Limpar cache funciona)',
      t.cacheResumo().n === 1, JSON.stringify(t.cacheResumo()));
    // render da entrada CRU (simulando o que o build antigo deixou no navegador)
    els['cnpj-input'].value = cnpjValido;
    await t.consultar();
    const h = els['cnpj-result'].innerHTML;
    ok('render() escapa payload cru vindo do cache (XSS armazenado)',
      !/<img/i.test(h) && /&lt;img/i.test(h), h.slice(0, 240));
    ok('o texto do payload cru aparece escaped na tela, não interpretado',
      /&lt;img src=x onerror=/.test(h), h.slice(0, 240));
  }

  // ── B6b: grava pela chave nova, relê e renderiza com HTML da API ──
  {
    const storage = storageReal();
    const api = { razao_social: '<img src=x onerror="window.__pwn=1">', estabelecimento: { cnpj: '11222333000181' } };
    const { t, els, erros } = rodarCnpj({
      storage, fetchImpl: () => Promise.resolve({ ok: true, status: 200, json: async () => api }),
      modPdf: { vC: modPdf },
    });
    ok('módulo sobe com fetch bem-sucedido', erros.length === 0, erros.map((e) => e.message).join('|'));
    if (erros.length) return;
    els['cnpj-input'].value = cnpjValido;
    await t.consultar();
    const h = els['cnpj-result'].innerHTML;
    ok('render() escapa HTML vindo da API nova', !/<img/i.test(h) && /&lt;img/i.test(h), h.slice(0, 200));
    const gravado = storage.getItem('cnpj_v2_11222333000181');
    ok('o cache guarda o dado CRU (o escape é do render, não da fronteira)',
      gravado !== null && /"<img src=x onerror=/.test(gravado), String(gravado).slice(0, 120));
    ok('o aviso de cache fica VISÍVEL depois de uma consulta bem-sucedida (B26)',
      els['cnpj-cache-aviso'].style.display === 'block',
      els['cnpj-cache-aviso'].style.display + ' / ' + els['cnpj-cache-aviso'].innerHTML.slice(0, 80));
  }

  // ── B7: injeção de fórmula no CSV do lote ──
  {
    const bloco = /const q=v=>[\s\S]*?return '"'\+s\.replace\(\/"\/g,'""'\)\+'"';};/.exec(html);
    ok('a função de escape do CSV do lote existe', !!bloco, bloco && bloco[0]);
    if (bloco) {
      // `const q=v=>…;` é declaração; vira expressão para o sandbox.
      const q = vm.runInNewContext('(' + bloco[0].replace(/^const q=/, '').replace(/;\s*$/, '') + ')',
        {}, { filename: 'csv#q' });
      const casos = [['=1+1', '\'=1+1'], ['@SUM(A1)', "'@SUM(A1)"], ['-2+3+cmd', "'-2+3+cmd"],
        ['+41', "'+41"], ['\tcmd', "'\tcmd"], ['EMPRESA LTDA', 'EMPRESA LTDA'],
        ['=HYPERLINK("x")', '\'=HYPERLINK(""x"")']];
      casos.forEach(([entra, esperado]) => {
        ok('CSV neutraliza fórmula: ' + JSON.stringify(entra), q(entra) === '"' + esperado + '"',
          q(entra));
      });
      /* O invariante é sobre o CONTEÚDO entre aspas: nunca pode começar com
         =, +, - ou @. O prefixo ' do Excel é o que impede a execução. */
      ok('nenhum campo exportado começa com =, +, - ou @ cru',
        ['=1+1', '@SUM(A1)', '-1', '+1', '\tX', '\rX']
          .every((v) => /^"'?[=+\-@\t\r]/.test(q(v))), q('=1+1'));
      ok('aspas duplas continuam duplicadas (delimitador intacto)',
        q('a"b') === '"a""b"', q('a"b'));
      /* O XLSX vai por XLSX.utils.aoa_to_sheet, que escreve string como string
         (fórmula exigiria {f:...}), então o risco é do caminho CSV — que é o
         caminho de reserva e o que roda quando a CDN do Excel cai. */
      ok('o export XLSX do lote escreve string (sem objeto {f:})',
        /const ws=XLSX\.utils\.aoa_to_sheet\(\[header,\.\.\.rows\]\)/.test(html));
    }
  }

  // ── B8: o aviso de privacidade do arquivo gerado não é falso ──
  {
    const mIns = /const INSTRUCOES=(\[[\s\S]*?\n    \]);/.exec(html);
    ok('INSTRUCOES extraível', !!mIns);
    if (mIns) {
      const linhas = vm.runInNewContext(mIns[1]).map((l) => l[0]);
      /* Só as linhas que FAZEM afirmação de privacidade — as que citam para
         onde os dados vão. As demais linhas de "Limites" falam de cache e de
         CDN e não são afirmação de privacidade. */
      const priv = linhas.filter((t) => /nada é enviado|não são enviados|nenhum servidor|transmitid|enviado a fora|servidor/i.test(t));
      ok('o painel gerado tem aviso de privacidade', priv.length > 0, JSON.stringify(priv));
      priv.forEach((t) => {
        ok('aviso de privacidade cita publica.cnpj.ws: ' + t.slice(0, 60),
          /publica\.cnpj\.ws/.test(t), t);
        ok('aviso de privacidade NÃO afirma "nenhum servidor": ' + t.slice(0, 60),
          !/nenhum servidor|não são enviados a nenhum servidor/i.test(t), t);
      });
    }
    /* O aviso da tela (#cnpj-privacidade) e o do arquivo precisam concordar. */
    const tela = /id="cnpj-privacidade"[\s\S]*?<\/div>/.exec(html);
    ok('o aviso da tela também cita publica.cnpj.ws e o CNPJ digitado',
      !!tela && /publica\.cnpj\.ws/.test(tela[0]) && /CNPJ digitado/.test(tela[0]));
  }
})();

// ══════════════════════════════════════════════════════════════
grupo('12 · CACHE DE CNPJ (cota, degradação e leitura no lote)');
// ══════════════════════════════════════════════════════════════
// O lote chamava JSON.parse() sobre o retorno de lerCache(), que já é um
// objeto: lançava exceção, era engolida no catch e todo CNPJ em cache era
// consultado de novo — o cache do lote nunca funcionou.
{
  ok('lote NÃO faz JSON.parse sobre o retorno de lerCache',
    !/JSON\.parse\(cached\)/.test(html));
  ok('lote registra direto o objeto do cache', /const j=lerCache\(CHAVE_CACHE\+c\)/.test(html));
  ok('lote tem trava de reentrância (2 requisições no mesmo instante)',
    /if\(rodando\)return;/.test(html));
  ok('lote valida o DV do CNPJ antes de consumir a taxa',
    /RE_CNPJ_CELULA/.test(html) && /vC\(soDigitos\)/.test(html));
  ok('lote avisa antes de fechar a aba', /beforeunload/.test(html));
  ok('cache informa quando não coube (não some em silêncio)',
    /if\(!gravarCache\(CHAVE_CACHE\+c,dados\)\)naoGravados\+\+/.test(html));
  ok('aviso de cache visível existe e tem role=status',
    /id="cnpj-cache-aviso" role="status"/.test(html));
  ok('tabela do lote limita linhas (não trava com 2.000 CNPJs)', /LIMITE_LINHAS=\d+/.test(html));
  ok('modelo de consulta em massa existe', /id="cnpj-lote-modelo"/.test(html));
  ok('modelo tem as duas abas (CNPJs + Instrucoes)',
    /book_append_sheet\(wb,ws,'CNPJs'\)/.test(html) && /book_append_sheet\(wb,wi,'Instrucoes'\)/.test(html));
  ok('modelo tem fallback em CSV se o Excel não carregar', /modelo_consulta_cnpj\.csv/.test(html));
  ok('leitura do cache trata relógio que andou para trás',
    /idade<-86400000/.test(html));
// ── o modelo de consulta em massa é lido pelo mesmo validador do importador ──
const mExemplos = /const exemplos=(\[\[.*?\]\]);/.exec(html);
ok('a lista de exemplos do modelo é extraível do index.html', !!mExemplos);
if (mExemplos) {
  const cnpjsModelo = vm.runInNewContext(mExemplos[1]).slice(1).map((l) => l[0]);
  ok('o modelo traz 3 exemplos de CNPJ', cnpjsModelo.length === 3, String(cnpjsModelo.length));
  // O importador só aceita CNPJ com DV válido. Um exemplo inválido no modelo
  // faz o usuário concluir que a coluna dele está errada.
  const rejeitados = cnpjsModelo.filter((c) => !vC(c));
  ok('todo exemplo do modelo passa no vC do próprio app', rejeitados.length === 0, rejeitados.join(','));
}
const mInstrucoes = /const INSTRUCOES=(\[[\s\S]*?\n    \]);/.exec(html);
ok('as instruções do modelo são extraíveis do index.html', !!mInstrucoes);
if (mInstrucoes) {
  const linhas = vm.runInNewContext(mInstrucoes[1]).map((l) => l[0]);
  const emIngles = linhas.filter((t) => /\b(the|are|ignored|columns|other|with)\b/i.test(t));
  ok('nenhuma linha do modelo escrito em inglês', emIngles.length === 0, emIngles.join(' | '));
  ok('o modelo avisa que sem a biblioteca de planilhas só há CSV',
    linhas.some((t) => /CSV/.test(t)));
}
// ── estado do lote: uma lista por vez, um intervalo por vez ──
ok('importar outra planilha no meio do lote mata o lote (2 intervalos = 6/min, o dobro do teto)',
  /ger\+\+;\s*\n\s*abort=true;\s*\n\s*if\(timer\)\{clearInterval\(timer\);timer=null;\}/.test(html));
ok('a resposta que chegou depois da troca de lista é descartada',
  /const meuGer=ger;/.test(html) && (html.match(/if\(meuGer!==ger\)return;/g) || []).length >= 3);
ok('"Iniciar" nunca cria um segundo intervalo',
  /if\(timer\)\{clearInterval\(timer\);timer=null;\}/.test(html));
ok('importar .xlsx sem a biblioteca diz o que fazer (CDN fora)', /!window\.XLSX/.test(html) && /Exporte a planilha como CSV/.test(html));
ok('nenhum código morto sobrou no módulo do lote', !/linhaDe/.test(html));
// O log era apagado logo DEPOIS de receber a linha "N CNPJ(s) prontos para
// iniciar" (e escondido quando a lista vinha vazia): a mensagem existia no
// código e nunca aparecia.
// O escape é do RENDER, não do fetch: o cache guarda o dado cru. O caminho
// inverso (escapar na fronteira) fazia o invariante depender de qual versão do
// app gravou a entrada — e foi isso que deixou o payload cruo do 627b8e0
// chegar ao innerHTML por 30 dias.
ok('NÃO escapa só no fetch (o escape tem de ser do render)',
  !/escProfundo\(await/.test(html));
ok('render() escapa a carga antes de escrever no DOM',
  /function render\(dados,cached\)[\s\S]{0,600}?dados=escProfundo\(dados\);/.test(html));
ok('renderLote() escapa cada campo da tabela do lote',
  /const rows=janela\.map\(r=>`[\s\S]{0,240}?esc\(r\.razao\)[\s\S]{0,240}?esc\(r\.fantasia\)/.test(html));
ok('o log do lote não é apagado depois de escrever nele',
  !/loteLog\([^;]{0,200};\s*\n?[^\n]*logEl\.textContent\s*=\s*''/.test(html));
ok('a mensagem de lista vazia fica visível (o log não some junto)',
  !/logEl\.style\.display\s*=\s*cnpjs\.length\s*\?\s*'block'\s*:\s*'none'/.test(html));

}

// ══════════════════════════════════════════════════════════════
grupo('13 · SEPARADOR: robustez e layout');
// ══════════════════════════════════════════════════════════════
{
  ok('separador usa a largura da tela (sem coluna central)',
    /#tab-separar\{max-width:none\}/.test(html) && !/#tab-separar\{max-width:760px/.test(html));
  ok('separador tem grade responsiva',
    /#tab-separar \.grade\{display:grid/.test(html) && /@media \(max-width:900px\)/.test(html));
  ok('rádio ausente não trava o botão (sem .value em null)',
    /const modo = modoEl \? modoEl\.value : 'auto'/.test(html)
    && !/querySelector\('input\[name=modo\]:checked'\)\.value/.test(html));
  ok('lê o PDF uma vez só (buffer não duplicado)',
    /const original = await arquivo\.arrayBuffer\(\)/.test(html)
    && !/getDocument\(await arquivo\.arrayBuffer\(\)\)/.test(html));
  ok('destrói o documento do pdf.js mesmo em erro', /finally\s*\{[\s\S]{0,120}doc\.destroy\(\)/.test(html));
  ok('erro na separação invalida os resultados antigos',
    /window\.__resultados\s*=\s*null;\s*\n\s*baixar\.style\.display\s*=\s*'none';/.test(html));
  ok('trocar de PDF limpa o que estava pronto',
    /getElementById\('pdfFile'\)\.addEventListener\('change'/.test(html));
  ok('falha na pasta cai para ZIP em vez de perder os arquivos',
    /baixarZip\(motivo\)/.test(html) && /A pasta parou de responder/.test(html));
  ok('permissão da pasta é renovada antes de salvar',
    /queryPermission\(\{ mode: 'readwrite' \}\)/.test(html));
  ok('confere se nenhuma página se perdeu no agrupamento',
    /paginasGeradas !== saida\.totalPaginas/.test(html));
  ok('log do separador não é reescrito inteiro a cada linha',
    /appendChild\(document\.createTextNode/.test(html));
  ok('referência a CDN fica dentro de guarda',
    /if \(typeof pdfjsLib !== 'undefined'\)[\s\S]{0,140}workerSrc/.test(html));
  ok('wrapper morto de localStorage removido',
    !/window\.localStorage\s*=/.test(html));
ok('falha parcial também gera o ZIP (o log não promete o que não entrega)',
  /if \(falhas\.length\)[\s\S]{0,900}await baixarZip\(\)/.test(html));
ok('"Salvar arquivos" trava já no primeiro await (dois cliques = dois laços de gravação)',
  /if \(btnBaixar\.disabled\) return;\s*\n\s*btnBaixar\.disabled = true;/.test(html));
ok('o rótulo do botão volta por um caminho só (sem dataset.orig)', !/dataset\.orig/.test(html));

}

/* ══════════════════════════════════════════════════════════════
   grupo('14 · ALVOS DE TOQUE, ESCALA E TOKENS (bloqueios do Designer)');
   ══════════════════════════════════════════════════════════════ */
{
  /* .btn media 32,5px com o padding de 8px — abaixo do piso. Os 4 botões da
     Consulta em Lote são .btn. */
  const regraBtn = /\.btn\{([^}]*)\}/.exec(html);
  ok('.btn tem min-height de 40px (media 32,5px sem ele)',
    !!regraBtn && /min-height:\s*40px/.test(regraBtn[1]), regraBtn && regraBtn[1].slice(0, 80));
  const mq768 = /@media \(max-width:768px\)\{([\s\S]*?)\n\}/.exec(html);
  ok('no celular .btn vai a 44px (piso de alvo de toque)',
    !!mq768 && /\.btn\{[^}]*min-height:\s*44px/.test(mq768[1]), mq768 && mq768[1].slice(0, 60));
  /* .radio-group label sem padding/altura: alvo de ~20px na aba Separar. */
  const regraRadio = /#tab-separar \.radio-group label\{([^}]*)\}/.exec(html);
  ok('o label do radio tem min-height de 44px (era ~20px)',
    !!regraRadio && /min-height:\s*44px/.test(regraRadio[1]), regraRadio && regraRadio[1]);
  ok('o label do radio é flex e centraliza (alvo clicável de verdade)',
    !!regraRadio && /display:\s*flex/.test(regraRadio[1]) && /align-items:\s*center/.test(regraRadio[1]));
  ok('o radio em si tem 20x20 e margin 0 (não empurra o alvo)',
    /#tab-separar \.radio-group label input\{[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*margin:\s*0/.test(html));
  /* Escala de 4px no código NOVO (esta rodada). O arquivo tem 10px em regras
     antigas (.filter-bar, .info-grid, .nav-btn): mexer nelas seria troca de
     aperto visual fora do escopo, então o gate mede só o que foi introduzido. */
  const escala4 = (sel) => {
    const r = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(html);
    return r ? r[1] : '';
  };
  /* Só as regras que a rodada tocou: .btn e .campo mantêm espaçamento antigo
     (18px no padding, 6px no gap, 14px no margin-bottom) que já é o padrão do
     arquivo inteiro — mudá-las seria troca de aperto visual fora do escopo. */
  const novosComEspaco = ['#tab-separar .grade', '#tab-separar .acoes-sep', '#tab-separar .radio-group',
    '#tab-separar .radio-group label', '#cnpj-lote-log'];
  const furos = novosComEspaco.flatMap((s) => {
    const corpo = escala4(s);
    return [...corpo.matchAll(/(?:margin|gap|padding)[a-z-]*\s*:\s*([^;]+)/g)]
      .filter((m) => /(?<![\d.])(?:6px|10px|18px|14px|22px)(?![\d.])/.test(m[1]))
      .map((m) => s + ' -> ' + m[0].trim());
  });
  ok('nenhum espaçamento do código novo fura a escala de 4px (nada de 6, 10, 14, 18 ou 22px)',
    furos.length === 0, furos.join(' | '));
  ok('o painel também não usa 6px no código novo (.est-msg/.est-alert)',
    /\.est-msg, \.est-alert\s*\{[^}]*margin:\s*8px 0 0/.test(fs.readFileSync(path.join(RAIZ, 'painel-gerencial.html'), 'utf8')));
  ok('o gap da grade do separador é 16px (não 18)',
    /#tab-separar \.grade\{[^}]*gap:\s*0 16px/.test(html));
  ok('o gap das ações do separador é 12px e a margem 8px',
    /#tab-separar \.acoes-sep\{[^}]*gap:\s*12px;[^}]*margin-top:\s*8px/.test(html));
  ok('o gap do grupo de radios é 24px (não 18) e a margem 8px (não 6)',
    /#tab-separar \.radio-group\{[^}]*gap:\s*24px;[^}]*margin-top:\s*8px/.test(html));
  /* Nenhum rgba escrito à mão em style="" (fora dos tokens). */
  const rgbaInline = [...html.matchAll(/style="[^"]*rgba\(/g)].map((m) => m[0]);
  ok('nenhuma cor rgba escrita à mão em style="" (tokenize, B16)',
    rgbaInline.length === 0, rgbaInline.slice(0, 3).join(' | '));
  ok('o badge "cache" usa o token --badge-on-cta',
    /<span class="badge" style="background:var\(--badge-on-cta\)">cache<\/span>/.test(html));
  /* Nomenclatura e copy. */
  ok('"Separar notas" com n minúsculo', /id="btn-processar" class="btn">Separar notas</.test(html));
  ok('"Nomenclatura dos arquivos" (não "Nomeação")',
    /<legend class="campo-legenda">Nomenclatura dos arquivos<\/legend>/.test(html)
    && !/Nomeação dos arquivos/.test(html));
  ok('o texto auxiliar cita o rótulo real do radio',
    /Com “Ler número da nota” o nome sai como/.test(html) && /com “Não ler”/.test(html));
  /* Contrato entre módulos: consultarCNPJ é publicado por outra IIFE. */
  ok('o consumidor do CNPJ verifica o contrato antes de chamar (não ReferenceError cru)',
    /typeof window\.consultarCNPJ!=='function'/.test(html) && /onclick="return abrirConsultaCNPJ\(/.test(html));
  ok('a IIFE de CNPJ nomeia o contrato que publica',
    /CONTRATO ENTRE M[ÓO]DULOS: publica window\.consultarCNPJ/.test(html));
  /* Teto de volume do separador. */
  ok('o separador tem teto de páginas (o OCR tem, o separador não)',
    /const SEP_MAX_PAGINAS = \d+;/.test(html) && /const SEP_MAX_BYTES = \d+ \* 1024 \* 1024;/.test(html));
  ok('acima do teto o pedido é um segundo clique explícito (sem alert/confirm)',
    /e\.code = 'SEP_VOLUME'/.test(html) && /sepConfirmado = file;/.test(html)
    && /Clique em "Separar notas" de novo para continuar\./.test(html));
  ok('trocar de PDF invalida a confirmação de volume',
    /pdfFile'\)\.addEventListener\('change'[\s\S]{0,400}?sepConfirmado = null;/.test(html));
  ok('o separador informa o volume que fica retido em memória',
    /retidos em memória/.test(html) && /sepMb\(original\.byteLength\)/.test(html));
  /* alert() pré-existente. O gate olha o código, não os comentários que
     citam a regra (dois deles legítimamente mencionam alert()). */
  const semComentarios = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  ok('nenhum alert() no index.html (regra do projeto)',
    !/\balert\s*\(/.test(semComentarios), (/\balert\s*\([^)]*\)/.exec(semComentarios) || [''])[0]);
  ok('nenhum confirm() novo no separador (a confirmação é por segundo clique)',
    (semComentarios.match(/confirm\s*\(/g) || []).length === 1,
    String((semComentarios.match(/confirm\s*\(/g) || []).length));
  ok('"sem dados para exportar" vai para a faixa de status, não para alert()',
    /function exportAviso\(msg\)/.test(html)
    && (html.match(/exportAviso\('Nada para exportar/g) || []).length === 2);
  ok('a faixa de status some sozinha (não fica sempre na tela)',
    /exportAvisoTimer=setTimeout\([\s\S]{0,120}?b\.style\.display='none'/.test(html));
}

// ══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(58));
console.log('REGRESSÃO: ' + passou + ' passaram, ' + falhou + ' falharam');
if (falhou) {
  console.log('\nFALHAS:');
  falhas.forEach(f => console.log('  ✗ ' + f));
}
console.log('='.repeat(58));
process.exit(falhou ? 1 : 0);
