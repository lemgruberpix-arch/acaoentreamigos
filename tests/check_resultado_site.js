// Secao "Resultado do sorteio" da cartela publica (index.html + assets/app.js), sem navegador e sem rede:
// roda o app.js num DOM simulado com fetch falso e confere o que aparece na tela.
// Cobre: registrado:false, ordens 1..6 e null, data dd/mm/aaaa, cota com 4 digitos, falha de rede, dado pessoal NUNCA na tela.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'assets', 'style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'assets', 'app.js'), 'utf8');
const cfgJs = fs.readFileSync(path.join(ROOT, 'assets', 'config.js'), 'utf8');

const AVISO = 'O ganhador é avisado por WhatsApp no mesmo dia.';
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }

// ---------- 1) Estatico ----------
const ini = html.search(/<script src="assets\/app\.js/);
ok(ini > 0, 'index.html carrega assets/app.js');
const IDS_RESULTADO = ['resultadoCard', 'resultadoLive', 'resultadoDemo', 'resultadoData', 'resultadoCota', 'resultadoRegra',
  'resultadoPremios', 'resultadoAviso', 'resultadoVerBtn', 'resultadoRegulamentoLink'];
IDS_RESULTADO.forEach((id) => {
  const pos = html.search(new RegExp('id="' + id + '"'));
  ok(pos > 0 && pos < ini, '#' + id + ' existe e vem ANTES do script do app.js');
});
ok(/id="resultadoCard"[^>]*\bhidden\b/.test(html), 'o cartao nasce escondido (so aparece com resultado valido)');
ok(/id="resultadoLive"[^>]*role="status"[^>]*aria-live="polite"/.test(html), 'aviso para leitor de tela: role=status + aria-live=polite');
ok(/id="resultadoRegulamentoLink" href="regulamento\.html">Ver o regulamento</.test(html), 'link "Ver o regulamento" -> regulamento.html');
ok(/aria-labelledby="resultadoTitulo"/.test(html) && /id="resultadoTitulo">Resultado do sorteio</.test(html), 'titulo "Resultado do sorteio" ligado ao cartao');
ok(/\.result-cota\b/.test(css) && /\.number-button\.result-winner/.test(css), 'CSS do cartao e do destaque na grade');
ok(/prefers-reduced-motion/.test(css), 'reduced-motion segue no CSS');

// ---------- 2) DOM simulado ----------
const idsDoHtml = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));

function makeEl(id) {
  const el = {
    id,
    hidden: false,
    textContent: '',
    innerHTML: '',
    value: '',
    disabled: false,
    children: [],
    attrs: {},
    listeners: {},
    style: {},
    dataset: {},
    classes: new Set(),
    className: '',
    classList: null,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { if (c && c.__frag) { this.children.push(...c.children); c.children = []; } else this.children.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains() { return false; },
    focus() {},
    blur() {},
    click() {},
    scrollIntoView() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    insertAdjacentHTML() {},
    reset() {},
    remove() {}
  };
  const classes = el.classes;
  el.classList = {
    add: (...c) => c.forEach((x) => classes.add(x)),
    remove: (...c) => c.forEach((x) => classes.delete(x)),
    contains: (c) => classes.has(c),
    toggle: (c, force) => { const on = force === undefined ? !classes.has(c) : !!force; on ? classes.add(c) : classes.delete(c); return on; }
  };
  return el;
}

function makeEnv(fetchImpl, search) {
  const els = {};
  const getEl = (id) => {
    if (!idsDoHtml.has(id)) return null; // so existe o que existe no index.html (pega id faltando)
    if (!els[id]) els[id] = makeEl(id);
    return els[id];
  };
  // estado inicial real do HTML: o cartao nasce hidden; avisos e botao idem se tiverem hidden
  ['resultadoCard', 'resultadoDemo', 'pendingReservation'].forEach((id) => { getEl(id).hidden = true; });

  const docListeners = {};
  const document = {
    getElementById: getEl,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener() {},
    createElement: (tag) => { const e = makeEl('(novo ' + tag + ')'); e.tag = tag; return e; },
    createDocumentFragment: () => { const f = makeEl('(frag)'); f.__frag = true; return f; },
    querySelector: () => null,
    querySelectorAll: () => [],
    body: makeEl('body'),
    documentElement: makeEl('html'),
    activeElement: null
  };
  const storage = {};
  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: {}, userAgent: 'teste' },
    location: { search: search || '', href: 'http://localhost/index.html' + (search || ''), origin: 'http://localhost', hash: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: (fn) => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
    requestAnimationFrame: (fn) => 0,
    URLSearchParams,
    Promise,
    fetch: fetchImpl,
    Blob: function () {},
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Date, Math, JSON, Number, String, Array, Object, Set, Map, Intl, Error, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, RegExp
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.getComputedStyle = () => ({});
  vm.createContext(sandbox);
  vm.runInContext(cfgJs, sandbox);
  vm.runInContext(appJs, sandbox);
  return { els, getEl, sandbox, docListeners, storage };
}

const sleep = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 25; i += 1) await sleep(); }

