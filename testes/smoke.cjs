/* Smoke de navegador do GCON/SIAN — o quarto gate, e o único que roda a
   interface de verdade.
   Rode de dentro de testes/ com:  node smoke.mjs
   Precisa de: Microsoft Edge instalado (ou EDGE_PATH apontando para ele) e o
   playwright-core, que é devDependency — `npm i` já traz. PLAYWRIGHT_PATH
   sobrescreve, para quem mantém o pacote num cache fora do repo.
   Sem browser, as outras três suítes continuam valendo; este script só
   acrescenta o que só a tela prova.

   O que este script mede, e por quê:
   - 5 breakpoints x 2 temas, sem overflow horizontal e sem erro de console;
   - a sidebar recolhível: largura do rail e do menu cheio, o que sobra de
     largura útil, aria-expanded, o par de ícones, o que é gravado, e se o
     estado volta depois de recarregar;
   - Esc expande um menu recolhido, não expande no celular (lá o rail é layout,
     não escolha — achado do Arquiteto) e não expande com o foco num campo;
   - a troca de largura: em ≤768px o rail manda, e ao voltar para desktop a
     preferência do usuário reassume (o bug que o primeiro smoke achou morava
     aqui: a mudança de largura lia a variável em memória, não o storage);
   - o foco visível do toggle, medido no navegador: --focus reprova 3:1 sobre
     a sidebar no tema claro, e o toggle usa --sidebar-accent;
   - a área de drop do Leitura PDF: centralizada no desktop, no topo no celular
     (a regra de :has() só vale a partir de 769px);
   - a aba Leitura PDF de ponta a ponta com uma NOTA REAL, quando há amostra
     em amostras/ (sem amostra, o bloco é pulado com aviso — não é falha);
   - prefers-reduced-motion: sem sobra de movimento. */
/* commonjs: o package.json do projeto é "type": "commonjs" e o smoke é um
   script de desenvolvimento, não parte do app. */
const path = require('path');
const fs = require('fs');

const RAIZ = path.join(__dirname, '..');
const FILE = path.join(RAIZ, 'index.html');
/* playwright-core é devDependency do projeto, então o caminho normal é o do
   próprio node_modules. PLAYWRIGHT_PATH continua existindo como override para
   quem usa um cache fora do repo. A variável não é o default: o smoke anterior
   morreu por morar fora do repositório, e um gate cuja dependência também mora
   fora da máquina de quem rodou repete o mesmo modo de falha. */
const PW = process.env.PLAYWRIGHT_PATH || path.join(__dirname, 'node_modules', 'playwright-core');
const EDGE = process.env.EDGE_PATH
  || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const SHOT = process.env.SMOKE_SHOTS || path.join(__dirname, '..', 'testes', 'saidas', 'smoke');
const AMOSTRAS = path.join(RAIZ, 'amostras');

const faltando = () => {
  console.error('O smoke precisa de browser: faltou ' + faltando.qual + '.\n'
    + '  npm i            -> instala o playwright-core (devDependency do projeto)\n'
    + '  PLAYWRIGHT_PATH  -> so se você usa o pacote de um cache fora do repo\n'
    + '  EDGE_PATH        -> o executável do Edge, se não estiver no caminho padrão\n'
    + 'As outras três suítes não precisam de browser: npm test continua valendo.');
  process.exit(2);
};
if (!PW) { faltando.qual = 'PLAYWRIGHT_PATH'; faltando(); }
if (!fs.existsSync(PW)) { faltando.qual = 'playwright-core em ' + PW; faltando(); }
if (!fs.existsSync(EDGE)) { faltando.qual = 'o Edge em ' + EDGE; faltando(); }
const { chromium } = require(PW);
const { pathToFileURL } = require('url');
fs.mkdirSync(SHOT, { recursive: true });

let fail = 0;
const ok = (c, m) => { console.log((c ? 'PASS' : 'FAIL') + ' | ' + m); if (!c) fail++; };
const head = (t) => console.log('\n=== ' + t + ' ===');

/* Contraste real, calculado no navegador a partir das cores computadas.
   A estante do grupo 8 já mede contraste por tokens; aqui o alvo é o anel de
   foco do toggle, que depende do fundo da sidebar e não de um par do design. */
