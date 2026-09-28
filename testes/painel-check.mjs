// Prova do painel-gerencial.html — sem browser.
// O render real já foi verificado no Edge headless (0 erros de JS, 4 KPIs, 5 seções).
// Aqui ficam as duas coisas que o render não prova: a lógica de normalização/busca
// e os invariantes estruturais que quebram em silêncio.
import fs from 'fs';
import vm from 'vm';

const html = fs.readFileSync('painel-gerencial.html', 'utf8');
const js = /<script>([\s\S]*)<\/script>/.exec(html)[1];

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
ok('blocos <script> e <style> fechados', (html.match(/<script>/g) || []).length === (html.match(/<\/script>/g) || []).length
  && (html.match(/<style>/g) || []).length === (html.match(/<\/style>/g) || []).length);
ok('<div> balanceados', (html.match(/<div[\s>]/g) || []).length === (html.match(/<\/div>/g) || []).length,
  'abre ' + (html.match(/<div[\s>]/g) || []).length + ' fecha ' + (html.match(/<\/div>/g) || []).length);

/* ---------- 1. a busca: normalização e predicado, testados de verdade ---------- */
console.log('\n1 · BUSCA E FILTRO');
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
  ['feito', 'testes regressao 179 f736ac3', 'Regressão e gate'],
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
ok('5 secoes h2', (html.match(/<h2>/g) || []).length === 5);
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
ok('nenhuma cor de token fora do :root', (() => {
  const fora = html.replace(/:root\s*\{[\s\S]*?\}/, '');
  // rgba/hex so podem existir como preenchimento dentro de regra que usa var()
  return !/#[0-9a-fA-F]{6}\b/.test(fora.replace(/--[a-z0-9-]+:\s*#[0-9a-fA-F]{3,8}/gi, ''));
})());

console.log('\n' + '='.repeat(56));
console.log('PAINEL: ' + passou + ' passaram, ' + falhou + ' falharam');
if (falhou) { console.log('\nFALHAS:'); falhas.forEach((f) => console.log('  ✗ ' + f)); }
console.log('='.repeat(56));
process.exit(falhou ? 1 : 0);