const RESPOSTA_LISTAR = { ok: true, total_numeros: 10000, numero_inicial: 0, valor_numero: 20, numeros: [] };

// fetch falso: POST (listar) devolve a lista; GET com action=resultado devolve o que o teste mandar.
function fetchFalso(resultado, calls) {
  return async (url, opts) => {
    const metodo = ((opts && opts.method) || 'GET').toUpperCase();
    calls.push({ url: String(url), metodo, body: opts && opts.body });
    if (metodo === 'POST') return { text: async () => JSON.stringify(RESPOSTA_LISTAR) };
    if (resultado === 'REDE_CAIU') throw new TypeError('Failed to fetch');
    if (resultado === 'LIXO') return { text: async () => '<html>nao e json</html>' };
    return { text: async () => JSON.stringify(resultado) };
  };
}

async function carrega(resultado, search) {
  const calls = [];
  const env = makeEnv(fetchFalso(resultado, calls), search);
  const erros = [];
  process.once('unhandledRejection', (e) => erros.push(e));
  (env.docListeners.DOMContentLoaded || []).forEach((fn) => fn());
  await settle();
  process.removeAllListeners('unhandledRejection');
  return { ...env, calls, erros };
}

// Tudo que o visitante enxerga do cartao (vazio se o cartao esta escondido).
function textoVisivel(env) {
  const e = env.els;
  if (!e.resultadoCard || e.resultadoCard.hidden) return '';
  const partes = [];
  ['resultadoDemo', 'resultadoData', 'resultadoCota', 'resultadoRegra', 'resultadoPremios', 'resultadoAviso', 'resultadoVerBtn']
    .forEach((id) => { const x = e[id]; if (x && !x.hidden) partes.push((x.textContent || '') + ' ' + (x.innerHTML || '').replace(/<[^>]+>/g, ' ')); });
  return partes.join(' | ').replace(/\s+/g, ' ');
}
function tudoQueHaNaTela(env) {
  const e = env.els;
  const partes = [textoVisivel(env), e.resultadoLive ? e.resultadoLive.textContent : ''];
  const grade = e.numbersGrid;
  if (grade) grade.children.forEach((c) => partes.push((c.innerHTML || '') + ' ' + (c.attrs['aria-label'] || '')));
  return partes.join(' | ');
}

const PREMIOS = ['04321', '55007', '93017', '12999', '88880'];
function resposta(ordem, numero, extra) {
  return Object.assign({ ok: true, registrado: true, data_extracao: '2026-12-31', premios: PREMIOS.slice(), numero_vencedor: numero, ordem_premio_usado: ordem }, extra || {});
}