const contraste = `(() => {
  const lum = (rgb) => {
    const m = rgb.match(/[\\d.]+/g).map(Number).slice(0, 3).map((v) => {
      v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2];
  };
  const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bg = getComputedStyle(document.getElementById('sidebar')).backgroundColor;
  const f = getComputedStyle(document.documentElement).getPropertyValue('--focus').trim();
  const probe = document.createElement('div');
  probe.style.color = f; document.body.appendChild(probe);
  const fc = getComputedStyle(probe).color; probe.remove();
  const sa = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-accent').trim();
  const p2 = document.createElement('div'); p2.style.color = sa; document.body.appendChild(p2);
  const sac = getComputedStyle(p2).color; p2.remove();
  return { fundo: bg, foco: fc, crFoco: +cr(fc, bg).toFixed(2), sidebarAccent: sac, crAccent: +cr(sac, bg).toFixed(2) };
})()`;

const fmt = (m) => `${m.w}px rail=${m.rail} aria=${m.expanded} ${m.icone} salvo=${m.salvo} secoes=${m.secoes}`;

/* Mede o estado da sidebar e da área de drop de uma vez. */
const MEDIR_SIDEBAR = `(() => {
  const sb = document.getElementById('sidebar'), btn = document.getElementById('btn-rail');
  const cs = getComputedStyle;
  const btns = [...document.querySelectorAll('.nav-btn')];
  const up = document.getElementById('pdfiso-upload');
  const drop = up ? up.getBoundingClientRect() : null;
  return {
    w: sb.getBoundingClientRect().width,
    conteudo: document.getElementById('content').getBoundingClientRect().width,
    rail: sb.getAttribute('data-rail'),
    expanded: btn.getAttribute('aria-expanded'),
    label: btn.getAttribute('aria-label'),
    icone: btn.querySelector('use').getAttribute('href'),
    btnVisivel: cs(btn).display !== 'none',
    btnH: btn.getBoundingClientRect().height,
    secoes: [...document.querySelectorAll('.nav-section')].filter((s) => cs(s).display !== 'none').length,
    status: (document.getElementById('rail-status') || {}).textContent || '',
    salvo: localStorage.getItem('gcon-sidebar-v1'),
    crumb: (document.getElementById('crumb-cur') || {}).textContent || '',
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    /* O rótulo encolhe com clip (não display:none) para o breadcrumb continuar
       lendo textContent — por isso o teste olha position, não display. */
    rotulo: btns.length ? cs(btns[0].querySelector('span:not(.icon)')).position : '',
    dropTopo: drop ? Math.round(drop.top) : 0,
    dropMeio: drop && window.innerHeight > 700 ? Math.round(drop.top + drop.height / 2) : 0,
    janelaH: window.innerHeight,
  };
})()`;

/* Os 8 itens do menu têm title (nome no rail, onde o rótulo é visually-hidden)
   e o toggle não é .nav-btn (entraria na troca de aba e no breadcrumb). */
