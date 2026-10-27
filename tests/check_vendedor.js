// Programa de vendedores (lado publico), sem navegador e sem rede:
// 1) o codigo e sanitizado igual ao servidor (apps-script/codigo.gs);
// 2) assets/app.js captura ?v= (e ?ref=), guarda em localStorage e manda `indicador` na reserva (e NAO manda sem codigo);
// 3) vendedor.html gera codigo + link, copia, compartilha no WhatsApp e mostra o progresso (0/100, 37/100, 100/100), com erro de API tratado;
// 4) texto honesto, tema claro, fontes >= 16px, link no rodape do index.html e INDICACAO no config.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');
const appJs = read('assets/app.js');
const cfgJs = read('assets/config.js');
const vendHtml = read('vendedor.html');
const servidor = read('apps-script/codigo.gs');
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }
const sleep = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 30; i += 1) await sleep(); }

// ---------- 1) Sanitizacao igual a do servidor ----------
function extrair(fonte, nomeFn, rotulo) {
  const m = fonte.match(new RegExp('function ' + nomeFn + '\\(value\\) \\{[\\s\\S]*?\\n\\s*\\}\\n'));
  ok(!!m, rotulo + ': funcao ' + nomeFn + ' encontrada');
  const box = {};
  vm.runInNewContext(m[0] + '; this.f = ' + nomeFn + ';', box);
  return box.f;
}
const doServidor = extrair(servidor, 'sanitizeIndicador_', 'codigo.gs');
const doApp = extrair(appJs, 'sanitizeIndicador', 'app.js');
const inlineVend = vendHtml.match(/<script>([\s\S]*?)<\/script>/);
ok(!!inlineVend, 'vendedor.html tem o script da pagina');
const doVend = extrair(inlineVend[1], 'sanitizeIndicador', 'vendedor.html');
const entradas = [
  'joao-silva', 'João Silva', '  Maria   da  Luz  ', 'ÁÉÍÓÚ çãõ', 'a', '', '  ', '-', '__', 'x_y-z', 'Ze!@#Pe', 'UPPER',
  'a'.repeat(40), 'abcdefghijklmnopqrstuvwxyz0123456789', 'josé.da.silva@x.com', '日本語', 'ab', 'a b', ' a ', 'ñandú', undefined, null, 123, 'ref=1&v=2',
  '<script>alert(1)</script>', 'Joao\tSilva\nNeto'
];
entradas.forEach((e) => {
  const esperado = doServidor(e);
  ok(doApp(e) === esperado, 'app.js sanitiza igual ao servidor: ' + JSON.stringify(e) + ' -> ' + JSON.stringify(esperado));
  ok(doVend(e) === esperado, 'vendedor.html sanitiza igual ao servidor: ' + JSON.stringify(e));
});
ok(doServidor('João Silva') === 'joao-silva' && doServidor('a') === '' && doServidor('a'.repeat(40)).length === 24, 'valores de referencia do servidor (joao-silva; 1 letra = vazio; corta em 24)');

// ---------- 2) Estatico ----------
ok(/INDICACAO:\s*\{\s*cotasPorBloco:\s*100,\s*bonusPorBloco:\s*5\s*\}/.test(cfgJs), 'config.js tem INDICACAO { cotasPorBloco: 100, bonusPorBloco: 5 }');
const cfgBox = { window: {} }; vm.createContext(cfgBox); vm.runInContext(cfgJs, cfgBox);
ok(cfgBox.window.RIFA_CONFIG.INDICACAO.cotasPorBloco === 100 && cfgBox.window.RIFA_CONFIG.INDICACAO.bonusPorBloco === 5, 'config.js carrega INDICACAO');
ok(/COTAS_POR_BLOCO = 100/.test(servidor) && /BONUS_POR_BLOCO = 5/.test(servidor), 'config.js e servidor usam os mesmos numeros (100 e 5)');

const rodape = html.slice(html.indexOf('<footer'), html.indexOf('</footer>'));
ok(/<a href="vendedor\.html">Indique e ganhe cotas grátis<\/a>/.test(rodape), 'index.html: rodape tem o link "Indique e ganhe cotas grátis" -> vendedor.html');
ok(/regulamento\.html/.test(rodape) && /youtube\.com\/channel/.test(rodape), 'index.html: links antigos do rodape continuam');
ok(/Esse código já tem vendas: se não é você, escolha outro \(ex\.: joao-silva\)\./.test(vendHtml), 'vendedor.html traz o aviso "esse codigo ja tem vendas"');