(async () => {
  // ---- registrado:false -> nada na tela
  {
    const env = await carrega({ ok: true, registrado: false });
    const get = env.calls.find((c) => c.metodo === 'GET');
    ok(get && /\?action=resultado$/.test(get.url), 'chama a MESMA API_URL com GET ?action=resultado');
    ok(get.url.startsWith(env.sandbox.RIFA_CONFIG.API_URL), 'usa CFG.API_URL');
    ok(env.els.resultadoCard.hidden === true, 'registrado:false: cartao continua escondido');
    ok(textoVisivel(env) === '', 'registrado:false: nada de resultado na tela');
    ok(env.erros.length === 0, 'registrado:false: nenhuma excecao');
  }

  // ---- ordem 1
  {
    const env = await carrega(resposta(1, '4321'));
    const t = textoVisivel(env);
    ok(env.els.resultadoCard.hidden === false, 'ordem 1: cartao aparece');
    ok(env.els.resultadoCota.textContent === 'Cota 4321', 'ordem 1: Cota 4321');
    ok(/Valeu o 1º prêmio/.test(env.els.resultadoRegra.textContent), 'ordem 1: frase "Valeu o 1º prêmio"');
    ok(env.els.resultadoData.textContent === '31/12/2026', 'data em dd/mm/aaaa (31/12/2026)');
    PREMIOS.forEach((p) => ok(t.includes(p) || t.includes(p.slice(0, -4)), 'mostra o premio ' + p));
    ok((env.els.resultadoPremios.innerHTML.match(/<li /g) || []).length === 5, 'lista os 5 premios');
    ok(/is-used/.test(env.els.resultadoPremios.innerHTML) && /<b>4321<\/b>/.test(env.els.resultadoPremios.innerHTML), 'ordem 1: destaca o 1º premio e os 4 ultimos digitos');
    ok(env.els.resultadoAviso.hidden === false, 'aviso do WhatsApp visivel (texto fixo no HTML, conferido na parte estatica)');
    ok(env.els.resultadoVerBtn.hidden === false, 'botao "Ver a cota na cartela" visivel');
    ok(env.els.resultadoDemo.hidden === true, 'sem rotulo de demonstracao no resultado real');
    ok(/Resultado do sorteio disponível/.test(env.els.resultadoLive.textContent) && /4321/.test(env.els.resultadoLive.textContent), 'aviso para leitor de tela');
    ok(env.erros.length === 0, 'ordem 1: nenhuma excecao');
    // grade: a cota 4321 esta no painel 44 (nao visivel no painel 01), entao nada destacado ali; ao ir para o painel, destaca
    ok(!env.els.numbersGrid.children.some((c) => c.classes.has('result-winner')), 'fora do painel atual nao ha destaque');
    env.els.resultadoVerBtn.listeners.click[0]();
    const venc = env.els.numbersGrid.children.filter((c) => c.classes.has('result-winner'));
    ok(venc.length === 1 && venc[0].disabled === true, 'grade: cota vencedora destacada e nao selecionavel');
    ok(/cota vencedora/.test(venc[0].attrs['aria-label']) && /4321/.test(venc[0].attrs['aria-label']) && /Ganhou/.test(venc[0].innerHTML), 'grade: rotulo acessivel "cota vencedora"');
  }

  // ---- ordem 3 (zeros a esquerda no premio: 93017 -> 3017)
  {
    const env = await carrega(resposta(3, '3017'));
    ok(env.els.resultadoCota.textContent === 'Cota 3017', 'ordem 3: Cota 3017');
    ok(/Valeu o 3º prêmio/.test(env.els.resultadoRegra.textContent) && /anteriores não estavam vendidas/.test(env.els.resultadoRegra.textContent), 'ordem 3: frase "Valeu o 3º prêmio"');
    ok(/is-used/.test(env.els.resultadoPremios.innerHTML.split('</li>')[2]), 'ordem 3: o 3º premio e o destacado');
  }

  // ---- ordem 5
  {
    const env = await carrega(resposta(5, '8880'));
    ok(env.els.resultadoCota.textContent === 'Cota 8880', 'ordem 5: Cota 8880');
    ok(/Valeu o 5º prêmio/.test(env.els.resultadoRegra.textContent), 'ordem 5: frase "Valeu o 5º prêmio"');
  }

  // ---- ordem 6 (regra de fechamento) + zeros a esquerda
  {
    const env = await carrega(resposta(6, '0007'));
    ok(env.els.resultadoCota.textContent === 'Cota 0007', 'ordem 6: Cota 0007 (4 digitos, zeros a esquerda)');
    ok(env.els.resultadoRegra.textContent === 'Nenhuma das cinco cotas estava vendida: vale a cota paga logo acima do 1º prêmio.', 'ordem 6: frase da regra de fechamento');
    ok(!/is-used/.test(env.els.resultadoPremios.innerHTML), 'ordem 6: nenhum premio marcado como usado');
    ok(env.els.resultadoAviso.hidden === false, 'ordem 6: aviso do WhatsApp visivel');
    env.els.resultadoVerBtn.listeners.click[0]();
    ok(env.els.numbersGrid.children.some((c) => c.classes.has('result-winner') && /0007/.test(c.innerHTML)), 'ordem 6: 0007 destacada na grade (painel 01 visivel)');
  }

  // ---- sem ganhador (ordem null)
  {
    const env = await carrega(resposta(null, null));
    ok(env.els.resultadoCard.hidden === false, 'sem ganhador: cartao aparece com os premios');
    ok(env.els.resultadoCota.textContent === 'Sem ganhador apurável' && !/Cota \d/.test(textoVisivel(env)), 'sem ganhador: nenhuma cota exibida');
    ok(env.els.resultadoRegra.textContent === 'Nenhuma cota paga: sem ganhador apurável.', 'sem ganhador: frase certa');
    ok(env.els.resultadoAviso.hidden === true && env.els.resultadoVerBtn.hidden === true, 'sem ganhador: sem aviso de WhatsApp e sem botao de ver cota');
    ok(!env.els.numbersGrid.children.some((c) => c.classes.has('result-winner')), 'sem ganhador: nada destacado na grade');
  }

  // ---- falhas: nenhuma excecao, nada na tela, cartela segue
  for (const [nome, r] of [['rede caiu', 'REDE_CAIU'], ['resposta nao-JSON', 'LIXO'], ['ok:false', { ok: false, error: 'x' }], ['vazio', null]]) {
    const env = await carrega(r);
    ok(env.erros.length === 0, nome + ': nenhuma excecao solta');
    ok(env.els.resultadoCard.hidden === true && textoVisivel(env) === '', nome + ': secao nao aparece');
    ok(env.els.numbersGrid.children.length > 0, nome + ': a cartela continua carregando normalmente');
  }

  // ---- formatos invalidos nunca viram tela (nem meia tela)
  for (const [nome, r] of [
    ['data torta', resposta(1, '4321', { data_extracao: '31/12/2026' })],
    ['4 premios', resposta(1, '4321', { premios: PREMIOS.slice(0, 4) })],
    ['premio com letra', resposta(1, '4321', { premios: ['04321', 'abcde', '93017', '12999', '88880'] })],
    ['cota com 3 digitos', resposta(6, '007')],
    ['ordem 7', resposta(7, '4321')],
    ['cota que nao bate com o premio', resposta(1, '9999')],
    ['ordem null com cota', resposta(null, '0007')]
  ]) {
    const env = await carrega(r);
    ok(env.els.resultadoCard.hidden === true && textoVisivel(env) === '', nome + ': nao exibe');
  }

  // ---- dado pessoal inserido de proposito: NUNCA aparece (so os campos conhecidos sao lidos)
  {
    const iscas = { nome: 'ZEQUINHA_ISCA', whatsapp: '21977776666', ganhador: { nome: 'MARIA_ISCA', whatsapp: '21966665555' }, comprovante_url: 'https://drive.example/segredo', observacao: 'OBS_ISCA' };
    const env = await carrega(resposta(1, '4321', iscas));
    ok(env.els.resultadoCard.hidden === false, 'com iscas: o resultado aparece normalmente');
    const tela = tudoQueHaNaTela(env);
    ['ZEQUINHA_ISCA', 'MARIA_ISCA', '21977776666', '21966665555', 'drive.example', 'OBS_ISCA'].forEach((x) => ok(!tela.includes(x), 'dado pessoal "' + x + '" NAO pode aparecer na tela'));
    const cartaoFonte = [env.els.resultadoCard, env.els.resultadoCota, env.els.resultadoRegra, env.els.resultadoPremios, env.els.resultadoLive].map((x) => (x.textContent || '') + (x.innerHTML || '')).join('');
    ok(!/ISCA|2197777|2196666/.test(cartaoFonte), 'nem no HTML interno do cartao');
  }

  // ---- demonstracao: ?resultado=demo nao chama a API e vem rotulada
  {
    const env = await carrega({ ok: true, registrado: false }, '?resultado=demo');
    ok(!env.calls.some((c) => c.metodo === 'GET'), 'demo: nao chama a API de resultado');
    ok(env.els.resultadoCard.hidden === false && env.els.resultadoDemo.hidden === false, 'demo: cartao visivel com o rotulo');
    ok(/id="resultadoDemo"[^>]*>Demonstração: dados fictícios, não é o resultado real\.</.test(html), 'demo: rotulo "Demonstração" bem claro (texto fixo no HTML)');
    ok(/^Cota \d{4}$/.test(env.els.resultadoCota.textContent), 'demo: cota com 4 digitos');
    ok(env.els.resultadoLive.textContent === '', 'demo: nao anuncia nada ao leitor de tela como se fosse real');
    const e6 = await carrega(null, '?resultado=demo&ordem=6');
    ok(e6.els.resultadoCota.textContent === 'Cota 0043' && /logo acima/.test(e6.els.resultadoRegra.textContent), 'demo ordem 6');
    const en = await carrega(null, '?resultado=demo&ordem=nenhuma');
    ok(/sem ganhador/.test(en.els.resultadoRegra.textContent), 'demo sem ganhador');
    const outro = await carrega({ ok: true, registrado: false }, '?resultado=real');
    ok(outro.els.resultadoCard.hidden === true && outro.els.resultadoDemo.hidden === true, 'qualquer outro valor de ?resultado nao ativa a demo');
  }

  console.log('PASS: resultado do sorteio na cartela publica verificado (' + checks + ' checks).');
})().catch((e) => { console.error(e); process.exit(1); });
