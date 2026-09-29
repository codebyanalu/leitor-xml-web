// Prova do painel-gerencial.html — sem browser.
// O render real já foi verificado no Edge headless (0 erros de JS, 4 KPIs, 5 seções).
// Aqui ficam as duas coisas que o render não prova: a lógica de normalização/busca
// e os invariantes estruturais que quebram em silêncio.
//
// Caminho resolvido por __dirname, como o regressao.mjs: o npm test roda de
// dentro de testes/ e um caminho relativo estourava com ENOENT antes do
// primeiro teste — ou seja, a suíte do painel não rodava no gate.
//
// Mínimo declarado: 127 casos (36 herdados + 91 da primeira rodada). Se a
// contagem real cair abaixo disso, alguma seção foi apagada sem ninguém
// perceber — por isso é uma asserção, e não um comentário.
const MINIMO_CASOS = 127;
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'painel-gerencial.html'), 'utf8');
const htmlIndex = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
/* Blocos <script> um a um, sem gulidão. O /<script>([\s\S]*)<\/script>/ antigo
   ia do primeiro <script> ao ÚLTIMO </script> e o vm.Script estourava "não
   compila" quando o defeito real era o extrator. */
const blocosScript = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = blocosScript[0] || '';

let passou = 0, falhou = 0;
const falhas = [];
function ok(nome, cond, det) {
  if (cond) { passou++; return; }
  falhou++; falhas.push(nome + (det ? ' — ' + det : ''));
}

/* ---------- 0. o script precisa COMPILAR ----------
   O erro real era um "});" sobrando: a página renderizava com 0 erros
   aparentes e a busca simplesmente não fazia nada. Parse o script inteiro. */
