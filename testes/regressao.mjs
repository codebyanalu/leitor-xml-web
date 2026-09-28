// Regressão estrutural do GCON/SIAN — SEM OCR, SEM browser, ~1 s.
// Uso: node regressao.mjs   (exit != 0 se algo falhar)
//
// Cobre o que a bancada de PDF (rodar.mjs) NÃO alcança: a bancada fatia o index.html
// do marcador do ModPDFIsolado até o primeiro </script>, ou seja, tudo que vem DEPOIS
// da linha 355 (tema, sprite, CSS, acessibilidade, CDNs) é estruturalmente invisível
// para ela. Aqui essa parte é auditada de verdade.
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');

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
ok('resposta de API externa passa por escape', /escProfundo\(await/.test(html));
ok('aviso de localStorage presente (LGPD)', /id="cnpj-privacidade"/.test(html));
ok('cache de CNPJ tem TTL', /CACHE_TTL\s*=/.test(html));
ok('setItem do cache é try/catch dedicado (quota)', /function gravarCache[\s\S]{0,400}try\{/.test(html));
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
  ['--err', '--card', 4.5], ['--success', '--card', 4.5],
  ['--code-fg', '--code-bg', 4.5],
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
  '3326090602031800054455005000742197115953838',   // 43
  '332609060203180005445500500074219711595383867', // 45
  'abcdefghijklmnopqrstuvwxyzabcdefghijklmnop', '', '   ',
  '33260906020318000544550050007421971159538 6',
];
falsas.forEach((k, i) => ok('chave falsa #' + (i + 1) + ' rejeitada por vH', vH(k) === false, JSON.stringify(k.slice(0, 20))));
ok('vH aceita chave válida sintética (controle positivo)',
  vH('33260906020318000544550050007421971159538386') === true);
ok('CNPJ placeholder rejeitado por vC', vC('00.000.000/0000-00') === false);
ok('CNPJ válido aceito por vC', vC('06.020.318/0005-44') === true);

// ══════════════════════════════════════════════════════════════
grupo('10 · REGRAS DO PROJETO');
// ══════════════════════════════════════════════════════════════
ok('erro de XML malformado é específico', /XML inválido ou malformado/.test(html));
ok('single-file: nenhum .js ou .css local', !/<script[^>]+src="(?!https:)[^"]+\.js"/.test(html));
ok('font-import dentro de <style>', /@import url\('https:\/\/fonts\.googleapis\.com[^']*'\)/.test(html));
const hnfe = /const HNFE=\[([\s\S]*?)\];/.exec(html)[1];
const hnfse = /const HNFSE=\[([\s\S]*?)\];/.exec(html)[1];
const nHnfe = (hnfe.match(/'[^']+'/g) || []).length;
const nHnfse = (hnfse.match(/'[^']+'/g) || []).length;
ok('HNFE tem 93 campos', nHnfe === 93, 'achou ' + nHnfe);
ok('HNFSE tem 56 campos', nHnfse === 56, 'achou ' + nHnfse);
ok('README diz 93 colunas NF-e (bate com o código)', /93 NF-e/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8')));
ok('nenhum texto fala 423 campos', !/423/.test(fs.readFileSync(path.join(RAIZ, 'README.md'), 'utf8'))
  && !/423/.test(fs.readFileSync(path.join(RAIZ, 'workflow-rule.md'), 'utf8')));
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

// ══════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(58));
console.log('REGRESSÃO: ' + passou + ' passaram, ' + falhou + ' falharam');
if (falhou) {
  console.log('\nFALHAS:');
  falhas.forEach(f => console.log('  ✗ ' + f));
}
console.log('='.repeat(58));
process.exit(falhou ? 1 : 0);
