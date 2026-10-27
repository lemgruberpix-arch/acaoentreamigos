// "Meus numeros" + recibo da cartela publica (index.html + assets/app.js), sem navegador e sem rede:
// roda o app.js num DOM simulado com fetch falso e confere o que a pessoa ve.
// Cobre: funciona sem localStorage; 3 estados (paga / aguardando / liberada) e os mistos; recibo SO se TODAS as cotas estao pagas;
// WhatsApp mascarado (so os 4 ultimos digitos); valor e numeros certos; nada de dados de outras pessoas; sem senha; limite de 20
// reservas e limpeza de reservas com mais de 90 dias; rebusca da situacao ao abrir; falha de rede nao libera recibo.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const html = read('index.html');
const css = read('assets/style.css');
const appJs = read('assets/app.js');
const cfgJs = read('assets/config.js');
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }
const nb = (t) => String(t).replace(/ /g, ' ');

// ---------- 1) Estatico ----------
ok(/<button[^>]*id="meusBtn"[^>]*>Meus números<\/button>/.test(html), 'botao "Meus números" no topo');
ok(/\.meus-btn\s*\{[^}]*min-height:\s*44px/.test(css), 'botao "Meus números" tem alvo de toque >= 44 px');
ok(/id="meusModal"[^>]*aria-hidden="true"/.test(html) && /role="dialog" aria-modal="true" aria-labelledby="meusTitle"/.test(html), 'painel e um dialogo acessivel, nasce fechado');
ok(/id="meusEmpty"[^>]*hidden/.test(html), 'aviso de "sem reservas" nasce escondido');
const vazio = html.slice(html.indexOf('id="meusEmpty"'));
ok(/Não há reservas neste aparelho\. Se você pagou, fale com o responsável pelo WhatsApp\./.test(vazio), 'texto de "sem reservas neste aparelho"');
ok(/<a [^>]*href="https:\/\/wa\.me\/5522992839362[^"]*"/.test(vazio.slice(0, 900)), 'aviso de "sem reservas" traz o link wa.me ja existente');
ok(appJs.includes('Gerado neste aparelho a partir da situação pública das cotas (pagas na cartela). Sorteio pela Loteria Federal; regras em regulamento.html.'), 'texto fixo do recibo (exato)');
ok(appJs.includes('Recibo de participação — Ação Entre Amigos'), 'titulo do recibo');
const trechoMeus = html.slice(html.indexOf('id="meusModal"'), html.indexOf('Fallback de Configura'));
[['index.html (painel)', trechoMeus], ['app.js', appJs]].forEach(([nome, t]) => {
  ok(!/recibo oficial|comprovante fiscal|nota fiscal|100% oficial/i.test(t), nome + ': nao chama o recibo de oficial/fiscal');
  ok(!/\bsenha\b|password|\btoken\b|ADMIN_TOKEN/i.test(t), nome + ': sem senha/token');
  ok(!/avisado na hora|auditad|garantid[oa]|mude de vida|últimas cotas/i.test(t), nome + ': sem frases proibidas');
});
const iLib = html.search(/<script src="assets\/qrcode-generator\.js/);
const iApp = html.search(/<script src="assets\/app\.js/);
ok(iLib > 0 && iLib < iApp, 'qrcode-generator.js antes do app.js');

// ---------- 2) DOM simulado ----------
const idsDoHtml = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
const idsHidden = new Set([...html.matchAll(/<[^>]*\sid="([A-Za-z0-9_-]+)"[^>]*\shidden(?=[\s>])/g)].map((m) => m[1]));

function makeEl(id) {
  const el = {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
    classes: new Set(), width: 0, height: 0, className: '', clicked: 0,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { if (c && c.__frag) { this.children.push(...c.children); c.children = []; } else this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    focus() {}, blur() {}, click() { this.clicked += 1; }, scrollIntoView() {}, reset() {}, remove() {},
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

// opts: { situacao: {numero: {status, nome?, whatsapp?}}, listarFalha: bool, semStorage: bool, storageQuebrado: bool, share: bool }
function makeEnv(opts) {
  opts = opts || {};
  const els = {};
  const created = [];
  const calls = { listar: 0, reservar: 0, outras: [] };
  const getEl = (id) => { if (!idsDoHtml.has(id)) return null; if (!els[id]) { els[id] = makeEl(id); els[id].hidden = idsHidden.has(id); } return els[id]; };
  const docListeners = {};
  const document = {
    getElementById: getEl,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener() {},
    createElement: (tag) => { const e = makeEl('(novo ' + tag + ')'); e.tag = tag; created.push(e); return e; },
    createDocumentFragment: () => { const f = makeEl('(frag)'); f.__frag = true; return f; },
    querySelector: () => null, querySelectorAll: () => [], contains: () => false,
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null
  };
  const storage = {};
  const state = { situacao: opts.situacao || {}, listarFalha: !!opts.listarFalha };
  const fetchFalso = async (url, o) => {
    const body = JSON.parse(o.body);
    if (body.action === 'listar') {
      calls.listar += 1;
      if (state.listarFalha) throw new TypeError('Failed to fetch');
      const numeros = Object.entries(state.situacao).map(([n, v]) => Object.assign({ numero: Number(n), status: v.status, comprovante_url: '' }, v.extra || {}));
      return { text: async () => JSON.stringify({ ok: true, numeros }) };
    }
    if (body.action === 'reservar') { calls.reservar += 1; return { text: async () => JSON.stringify({ ok: true, numeros: body.numeros }) }; }
    calls.outras.push(body.action);
    return { text: async () => JSON.stringify({ ok: false, error: 'nao usado' }) };
  };
  const compartilhado = [];
  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: Object.assign({ clipboard: { writeText: async () => {} }, userAgent: 'teste' }, opts.share ? { share: async (d) => { compartilhado.push(d); } } : {}),
    location: { search: '', href: 'http://localhost/index.html', origin: 'http://localhost', hash: '', protocol: 'http:', pathname: '/index.html' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    URLSearchParams, Promise, fetch: fetchFalso, Blob: function () {}, File: function (parts, nome, o) { this.name = nome; this.type = o && o.type; },
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
  vm.runInContext(cfgJs, sandbox);
  vm.runInContext(read('assets/qrcode-generator.js'), sandbox);
  vm.runInContext(appJs, sandbox);
  return { els, created, calls, state, storage, sandbox, docListeners, compartilhado };
}

const sleep = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 30; i += 1) await sleep(); }
async function iniciar(opts) {
  const env = makeEnv(opts);
  const erros = [];
  process.on('unhandledRejection', (e) => erros.push(e));
  (env.docListeners.DOMContentLoaded || []).forEach((fn) => fn());
  await settle();
  env.erros = erros;
  return env;
}
async function reservar(env, numeros, nome, whats) {
  for (const n of numeros) {
    env.els.panelSelect.value = String(Math.floor(n / 100));
    env.els.panelSelect.listeners.change[0]();
    const chip = env.els.numbersGrid.children.find((c) => c.attrs['data-number'] === String(n));
    ok(!!chip && !chip.disabled, 'cota ' + n + ' livre na grade para reservar');
    env.els.numbersGrid.listeners.click[0]({ target: { closest: () => chip } });
  }
  env.els.nome.value = nome; env.els.whatsapp.value = whats;
  await env.els.reserveForm.listeners.submit[0]({ preventDefault() {} });
  await settle();
  env.els.successModal.setAttribute('aria-hidden', 'true'); // "fechou" a janela do Pix
}
async function abrirMeus(env) { await env.els.meusBtn.listeners.click[0](); await settle(); }
function artigos(env) { return env.els.meusList.innerHTML.split('<article').slice(1).map((a) => '<article' + a); }
function achar(env, num4) { const a = artigos(env).filter((x) => x.includes('<b>' + num4 + '</b>')); ok(a.length === 1, 'reserva com a cota ' + num4 + ' aparece uma vez'); return a[0]; }
function texto(htmlStr) { return nb(htmlStr.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')); }
function botaoDoArtigo(env, art, act) {
  const m = art.match(new RegExp('data-act="' + act + '" data-res-id="([^"]+)"'));
  if (!m) return null;
  return { getAttribute: (k) => (k === 'data-act' ? act : k === 'data-res-id' ? m[1] : null) };
}
async function clicar(env, btn) { await env.els.meusList.listeners.click[0]({ target: { closest: () => btn } }); await settle(); }
function recibosDesenhados(env) { return env.created.filter((c) => c.tag === 'canvas' && c.__ctx && c.__ctx.texts.some((t) => /Recibo de participa/.test(t))); }
function linhas(canvas) { return nb(canvas.__ctx.texts.join(' | ')); }

(async () => {
  const OUTRO = { nome: 'ZEQUINHA_ISCA', whatsapp: '21977776666', observacao: 'OBS_ISCA', comprovante_url: 'https://drive.example/segredo' };

  // ---------- 3) Os 3 estados, mistos, rebusca e recibo ----------
  {
    const situacao = {
      7: { status: 'pago' }, 12: { status: 'pago' }, 40: { status: 'pago' },        // R1: tudo pago
      100: { status: 'reservado' },                                                  // R2: aguardando
      // R3 [200, 201]: nada (livre = liberada)
      300: { status: 'pago' }, 301: { status: 'reservado' },                         // R4: pago + reservado
      400: { status: 'pago' }, // R5 [400, 401]: pago + livre
      9001: { status: 'pago', extra: OUTRO }, 9002: { status: 'reservado', extra: OUTRO } // de outras pessoas
    };
    const env = await iniciar({});
    ok(env.els.meusBtn.listeners.click.length === 1, 'botao "Meus números" ligado');
    await reservar(env, [7, 12, 40], 'Maria da Silva', '22 99283-9362');
    await reservar(env, [100], 'Maria da Silva', '22 99283-9362');
    await reservar(env, [200, 201], 'Maria da Silva', '22 99283-9362');
    await reservar(env, [300, 301], 'Maria da Silva', '22 99283-9362');
    await reservar(env, [400, 401], 'Maria da Silva', '22 99283-9362');
    Object.assign(env.state.situacao, situacao); // o servidor passa a mostrar pagas/reservadas
    const salvo = JSON.parse(env.storage['rifa-minhas-reservas-v2']);
    ok(Array.isArray(salvo) && salvo.length === 5, 'localStorage guarda uma LISTA com as 5 reservas');
    const reg = salvo.find((r) => r.numeros.includes(7));
    ok(Object.keys(reg).sort().join(',') === 'criado_em,id,nome,numeros,total,whatsapp', 'registro tem so id, numeros, total, nome, whatsapp, criado_em');
    ok(reg.nome === 'Maria da Silva' && reg.whatsapp === '22 99283-9362' && reg.total === 50 && reg.numeros.join() === '7,12,40', 'nome e WhatsApp como digitados; total e numeros certos');
    ok(!/senha|token/i.test(env.storage['rifa-minhas-reservas-v2']), 'nada de senha no armazenamento');

    const listarAntes = env.calls.listar;
    await abrirMeus(env);
    ok(env.calls.listar > listarAntes, 'ao abrir "Meus números" a situacao e REBUSCADA (listar chamado de novo)');
    ok(env.calls.outras.length === 0, 'nenhuma acao nova no servidor (so listar/reservar)');
    ok(env.els.meusModal.getAttribute('aria-hidden') === 'false', 'painel abriu');
    ok(env.els.meusList.hidden === false && env.els.meusEmpty.hidden === true, 'lista visivel, aviso de vazio escondido');
    ok(artigos(env).length === 5, 'cinco reservas na lista');

    const r1 = achar(env, '0007'); const t1 = texto(r1);
    ['0007', '0012', '0040'].forEach((n) => ok(t1.includes(n), 'R1 mostra a cota ' + n + ' com 4 digitos'));
    ok(/paga/.test(t1) && !/reservada|liberada/.test(t1), 'R1: todas "paga"');
    ok(t1.includes('Pagamento confirmado') && t1.includes('3 cotas') && t1.includes('R$ 50,00'), 'R1: "Pagamento confirmado", 3 cotas, R$ 50,00');
    ok(/data-act="receipt"[^>]*>Gerar recibo</.test(r1), 'R1: botao "Gerar recibo" aparece (todas pagas)');

    const r2 = achar(env, '0100'); const t2 = texto(r2);
    ok(t2.includes('Aguardando a confirmação do Pix') && /reservada/.test(t2) && t2.includes('1 cota') && t2.includes('R$ 18,90'), 'R2: aguardando a confirmacao do Pix, cota reservada, R$ 18,90');
    ok(!/Gerar recibo|Pagamento confirmado|Reserva liberada/.test(r2), 'R2: sem recibo e sem "confirmado/liberada"');
    ok(/data-act="pay"/.test(r2), 'R2: oferece "Ver Pix para pagar"');

    const r3 = achar(env, '0200'); const t3 = texto(r3);
    ok(t3.includes('Reserva liberada (o prazo acabou ou o organizador liberou)') && t3.includes('0201') && /liberada/.test(t3), 'R3: reserva liberada (texto exato), cotas "liberada"');
    ok(!/Gerar recibo|Pagamento confirmado|Aguardando/.test(r3), 'R3: sem recibo, sem "confirmado", sem "aguardando"');

    const r4 = achar(env, '0300'); const t4 = texto(r4);
    ok(t4.includes('Aguardando a confirmação do Pix') && /paga/.test(t4) && /reservada/.test(t4), 'R4 (paga + reservada): aguardando');
    ok(!/Gerar recibo|Pagamento confirmado/.test(r4), 'R4: SEM recibo e sem "Pagamento confirmado"');

    const r5 = achar(env, '0400'); const t5 = texto(r5);
    ok(/liberada \(o prazo acabou ou o organizador liberou\)/.test(t5) && /paga/.test(t5), 'R5 (paga + livre): parte liberada');
    ok(!/Gerar recibo|Pagamento confirmado/.test(r5), 'R5: SEM recibo');

    ok((env.els.meusList.innerHTML.match(/Gerar recibo/g) || []).length === 1, 'so UMA reserva (a toda paga) tem "Gerar recibo"');
    const tudo = env.els.meusList.innerHTML + env.els.meusStatus.textContent;
    ['ZEQUINHA_ISCA', '21977776666', 'OBS_ISCA', 'drive.example', '9001', '9002'].forEach((x) => ok(!tudo.includes(x), 'dado de outra pessoa "' + x + '" NAO aparece em "Meus números"'));
    ok(!/senha|token/i.test(tudo), 'sem senha/token na tela');

    // ---- guarda no clique: mesmo forjando o botao, reserva nao paga nao gera recibo
    const antes = recibosDesenhados(env).length;
    await clicar(env, { getAttribute: (k) => (k === 'data-act' ? 'receipt' : JSON.parse(env.storage['rifa-minhas-reservas-v2']).find((r) => r.numeros.includes(100)).id) });
    ok(recibosDesenhados(env).length === antes, 'forjar o botao numa reserva NAO paga nao gera recibo');
    ok(/só sai quando todas as cotas/.test(env.els.statusMessageText.textContent), 'e avisa por que');
    await clicar(env, { getAttribute: (k) => (k === 'data-act' ? 'receipt' : JSON.parse(env.storage['rifa-minhas-reservas-v2']).find((r) => r.numeros.includes(300)).id) });
    ok(recibosDesenhados(env).length === antes, 'forjar o botao numa reserva meio paga NAO gera recibo');

    // ---- recibo da reserva paga
    const btn = botaoDoArtigo(env, r1, 'receipt');
    await clicar(env, btn);
    const rec = recibosDesenhados(env);
    ok(rec.length === 1, 'recibo desenhado uma vez');
    const L = linhas(rec[0]);
    ok(L.includes('Recibo de participação — Ação Entre Amigos'), 'recibo: titulo');
    ok(L.includes('Maria da Silva'), 'recibo: nome como digitado');
    ok(L.includes('22 9****-9362') && !/99283|992839362|9928/.test(L), 'recibo: WhatsApp mascarado (so os 4 ultimos digitos)');
    ok(L.includes('0007, 0012, 0040'), 'recibo: lista de numeros com 4 digitos');
    ok(/\| 3 \|/.test(L), 'recibo: quantidade 3');
    ok(L.includes('R$ 50,00'), 'recibo: valor total R$ 50,00');
    ok(/\d{2}\/\d{2}\/\d{4}[ ,]+\d{2}:\d{2}/.test(L), 'recibo: data e hora da geracao');
    ok(nb(rec[0].__ctx.texts.join(' ')).includes('Gerado neste aparelho a partir da situação pública das cotas (pagas na cartela). Sorteio pela Loteria Federal; regras em regulamento.html.'), 'recibo: texto fixo');
    ok(L.includes('acaoentreamigos.pages.dev'), 'recibo: endereco do site');
    ok(!/oficial|fiscal|senha|token/i.test(L), 'recibo: nao se diz oficial/fiscal e nao traz senha');
    ['ZEQUINHA_ISCA', '21977776666', '9001', '9002', '0100', '0200', '0300', '0400'].forEach((x) => ok(!L.includes(x), 'recibo: sem dados/cotas de outras reservas ("' + x + '")'));
    const baixou = env.created.filter((c) => c.tag === 'a' && c.download === 'recibo-acao-entre-amigos.png' && c.clicked === 1);
    ok(baixou.length === 1, 'recibo baixado como PNG (recibo-acao-entre-amigos.png)');
    ok(/Recibo salvo/.test(env.els.statusMessageText.textContent), 'avisa que o recibo foi salvo');
    ok(!/Compartilhar recibo/.test(env.els.meusList.innerHTML), 'sem navigator.share: so o botao de baixar');

    // ---- vira pago depois: ao reabrir, a situacao e rebuscada e o recibo aparece
    env.state.situacao[100] = { status: 'pago' };
    await abrirMeus(env);
    ok(/Gerar recibo/.test(achar(env, '0100')) && /Pagamento confirmado/.test(achar(env, '0100')), 'R2 virou paga no servidor: ao reabrir mostra "Pagamento confirmado" + recibo');
    // ---- e volta a livre (organizador liberou)
    delete env.state.situacao[100];
    await abrirMeus(env);
    ok(/Reserva liberada/.test(achar(env, '0100')) && !/Gerar recibo/.test(achar(env, '0100')), 'R2 voltou a livre: "Reserva liberada" e sem recibo');

    // ---- rebusca falha: nao libera recibo com dado velho
    env.state.listarFalha = true;
    await abrirMeus(env);
    ok(env.els.meusStatus.hidden === false && /Não foi possível atualizar agora/.test(env.els.meusStatus.textContent), 'falha de rede: aviso claro');
    ok(!/Gerar recibo/.test(env.els.meusList.innerHTML), 'falha de rede: NENHUM botao de recibo (dado nao conferido agora)');
    ok(/Toque em Atualizar situação para liberar o recibo/.test(achar(env, '0007')), 'falha de rede: reserva paga avisa para atualizar');
    env.state.listarFalha = false;
    await env.els.meusRefreshBtn.listeners.click[0](); await settle();
    ok(/Gerar recibo/.test(achar(env, '0007')) && env.els.meusStatus.hidden === true, 'Atualizar situação: volta o recibo e some o aviso');

    // ---- Esc fecha; "Ver Pix" abre a janela do Pix
    env.docListeners.keydown[0]({ key: 'Escape' });
    ok(env.els.meusModal.getAttribute('aria-hidden') === 'true', 'Esc fecha o painel');
    await abrirMeus(env);
    env.state.situacao[100] = { status: 'reservado' };
    await env.els.meusRefreshBtn.listeners.click[0](); await settle();
    await clicar(env, botaoDoArtigo(env, achar(env, '0100'), 'pay'));
    ok(env.els.meusModal.getAttribute('aria-hidden') === 'true' && env.els.successModal.getAttribute('aria-hidden') === 'false', '"Ver Pix para pagar" fecha o painel e abre a janela do Pix');
    ok(env.els.modalNumbers.textContent === '0100' && /18/.test(env.els.pixCopyPaste.value) && /540518\.90/.test(env.els.pixCopyPaste.value), 'janela do Pix com a cota 0100 e o valor R$ 18,90');
    ok(env.erros.length === 0, 'nenhuma excecao solta');
  }

  // ---------- 4) Compartilhar (quando o aparelho tem navigator.share) ----------
  {
    const env = await iniciar({ share: true });
    await reservar(env, [5], 'Joao Pedro', '(22) 99999-1234');
    env.state.situacao[5] = { status: 'pago' };
    await abrirMeus(env);
    const art = achar(env, '0005');
    ok(/Gerar recibo/.test(art) && /data-act="share"[^>]*>Compartilhar recibo</.test(art), 'com navigator.share: aparecem "Gerar recibo" e "Compartilhar recibo"');
    await clicar(env, botaoDoArtigo(env, art, 'share'));
    ok(env.compartilhado.length === 1 && env.compartilhado[0].files && env.compartilhado[0].files.length === 1 && /Recibo de participação/.test(env.compartilhado[0].title), 'compartilhar chama navigator.share com o PNG');
    const L = linhas(recibosDesenhados(env)[0]);
    ok(L.includes('22 9****-1234') && L.includes('R$ 18,90') && L.includes('0005'), 'recibo compartilhado: WhatsApp mascarado, valor e numero certos');
  }

  // ---------- 5) Mascara do WhatsApp em varios formatos ----------
  {
    const formatos = [['22 99283-9362', '22 9****-9362'], ['(22) 99283-9362', '22 9****-9362'], ['+55 22 99283-9362', '22 9****-9362'], ['5522992839362', '22 9****-9362'], ['2292839362', '22 ****-9362']];
    const agora = new Date().toISOString();
    const lista = formatos.map(([w], i) => ({ id: 'f' + i, numeros: [500 + i], total: 20, nome: 'Fulano ' + i, whatsapp: w, criado_em: agora }));
    const sit = {}; lista.forEach((r) => { sit[r.numeros[0]] = { status: 'pago' }; });
    const env = makeEnv({ situacao: sit });
    env.storage['rifa-minhas-reservas-v2'] = JSON.stringify(lista);
    (env.docListeners.DOMContentLoaded || []).forEach((fn) => fn());
    await settle();
    await abrirMeus(env);
    for (let i = 0; i < formatos.length; i += 1) {
      const art = achar(env, '0' + (500 + i));
      await clicar(env, botaoDoArtigo(env, art, 'receipt'));
      const c = recibosDesenhados(env)[i];
      const L = linhas(c);
      ok(L.includes(formatos[i][1]), 'mascara de "' + formatos[i][0] + '" -> "' + formatos[i][1] + '"');
      ok(!/\d{5}-\d{4}/.test(L) && !L.includes('99283'), 'recibo nunca traz o numero inteiro (' + formatos[i][0] + ')');
    }
  }

  // ---------- 6) Sem reservas / sem localStorage / localStorage bloqueado ----------
  {
    const env = await iniciar({});
    await abrirMeus(env);
    ok(env.els.meusEmpty.hidden === false && env.els.meusList.hidden === true && env.els.meusRefreshBtn.hidden === true, 'sem reservas: mostra o aviso "Não há reservas neste aparelho" (e esconde lista/atualizar)');
  }
  for (const [rotulo, opts] of [['sem localStorage', { semStorage: true }], ['localStorage bloqueado', { storageQuebrado: true }]]) {
    const env = await iniciar(opts);
    ok(env.erros.length === 0, rotulo + ': o app carrega sem excecao');
    ok(env.els.numbersGrid.children.length > 0, rotulo + ': a cartela carrega');
    await abrirMeus(env);
    ok(env.els.meusEmpty.hidden === false, rotulo + ': painel abre e diz que nao ha reservas');
    await reservar(env, [21], 'Ana Lima', '22 98888-7777');
    env.state.situacao[21] = { status: 'pago' };
    ok(env.erros.length === 0, rotulo + ': reservar funciona');
    await abrirMeus(env);
    const art = achar(env, '0021');
    ok(/Pagamento confirmado/.test(art) && /Gerar recibo/.test(art), rotulo + ': a reserva desta visita aparece (guardada na memoria) e gera recibo');
  }

  // ---------- 7) Limite de 20 reservas e limpeza de 90 dias ----------
  {
    const DIA = 24 * 60 * 60 * 1000;
    const velha = (n, dias) => ({ id: 'x' + n, numeros: [1000 + n], total: 20, nome: 'N' + n, whatsapp: '22 90000-000' + (n % 10), criado_em: new Date(Date.now() - dias * DIA).toISOString() });
    const seed = [];
    for (let n = 0; n < 25; n += 1) seed.push(velha(n, n)); // 25 reservas, de 0 a 24 dias
    seed.push(velha(90, 100), velha(91, 91), velha(92, 200)); // 3 com mais de 90 dias
    seed.push({ id: 'lixo', numeros: 'abc', criado_em: 'hoje' }, null, 'texto');
    const env = makeEnv({});
    env.storage['rifa-minhas-reservas-v2'] = JSON.stringify(seed);
    (env.docListeners.DOMContentLoaded || []).forEach((fn) => fn());
    await settle();
    await abrirMeus(env);
    ok(artigos(env).length === 20, 'mostra no maximo 20 reservas (tinha 25 validas)');
    ok(!/1090|1091|1092/.test(env.els.meusList.innerHTML), 'reservas com mais de 90 dias nao aparecem');
    ok(!/lixo/.test(env.els.meusList.innerHTML), 'registros invalidos ignorados');
    await reservar(env, [3], 'Nova Pessoa', '22 97777-6666');
    const salvo = JSON.parse(env.storage['rifa-minhas-reservas-v2']);
    ok(salvo.length === 20, 'ao salvar uma nova, a lista guardada continua com 20');
    ok(salvo[0].numeros.join() === '3', 'a nova reserva fica no topo');
    ok(salvo.every((r) => Date.now() - new Date(r.criado_em).getTime() <= 90 * DIA), 'nada com mais de 90 dias fica guardado');
  }

  // ---------- 8) Nunca carregou as cotas: nao afirma nada ----------
  {
    const env = await iniciar({ listarFalha: true });
    env.storage['rifa-minhas-reservas-v2'] = JSON.stringify([{ id: 'a1', numeros: [8], total: 20, nome: 'Rita', whatsapp: '22 95555-4444', criado_em: new Date().toISOString() }]);
    await abrirMeus(env);
    const art = achar(env, '0008');
    ok(/Situação indisponível agora/.test(art) && !/Pagamento confirmado|Gerar recibo|Aguardando|liberada/.test(art.replace(/Situação indisponível agora[^<]*/, '')), 'sem conseguir conferir: "Situação indisponível", sem confirmar nem liberar nada');
  }

  console.log('PASS: meus numeros e recibo verificado (' + checks + ' checks).');
})().catch((e) => { console.error(e); process.exit(1); });