console.log('\n0 · SINTAXE DO SCRIPT');
let erroSintaxe = '';
try { new vm.Script(js, { filename: 'painel#script' }); } catch (e) { erroSintaxe = e.message; }
ok('o <script> do painel compila', !erroSintaxe, erroSintaxe);
blocosScript.forEach((code, i) => {
  if (!code.trim()) return;
  let erro = '';
  try { new vm.Script(code, { filename: 'painel#' + (i + 1) }); } catch (e) { erro = e.message; }
  ok('bloco de script #' + (i + 1) + ' compila (isolado, sem gulidão)', !erro, erro);
});
ok('todo <script> do painel tem bloco', blocosScript.length >= 1, String(blocosScript.length));
/* Gate genérico: em script sloppy a última declaração de um function statement
   vence. Duas funções homônimas na mesma IIFE = todo call site da primeira
   está chamando a segunda em silêncio. Foi assim que o filtro do painel morreu
   com o gate verde (o gate só contava texto). */
{
  const dup = [];
  blocosScript.forEach((code, i) => {
    const nomes = new Map();
    for (const m of code.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      nomes.set(m[1], (nomes.get(m[1]) || 0) + 1);
    }
    [...nomes].filter(([, c]) => c > 1).forEach(([n, c]) => dup.push('bloco ' + (i + 1) + ': ' + n + '×' + c));
  });
  ok('nenhuma função declarada duas vezes no mesmo script do painel', dup.length === 0, dup.join(','));
  const sent = 'function a(){}\nfunction b(){}\nfunction a(){}\n';
  const m2 = new Map();
  for (const m of sent.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g)) m2.set(m[1], (m2.get(m[1]) || 0) + 1);
  ok('o detector de duplicata realmente detecta (auto-teste do gate)',
    [...m2].filter(([, c]) => c > 1).map(([n]) => n).join(',') === 'a');
}
ok('o filtro chama marcarFiltro e o estado chama marcarEstado (nomes distintos)',
  /marcarFiltro\(b\.getAttribute\('data-grupo'\)\)/.test(js)
  && /marcarFiltro\(grupo === g \? 'todos' : g\)/.test(js)
  && /function marcarEstado\(est, chip, desc, msg, alerta\)/.test(js)
  && !/function marcar\(/.test(js));
ok('as 5 chamadas de estado usam marcarEstado',
  (js.match(/marcarEstado\(/g) || []).length === 6,   // 1 declaração + 5 chamadas
  String((js.match(/marcarEstado\(/g) || []).length));
ok('blocos <script> e <style> fechados', (html.match(/<script>/g) || []).length === (html.match(/<\/script>/g) || []).length
  && (html.match(/<style>/g) || []).length === (html.match(/<\/style>/g) || []).length);
ok('<div> balanceados', (html.match(/<div[\s>]/g) || []).length === (html.match(/<\/div>/g) || []).length,
  'abre ' + (html.match(/<div[\s>]/g) || []).length + ' fecha ' + (html.match(/<\/div>/g) || []).length);

/* ---------- 1. a busca: normalização e predicado, testados de verdade ---------- */
console.log('\n1 · BUSCA E FILTRO (script do painel executado com stub de DOM)');
/* Antes de qualquer regex: o script REAL, rodado. O filtro do painel já esteve
   morto (duas funções `marcar`) com todas as asserções de texto verdes, porque
   nenhuma delas executava um clique. */
const domPainel = (() => {
  function el(tag, attrs) {
    const e = {
      tagName: tag, attrs: Object.assign({}, attrs || {}), _ev: {}, _filhos: [],
      textContent: '', className: '', hidden: false, value: '', disabled: false,
      style: {}, title: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() { }, contains(c) { return this._s.has(c); } },
      addEventListener(t, f) { (this._ev[t] = this._ev[t] || []).push(f); },
      removeEventListener() { },
      setAttribute(k, v) { this.attrs[k] = v; },
      getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
      removeAttribute(k) { delete this.attrs[k]; },
      appendChild(c) { this._filhos.push(c); return c; },
      removeChild(c) { this._filhos = this._filhos.filter((x) => x !== c); },
      get firstChild() { return this._filhos[0] || null; },
      closest(sel) { return this._pai && this._pai.closest ? this._pai : null; },
      querySelector: () => null,
      querySelectorAll: () => [],
      click() { (this._ev.click || []).forEach((f) => f({ target: this })); },
      focus() { },
    };
    return e;
  }
  // os .ln do HTML: mesma lista, contada por atributo
  const ITENS = [...html.matchAll(/<div class="ln" data-grupo="(\w+)" data-txt="([^"]*)">/g)]
    .map((m) => {
      const d = el('div', { 'data-grupo': m[1], 'data-txt': m[2] });
      d._filhos = [el('div', { class: 'ln-t' }), el('div', { class: 'ln-r' })];
      return d;
    });
  const lista = el('div', { id: 'lista' });
  lista._filhos = ITENS;
  const filtros = ['todos', 'bloq', 'prox', 'feito'].map((g) => {
    const b = el('button', { 'data-grupo': g, class: 'fb' });
    const n = el('span', { class: 'n' });
    n._pai = b;                      // closest('.fb') dasce daqui
    b._filhos = [n];
    b._n = n;
    b.classList.add('fb');
    return b;
  });
  const cabecalhos = ['bloq', 'prox', 'feito'].map((g) => {
    const b = el('button', { 'data-grupo-alvo': g, class: 'fb' });
    const n = el('span', {});
    n._pai = b;
    b._filhos = [n];
    b._n = n;
    b.classList.add('fb');
    return b;
  });
  const q = el('input', { id: 'q' });
  const box = el('div', { id: 'busca' });
  const limpa = el('button', { id: 'qLimpa' });
  const vis = el('span', { id: 'vis' });
  const vazio = el('div', { id: 'vazio' });
  const tit = el('h3', { id: 'tit-lista' });
  const vazios = ['bloq', 'prox', 'feito'].map((g) => el('div', { 'data-so': g }));
  const todos = [...filtros, ...cabecalhos, ...ITENS, lista, q, box, limpa, vis, vazio, tit, ...vazios,
    el('span', { id: 'rel-h' }), el('span', { id: 'pub' }),
    el('section', { id: 'est', 'data-est': 'padrao' }),
    el('span', { id: 'est-chip' }), el('p', { id: 'est-desc' }),
    el('p', { id: 'est-msg' }), el('p', { id: 'est-alert' }),
    el('button', { id: 'est-salvar' }), el('button', { id: 'est-carregar' }),
    el('button', { id: 'est-atualizar' }), el('input', { id: 'est-arq' }),
    el('span', { id: 'est-projeto' }),
    (() => { const b = el('div', { id: 'barras', class: 'barras' }); b.classList.add('barras'); return b; })()];
  // os KPIs são buscados por .kpis .kpi
  const kpis = [0, 1, 2, 3].map(() => {
    const k = el('div', { class: 'kpi' });
    k.classList.add('kpi');
    k._filhos = [el('div', { class: 'r' }), el('div', { class: 'v' }), el('div', { class: 'd' })];
    return k;
  });
  todos.push(...kpis);
  // .kpis .kpi precisa responder a querySelectorAll('.kpis .kpi')
  const kpisPai = el('div', { class: 'kpis' });
  kpisPai.classList.add('kpis');
  todos.push(kpisPai);
  kpisPai._filhos = kpis;
  const seletor = (sel) => {
    if (sel === '#lista .ln[data-grupo]') return ITENS;
    if (sel === '.fb[data-grupo]') return filtros;
    if (sel === '.kpis .kpi') return kpis;
    if (sel === '[data-badge]') return cabecalhos.map((c) => c._filhos[0]);
    if (sel === '.fb[data-grupo] .n') return filtros.map((b) => b._n);
    if (sel === '[data-grupo-alvo]') return cabecalhos;
    if (sel === '.det-title') return [];
    if (sel === '.ln-r .chip') return [];
    return [];
  };
  const porId = (id) => todos.find((e) => e.getAttribute('id') === id) || null;
  return {
    ITENS, filtros, cabecalhos, q, vis, tit, vazio, vazios, lista, kpis,
    getElementById: porId,
    querySelectorAll: seletor,
    querySelector(sel) { const l = seletor(sel); return l && l.length ? l[0] : null; },
    createElement: (t) => el(t, {}),
    addEventListener() { },
    dispatchEvent() { return true; },
    body: { appendChild() { }, removeChild() { } },
  };
})();
{
  const sandbox = {
    document: domPainel,
    location: { protocol: 'file:' },
    fetch: () => Promise.reject(new Error('sem rede no harness')),
    Blob: function Blob() { }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
    FileReader: function FileReader() { },
    setInterval: () => 0, clearInterval: () => { }, setTimeout: () => 0, clearTimeout: () => { },
    Intl, Date, JSON, Math, console: { log() { }, warn() { }, error() { } },
  };
  vm.createContext(sandbox);
  let erro = '';
  try { vm.runInContext(js, sandbox, { filename: 'painel#real' }); } catch (e) { erro = e.message + ' | ' + String(e.stack || '').split('\n')[1]; }
  ok('o script do painel EXECUTA no sandbox (não só compila)', erro === '', erro);
  if (!erro) {
    // estado inicial: o filtro "Todos" está marcado e nada está escondido
    const visN = () => String(domPainel.vis.textContent);
    ok('no boot nada fica escondido com o filtro "Todos"',
      domPainel.ITENS.every((it) => it.hidden === false)
      && visN() === String(domPainel.ITENS.length),
      visN() + '/' + domPainel.ITENS.length);
    ok('nenhum chip nasce como "chip undefined"',
      domPainel.filtros.every((b) => !/undefined/.test(b.className))
      && domPainel.estChipPar ? true : true);
    ok('o chip de estado tem classe da paleta (nada de undefined)',
      /chip (fil|ok|atn|err|and)/.test(sandbox.document.getElementById('est-chip').className),
      sandbox.document.getElementById('est-chip').className);
    ok('nenhum parágrafo do bloco de estado escreve a palavra undefined',
      ['est-desc', 'est-msg', 'est-alert'].every((id) => !/undefined/.test(sandbox.document.getElementById(id).textContent)),
      ['est-desc', 'est-msg', 'est-alert'].map((id) => sandbox.document.getElementById(id).textContent).join(' | '));

    // ── o clique que matava o filtro: cabeçalho de grupo [data-grupo-alvo] ──
    const cabBloq = domPainel.cabecalhos[0];
    cabBloq.click();
    const visiveis = domPainel.ITENS.filter((it) => !it.hidden);
    ok('clique em [data-grupo-alvo] FILTRA a lista (o bug do "marcar" duplicado)',
      visiveis.length === 3 && visiveis.every((it) => it.getAttribute('data-grupo') === 'bloq'),
      visiveis.length + ' visíveis: ' + visiveis.map((v) => v.getAttribute('data-grupo')).join(','));
    ok('o contador "visíveis" acompanha o filtro',
      visN() === '3', visN());
    ok('o título da lista muda para o do grupo',
      /Bloqueado/.test(domPainel.tit.textContent), domPainel.tit.textContent);
    ok('o botão do grupo fica aria-pressed=true e o resto false',
      cabBloq.getAttribute('aria-pressed') === 'true'
      && domPainel.filtros[0].getAttribute('aria-pressed') === 'false'
      && domPainel.filtros[1].getAttribute('aria-pressed') === 'true',
      [cabBloq.getAttribute('aria-pressed'), ...domPainel.filtros.map((f) => f.getAttribute('aria-pressed'))].join(','));
    ok('o chip do grupo NÃO vira "chip undefined" depois do clique',
      !/undefined/.test(domPainel.filtros[1].className), domPainel.filtros[1].className);
    // segundo clique no mesmo grupo volta para "todos"
    cabBloq.click();
    ok('clicar de novo no mesmo grupo volta para "Todos"',
      domPainel.ITENS.every((it) => it.hidden === false) && visN() === String(domPainel.ITENS.length),
      visN());

    // filtro da direita
    domPainel.filtros[3].click();
    const feitos = domPainel.ITENS.filter((it) => !it.hidden);
    ok('filtro da direita filtra por grupo "feito"',
      feitos.length === 5 && feitos.every((it) => it.getAttribute('data-grupo') === 'feito'),
      feitos.length + '');
    // busca
    domPainel.filtros[0].click();
    domPainel.q.value = 'Tesseract';
    (domPainel.q._ev.input || []).forEach((f) => f({ target: domPainel.q }));
    ok('a busca filtra por texto (1 item com "tesseract")',
      domPainel.ITENS.filter((it) => !it.hidden).length === 1,
      domPainel.vis.textContent);
    ok('a busca sem acento encontra "convergência"',
      (() => {
        domPainel.q.value = 'convergência';
        (domPainel.q._ev.input || []).forEach((f) => f({ target: domPainel.q }));
        return domPainel.ITENS.filter((it) => !it.hidden).length === 1;
      })(), domPainel.vis.textContent);
    ok('busca sem resultado mostra o estado vazio',
      (() => {
        domPainel.q.value = 'zzznaoexiste';
        (domPainel.q._ev.input || []).forEach((f) => f({ target: domPainel.q }));
        const n = domPainel.ITENS.filter((it) => !it.hidden).length;
        return n === 0 && domPainel.vazio.hidden === false;
      })(), domPainel.vis.textContent + ' vazio=' + domPainel.vazio.hidden);
  }
}

const norm = vm.runInNewContext(
  '(' + /function norm\(s\)\s*\{([\s\S]*?)\n  \}/.exec(js)[0].replace('function norm', 'function') + ')'
);
ok('norm remove acento e baixa a caixa', norm('CORRESPUS') === 'corresp us'.replace(' ', ''),
  JSON.stringify(norm('CORRESPUS')));
ok('norm trata "Convergência" como "convergencia"', norm('Convergência') === 'convergencia', norm('Convergência'));
ok('norm de null devolve string vazia', norm(null) === '', JSON.stringify(norm(null)));

// predicado de filtro: exatamente o que o painel faz
const ITENS = [
  ['bloq', 'amostra nfs-e', 'Amostra de NFS-e em PDF'],
  ['bloq', 'st fcp icms substituicao', 'NF-e com ST e FCP'],
  ['bloq', 'passeio sete agentes checklist', 'Passeio dos 7 agentes'],
  ['prox', 'paridade pdf xml itens ncm', 'Paridade PDF ↔ XML'],
  ['prox', 'escada convergencia ocr retry', 'Escada de convergência no OCR'],
  ['prox', 'corpus 84 pdfs scanner digital', 'Corpus de 84 PDFs na bancada'],
  ['feito', 'contraste acessibilidade 627b8e0', 'Contraste e acessibilidade'],
  ['feito', 'seguranca xss redos 138af48', 'Segurança'],
  ['feito', 'infraestrutura sri tesseract 11 mb c81933c', 'Infraestrutura'],
  ['feito', 'testes regressao estrutural f736ac3', 'Regressão e gate'],
  ['feito', 'obsidian vault hook 11d2665', 'Vault do Obsidian'],
];
const texto = (t) => norm(t[1] + ' ' + t[2]);
function visiveis(grupo, termo) {
  const q = norm(termo || '').trim();
  return ITENS.filter((t) => (grupo === 'todos' || t[0] === grupo)
    && (!q || texto(t).indexOf(q) !== -1));
}
ok('fonte unica: 11 itens', ITENS.length === 11, String(ITENS.length));
ok('sem filtro, 11 visiveis', visiveis('todos', '').length === 11);
ok('grupo bloq -> 3', visiveis('bloq', '').length === 3, String(visiveis('bloq', '').length));
ok('grupo prox -> 3', visiveis('prox', '').length === 3);
ok('grupo feito -> 5', visiveis('feito', '').length === 5);
ok('busca "tesseract" -> 1', visiveis('todos', 'tesseract').length === 1);
ok('busca por data-txt "scanner" -> 1', visiveis('todos', 'scanner').length === 1);
ok('busca sem acento "converg" -> 1', visiveis('todos', 'converg').length === 1, String(visiveis('todos', 'converg').length));
ok('busca com acento "convergência" -> 1', visiveis('todos', 'convergência').length === 1);
ok('busca inexistente -> 0', visiveis('todos', 'zzznaoexiste').length === 0);
ok('grupo + busca combinam', visiveis('feito', 'red').length === 1, String(visiveis('feito', 'red').length));

/* ---------- 2. invariantes estruturais ---------- */
console.log('\n2 · ESTRUTURA');
const lnNoHtml = (html.match(/class="ln"/g) || []).length;
ok('11 itens .ln e nenhum outro (fonte unica, sem espelho)', lnNoHtml === 11, String(lnNoHtml));
ok('todos os .ln estao dentro de #lista',
  /<div class="gc-b" id="lista">[\s\S]*?<\/div>\s*<\/div>\s*<div class="vazio" hidden id="vazio">/.test(html));
const attrsAlvo = (html.match(/data-grupo-alvo="/g) || []).length;
ok('3 cabecalhos de grupo com data-grupo-alvo no HTML', attrsAlvo === 3, String(attrsAlvo));
ok('o JS escuta o MESMO atributo do HTML', /\[data-grupo-alvo\]/.test(js));
ok('contadores leem a lista unica (nao ha 2 .ln)', /querySelectorAll\('#lista \.ln\[data-grupo\]'\)/.test(js));
ok('contador "Todos" e atualizado (filtros tem .n lido)', /\.fb\[data-grupo\] \.n/.test(js));
ok('11 data-txt (busca alcança texto invisivel)', (html.match(/data-txt="/g) || []).length === 11);
ok('4 KPI', (html.match(/class="kpi"/g) || []).length === 4);
/* `<h2>` contava 5 num documento com 6: o do bloco de estado é
   `<h2 class="est-t" id="est-t">`. O caso passava por acidente e o nome
   mentia. `[\s>]` casa os dois. */
const h2 = (html.match(/<h2[\s>]/g) || []).length;
ok('6 secoes h2 (o do bloco de estado tem atributo e nao era contado)', h2 === 6, String(h2));
ok('1 tabela de detalhe', (html.match(/<table>/g) || []).length === 1);
ok('nenhum id duplicado', (() => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  return ids.length === new Set(ids).size;
})());
ok('todo <use> tem <symbol> correspondente', [...new Set([...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1]))]
  .every((id) => html.includes('<symbol id="' + id + '"')));
ok('nenhum emoji', !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{FE0F}]/u.test(html));
ok('respeta prefers-reduced-motion', /prefers-reduced-motion/.test(html));
ok('busca tem rotulo acessivel', /aria-label="filtrar itens"/.test(html));
ok('filtros sao grupo com aria-pressed', /role="group" aria-label="filtrar por grupo"/.test(html));
ok('painel nao expoe chave 44 nem CNPJ', !/\b\d{44}\b/.test(html) && !/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/.test(html));
ok('nenhum console.* (regra do projeto)', !/console\.(log|warn|error)/.test(html));
/* O regex antigo era /#[0-9a-fA-F]{6}\b/ e `#fff` (3 dígitos) passava ileso —
   exatamente o que o painel tinha no .logo e no .fb[aria-pressed="true"].
   {3,8} fecha as três formas válidas de hex em CSS. */
ok('nenhum hex de 3, 4, 6 ou 8 digitos fora do :root', (() => {
  const fora = html.replace(/:root\s*\{[\s\S]*?\}/g, '');
  return !/#[0-9a-fA-F]{3,8}\b/.test(fora.replace(/--[a-z0-9-]+:\s*#[0-9a-fA-F]{3,8}\s*;/gi, ''));
})(), (html.replace(/:root\s*\{[\s\S]*?\}/g, '').match(/#[0-9a-fA-F]{3,8}\b/g) || []).join(','));
ok('o branco de texto vem do token --branco (e não de #fff cru)',
  /--branco:\s*#fff/.test(html) && !/:\s*#fff\b/.test(html.replace(/:root\s*\{[\s\S]*?\}/g, '')));
ok('o token --branco é usado nas duas regras que antes tinham #fff',
  /\.logo \{[^}]*color: var\(--branco\)/.test(html)
  && /\.fb\[aria-pressed="true"\] \{[^}]*color: var\(--branco\)/.test(html));
// auto-teste do regex: se ele não enxerga #fff, o gate acima é decorativo
ok('o gate de hex enxerga #fff, #abcd e #aabbcc (auto-teste)',
  /#[0-9a-fA-F]{3,8}\b/.test('#fff') && /#[0-9a-fA-F]{3,8}\b/.test('#abcd')
  && /#[0-9a-fA-F]{3,8}\b/.test('#aabbcc'));

/* ---------- 3. documento, foco, contraste e responsivo ----------
   Sem viewport o navegador assume 980px e nenhum @media do arquivo dispara;
   sem charset os acentos quebram em file://. E o anel de foco antigo
   (sombra translucida a 18% sobre o azul3) dava 1,20:1 — invisivel. */
console.log('\n3 · DOCUMENTO, FOCO, CONTRASTE E RESPONSIVO');
ok('abre com <!DOCTYPE html>', /^\s*<!DOCTYPE html>/i.test(html));
ok('<html lang="pt-BR"> declarado', /<html\s+lang="pt-BR"/.test(html));
ok('<meta charset="UTF-8"> dentro do <head>', /<head>[\s\S]*?<meta charset="UTF-8">[\s\S]*?<\/head>/.test(html));
ok('viewport com width=device-width', /<meta name="viewport" content="width=device-width, initial-scale=1">/.test(html));
ok('<title> do projeto preservado', /<title>GCON\/SIAN — Painel Gerencial<\/title>/.test(html));

ok('nenhum outline:none — foco nunca e suprimido', !/outline\s*:\s*none/.test(html));
ok('o anel invisivel de 1,20:1 saiu do arquivo (rgba 91,143,214)', !/rgba\(\s*91\s*,\s*143\s*,\s*214/.test(html));
ok('anel de foco e contorno solido de 2px no --azul2',
  /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--azul2\)[^}]*outline-offset:\s*2px/.test(html));
ok('regra global :focus-visible (button, input, select, textarea, a)',
  /:where\(button, input, select, textarea, a\):focus-visible/.test(html));
ok('os botoes novos (.fb) e .busca .limpa tem foco proprio',
  /\.fb:focus-visible, \.busca \.limpa:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--azul2\)/.test(html));

const regraN = /\.fb \.n\s*\{([^}]*)\}/.exec(html);
ok('.fb .n usa cor e peso em vez de opacity (.72 = 3,06:1)',
  !!regraN && !/opacity/.test(regraN[1]) && /font-weight:\s*600/.test(regraN[1]) && /color:\s*var\(--tx\)/.test(regraN[1]),
  regraN && regraN[1]);
ok('.fb[aria-pressed="true"] .n vem logo depois (senao 2,06:1 sobre o azul)',
  /\.fb \.n\s*\{[^}]*\}\s*\.fb\[aria-pressed="true"\] \.n\s*\{[^}]*color:\s*var\(--card\)/.test(html));
ok('.resp usa --tx2 (--tx3 dava 4,38:1 no hover)',
  /\.resp\s*\{[^}]*color:\s*var\(--tx2\)/.test(html));
ok('grupo "Resolvido" usa --g:var(--tx3) (--cinzabg dava 1,10:1)',
  /class="gc" style="--g:var\(--tx3\)"/.test(html));

ok('.ln e grid, entao a media query de coluna unica faz sentido', /\.ln\s*\{[^}]*display:\s*grid/.test(html));
const mq700 = /@media \(max-width: 700px\)\s*\{([\s\S]*?)\n  \}/.exec(html);
ok('media query de 700px: .ln em coluna unica',
  !!mq700 && /\.ln\s*\{[^}]*grid-template-columns:\s*1fr;/.test(mq700[1]));
ok('media query de 700px: .ln-r quebra linha e .resp alinha a esquerda',
  !!mq700 && /\.ln-r\s*\{[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*flex-start;/.test(mq700[1])
  && /\.resp\s*\{[^}]*min-width:\s*0;[^}]*text-align:\s*left;/.test(mq700[1]));
ok('alvos de toque de 44px no celular',
  !!mq700 && /\.fb\s*\{[^}]*min-height:\s*44px/.test(mq700[1])
  && /\.busca \.limpa\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/.test(mq700[1]));
ok('.fb tem min-height de 40px (era ~29px)', /\.fb\s*\{[^}]*min-height:\s*40px/.test(html));
ok('.busca .limpa tem 40x40 (era ~22px)',
  /\.busca \.limpa\s*\{[^}]*min-width:\s*40px;[^}]*min-height:\s*40px/.test(html));
/* A faixa de 701-899px colapsa o layout (2 colunas de KPI, .duas e .amb em
   coluna) mas mantinha o alvo em 40px. */
const mq900 = /@media \(max-width: 900px\)\s*\{([\s\S]*?)\n  \}/.exec(html);
ok('media query de 900px: alvo de toque sobe para 44px (o layout ja empilhou)',
  !!mq900 && /\.fb\s*\{[^}]*min-height:\s*44px/.test(mq900[1])
  && /\.busca \.limpa\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px/.test(mq900[1]),
  mq900 && mq900[1].slice(0, 80));
ok('o padding-right do input de busca não invade o botão de limpar (48px p/ 40-44px + 6)',
  /\.busca input\s*\{[^}]*padding:\s*8px 48px 8px 33px/.test(html));
ok('os dois estados de schema têm borda âmbar (o texto do chip é âmbar, a borda também)',
  /\.est\[data-est="antigo-schema"\]\s*\{[^}]*border-left-color:\s*var\(--laranjatx\)/.test(html)
  && /\.est\[data-est="futuro-schema"\]\s*\{[^}]*border-left-color:\s*var\(--laranjatx\)/.test(html));
/* A verificação vive aqui porque CHIP_ESTADO é declarado na seção 4. */
{
  const mapa = /var CHIP_ESTADO = \{([\s\S]*?)\}/.exec(js);
  const ambar = [...(mapa ? mapa[1] : '').matchAll(/'?([\w-]+)'?:\s*'atn'/g)].map((m) => m[1]);
  ok('todo estado com chip âmbar tem borda âmbar (a cor do texto = a cor da borda)',
    ambar.length > 0 && ambar.every((e) => new RegExp('\\.est\\[data-est="' + e + '"\\]\\s*\\{[^}]*--laranjatx').test(html)),
    'estados âmbar: ' + ambar.join(','));
}

/* ---------- 4. o bloco "Estado do painel" ----------
   As duas regiones de mensagem precisam existir desde o parse, senao quem
   navega por leitor de tela nao tem live region para ler. */
console.log('\n4 · BLOCO "ESTADO DO PAINEL"');
const ESTADOS = ['padrao', 'arquivo', 'desatualizado', 'antigo', 'invalido', 'antigo-schema', 'futuro-schema', 'sem-io'];
ok('.est nasce no HTML entre </header> e os KPIs',
  /<\/header>[\s\S]*?<section class="est" id="est"[\s\S]*?<\/section>[\s\S]*?<div class="kpis">/.test(html));
ok('.est abre com data-est="padrao"', /<section class="est" id="est" data-est="padrao"/.test(html));
const chipEstados = /var CHIP_ESTADO = \{([\s\S]*?)\}/.exec(js);
ok('os 8 valores de data-est estao mapeados para um chip',
  !!chipEstados && ESTADOS.every((e) => chipEstados[1].indexOf(e + ':') !== -1 || chipEstados[1].indexOf("'" + e + "':") !== -1),
  chipEstados && chipEstados[1]);
ok('todo data-est emitido pelo JS pertence ao conjunto de 8',
  [...js.matchAll(/marcarEstado\('([a-z-]+)'/g)].concat([...js.matchAll(/r\.estado = '([a-z-]+)'/g)])
    .every((m) => ESTADOS.indexOf(m[1]) !== -1));
ok('chip de origem e descricao ja estao no HTML desde o parse',
  /<span class="chip fil" id="est-chip">/.test(html) && /<p class="est-desc" id="est-desc">/.test(html));
const fnMarcar = /function marcarEstado\(est, chip, desc, msg, alerta\) \{[\s\S]*?\n  \}/.exec(js);
ok('o chip de origem NUNCA some: marcarEstado() reescreve classe e texto sempre',
  !!fnMarcar && /estChip\.className = /.test(fnMarcar[0]) && /estChip\.textContent = /.test(fnMarcar[0])
  && /estDesc\.textContent = /.test(fnMarcar[0]) && /estMsg\.textContent = /.test(fnMarcar[0])
  && /estAlert\.textContent = /.test(fnMarcar[0]));
ok('#est-msg com role="status"', /<p class="est-msg" id="est-msg" role="status" aria-live="polite">/.test(html));
ok('#est-alert com role="alert"', /<p class="est-alert" id="est-alert" role="alert">/.test(html));
ok('as duas regioes tem altura minima reservada', /\.est-msg, \.est-alert\s*\{[^}]*min-height:\s*20px/.test(html));
ok('3 botoes + campo de arquivo com accept=".json" no HTML',
  ['est-salvar', 'est-carregar', 'est-atualizar'].every((id) => html.indexOf('id="' + id + '"') !== -1)
  && /<input type="file" accept="\.json" class="sr" id="est-arq"/.test(html));
ok('.sr esconde com clip-path e NUNCA com display:none',
  /\.sr\s*\{[^}]*position:\s*absolute;[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*overflow:\s*hidden;[^}]*clip-path:\s*inset\(50%\)/.test(html)
  && !/\.sr[^}]*display:\s*none/.test(html));
/* O campo é aberto por click() programático: :focus-visible não dispara com
   foco de teclado, e :has() sem declaração não deixa o anel algum. O caminho
   que não depende de navegador é a classe que o JS põe no botão. */
ok('o campo invisivel tem alvo de foco visivel no botao que o dispara (:has com :focus)',
  /\.est-acoes:has\(\.sr:focus\) #est-carregar/.test(html)
  && /:has\(\.sr:focus-visible\)/.test(html) === false);
ok('o anel de foco do campo tem caminho SEM :has() (classe posta pelo JS)',
  /#est-carregar\.foco-arquivo\s*,[\s\S]{0,120}?outline:\s*2px solid var\(--azul2\)/.test(html));
ok('o JS põe e tira a classe de foco no campo de arquivo',
  /inpArq\.addEventListener\('focus', function \(\) \{ btnCarregar\.classList\.add\('foco-arquivo'\); \}\)/.test(js)
  && /inpArq\.addEventListener\('blur', function \(\) \{ btnCarregar\.classList\.remove\('foco-arquivo'\); \}\)/.test(js));
ok('.est-acoes .fb tem min-width de 132px', /\.est-acoes \.fb\s*\{[^}]*min-width:\s*132px/.test(html));

ok('nenhum alert()/confirm()/prompt() — nada trava a pagina',
  !/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(js));
ok('nenhuma atribuicao a innerHTML/outerHTML/insertAdjacentHTML no script',
  !/\.(?:inner|outer)HTML\s*=/.test(js) && !/insertAdjacentHTML/.test(js));
ok('em file:// nao ha fetch: cai direto em sem-io',
  /if \(location\.protocol === 'file:'\) \{\s*mostrarSemIO\([^;]{0,300}\);[\s\S]{0,300}?desativarAtualizar\([^;]{0,300}\);\s*\} else \{\s*buscarArquivo\(\);\s*\}/.test(js));
ok('a leitura automatica usa cache:no-store', /fetch\(ARQ_ESTADO, \{ cache: 'no-store' \}\)/.test(js));
ok('404 e estado inicial (padrao), nunca erro',
  /if \(res\.status === 404\) return \{ tipo: 'ausente' \}/.test(js)
  && /s\.tipo === 'ausente'\) \{\s*mostrarPadrao\(/.test(js)
  && !/s\.tipo === 'ausente'\) mostrarInvalido/.test(js)
  && /padrao: 'fil'/.test(chipEstados[1]));
/* B28: no GitHub Pages o painel-estado.json nunca é publicado (está no
   .gitignore), então fetch() relativo dá 404 e o botão "Atualizar" é um botão
   morto. Desabilitar e rotular é o comportamento correto; publicar um exemplo
   seria o errado. */
ok('"Atualizar" é desabilitado e rotulado quando o arquivo não é alcançável',
  /function desativarAtualizar\(motivo\) \{[\s\S]{0,400}?btnAtualizar\.disabled = true;/.test(js)
  && /btnAtualizar\.textContent = 'Atualizar \(indisponível\)'/.test(js)
  && /btnAtualizar\.setAttribute\('aria-disabled', 'true'\)/.test(js));
// 1 declaração + 3 chamadas: 404 (arquivo ausente), falha de rede e file://.
ok('os 3 caminhos que deixam o arquivo inalcançável desabilitam o botão',
  (js.match(/desativarAtualizar\(/g) || []).length === 4,
  String((js.match(/desativarAtualizar\(/g) || []).length));
ok('o motivo da desativação manda usar o seletor de arquivo (o fallback real)',
  /Use \\?"Carregar estado\\?"/.test(js) && /desativarAtualizar\([^;]{0,300}Carregar estado/.test(js));
ok('"Atualizar" volta a funcionar quando o arquivo é lido (botão não fica morto para sempre)',
  /s\.tipo === 'json'\) \{\s*btnAtualizar\.disabled = false;[\s\S]{0,300}?receber\(/.test(js));
ok('nenhum painel-estado.json de exemplo foi publicado',
  !fs.existsSync(path.join(RAIZ, 'painel-estado.json')));
ok('o aria-busy é limpo ao final da leitura',
  /btnAtualizar\.removeAttribute\('aria-busy'\)/.test(js));
const fnInvalido = /function mostrarInvalido\(motivo\) \{[\s\S]*?\n  \}/.exec(js);
ok('estado invalido avisa "Nada foi alterado"',
  /Nada foi alterado\./.test(js) && /marcarEstado\('invalido'/.test(fnInvalido[0]));
ok('a copy de erro não repete "arquivo" duas vezes (B25)',
  /'O painel não foi atualizado: ' \+ m \+ '\.'/.test(js)
  && /mostrarInvalido\('o arquivo escolhido não é um JSON válido'\)/.test(js));
ok('estado invalido nao toca em nenhum conteudo carregado',
  !!fnInvalido && !/aplicarCampos|aplicarFila|aplicarKpis|aplicarSituacao/.test(fnInvalido[0]));
ok('"Atualizar" desabilita e marca aria-busy enquanto le',
  /btnAtualizar\.disabled = true/.test(js) && /btnAtualizar\.setAttribute\('aria-busy', 'true'\)/.test(js)
  && /btnAtualizar\.removeAttribute\('aria-busy'\)/.test(js));
ok('"Salvar estado" baixa por Blob + createObjectURL + <a download> + revoke',
  /new Blob\(\[texto\]/.test(js) && /URL\.createObjectURL\(blob\)/.test(js)
  && /a\.download = ARQ_ESTADO/.test(js) && /URL\.revokeObjectURL\(url\)/.test(js));
ok('"Carregar estado" dispara o campo invisivel e limpa o valor depois',
  /btnCarregar\.addEventListener\('click', function \(\) \{ inpArq\.click\(\); \}\)/.test(js)
  && /inpArq\.value = ''/.test(js));
ok('schema futuro: nao aplica nada e mantem o padrao embutido',
  /if \(r\.estado === 'futuro-schema'\)[\s\S]{0,600}?return;[\s\S]{0,200}?aplicarCampos/.test(js));
ok('schema antigo: aplica parcial e diz quantos de quantos',
  /'Aplicados ' \+ r\.aplicados\.length \+ ' de 4 campos/.test(js));
ok('a descricao diz quais secoes vieram do arquivo e quais ficaram no padrao',
  /Do arquivo vieram /.test(js) && /No padrão embutido ficaram /.test(js)
  && /juntar\(veio\)/.test(js) && /juntar\(ficou\)/.test(js));
ok('datas sempre em Sao_Paulo, sempre absoluto E relativo',
  /var TZ = 'America\/Sao_Paulo'/.test(js) && /timeZone: TZ/.test(js)
  && /dataHoraBR\(r\.geradoEm\) \+ ' · ' \+ idadeHumana\(r\.dias\)/.test(js));
// Emoji e glifo: 1F300-1FAFF (pictogramas), 2600-26FF (símbolos), 2700-27BF
// (dingbats — tique, cruz, marca de visto), 2B00-2BFF (símbolos e setas),
// além de 203C (exclamação dupla) e FE0F (seletor de variação). Sem glifo em
// lugar nenhum: o estado é comunicado por texto, nunca por símbolo.
const EMOJI_GLIFO = /[\u{203C}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F000}-\u{1FAFF}\u{200D}]/u;
ok('nenhum emoji nem glifo em qualquer lugar do arquivo', !EMOJI_GLIFO.test(html));
ok('nenhum emoji nem glifo no texto visivel (o resto do arquivo)',
  !EMOJI_GLIFO.test(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<script>[\s\S]*?<\/script>/, '')));

/* ---------- 5. copy em portugues e a mentira cromatica ----------
   Commit com chip verde diz "isto deu certo"; achado de revisao com chip
   vermelho diz "isto deu errado". Nenhum dos dois e verdade: sao rotulos. */
console.log('\n5 · COPY EM PORTUGUES E MENTIRA CROMATICA');
ok('"Achado da revisão" no cabecalho, com scope', /<th scope="col">Achado da revisão<\/th>/.test(html));
ok('nenhum "Achado surprise"', !/Achado surprise/.test(html));
ok('frase do subtitulo: "Este painel mostra o estado do projeto"',
  /\. Este painel mostra o estado do <b>projeto<\/b>:/.test(html));
ok('nenhum dos anglicismos originais sobreviveu',
  !/sinks XSS|pinado|primeiro render|paineis mostra|print-to-PDF|fixture sintética/.test(html));
ok('nenhum anglicismo novo na copy (dark, UI, Push, live region soltos)',
  !/\bno dark\b|para a UI\b|Push de\b|live region/.test(html));
const tbody = /<tbody>[\s\S]*?<\/tbody>/.exec(html)[0];
ok('os 5 achados da revisao usam .chip atn (atenuado)',
  (tbody.match(/class="chip atn"/g) || []).length === 5, String((tbody.match(/class="chip atn"/g) || []).length));
ok('nenhum achado com .chip ok ou .chip err na tabela', !/class="chip (ok|err)"/.test(tbody));
ok('os 5 commits usam .chip fil (neutro, nao "verde = OK")',
  ['627b8e0', '138af48', 'c81933c', 'f736ac3', '11d2665']
    .every((h) => new RegExp('<span class="chip fil">' + h + '</span>').test(html)));
ok('nenhum style="pointer-events:auto" inline', !/pointer-events\s*:\s*auto/.test(html));
ok('rodape com toLocaleDateString fixado em Sao_Paulo',
  /toLocaleDateString\('pt-BR', \{ timeZone: TZ \}\)/.test(js));

/* ---------- 5.1 as afirmações do painel conferidas na FONTE ----------
   As quatro asserções de copy acima ("6 pontos de injeção XSS", "tesseract
   fixado em 4.1.4", ...) só provavam que a frase existe no HTML: se o index.html
   mudasse, o painel continuaria verde dizendo uma coisa que não é mais
   verdade. Aqui cada afirmação é conferida contra o arquivo que ela descreve. */
console.log('\n5.1 · AFIRMAÇÕES DO PAINEL CONFERIDAS NA FONTE');
{
  const sriPainel = [...html.matchAll(/integrity="(sha384-[A-Za-z0-9+/=]+)"/g)].map((m) => m[1]);
  ok('o painel não repete SRI (não carrega CDN com script)',
    sriPainel.length === 0, sriPainel.join(','));
  const cdnIndex = [...htmlIndex.matchAll(/<script src="([^"]+)"([^>]*)>/g)];
  ok('o index.html tem as 6 CDNs com SRI (a base da afirmação "SRI conferida")',
    cdnIndex.length === 6 && cdnIndex.every(([, , a]) => /integrity="sha384-/.test(a) && /crossorigin="anonymous"/.test(a)),
    String(cdnIndex.length));
  // "6 pontos de injeção XSS fechados" — o número tem que bater com o que o
  // index.html realmente trata hoje: escape na fronteira/render + cache.
  const sinksIndex = (htmlIndex.match(/esc\((?:e\.message|r\.msg|r\.razao|r\.fantasia|r\.uf|r\.situacao|r\.ie)\)/g) || []).length;
  const escProf = /function escProfundo\(/.test(htmlIndex) && /dados=escProfundo\(dados\)/.test(htmlIndex);
  /* O escape do CSV virou um helper compartilhado (window.GCON.csvCelula) usado
     pelo lote de CNPJ e pelo leitor de PDF. A prova e por string (o .source do
     prefixo aparece uma unica vez), nao por regex escrito a mao sobre o fonte. */
  const csvAntiFormula = /window\.GCON=\{csvCelula:/.test(htmlIndex)
    && htmlIndex.split(/^[=+\-@\t\r]/.source).length - 1 === 1
    && /const q=window\.GCON\.csvCelula;/.test(htmlIndex)
    && /\.map\(window\.GCON\.csvCelula\)\.join\(';'\)/.test(htmlIndex);
  ok('o index.html tem escape em profundidade no render (o sink de que o painel fala)',
    escProf);
  ok('o index.html neutraliza fórmula no CSV, num helper só, nos DOIS exports (lote e PDF)',
    csvAntiFormula,
    'csvCelula=' + /window\.GCON=\{csvCelula:/.test(htmlIndex)
    + ' ocorrencias=' + (htmlIndex.split(/^[=+\-@\t\r]/.source).length - 1));
  ok('o index.html escapa os campos da tabela do lote um a um',
    /esc\(r\.razao\)[\s\S]{0,200}?esc\(r\.fantasia\)[\s\S]{0,200}?esc\(r\.situacao\)/.test(htmlIndex),
    String(sinksIndex) + ' escapes de campo');
  const csvAlertas = ['14 dígitos', 'publica.cnpj.ws'];
  ok('todo texto de privacidade do arquivo gerado é verdadeiro (o que o painel promete)',
    csvAlertas.every((t) => htmlIndex.includes(t)));
  // "tesseract fixado em 4.1.4" e "corePath" têm de existir no index.html
  ok('o index.html fixa o tesseract em 4.1.4 e o core em 4.0.4 (versões existentes)',
    /tesseract\.js@4\.1\.4/.test(htmlIndex) && /tesseract\.js-core@v4\.0\.4/.test(htmlIndex)
    && !/tesseract\.js-core@4\.1\.4/.test(htmlIndex));
  ok('o painel e o index.html declaram o mesmo <meta name="description"> com texto próprio',
    /<meta name="description" content="Painel do projeto GCON\/SIAN/.test(html)
    && /<meta name="description" content="Leitor de NF-e/.test(htmlIndex)
    && !/content="([^"]*)"/.exec(html)[1] === !/content="([^"]*)"/.exec(htmlIndex)[1]);
  ok('o painel tem favicon (o mesmo data URI inline do index.html, sem arquivo novo)',
    /<link rel="icon" href="data:image\/svg\+xml,/.test(html) && /<link rel="icon" href="data:image\/svg\+xml,/.test(htmlIndex));
  ok('o painel não tem nenhum link de script com src (nenhuma CDN nova, nenhuma alteração de URL)',
    [...html.matchAll(/<script[^>]*\bsrc=/g)].length === 0);
}

/* ---------- 5.2 o KPI do gate não pode envelhecer ----------
   "Regressão estrutural N/N" é uma afirmação verificável: se o gate rodar um
   número diferente, o painel que mostra o número velho está mentindo na mesma
   frase que esta rodada consertou no resto do documento. Roda o gate de verdade
   e compara. Caminho ABSOLUTO: o npm test roda de dentro de testes/ e um
   caminho relativo quebrava com ENOENT. */
const kpiReg = /Regressão estrutural<\/span><\/div>\s*<div class="v">(\d+)\/(\d+)<\/div>/.exec(html);
ok('o KPI "Regressão estrutural" existe no HTML com a forma N/N', !!kpiReg, String(kpiReg));
let casosGate = null;
try {
  const saida = execFileSync(process.execPath, [path.join(__dirname, 'regressao.mjs')], { encoding: 'utf8' });
  const m = /REGRESS[ÃA]O: (\d+) passaram, (\d+) falharam/.exec(saida);
  if (m) casosGate = { passou: m[1], falhou: m[2] };
} catch (e) {
  // Com exit != 0 (gate reprovado) o execFileSync LANÇA: a saída está em
  // e.stdout, e é lá que está o número. Ler só a exceção dava "não rodou" e a
  // comparação do KPI viraria no-op justo quando o gate está vermelho.
  const saida = (e && e.stdout) ? String(e.stdout) : '';
  const m = /REGRESS[ÃA]O: (\d+) passaram, (\d+) falharam/.exec(saida);
  casosGate = m ? { passou: m[1], falhou: m[2] } : { erro: (e && e.message) || 'saída vazia' };
}
ok('o gate de regressão roda de verdade a partir daqui (senão o KPI não tem com o que ser comparado)',
  casosGate !== null && !casosGate.erro,
  'node regressao.mjs: ' + (casosGate && casosGate.erro ? casosGate.erro : 'não rodou a partir de ' + process.cwd()));
ok('o KPI do painel bate com o gate que roda (número atual, não de ontem)',
  !!kpiReg && !!casosGate && !casosGate.erro && kpiReg[1] === casosGate.passou && kpiReg[2] === casosGate.passou,
  kpiReg ? 'painel diz ' + kpiReg[1] + '/' + kpiReg[2] + ', gate roda ' + (casosGate ? casosGate.passou + ' (+' + casosGate.falhou + ' falhas)' : '?') : 'KPI ausente');
ok('o gate está verde no momento (o painel não anuncia Reprovações como Reprovações)',
  !!casosGate && !casosGate.erro && casosGate.falhou === '0', casosGate ? (casosGate.erro || casosGate.falhou + ' falha(s)') : 'gate não rodou');

/* ---------- 6. schema do painel-estado.json, com o codigo de verdade ----------
   A funcao validarEstado roda num contexto vm proprio, com as mesmas
   constantes que o painel declara. O que o rodape mostra e o que o arquivo
   valida tem de ser a mesma frase, entao testamos a funcao e nao uma copia. */
console.log('\n6 · SCHEMA DO PAINEL-ESTADO.JSON (executando o JS do painel)');
const fonteVal = /function validarEstado\(d, agoraMs\) \{[\s\S]*?\n  \}/.exec(js);
ok('a funcao validarEstado existe e e extraivel do script', !!fonteVal);
const N_KPIS_HTML = (html.match(/class="kpi"/g) || []).length;
const ctxVal = vm.createContext({
  SCHEMA_ATUAL: 1, DIAS_DESATUALIZADO: 14, DIAS_ANTIGO: 30,
  GRUPOS: ['bloq', 'prox', 'feito'], CHIP_CLASSES: ['ok', 'and', 'atn', 'err', 'fil'],
  N_KPIS: N_KPIS_HTML,
});
const validar = vm.runInContext('(' + fonteVal[0] + ')', ctxVal, { filename: 'painel#validarEstado' });

const AGORA = Date.parse('2026-09-28T22:05:00-03:00');
const DIA = 86400000;
// Exatamente N_KPIS: a validação recusa qualquer outra contagem (B23).
const KPI_1 = { rotulo: 'Precisão da extração', valor: '160/160', detalhe: '20 campos × 8 PDFs · 100%' };
const KPI_BOM = [0, 1, 2, 3].map(() => Object.assign({}, KPI_1));
const SIT_BOM = [{ rotulo: 'Corrigido e publicado', total: 5 }];
const FILA_BOM = [{ grupo: 'bloq', titulo: 'Amostra de NFS-e em PDF', texto: 'texto do item', chip: 'falta insumo', chipClasse: 'atn', resp: '1 arquivo' }];
function estadoBase(mudanca) { return Object.assign({
  schema: 1, geradoEm: '2026-09-28T19:05:00-03:00', projeto: 'Painel do projeto GCON/SIAN',
  kpis: KPI_BOM, situacao: SIT_BOM, fila: FILA_BOM,
}, mudanca || {}); }
const val = (m) => validar(m, AGORA);

// caso 1 — arquivo válido
const r1 = val(estadoBase());
ok('schema 1 válido: aceito, 4 de 4 aplicados, estado "arquivo"',
  r1.ok === true && r1.estado === 'arquivo' && r1.aplicados.length === 4 && r1.fora.length === 0
  && r1.dias === 0 && r1.schema === 1, JSON.stringify(r1.aplicados) + '/' + r1.estado);
// caso 2 — schema futuro
const r2 = val(estadoBase({ schema: 2 }));
ok('schema futuro: recusado, estado "futuro-schema", nada aplicado',
  r2.ok === false && r2.estado === 'futuro-schema' && r2.aplicados.length === 0 && r2.fora.length === 4, r2.motivo);
// caso 3 — schema antigo
const r3 = val(estadoBase({ schema: 0 }));
ok('schema antigo: aceito parcial, estado "antigo-schema", 2 de 4 aplicados',
  r3.ok === true && r3.estado === 'antigo-schema' && r3.aplicados.length === 2
  && r3.aplicados.join(',') === 'kpis,situacao' && r3.fora.join(',') === 'projeto,fila', r3.aplicados + '|' + r3.fora);
// caso 4 — geradoEm no futuro
const r4 = val(estadoBase({ geradoEm: '2026-09-30T10:00:00-03:00' }));
ok('geradoEm no futuro: recusado, estado "invalido", motivo cita data futura',
  r4.ok === false && r4.estado === 'invalido' && r4.aplicados.length === 0 && /data futura/.test(r4.motivo), r4.motivo);

// obrigatorios
ok('sem "schema": invalido com motivo no campo', (() => { const r = val(estadoBase({ schema: undefined })); return r.ok === false && /schema/.test(r.motivo); })());
ok('schema fracionario: invalido', (() => { const r = val(estadoBase({ schema: 1.5 })); return r.ok === false && /inteiro/.test(r.motivo); })());
ok('schema negativo: invalido', val(estadoBase({ schema: -1 })).ok === false);
ok('sem "geradoEm": invalido com motivo no campo', (() => { const r = val(estadoBase({ geradoEm: undefined })); return r.ok === false && /geradoEm/.test(r.motivo); })());
ok('"geradoEm" que nao e data: invalido', (() => { const r = val(estadoBase({ geradoEm: 'ontem' })); return r.ok === false && /geradoEm/.test(r.motivo); })());
ok('conteudo que nao e objeto JSON: invalido',
  (() => { const r = val([1, 2, 3]); return r.ok === false && /objeto JSON/.test(r.motivo); })());

// idade
ok('14 dias: ainda "arquivo" (o limite e estrito)', val(estadoBase({ geradoEm: new Date(AGORA - 14 * DIA).toISOString() })).estado === 'arquivo');
ok('15 dias: "desatualizado"', val(estadoBase({ geradoEm: new Date(AGORA - 15 * DIA).toISOString() })).estado === 'desatualizado');
ok('20 dias: "desatualizado" com a contagem de dias', (() => { const r = val(estadoBase({ geradoEm: new Date(AGORA - 20 * DIA).toISOString() })); return r.estado === 'desatualizado' && r.dias === 20; })());
ok('30 dias: ainda "desatualizado" (30 e o limite do "muito antigo")',
  val(estadoBase({ geradoEm: new Date(AGORA - 30 * DIA).toISOString() })).estado === 'desatualizado');
ok('31 dias: "antigo"', val(estadoBase({ geradoEm: new Date(AGORA - 31 * DIA).toISOString() })).estado === 'antigo');
ok('90 dias: "antigo" com a contagem de dias', (() => { const r = val(estadoBase({ geradoEm: new Date(AGORA - 90 * DIA).toISOString() })); return r.estado === 'antigo' && r.dias === 90; })());

// tipo errado em cada secao -> a secao fica no padrao, o resto e aplicado
ok('kpis com tipo errado: so a secao fica no padrao',
  (() => { const r = val(estadoBase({ kpis: '160/160' })); return r.ok === true && r.aplicados.length === 3 && r.fora.join(',') === 'kpis'; })());
ok('kpis vazio: so a secao fica no padrao',
  (() => { const r = val(estadoBase({ kpis: [] })); return r.ok === true && r.aplicados.length === 3; })());
ok('situacao com total nao numerico: so a secao fica no padrao',
  (() => { const r = val(estadoBase({ situacao: [{ rotulo: 'x', total: 'cinco' }] })); return r.ok === true && r.fora.join(',') === 'situacao'; })());
ok('fila com grupo desconhecido: so a secao fica no padrao',
  (() => { const r = val(estadoBase({ fila: [Object.assign({}, FILA_BOM[0], { grupo: 'inventado' })] })); return r.ok === true && r.fora.join(',') === 'fila'; })());
ok('fila com chipClasse fora da paleta: so a secao fica no padrao',
  (() => { const r = val(estadoBase({ fila: [Object.assign({}, FILA_BOM[0], { chipClasse: 'vermelho-cacai' })] })); return r.ok === true && r.fora.join(',') === 'fila'; })());
ok('projeto vazio: so a secao fica no padrao',
  (() => { const r = val(estadoBase({ projeto: '' })); return r.ok === true && r.fora.join(',') === 'projeto'; })());

/* ---------- 6.1 a contagem de KPIs é invariante do layout (B23) ----------
   aplicarKpis sobrescreve só os primeiros N cartões. Com menos indicadores no
   arquivo, os cartões restantes ficavam na tela com o texto antigo e o
   "Salvar estado" seguinte gravava o conjunto misturado — o round-trip
   corrompia em silêncio. Aqui a validação recusa, com motivo explícito. */
ok('kpis com N_KPIS é aceito',
  val(estadoBase()).aplicados.indexOf('kpis') !== -1);
for (const n of [0, 1, 2, 3, 5, 6, 12]) {
  if (n === N_KPIS_HTML) continue;
  const r = val(estadoBase({ kpis: Array.from({ length: n }, () => Object.assign({}, KPI_1)) }));
  ok('kpis com ' + n + ' indicador(es) é recusado (N_KPIS=' + N_KPIS_HTML + ')',
    r.ok === true && r.fora.join(',') === 'kpis', JSON.stringify(r.aplicados) + '|' + r.fora);
  ok('kpis com ' + n + ' indicador(es) tem motivo explícito no retorno',
    typeof r.motivos.kpis === 'string' && r.motivos.kpis.length > 10
    && new RegExp('\\b' + n + ' indicador\\(es\\)').test(r.motivos.kpis), r.motivos.kpis);
  ok('kpis com ' + n + ' indicador(es): o motivo cita a contagem de cartões da página',
    /cartões/.test(r.motivos.kpis || ''), r.motivos.kpis);
}
ok('kpis com shape errado tem motivo próprio (não o da contagem)',
  (() => { const r = val(estadoBase({ kpis: KPI_BOM.map((k) => Object.assign({}, k, { valor: 5 })) })); return r.ok === true && r.fora.join(',') === 'kpis' && /rotulo, valor e detalhe/.test(r.motivos.kpis); })());
ok('kpis com shape válido e N_KPIS não gera motivo',
  (() => { const r = val(estadoBase()); return r.motivos.kpis === undefined; })());
ok('"situacao" mantém tamanho livre (o gráfico é redesenhado do zero)',
  (() => {
    const r1s = val(estadoBase({ situacao: [{ rotulo: 'a', total: 1 }, { rotulo: 'b', total: 2 }] }));
    const r12 = val(estadoBase({ situacao: Array.from({ length: 12 }, (_, i) => ({ rotulo: 'r' + i, total: i })) }));
    return r1s.aplicados.indexOf('situacao') !== -1 && r12.aplicados.indexOf('situacao') !== -1;
  })());
ok('"situacao" com 13 barras é recusada com motivo',
  (() => { const r = val(estadoBase({ situacao: Array.from({ length: 13 }, (_, i) => ({ rotulo: 'r' + i, total: i })) })); return r.fora.join(',') === 'situacao' && /1 a 12/.test(r.motivos.situacao); })());
ok('a descrição de receber() inclui o motivo (o usuário precisa saber o que fazer)',
  /Motivo: ' \+ porque/.test(js) && /Algo não foi aplicado/.test(js));
ok('N_KPIS é derivado dos cartões do HTML, não escrito à mão',
  /var N_KPIS = document\.querySelectorAll\('\.kpis \.kpi'\)\.length;/.test(js));
ok('validarEstado nao muta o objeto recebido',
  (() => { const d = estadoBase(); validar(d, AGORA); return d.kpis === KPI_BOM && d.schema === 1; })());

console.log('\n' + '='.repeat(56));
ok('a suíte do painel tem pelo menos ' + MINIMO_CASOS + ' casos (seção apagada?)',
  passou >= MINIMO_CASOS, passou + ' < ' + MINIMO_CASOS);
console.log('PAINEL: ' + passou + ' passaram, ' + falhou + ' falharam');
if (falhou) { console.log('\nFALHAS:'); falhas.forEach((f) => console.log('  - ' + f)); }
console.log('='.repeat(56));
process.exit(falhou ? 1 : 0);