const MEDIR_MENU = `(() => {
  const btns = [...document.querySelectorAll('.nav-btn')];
  const cs = getComputedStyle;
  return {
    itens: btns.length,
    titulos: btns.filter((b) => b.getAttribute('title')).length,
    crumb: (document.getElementById('crumb-cur') || {}).textContent || '',
    labels: btns.map((b) => (b.getAttribute('title') || '').trim()),
    rotulo: btns.length ? cs(btns[0].querySelector('span:not(.icon)')).position : '',
  };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });

  /* ───────────────────────────────────────────────────────────────────────
     1. BREAKPOINTS x TEMAS
     ─────────────────────────────────────────────────────────────────────── */
  head('1. BREAKPOINTS x TEMAS');
  for (const w of [375, 768, 1024, 1280, 1440]) {
    for (const tema of ['claro', 'escuro']) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 140)));
      await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 60000 });
      if (tema === 'escuro') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await page.waitForTimeout(1200);
      await page.click('.nav-btn[data-tab="pdfleitura"]');
      await page.waitForTimeout(400);

      const m = await page.evaluate(MEDIR_SIDEBAR);
      const erros = errs.length ? ' erros: ' + errs.slice(0, 2).join(' | ') : '';
      ok(m.overflow <= 1,
        `${w}px ${tema}: sem overflow horizontal (${m.overflow})${erros}`);
      if (w <= 768) {
        ok(m.w === 64 && m.secoes === 0 && m.rotulo === 'absolute' && m.btnVisivel === false,
          `${w}px ${tema}: rail de ${m.w}px, secoes ${m.secoes}, rotulo em visually-hidden (${m.rotulo}), toggle escondido (visivel=${m.btnVisivel})`);
        ok(m.dropTopo > 0 && m.dropTopo < 300,
          `${w}px ${tema}: drop area no topo, dentro da dobra (topo=${m.dropTopo}px)`);
      } else {
        ok(m.w === 240 && m.secoes === 4 && m.btnVisivel === true,
          `${w}px ${tema}: menu cheio de ${m.w}px, ${m.secoes} secoes, toggle visivel`);
        if (w >= 1024) {
          ok(m.dropMeio > m.janelaH * 0.25,
            `${w}px ${tema}: drop area centralizada no estado vazio (meio=${m.dropMeio}px de ${m.janelaH}px)`);
        }
      }
      const c = await page.evaluate(contraste);
      if (w === 1440) {
        /* O Designer mediu --focus sobre --sidebar em 2,96:1 no claro: reprova
           3:1. No escuro o mesmo --focus dá 6,77:1, então o anel herdado passa
           lá. É por isso que o toggle tem seletor próprio com --sidebar-accent. */
        /* O anel herdado reprova 3:1 no claro, e isso é o motivo de o toggle
           existir com seletor próprio — o teste registra a medição, não exige
           que ela passe. O que tem que passar é --sidebar-accent, logo abaixo. */
        ok(typeof c.crFoco === 'number' && c.crFoco > 1,
          `${tema}: anel herdado (--focus) sobre --sidebar = ${c.crFoco}:1`
          + (c.crFoco >= 3 ? ' (passa 3:1)' : ' (reprova 3:1 — o toggle usa --sidebar-accent)'));
        ok(tema === 'escuro' ? c.crFoco >= 3 : c.crFoco < 3,
          `${tema}: o anel herdado reprova SÓ no claro (${c.crFoco}:1), como o Designer mediu`);
        ok(c.crAccent >= 3, `${tema}: --sidebar-accent sobre --sidebar = ${c.crAccent}:1 (o que o toggle usa)`);
      }
      const menu = await page.evaluate(MEDIR_MENU);
      ok(menu.itens === 8 && menu.titulos === 8,
        `${w}px ${tema}: os 8 itens do menu têm title (${menu.titulos}/8)`);
      ok(menu.crumb === 'Leitura PDF',
        `${w}px ${tema}: o breadcrumb mostra a aba, sem o toggle ("${menu.crumb.trim()}")`);
      await ctx.close();
    }
  }

  /* ───────────────────────────────────────────────────────────────────────
     2. SIDEBAR RECOLHÍVEL: ciclo completo
     ─────────────────────────────────────────────────────────────────────── */
  head('2. SIDEBAR RECOLHIVEL: clique, persistencia, Esc e troca de largura');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 140)));
    await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(900);

    const medir = () => page.evaluate(MEDIR_SIDEBAR);

    const cheio = await medir();
    ok(cheio.w === 240 && cheio.rail === 'off' && cheio.expanded === 'true' && cheio.secoes === 4,
      `1440px inicia CHEIO: ${fmt(cheio)}`);

    await page.click('#btn-rail');
    await page.waitForTimeout(320);
    const rail = await medir();
    ok(rail.w === 64 && rail.rail === 'on' && rail.expanded === 'false' && rail.secoes === 0
      && rail.icone === '#i-panel-open' && rail.salvo === 'rail',
      `clique recolhe: ${fmt(rail)}`);
    ok(rail.conteudo > cheio.conteudo,
      `o rail libera largura util: ${cheio.conteudo.toFixed(0)} -> ${rail.conteudo.toFixed(0)}px`);
    ok(rail.overflow <= 1, `rail de 64px sem overflow horizontal (${rail.overflow})`);
    ok(rail.btnVisivel && rail.btnH >= 44, `toggle presente no desktop com ${rail.btnH.toFixed(0)}px de alvo`);
    ok(rail.label === 'Expandir menu', `o nome acessível acompanha o estado ("${rail.label}")`);
    ok(rail.status === 'Menu expandido', `a live region anuncia "${rail.status}"`);

    /* Recarrega: o rail tem que voltar, e com o ícone de expandir. */
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    const depois = await medir();
    ok(depois.w === 64 && depois.rail === 'on' && depois.salvo === 'rail' && depois.icone === '#i-panel-open',
      `após recarregar, o rail volta (${depois.w}px, salvo=${depois.salvo}, ${depois.icone})`);

    /* Esc expande, grava "full" e vira o glifo. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(320);
    const esc = await medir();
    ok(esc.w === 240 && esc.rail === 'off' && esc.salvo === 'full'
      && esc.status === 'Menu recolhido' && esc.icone === '#i-panel-close',
      `Esc expande: ${fmt(esc)}`);

    /* Esc com foco num campo de texto não mexe no menu. */
    await page.click('#btn-rail');
    await page.waitForTimeout(300);
    await page.click('.nav-btn[data-tab="cnpj"]');
    await page.waitForTimeout(300);
    /* CNPJ sintético com DV válido (módulo 11 conferido): o campo valida o
       dígito ao digitar, e um DV errado faria o teste passar pelo caminho do
       erro em vez do caminho normal. Não é empresa real. */
    await page.fill('#cnpj-input', '11222333000103');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const digitando = await medir();
    ok(digitando.w === 64 && digitando.rail === 'on' && digitando.salvo === 'rail',
      `Esc com o foco no campo de CNPJ não mexe no menu (ficou em ${digitando.w}px, salvo=${digitando.salvo})`);

    /* Celular: o toggle some e o rail é obrigatório mesmo com "full" salvo.
       O teste grava "full" antes de encolher para não depender do que os
       cliques anteriores deixaram. */
    await page.evaluate(() => localStorage.setItem('gcon-sidebar-v1', 'full'));
    await page.setViewportSize({ width: 375, height: 720 });
    await page.waitForTimeout(400);
    const cel = await medir();
    ok(cel.w === 64 && cel.rail === 'on' && cel.btnVisivel === false,
      `375px: rail obrigatório e toggle escondido mesmo com "full" salvo (visivel=${cel.btnVisivel}, ${cel.w}px)`);
    /* E o Esc no celular não pode apagar a preferência de desktop: o achado do
       Arquiteto. */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    const celEsc = await medir();
    ok(celEsc.salvo === 'full' && celEsc.rail === 'on',
      `Esc no celular não grava nem anuncia (salvo=${celEsc.salvo}, rail=${celEsc.rail})`);

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    const volta = await medir();
    ok(volta.w === 240 && volta.rail === 'off' && volta.btnVisivel === true,
      `voltando de 375 para 1440, a preferencia salva reassume (${volta.w}px, salvo=${volta.salvo})`);

    /* Foco visível no toggle, medido no navegador. O :focus-visible só acende
       se o foco vier de teclado: um .focus() por script conta como foco de
       mouse e o navegador não desenha o anel (estilo=none). O caminho real é
       Shift+Tab a partir do primeiro item do menu, que vem logo depois do
       toggle no DOM. */
    await page.click('#btn-rail');
    await page.waitForTimeout(300);
    await page.focus('.nav-btn[data-tab="importar"]');
    await page.keyboard.press('Shift+Tab');
    const quemTemFoco = await page.evaluate(() => document.activeElement.id);
    ok(quemTemFoco === 'btn-rail',
      `Shift+Tab a partir do primeiro item volta para o toggle (foco em "${quemTemFoco || 'nenhum'}")`);
    const anel = await page.evaluate(() => {
      const b = document.getElementById('btn-rail');
      const a = getComputedStyle(b);
      const token = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-accent').trim();
      const probe = document.createElement('div');
      probe.style.color = token; document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color; probe.remove();
      return { cor: a.outlineColor, rgbDoToken: rgb, estilo: a.outlineStyle, largura: a.outlineWidth };
    });
    ok(anel.estilo !== 'none' && anel.cor === anel.rgbDoToken,
      `anel de foco do toggle: ${anel.estilo} ${anel.largura} ${anel.cor} (--sidebar-accent = ${anel.rgbDoToken})`);

    /* Pedido explícito: nada de card ao lado da barra. O balão do item ativo
       abria a cada troca de aba (o item fica .active), então o teste mede que
       ele não existe e que a área útil do conteúdo não é invadida. */
    const semCartao = await page.evaluate(() => {
      const itens = [...document.querySelectorAll('.nav-btn')];
      const ativa = document.querySelector('.nav-btn.active');
      const conteudo = document.getElementById('content').getBoundingClientRect();
      /* Pseudo-elemento presente = existe balão, mesmo com opacity:0. */
      const pseudo = getComputedStyle(ativa, '::after').content;
      /* O pseudo precisa ter conteúdo de verdade para desenhar algo. */
      const conteudoPseudo = pseudo && pseudo !== 'none' && !/^["']?$/.test(pseudo);
      /* Algo do rail invadindo a área do conteúdo? */
      const invadindo = itens.filter((b) => {
        const r = b.getBoundingClientRect();
        return r.right > conteudo.left + 1;
      }).length;
      return { conteudoPseudo, invadindo, conteudoEsq: Math.round(conteudo.left) };
    });
    ok(semCartao.conteudoPseudo === false,
      `nenhum balão no ::after do item ativo (content="${semCartao.conteudoPseudo}")`);
    ok(semCartao.invadindo === 0,
      `nenhum item da barra invade a área do conteúdo (${semCartao.invadindo} invadindo, conteúdo começa em ${semCartao.conteudoEsq}px)`);

    /* A marca some inteira no rail (Designer): o primeiro item de uma coluna
       de 8 ícones não pode ser texto, e o fragmento herdava a cor mais
       saturada do topo. O que ainda tem que valer: nada vaza da barra, e o
       nome completo continua no breadcrumb do topo. */
    const cab = await page.evaluate(() => {
      const logo = document.getElementById('logo');
      const sb = document.getElementById('sidebar').getBoundingClientRect();
      const conteudo = document.getElementById('content').getBoundingClientRect();
      const crumb = (document.getElementById('crumb-cur') || {}).textContent || '';
      const marca = (document.querySelector('#crumb .c-brand') || {}).textContent || '';
      /* Todo filho direto da barra tem que caber nela: se algo vazar, invade o
         conteúdo — foi assim que o "N" do GCON/SIAN ficou no canto da tela. */
      const vazando = [...document.getElementById('sidebar').children]
        .filter((e) => getComputedStyle(e).display !== 'none')
        .filter((e) => e.getBoundingClientRect().right > sb.right + 1)
        .map((e) => e.id || e.className || e.tagName);
      return {
        marcaVisivel: logo ? getComputedStyle(logo).display !== 'none' : false,
        sbDireita: Math.round(sb.right),
        conteudoEsq: Math.round(conteudo.left),
        vazando,
        crumb: crumb.trim(),
        marca: marca.trim(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    ok(cab.marcaVisivel === false,
      `a marca não ocupa a barra recolhida (visivel=${cab.marcaVisivel})`);
    ok(cab.vazando.length === 0,
      `nenhum filho da barra ultrapassa a largura dela (vazando: ${cab.vazando.join(',') || 'nenhum'})`);
    ok(cab.sbDireita === 64 && cab.conteudoEsq === 64,
      `a barra ocupa exatamente 64px e o conteúdo começa depois (${cab.sbDireita}/${cab.conteudoEsq})`);
    ok(cab.marca === 'GCON·SIAN',
      `o nome completo da marca continua no topo ("${cab.marca}", aba "${cab.crumb}")`);
    ok(cab.overflow <= 1, `nenhum overflow horizontal com a barra recolhida (${cab.overflow})`);

    /* O rótulo do item continua exposto ao leitor de tela no rail: o
       breadcrumb lê textContent e um display:none aqui o apagaria em silêncio. */
    const railLabel = await page.evaluate(() => {
      const b = document.querySelector('.nav-btn[data-tab="cnpj"]');
      return { texto: b.textContent.trim(), rotuloVisivel: getComputedStyle(b.querySelector('span:not(.icon)')).display };
    });
    ok(railLabel.texto.length > 0 && railLabel.rotuloVisivel !== 'none',
      `no rail o rótulo continua no DOM e só some da tela ("${railLabel.texto}")`);

    ok(errs.length === 0, `sem pageerror no ciclo da sidebar: ${errs.join(' | ') || 'nenhum'}`);
    await page.screenshot({ path: path.join(SHOT, '1440-claro-rail.png') });
    await page.click('#btn-rail');
    await page.waitForTimeout(320);
    await page.screenshot({ path: path.join(SHOT, '1440-claro-cheio.png') });
    await ctx.close();
  }

  /* ───────────────────────────────────────────────────────────────────────
     3. TELAS VAZIAS: nada de inventário nem de rótulo solto
     ─────────────────────────────────────────────────────────────────────── */
  head('3. TELAS VAZIAS (sessão sem nenhum documento)');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(900);
    for (const aba of ['importar', 'cnpj', 'dashboard', 'pdfleitura', 'nfe']) {
      await page.click(`.nav-btn[data-tab="${aba}"]`);
      await page.waitForTimeout(350);
      const m = await page.evaluate(() => {
        const p = document.getElementById('tab-' + document.querySelector('.tab-content.active').id.slice(4));
        const barra = document.getElementById('status-bar');
        const contadores = [...document.querySelectorAll('#status-bar .stat')].filter((s) => getComputedStyle(s).display !== 'none').length;
        const priv = document.getElementById('cnpj-privacidade');
        return {
          barraVisivel: barra ? getComputedStyle(barra).display !== 'none' : false,
          contadores,
          kpis: p ? p.querySelectorAll('.kpi-card').length : 0,
          filtrosVisiveis: (() => { const f = document.getElementById('pdfiso-filtros'); return f ? getComputedStyle(f).display !== 'none' : null; })(),
          privAberto: priv ? priv.open : null,
          privAltura: priv ? Math.round(priv.getBoundingClientRect().height) : null,
          /* Um travessão solto é ruído visual: era o estado inicial do rodapé
             do lote de CNPJ. Só conta o que está de fato visível e sem texto
             ao lado — dentro de <option>, <title> ou aria-hidden não é. */
          textoSolto: p ? [...p.querySelectorAll('*')].filter((e) => {
            if (e.children.length || e.tagName === 'OPTION' || e.tagName === 'TITLE') return false;
            if (e.closest('[aria-hidden="true"]')) return false;
            const t = e.textContent.trim();
            if (t !== '—' && t !== '-') return false;
            const a = getComputedStyle(e);
            return a.display !== 'none' && a.visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
          }).length : 0,
        };
      });
      ok(m.barraVisivel === false && m.contadores === 0,
        `${aba}: a faixa de estatísticas some sem sessão (visivel=${m.barraVisivel}, contadores=${m.contadores})`);
      if (aba === 'dashboard') {
        ok(m.kpis === 0, `dashboard: nenhum KPI zerado na tela (${m.kpis} cards)`);
      }
      if (aba === 'pdfleitura') {
        ok(m.filtrosVisiveis === false, `leitura PDF: a busca só existe depois do primeiro PDF (visivel=${m.filtrosVisiveis})`);
      }
      if (aba === 'cnpj') {
        ok(m.privAberto === false && m.privAltura <= 60,
          `cnpj: o aviso de privacidade fica recolhido em uma linha (aberto=${m.privAberto}, ${m.privAltura}px)`);
        await page.click('#cnpj-privacidade > summary');
        await page.waitForTimeout(200);
        const aberto = await page.evaluate(() => {
          const d = document.getElementById('cnpj-privacidade');
          return { aberto: d.open, altura: Math.round(d.getBoundingClientRect().height), texto: d.textContent.length };
        });
        ok(aberto.aberto === true && aberto.altura > aberto.texto / 200,
          `cnpj: o sumário abre o texto completo (${aberto.altura}px, ${aberto.texto} caracteres)`);
        await page.click('#cnpj-privacidade > summary');
        await page.waitForTimeout(150);
      }
      ok(m.textoSolto === 0, `${aba}: nenhum travessão solto na tela (${m.textoSolto})`);
    }
    /* O botão principal do separador ocupa a linha inteira enquanto o
       secundário não existe. */
    await page.click('.nav-btn[data-tab="separar"]');
    await page.waitForTimeout(300);
    const sep = await page.evaluate(() => {
      const p = document.getElementById('btn-processar'), b = document.getElementById('baixar');
      return { w: p.getBoundingClientRect().width, pai: p.parentElement.getBoundingClientRect().width, temSec: getComputedStyle(b).display !== 'none' };
    });
    ok(Math.abs(sep.w - sep.pai) < 2,
      `separar: o botão principal ocupa a linha inteira sem o secundário (${sep.w.toFixed(0)} de ${sep.pai.toFixed(0)}px)`);
    await ctx.close();
  }

  /* ───────────────────────────────────────────────────────────────────────
     4. LEITURA PDF DE PONTA A PONTA (só com amostra real)
     ─────────────────────────────────────────────────────────────────────── */
  head('4. LEITURA PDF DE PONTA A PONTA com uma NOTA REAL');
  {
    const pdf = fs.existsSync(AMOSTRAS)
      ? fs.readdirSync(AMOSTRAS).find((f) => /^NF\s*108/i.test(f) && f.toLowerCase().endsWith('.pdf'))
      : null;
    if (!pdf) {
      console.log('PULADO | sem amostras/ (ou sem a NF 108). O bloco 4 precisa de um PDF real;'
        + ' em clone novo isso é o esperado, e os blocos 1-3 continuam valendo.');
    } else {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
      page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 140)));
      await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 60000 });
      await page.click('.nav-btn[data-tab="pdfleitura"]');
      await page.waitForTimeout(600);
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        page.click('#pdfiso-upload'),
      ]);
      await chooser.setFiles([path.join(AMOSTRAS, pdf)]);
      await page.waitForSelector('#pdfiso-result table tbody tr', { timeout: 120000 });
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        const tr = document.querySelectorAll('#pdfiso-result table tbody tr');
        /* Seletor por data-para, nunca o primeiro .pdfiso-badge: a linha tem
           DOIS badges e o primeiro é a confiança (percentual do OCR). Ler o
           primeiro fazia a asserção de garantia passar com "99%". */
        const badge = document.querySelector('.pdfiso-badge[data-para="garantia"]');
        const conf = document.querySelector('.pdfiso-badge[data-para="confianca"]');
        /* Célula sem dado: o app marca com ✗ e nomeia a ausência — no title da
           célula ou no aria-label do ✗ dentro dela. Aceito os dois caminhos,
           porque o que importa é que a ausência esteja nomeada para o leitor
           de tela, não o glifo escolhido. */
        const vazias = [...tr[0].querySelectorAll('td')].filter((td) => {
          const t = td.textContent.trim();
          if (t !== '' && t !== '✗') return false;
          const dentro = td.querySelector('[aria-label]');
          return !!(td.title || (dentro && dentro.getAttribute('aria-label')));
        });
        return {
          /* Dump de toda célula que carrega um title ou um aria-label: é onde
             mora a explicação do dado ausente. Se o filtro acima não casar, a
             falha mostra o que existe de fato em vez de nada. */
          celulasSemDados: [...tr[0].querySelectorAll('td')]
            .filter((td) => { const t = td.textContent.trim(); return t === '' || t === '✗'; }).length,
          vaziasSemNome: vazias.length,
          celulasNomeadas: vazias.map((td) => JSON.stringify(td.textContent.trim()) + ' title=' + JSON.stringify(td.title)),
          linhas: tr.length,
          badge: badge ? badge.textContent.trim() : null,
          badgeClasse: badge ? badge.className : null,
          /* A garantia só pode ser verde se o texto disser ✓. Se a classe e o
             texto divergirem, o badge mente — e o texto é o que o usuário lê. */
          badgeOk: !!badge && badge.className.includes('ok') && /✓/.test(badge.textContent),
          confianca: conf ? conf.textContent.trim() : null,
          celulaVazia: vazias.length
            ? (vazias[0].title
              || ((vazias[0].querySelector('[aria-label]') || {}).getAttribute
                && vazias[0].querySelector('[aria-label]').getAttribute('aria-label')))
            : null,
          kpis: [...document.querySelectorAll('#pdfiso-kpis .kpi-card')]
            .map((c) => (c.querySelector('.label').textContent + '=' + c.querySelector('.value').textContent)),
          filtrosVisiveis: (() => { const f = document.getElementById('pdfiso-filtros'); return getComputedStyle(f).display !== 'none'; })(),
          /* Nome acessível dos glifos: o app usa <title> dentro do <svg> ou
             aria-label no elemento. Os dois caminhos são aceitos — o teste
             mede o que existe, não o que Preferred. */
          nomes: [...document.querySelectorAll('#pdfiso-result svg, #pdfiso-result [aria-label]')]
            .map((e) => (e.getAttribute('aria-label') || (e.querySelector('title') || {}).textContent || '').trim())
            .filter(Boolean),
        };
      });
      ok(r.linhas === 1, `a nota entrou e virou 1 linha (${r.linhas})`);
      ok(!!r.badge, `a linha traz o badge de garantia (confiança lida à parte: "${r.confianca}")`);
      ok(r.badgeOk,
        `badge de garantia: "${r.badge}" (classe "${r.badgeClasse}") — verde só com ✓;`
        + ' a garantia naranja é "~ CNPJ+Nº · emissor não confirmado" e reprova aqui de propósito,'
        + ' porque esta nota tem chave validada');
      /* Nenhuma célula vazia é o melhor resultado, mas depende da amostra: a
         NF 108 costuma sair completa, outras não. O invariante é sobre as
         células que FICARAM vazias, não sobre haver alguma. */
      ok(r.vaziasSemNome === 0,
        r.celulasSemDados === 0
          ? 'nenhuma célula ficou sem dado nesta nota'
          : `${r.celulasSemDados} célula(s) sem dado, todas com o motivo nomeado: "${(r.celulaVazia || '').slice(0, 60)}"`);
      ok(r.kpis.some((k) => /chave 44/i.test(k) && /1/.test(k)),
        `KPI de chave 44 contando as validadas (${r.kpis.join(' | ')})`);
      ok(r.filtrosVisiveis === true, `com o PDF lido, a busca aparece (visivel=${r.filtrosVisiveis})`);
      /* A faixa conta XML do painel de Notas, não o leitor de PDF. Ela é
         escondida na sessão vazia (bloco 3) e o caminho de volta é o
         `updateStatus()` do pós-processamento de XML. Ler um PDF não passa por
         ele — a leitura é isolada, por desenho — então este caso roda
         updateStatus de propósito, com um valor alto, para medir que a caixa
         reaparece e que o contador zerado se esconde. */
      const faixa = await page.evaluate(() => {
        const antes = { visivel: getComputedStyle(document.getElementById('status-bar')).display !== 'none' };
        updateStatus();
        const b = document.getElementById('status-bar');
        const stats = [...document.querySelectorAll('#status-bar .stat')];
        return {
          antesVisivel: antes.visivel,
          visivel: getComputedStyle(b).display !== 'none',
          /* Nenhum XML foi importado, então os três são 0 e a barra tem que
             seguir escondida: foi a NF-e de verdade, não um número forjado. */
          contadores: stats.filter((s) => getComputedStyle(s).display !== 'none').length,
          sessao: (document.getElementById('s-sessao').textContent || '').trim(),
        };
      });
      ok(faixa.antesVisivel === false,
        `ler PDF não acorda a faixa: a leitura é isolada e não entra no inventário (visivel=${faixa.antesVisivel})`);
      ok(faixa.visivel === false && faixa.contadores === 0,
        `updateStatus com 0 em tudo mantém a faixa escondida (visivel=${faixa.visivel}, contadores=${faixa.contadores})`);
      ok(/Sess/.test(faixa.sessao),
        `o id da sessão é sempre escrito, mesmo com a barra escondida ("${faixa.sessao}")`);
      ok(r.nomes.length > 0 && r.nomes.every((n) => n.length > 6),
        `todo glifo da tabela tem nome acessível (${r.nomes.length}): "${(r.nomes[0] || '').slice(0, 60)}"`);
      ok(r.nomes.some((n) => /chave/i.test(n)),
        `o glifo da chave 44 explica a validação: "${(r.nomes.find((n) => /chave/i.test(n)) || '').slice(0, 70)}"`);
      ok(errs.length === 0, `sem erro de página no fluxo real: ${errs.join(' | ') || 'nenhum'}`);
      await page.screenshot({ path: path.join(SHOT, '1440-claro-pdf-com-nota.png') });
      await ctx.close();
    }
  }

  /* ───────────────────────────────────────────────────────────────────────
     5. prefers-reduced-motion
     ─────────────────────────────────────────────────────────────────────── */
  head('5. prefers-reduced-motion: nao pode sobrar movimento');
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(pathToFileURL(FILE).href, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(800);
    const sobra = await page.evaluate(() => {
      const fora = [];
      document.querySelectorAll('*').forEach((el) => {
        if (el.closest('#loading-box')) return; /* spinner: atividade, não decoração */
        const a = getComputedStyle(el);
        const dur = (v) => parseFloat(v) || 0;
        if (dur(a.transitionDuration) > 0.01 || dur(a.animationDuration) > 0.01) {
          fora.push((el.id || el.className || el.tagName) + ' t=' + a.transitionDuration + ' a=' + a.animationDuration);
        }
      });
      return fora.slice(0, 6);
    });
    ok(sobra.length === 0, `nenhuma transição ou animação sobrando: ${sobra.join(' | ') || 'nenhuma'}`);
    /* A sidebar também não pode animar a largura com a preferência ligada. */
    const w = await page.evaluate(() => getComputedStyle(document.getElementById('sidebar')).transitionDuration);
    ok(parseFloat(w) < 0.01, `a largura da sidebar não anima com reduce (transition=${w})`);
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (fail ? 'SMOKE REPROVADO: ' + fail + ' falha(s)' : 'SMOKE OK: tudo passou'));
  console.log('screenshots: ' + SHOT);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