function semComentarios(t) { return t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); }
const vendLimpo = semComentarios(vendHtml);
ok(/<title>Indique e ganhe cotas grátis/.test(vendHtml) && /<h1[^>]*>Indique e ganhe cotas grátis<\/h1>/.test(vendHtml), 'vendedor.html: titulo "Indique e ganhe cotas grátis"');
ok(/Seu nome ou apelido/.test(vendHtml), 'campo "Seu nome ou apelido"');
ok(/<ol class="vend-passos">(?:[\s\S]*?<li>){3}/.test(vendHtml) && !/<ol class="vend-passos">(?:[\s\S]*?<li>){4}/.test(vendHtml.split('</ol>')[0] + '</ol>'), 'explica em exatamente 3 passos');
ok(/pagas e confirmadas pelo seu link/.test(vendHtml), 'passo 3: cotas pagas e confirmadas pelo seu link');
ok(/entregue pelo organizador durante as vendas/.test(vendHtml) && /Não há pagamento em dinheiro/.test(vendHtml), 'texto honesto: bonus entregue pelo organizador, sem dinheiro');
ok(/href="regulamento\.html"/.test(vendHtml), 'link para o regulamento');
ok(/id="voltarCartela" href="\.\/"/.test(vendHtml) && (vendHtml.match(/href="\.\/"/g) || []).length >= 2, 'botao de voltar para a cartela');
ok(/<script src="assets\/config\.js">/.test(vendHtml) && /<link rel="stylesheet" href="assets\/style\.css/.test(vendHtml), 'usa config.js e a mesma folha de estilo do site');
ok(!/prefers-color-scheme|data-theme|dark|tema escuro/i.test(vendLimpo), 'sem tema escuro');
ok(/<meta name="color-scheme" content="light">/.test(vendHtml), 'declara color-scheme claro');
const cfgPix = cfgBox.window.RIFA_CONFIG.PIX_KEY;
ok(!vendHtml.includes(cfgPix) && !/chave pix|copia e cola|BR\.GOV\.BCB/i.test(vendHtml), 'vendedor.html nao traz chave Pix');
ok(!/\bsenha\b|password|ADMIN_TOKEN|\btoken\b/i.test(vendLimpo), 'vendedor.html sem senha/token');
// fontes: tudo >= 16px (1rem)
const estilo = (vendHtml.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const tamanhos = [...estilo.matchAll(/font-size:\s*([\d.]+)(rem|px|em)/g)].map((m) => (m[2] === 'px' ? Number(m[1]) : Number(m[1]) * 16));
ok(tamanhos.length >= 8 && tamanhos.every((t) => t >= 16), 'toda font-size do vendedor.html e >= 16px (' + tamanhos.join(',') + ')');
ok(!/font-size:\s*(small|smaller|x-small)/.test(estilo) && !/<small|<sub|<sup/.test(vendLimpo), 'sem texto pequeno por tag');
[
  [/avisado na hora/i], [/ganhador[^.\n]{0,40}na hora/i], [/100% (oficial|auditad)/i], [/auditad[oa]/i], [/mude de vida/i],
  [/garantid[oa]/i], [/[uú]ltimas cotas/i], [/lucro|dinheiro f[aá]cil|renda extra/i], [/ganhe dinheiro|comiss[aã]o|sal[aá]rio/i]
].forEach(([re]) => ok(!re.test(vendLimpo), 'vendedor.html sem frase proibida ' + re));
ok(/^\s*<!doctype html>/i.test(vendHtml), 'vendedor.html com doctype');

// ---------- 3) DOM simulado ----------
function makeEl(id, hiddenInicial) {
  const el = {
    id, hidden: !!hiddenInicial, textContent: '', innerHTML: '', value: '', disabled: false, children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
    classes: new Set(), width: 0, height: 0, className: '', clicked: 0, focused: 0, selected: 0,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { if (c && c.__frag) { this.children.push(...c.children); c.children = []; } else this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    focus() { this.focused += 1; }, blur() {}, select() { this.selected += 1; }, setSelectionRange() {}, click() { this.clicked += 1; }, scrollIntoView() {}, reset() {}, remove() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    toBlob(cb, type) { cb({ size: 123, type }); },
    getContext() {
      const self = this;
      if (!self.__ctx) {
        self.__ctx = {
          fillStyle: '#000', font: '', rects: [], texts: [],
          fillRect(x, y, w, h) { this.rects.push({ x, y, w, h }); },
          fillText(t) { this.texts.push(String(t)); },
          measureText(t) { return { width: String(t).length * 11 }; }
        };
      }
      return self.__ctx;
    }
  };
  el.classList = {
    add: (...c) => c.forEach((x) => el.classes.add(x)), remove: (...c) => c.forEach((x) => el.classes.delete(x)),
    contains: (c) => el.classes.has(c), toggle: (c, f) => { const on = f === undefined ? !el.classes.has(c) : !!f; on ? el.classes.add(c) : el.classes.delete(c); return on; }
  };
  return el;
}

function ambienteBase(htmlTexto, opts) {
  const idsDoHtml = new Set([...htmlTexto.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
  const idsHidden = new Set([...htmlTexto.matchAll(/<[^>]*\sid="([A-Za-z0-9_-]+)"[^>]*\shidden(?=[\s>])/g)].map((m) => m[1]));
  const els = {};
  const created = [];
  const getEl = (id) => { if (!idsDoHtml.has(id)) return null; if (!els[id]) els[id] = makeEl(id, idsHidden.has(id)); return els[id]; };
  idsDoHtml.forEach((id) => getEl(id)); // todos os elementos existem desde o inicio
  const docListeners = {};
  const document = {
    getElementById: getEl,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener() {},
    createElement: (tag) => { const e = makeEl('(novo ' + tag + ')'); e.tag = tag; created.push(e); return e; },
    createDocumentFragment: () => { const f = makeEl('(frag)'); f.__frag = true; return f; },
    querySelector: () => null, querySelectorAll: () => [], contains: () => false,
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null,
    execCommand: () => !!opts.execCommandCopia
  };
  const storage = Object.assign({}, opts.storageInicial || {});
  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: opts.clipboard, userAgent: 'teste' },
    location: { search: opts.search || '', href: 'https://acaoentreamigos.pages.dev/' + (opts.pagina || 'index.html') + (opts.search || ''), origin: 'https://acaoentreamigos.pages.dev', hash: '', protocol: 'https:', pathname: '/' + (opts.pagina || 'index.html') },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    URLSearchParams, Promise, Blob: function () {}, File: function (parts, nome, o) { this.name = nome; this.type = o && o.type; },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Date, Math, JSON, Number, String, Array, Object, Set, Map, Intl, Error, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, RegExp
  };
  if (!opts.semStorage) {
    sandbox.localStorage = opts.storageQuebrado
      ? { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, removeItem() { throw new Error('bloqueado'); } }
      : { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } };
  }
  sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.getComputedStyle = () => ({});
  vm.createContext(sandbox);
  return { els, created, storage, sandbox, docListeners };
}

// ----- 3a) cartela publica (assets/app.js) -----
// opts: { search, storageInicial, semStorage, storageQuebrado }
function envCartela(opts) {
  opts = opts || {};
  const env = ambienteBase(html, opts);
  env.calls = { reservar: [] };
  env.sandbox.fetch = async (url, o) => {
    const body = JSON.parse(o.body);
    if (body.action === 'listar') return { text: async () => JSON.stringify({ ok: true, numeros: [] }) };
    if (body.action === 'reservar') { env.calls.reservar.push(body); return { text: async () => JSON.stringify({ ok: true, numeros: body.numeros }) }; }
    return { text: async () => JSON.stringify({ ok: false, error: 'nao usado' }) };
  };
  vm.runInContext(cfgJs, env.sandbox);
  vm.runInContext(read('assets/qrcode-generator.js'), env.sandbox);
  vm.runInContext(appJs, env.sandbox);
  return env;
}
async function iniciarCartela(opts) {
  const env = envCartela(opts);
  (env.docListeners.DOMContentLoaded || []).forEach((fn) => fn());
  await settle();
  return env;
}
async function reservarUma(env, n) {
  env.els.panelSelect.value = String(Math.floor(n / 100));
  env.els.panelSelect.listeners.change[0]();
  const chip = env.els.numbersGrid.children.find((c) => c.attrs['data-number'] === String(n));
  ok(!!chip && !chip.disabled, 'cota ' + n + ' livre na grade');
  env.els.numbersGrid.listeners.click[0]({ target: { closest: () => chip } });
  env.els.nome.value = 'Maria da Silva'; env.els.whatsapp.value = '22 99283-9362';
  await env.els.reserveForm.listeners.submit[0]({ preventDefault() {} });
  await settle();
}

(async () => {
  // ---------- captura do link ----------
  {
    const env = await iniciarCartela({ search: '?v=Joao-Silva' });
    ok(env.storage.acao_indicador === 'joao-silva', '?v= e sanitizado e guardado em acao_indicador');
    await reservarUma(env, 5);
    ok(env.calls.reservar.length === 1, 'a reserva foi enviada');
    ok(env.calls.reservar[0].indicador === 'joao-silva', 'a reserva leva indicador = joao-silva');
    ok(env.calls.reservar[0].numeros.join() === '5' && env.calls.reservar[0].nome === 'Maria da Silva', 'o resto do payload continua igual');
  }
  {
    const env = await iniciarCartela({ search: '?ref=MARIA%20DA%20LUZ' });
    ok(env.storage.acao_indicador === 'maria-da-luz', '?ref= tambem vale (sanitizado)');
    await reservarUma(env, 6);
    ok(env.calls.reservar[0].indicador === 'maria-da-luz', 'reserva leva o indicador vindo de ?ref=');
  }
  {
    const env = await iniciarCartela({ search: '?ref=outro&v=primeiro' });
    ok(env.storage.acao_indicador === 'primeiro', '?v= tem prioridade sobre ?ref=');
  }
  {
    // visita seguinte, sem ?v= na URL: usa o que ficou guardado
    const env = await iniciarCartela({ search: '', storageInicial: { acao_indicador: 'Joao-Silva' } });
    await reservarUma(env, 7);
    ok(env.calls.reservar[0].indicador === 'joao-silva', 'sem ?v= na URL, usa o codigo guardado de antes');
  }
  {
    // ?v= invalido nao apaga o codigo guardado
    const env = await iniciarCartela({ search: '?v=a', storageInicial: { acao_indicador: 'ze-pedro' } });
    ok(env.storage.acao_indicador === 'ze-pedro', '?v= invalido (1 caractere) nao apaga o codigo guardado');
    await reservarUma(env, 8);
    ok(env.calls.reservar[0].indicador === 'ze-pedro', 'e a reserva usa o guardado');
  }
  {
    // lixo guardado e sanitizado antes de ir para o servidor
    const env = await iniciarCartela({ search: '', storageInicial: { acao_indicador: '<b>X</b>' } });
    await reservarUma(env, 9);
    ok(env.calls.reservar[0].indicador === 'bxb', 'valor guardado e sanitizado de novo antes de enviar');
  }
  {
    const env = await iniciarCartela({ search: '' });
    await reservarUma(env, 10);
    ok(env.calls.reservar.length === 1 && !('indicador' in env.calls.reservar[0]), 'sem codigo, o campo indicador NAO vai na reserva');
    ok(!('acao_indicador' in env.storage), 'sem codigo, nada e guardado');
  }
  {
    const env = await iniciarCartela({ search: '?v=%20%20&ref=' });
    await reservarUma(env, 11);
    ok(!('indicador' in env.calls.reservar[0]), 'codigo vazio/invalido na URL: sem indicador');
  }
  {
    const env = await iniciarCartela({ search: '?v=ana-lima', semStorage: true });
    await reservarUma(env, 12);
    ok(env.calls.reservar[0].indicador === 'ana-lima', 'sem localStorage (indefinido) o codigo vale nesta visita');
  }
  {
    const env = await iniciarCartela({ search: '?v=ana-lima', storageQuebrado: true });
    await reservarUma(env, 13);
    ok(env.calls.reservar[0].indicador === 'ana-lima', 'localStorage que da erro: o codigo vale nesta visita e nada quebra');
  }
  {
    // quem clica no link nao ve nada novo: mesma quantidade de elementos criados e mesmos textos de aviso
    const com = await iniciarCartela({ search: '?v=joao-silva' });
    const sem = await iniciarCartela({ search: '' });
    ok(com.created.length === sem.created.length, 'o link com ?v= nao cria nenhum elemento a mais na tela (sem banner)');
    const textos = (e) => Object.values(e.els).map((x) => x.id + '|' + x.textContent + '|' + x.hidden).join('\n');
    ok(textos(com) === textos(sem), 'nenhum texto da cartela muda por causa do ?v=');
    ok(!/joao-silva/.test(textos(com)), 'o codigo nao aparece em lugar nenhum da tela');
  }

  // ----- 3b) pagina vendedor.html -----
  // opts: { respostas: [fn|obj], storageInicial, clipboard, execCommandCopia, storageQuebrado, semStorage }
  function envVendedor(opts) {
    opts = opts || {};
    opts.pagina = 'vendedor.html';
    const env = ambienteBase(vendHtml, opts);
    env.fetchUrls = [];
    const respostas = (opts.respostas || []).slice();
    env.sandbox.fetch = async (url) => {
      env.fetchUrls.push(url);
      const r = respostas.length > 1 ? respostas.shift() : respostas[0];
      if (r === 'rede') throw new TypeError('Failed to fetch');
      if (r === 'html') return { text: async () => '<html>erro</html>' };
      return { text: async () => JSON.stringify(r) };
    };
    env.proximas = respostas;
    const blocos = [{ textContent: '' }, { textContent: '' }];
    env.blocos = blocos; env.bonusBlocos = [{ textContent: '' }];
    env.sandbox.document.querySelectorAll = (sel) => (sel === '[data-cotas-bloco]' ? env.blocos : sel === '[data-bonus-bloco]' ? env.bonusBlocos : []);
    vm.runInContext(cfgJs, env.sandbox);
    vm.runInContext(inlineVend[1], env.sandbox);
    return env;
  }
  const resp = (o) => Object.assign({ ok: true, codigo: 'joao-silva', cotas_pagas: 0, cotas_pendentes: 0, blocos_fechados: 0, bonus_ganho: 0, bonus_entregue: 0, bonus_a_entregar: 0, faltam_para_proximo: 100, cotas_por_bloco: 100, bonus_por_bloco: 5 }, o || {});
  async function gerarCodigo(env, nome) {
    env.els.vendNome.value = nome;
    env.els.vendNome.listeners.input.forEach((fn) => fn());
    await env.els.vendForm.listeners.submit[0]({ preventDefault() { env.prevented = true; } });
    await settle();
  }
  const vis = (env, id) => env.els[id].hidden === false;

  // estado inicial
  {
    const env = envVendedor({ respostas: [resp()] });
    ok(env.fetchUrls.length === 0, 'ao abrir sem codigo guardado, nao consulta nada');
    ok(!vis(env, 'linkCard') && !vis(env, 'progressoCard'), 'link e progresso nascem escondidos');
    ok(env.blocos.every((b) => b.textContent === '100') && env.bonusBlocos[0].textContent === '5', 'os numeros 100 e 5 da pagina vem do config.js (INDICACAO)');
  }

  // gera codigo e link; 0/100
  {
    const env = envVendedor({ respostas: [resp()] });
    await gerarCodigo(env, 'João Silva');
    ok(env.prevented === true, 'o formulario nao recarrega a pagina');
    ok(env.els.vendDica.textContent === 'Seu código será: joao-silva', 'dica ao digitar mostra o codigo sanitizado');
    ok(env.els.codigoTexto.textContent === 'joao-silva', 'mostra o codigo gerado');
    ok(env.els.linkCampo.value === 'https://acaoentreamigos.pages.dev/?v=joao-silva', 'link = <origem>/?v=<codigo>');
    ok(vis(env, 'linkCard'), 'cartao do link aparece');
    ok(env.storage.acao_vendedor_codigo === 'joao-silva', 'guarda o ultimo codigo para a proxima visita');
    ok(env.fetchUrls.length === 1 && /\?action=vendedor&codigo=joao-silva$/.test(env.fetchUrls[0]) && env.fetchUrls[0].startsWith(cfgBox.window.RIFA_CONFIG.API_URL), 'consulta GET action=vendedor&codigo= na API do config');
    ok(!/senha|password|token/i.test(env.fetchUrls[0]), 'a consulta nao leva senha');
    const wa = env.els.whatsBtn.getAttribute('href');
    ok(wa.startsWith('https://wa.me/?text='), 'botao do WhatsApp usa wa.me com texto');
    const msg = decodeURIComponent(wa.slice('https://wa.me/?text='.length));
    ok(msg.includes('https://acaoentreamigos.pages.dev/?v=joao-silva'), 'a mensagem do WhatsApp leva o link do vendedor');
    ok(!msg.includes(cfgBox.window.RIFA_CONFIG.PIX_KEY) && !/chave|pix/i.test(msg), 'a mensagem do WhatsApp nao leva chave Pix');
    ok(msg.length < 220, 'mensagem curta');
    ok(env.els.whatsBtn.getAttribute('rel') === 'noopener noreferrer' || /noopener/.test(vendHtml.match(/id="whatsBtn"[^>]*>/)[0]), 'link do WhatsApp com noopener');
    // progresso 0/100
    ok(vis(env, 'progressoCard') && vis(env, 'consultaOk') && !vis(env, 'consultaErro') && !vis(env, 'consultando'), 'progresso 0: so o resultado aparece');
    ok(env.els.cotasPagas.textContent === '0' && env.els.noBloco.textContent === '0' && env.els.blocoTotal.textContent === '100', '0 de 100');
    ok(env.els.barra.getAttribute('aria-valuenow') === '0' && env.els.barraPreench.style.width === '0%', 'barra vazia (0%)');
    ok(env.els.faltamTexto.textContent === 'Faltam 100 cotas pagas para o próximo bloco de 100.', 'faltam 100');
    ok(env.els.bonusGanho.textContent === '0' && env.els.bonusEntregue.textContent === '0' && env.els.bonusReceber.textContent === '0', 'bonus 0 / 0 / 0');
    ok(!vis(env, 'codigoUsado') && !vis(env, 'pendentesTexto'), 'codigo sem vendas: sem aviso de "ja tem vendas"');
  }

  // copiar
  {
    const copiados = [];
    const env = envVendedor({ respostas: [resp()], clipboard: { writeText: async (t) => { copiados.push(t); } } });
    await gerarCodigo(env, 'joao-silva');
    ok(vendHtml.includes('id="copiarBtn"') && env.els.copiarBtn.listeners.click.length === 1, 'botao Copiar ligado');
    env.els.copiarBtn.listeners.click[0](); await settle();
    ok(copiados.length === 1 && copiados[0] === 'https://acaoentreamigos.pages.dev/?v=joao-silva', 'copia o link para a area de transferencia');
    ok(vis(env, 'copiaAviso') && /Link copiado/.test(env.els.copiaAviso.textContent), 'avisa "Link copiado"');
  }
  {
    // sem clipboard, mas com execCommand
    const env = envVendedor({ respostas: [resp()], execCommandCopia: true });
    await gerarCodigo(env, 'joao-silva');
    env.els.copiarBtn.listeners.click[0](); await settle();
    ok(env.els.linkCampo.selected === 1 && /Link copiado/.test(env.els.copiaAviso.textContent), 'plano B: seleciona o campo e copia por execCommand');
  }
  {
    // nada funciona: orienta a copiar na mao
    const env = envVendedor({ respostas: [resp()], clipboard: { writeText: async () => { throw new Error('negado'); } } });
    await gerarCodigo(env, 'joao-silva');
    env.els.copiarBtn.listeners.click[0](); await settle();
    ok(/Não consegui copiar/.test(env.els.copiaAviso.textContent) && !/Link copiado/.test(env.els.copiaAviso.textContent), 'copia negada: nao diz que copiou, orienta a copiar na mao');
  }

  // 37/100 + codigo que ja tem vendas
  {
    const env = envVendedor({ respostas: [resp({ cotas_pagas: 37, cotas_pendentes: 3, faltam_para_proximo: 63 })] });
    await gerarCodigo(env, 'Joao Silva');
    ok(env.els.cotasPagas.textContent === '37' && env.els.noBloco.textContent === '37', '37 de 100');
    ok(env.els.barra.getAttribute('aria-valuenow') === '37' && env.els.barraPreench.style.width === '37%', 'barra em 37%');
    ok(env.els.faltamTexto.textContent === 'Faltam 63 cotas pagas para o próximo bloco de 100.', 'faltam 63');
    ok(vis(env, 'codigoUsado') && /Esse código já tem vendas: se não é você, escolha outro \(ex\.: joao-silva\)\./.test(env.els.codigoUsado.textContent || vendHtml), 'aviso "esse codigo ja tem vendas" quando acabou de digitar');
    ok(vis(env, 'pendentesTexto') && /3 cotas reservadas/.test(env.els.pendentesTexto.textContent) && /Só contam quando o organizador confirmar/.test(env.els.pendentesTexto.textContent), 'pendentes explicadas: so contam quando o organizador confirmar');
    ok(env.els.bonusGanho.textContent === '0' && env.els.bonusReceber.textContent === '0', 'ainda sem bonus');
  }
  {
    // so pendentes (nenhuma paga) tambem avisa
    const env = envVendedor({ respostas: [resp({ cotas_pendentes: 1 })] });
    await gerarCodigo(env, 'Fulano');
    ok(vis(env, 'codigoUsado') && /1 cota reservada com o seu código está esperando/.test(env.els.pendentesTexto.textContent), 'so pendentes: avisa que o codigo ja tem uso (singular certo)');
  }

  // 100/100 -> bonus
  {
    const env = envVendedor({ respostas: [resp({ cotas_pagas: 100, blocos_fechados: 1, bonus_ganho: 5, bonus_entregue: 2, bonus_a_entregar: 3, faltam_para_proximo: 100 })] });
    await gerarCodigo(env, 'joao-silva');
    ok(env.els.cotasPagas.textContent === '100' && env.els.noBloco.textContent === '100' && env.els.blocoTotal.textContent === '100', '100 de 100');
    ok(env.els.barra.getAttribute('aria-valuenow') === '100' && env.els.barraPreench.style.width === '100%', 'barra cheia');
    ok(/^Bloco completo!/.test(env.els.faltamTexto.textContent) && /faltam 100 cotas pagas/.test(env.els.faltamTexto.textContent), 'bloco completo; proximo bloco comeca do zero');
    ok(env.els.bonusGanho.textContent === '5' && env.els.bonusEntregue.textContent === '2' && env.els.bonusReceber.textContent === '3', 'bonus: 5 ganho, 2 entregue, 3 a receber');
  }
  {
    // 205 pagas: 2 blocos, 5 no terceiro
    const env = envVendedor({ respostas: [resp({ cotas_pagas: 205, blocos_fechados: 2, bonus_ganho: 10, bonus_entregue: 10, bonus_a_entregar: 0, faltam_para_proximo: 95 })] });
    await gerarCodigo(env, 'joao-silva');
    ok(env.els.cotasPagas.textContent === '205' && env.els.noBloco.textContent === '5' && env.els.barra.getAttribute('aria-valuenow') === '5', '205 pagas = 5 no bloco atual');
    ok(env.els.bonusGanho.textContent === '10' && env.els.bonusReceber.textContent === '0', 'bonus 10 ganho, 0 a receber');
  }
  {
    // 1 cota falta: singular
    const env = envVendedor({ respostas: [resp({ cotas_pagas: 99, faltam_para_proximo: 1 })] });
    await gerarCodigo(env, 'joao-silva');
    ok(env.els.faltamTexto.textContent === 'Faltam 1 cota paga para o próximo bloco de 100.', 'faltam 1 cota (singular)');
  }

  // erros da API
  {
    const env = envVendedor({ respostas: ['rede', resp({ cotas_pagas: 10, faltam_para_proximo: 90 })] });
    await gerarCodigo(env, 'joao-silva');
    ok(vis(env, 'consultaErro') && !vis(env, 'consultaOk') && !vis(env, 'consultando'), 'API fora do ar: mostra o erro, nao os numeros');
    ok(/Não foi possível consultar/.test(env.els.consultaErroTexto.textContent), 'texto do erro em portugues');
    ok(vis(env, 'linkCard') && env.els.linkCampo.value.endsWith('/?v=joao-silva'), 'mesmo com erro o link continua disponivel');
    ok(!/https?:|Failed|TypeError/.test(env.els.consultaErroTexto.textContent), 'o erro tecnico nao vaza para a tela');
    await env.els.tentarDeNovo.listeners.click[0](); await settle();
    ok(vis(env, 'consultaOk') && !vis(env, 'consultaErro') && env.els.cotasPagas.textContent === '10', '"Tentar de novo" consulta outra vez e mostra os numeros');
    ok(!vis(env, 'codigoUsado'), 'ao tentar de novo nao repete o aviso de "ja tem vendas"');
  }
  {
    const env = envVendedor({ respostas: [{ ok: false, error: 'Informe o seu código (2 a 24 letras ou números).' }] });
    await gerarCodigo(env, 'joao-silva');
    ok(vis(env, 'consultaErro') && !vis(env, 'consultaOk'), 'API devolveu ok:false: estado de erro');
  }
  {
    const env = envVendedor({ respostas: ['html'] });
    await gerarCodigo(env, 'joao-silva');
    ok(vis(env, 'consultaErro') && !vis(env, 'consultaOk'), 'resposta que nao e JSON: estado de erro');
  }

  // nome invalido
  {
    const env = envVendedor({ respostas: [resp()] });
    await gerarCodigo(env, 'a');
    ok(env.fetchUrls.length === 0 && !vis(env, 'linkCard'), 'nome curto demais: nao consulta e nao gera link');
    ok(vis(env, 'vendErro') && env.els.vendNome.getAttribute('aria-invalid') === 'true' && env.els.vendNome.focused >= 1, 'mostra o erro, marca o campo e leva o foco para ele');
    ok(env.els.vendDica.textContent === 'Use pelo menos 2 letras ou números.', 'dica explica o minimo');
    await gerarCodigo(env, '   ');
    ok(env.fetchUrls.length === 0 && !('acao_vendedor_codigo' in env.storage), 'campo em branco: nada guardado');
    await gerarCodigo(env, 'Zé');
    ok(!vis(env, 'vendErro') && env.els.codigoTexto.textContent === 'ze' && env.fetchUrls.length === 1, 'corrigiu o nome: erro some e o codigo "ze" funciona');
  }

  // volta na proxima visita
  {
    const env = envVendedor({ respostas: [resp({ cotas_pagas: 37, faltam_para_proximo: 63 })], storageInicial: { acao_vendedor_codigo: 'joao-silva' } });
    await settle();
    ok(env.els.vendNome.value === 'joao-silva', 'proxima visita: o ultimo codigo ja vem no campo');
    ok(env.fetchUrls.length === 1 && vis(env, 'linkCard') && env.els.cotasPagas.textContent === '37', 'proxima visita: link e progresso aparecem sozinhos');
    ok(!vis(env, 'codigoUsado'), 'proxima visita: NAO avisa "ja tem vendas" (nao acabou de digitar)');
  }
  {
    // codigo guardado e lixo: ignora
    const env = envVendedor({ respostas: [resp()], storageInicial: { acao_vendedor_codigo: '#' } });
    await settle();
    ok(env.fetchUrls.length === 0 && !vis(env, 'linkCard'), 'codigo guardado invalido e ignorado');
  }
  {
    // chave do vendedor e a do comprador sao diferentes
    const env = envVendedor({ respostas: [resp()], storageInicial: { acao_indicador: 'quem-me-indicou' } });
    await settle();
    ok(env.fetchUrls.length === 0 && env.els.vendNome.value === '', 'o codigo de quem INDICOU o visitante (acao_indicador) nao vira o codigo dele');
  }

  // sem storage / storage quebrado
  for (const quebra of [{ semStorage: true }, { storageQuebrado: true }]) {
    const env = envVendedor(Object.assign({ respostas: [resp({ cotas_pagas: 1, faltam_para_proximo: 99 })] }, quebra));
    await gerarCodigo(env, 'joao-silva');
    ok(vis(env, 'linkCard') && vis(env, 'consultaOk') && env.els.cotasPagas.textContent === '1', 'funciona sem localStorage (' + Object.keys(quebra)[0] + ')');
  }

  // origem aberta como arquivo: usa o endereco publico
  {
    const env = envVendedor({ respostas: [resp()] });
    env.sandbox.location.origin = 'null';
    await gerarCodigo(env, 'joao-silva');
    ok(env.els.linkCampo.value === 'https://acaoentreamigos.pages.dev/?v=joao-silva', 'origem invalida (arquivo local): usa o endereco publico do site');
  }
  {
    const env = envVendedor({ respostas: [resp()] });
    env.sandbox.location.origin = 'http://localhost:8000';
    await gerarCodigo(env, 'joao-silva');
    ok(env.els.linkCampo.value === 'http://localhost:8000/?v=joao-silva', 'link usa a origem de onde a pagina foi aberta');
  }

  // config diferente muda os numeros da pagina
  {
    const env = ambienteBase(vendHtml, { pagina: 'vendedor.html' });
    env.sandbox.fetch = async () => ({ text: async () => JSON.stringify(resp()) });
    env.blocos = [{ textContent: '' }]; env.bonusBlocos = [{ textContent: '' }];
    env.sandbox.document.querySelectorAll = (sel) => (sel === '[data-cotas-bloco]' ? env.blocos : env.bonusBlocos);
    vm.runInContext(cfgJs + '\nwindow.RIFA_CONFIG.INDICACAO = { cotasPorBloco: 50, bonusPorBloco: 3 };', env.sandbox);
    vm.runInContext(inlineVend[1], env.sandbox);
    ok(env.blocos[0].textContent === '50' && env.bonusBlocos[0].textContent === '3' && env.els.blocoTotal.textContent === '50', 'os numeros da pagina seguem o INDICACAO do config.js');
  }

  console.log('PASS: programa de vendedores verificado (' + checks + ' checks).');
})().catch((e) => { console.error(e); process.exit(1); });
