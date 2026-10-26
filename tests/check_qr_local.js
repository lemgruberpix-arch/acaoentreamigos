// QR Code local: o site gera o QR no proprio navegador (sem api.qrserver.com nem outro terceiro).
// Roda sem rede e sem navegador: app.js + qrcode-generator.js num DOM simulado com canvas falso que GRAVA o que foi desenhado.
// Confere: nenhuma referencia a servico externo de QR; script carrega antes do app.js; a matriz desenhada e valida
// (tamanho 17+4*versao, 3 marcadores de localizacao, margem de 4 modulos, fundo branco, >= 220 px) e e EXATAMENTE a do texto do
// "copia e cola"; valor R$ 60,00 -> campo 54 = "60.00"; chave sem valor -> sem campo 54 e CRC16 fecha; falha da biblioteca nao quebra a pagina.
// (A leitura por um decodificador real de QR e feita a parte, no navegador, com zxing.)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }

const html = read('index.html');
const appJs = read('assets/app.js');
const cfgJs = read('assets/config.js');
const libJs = read('assets/qrcode-generator.js');

// ---------- 1) Estatico ----------
const publicos = ['index.html', 'regulamento.html', 'cartaz.html', 'canvas-instagram.html', 'assets/app.js', 'assets/config.js', 'assets/style.css', 'assets/qrcode-generator.js'];
publicos.forEach((f) => {
  const t = read(f);
  ok(!/qrserver/i.test(t), f + ': nao referencia api.qrserver.com');
  ok(!/chart\.googleapis\.com\/chart\?cht=qr|quickchart\.io\/qr|goqr\.me|qr-code-generator\.com/i.test(t), f + ': nao referencia outro servico externo de QR');
});
ok(!/rel="preconnect"[^>]*qr/i.test(html) && !/<link[^>]*rel="preconnect"/i.test(html), 'index.html: sem <link rel=preconnect> para terceiros');
ok(!/buildQrUrl/.test(appJs), 'app.js: buildQrUrl removida');
const iLib = html.search(/<script src="assets\/qrcode-generator\.js/);
const iApp = html.search(/<script src="assets\/app\.js/);
ok(iLib > 0 && iApp > 0 && iLib < iApp, 'index.html: qrcode-generator.js carrega ANTES do app.js');
ok(fs.existsSync(path.join(ROOT, 'assets', 'qrcode-generator.LICENSE.txt')) && /MIT/.test(read('assets/qrcode-generator.LICENSE.txt')) && /Kazuhiko Arase/.test(read('assets/qrcode-generator.LICENSE.txt')), 'licenca MIT da biblioteca esta em assets/');
ok(/window\.qrcode/.test(appJs) && /lib\(0, ?"M"\)/.test(appJs), 'app.js: usa window.qrcode(0,"M") (versao automatica, correcao M)');
ok(/id="pixQrCode"/.test(html) && /<canvas[^>]*id="pixQrCode"/.test(html), 'janela do Pix: QR e um <canvas id="pixQrCode">');
ok(/id="pixHomeQr"/.test(html) && /<canvas[^>]*id="pixHomeQr"/.test(html), 'tela inicial: QR da chave e um <canvas id="pixHomeQr">');
ok(/<canvas[^>]*id="pixQrCode"[^>]*aria-label="[^"]+"/.test(html) && /<canvas[^>]*id="pixHomeQr"[^>]*aria-label="[^"]+"/.test(html), 'os dois QR tem texto alternativo (aria-label)');
ok(/Abra o app do seu banco, escolha Pix, e cole ou aponte a câmera para o QR\./.test(html), 'texto de apoio da tela inicial');
ok(/id="copyPixBtn">Copiar chave Pix</.test(html) && /id="copyPixStaticBtn">Copiar código Pix \(copia e cola\)</.test(html), 'tela inicial: botoes "Copiar chave Pix" e "Copiar código Pix (copia e cola)"');
ok(/Valor a pagar: <strong id="modalTotal">/.test(html), 'janela do Pix: "Valor a pagar" em destaque no topo');
const blocoPix = html.slice(html.indexOf('id="pixBox"'), html.indexOf('share-btn'));
const janelaPix = html.slice(html.indexOf('id="successModal"'), html.indexOf('id="meusModal"'));
ok(blocoPix.length > 500 && janelaPix.length > 500, 'blocos do Pix localizados no HTML');
ok(!/WELINGTON|ALMIR|LEMGRUBER|SANTOS/i.test(blocoPix + janelaPix), 'bloco do Pix e janela do Pix nao imprimem nome de pessoa');

// ---------- 2) Ferramentas independentes ----------
function crc16(str) { let c = 0xffff; for (let i = 0; i < str.length; i += 1) { c ^= str.charCodeAt(i) << 8; for (let j = 0; j < 8; j += 1) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c.toString(16).toUpperCase().padStart(4, '0'); }
function tlv(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2); const len = Number(s.slice(i + 2, i + 4));
    ok(Number.isInteger(len) && i + 4 + len <= s.length, 'TLV bem formado em ' + id);
    out.push([id, s.slice(i + 4, i + 4 + len)]); i += 4 + len;
  }
  return out;
}
const libCtx = { module: undefined }; libCtx.window = libCtx; vm.createContext(libCtx); vm.runInContext(libJs, libCtx);
const qrLib = libCtx.qrcode;
ok(typeof qrLib === 'function', 'biblioteca expoe o global qrcode');
function esperada(texto) { const q = qrLib(0, 'M'); q.addData(texto); q.make(); const n = q.getModuleCount(); return { n, dark: (r, c) => q.isDark(r, c) }; }

// ---------- 3) DOM simulado com canvas que grava os desenhos ----------
const idsDoHtml = new Set([...html.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]));
const idsHidden = new Set([...html.matchAll(/<[^>]*\sid="([A-Za-z0-9_-]+)"[^>]*\shidden(?=[\s>])/g)].map((m) => m[1]));

function makeEl(id) {
  const el = {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, children: [], attrs: {}, listeners: {}, style: {}, dataset: {},
    classes: new Set(), width: 0, height: 0,
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { if (c && c.__frag) { this.children.push(...c.children); c.children = []; } else this.children.push(c); return c; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, contains() { return false; },
    focus() {}, blur() {}, click() {}, scrollIntoView() {}, reset() {}, remove() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
    getContext() {
      const self = this;
      if (!self.__ctx) {
        self.__ctx = {
          fillStyle: '#000', font: '', rects: [], texts: [],
          fillRect(x, y, w, h) { this.rects.push({ x, y, w, h, color: this.fillStyle, W: self.width, H: self.height }); },
          fillText(t, x, y) { this.texts.push(String(t)); },
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

function makeEnv(opts) {
  opts = opts || {};
  const els = {};
  const getEl = (id) => { if (!idsDoHtml.has(id)) return null; if (!els[id]) { els[id] = makeEl(id); els[id].hidden = idsHidden.has(id); } return els[id]; };
  const docListeners = {};
  const document = {
    getElementById: getEl,
    addEventListener(type, fn) { (docListeners[type] = docListeners[type] || []).push(fn); },
    removeEventListener() {},
    createElement: (tag) => { const e = makeEl('(novo ' + tag + ')'); e.tag = tag; return e; },
    createDocumentFragment: () => { const f = makeEl('(frag)'); f.__frag = true; return f; },
    querySelector: () => null, querySelectorAll: () => [], contains: () => false,
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null
  };
  const storage = {};
  const copied = [];
  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {}, info() {} },
    localStorage: { getItem: (k) => (k in storage ? storage[k] : null), setItem: (k, v) => { storage[k] = String(v); }, removeItem: (k) => { delete storage[k]; } },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: { clipboard: { writeText: async (t) => { copied.push(t); } }, userAgent: 'teste' },
    location: { search: '', href: 'http://localhost/index.html', origin: 'http://localhost', hash: '', protocol: 'http:', pathname: '/index.html' },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, requestAnimationFrame: () => 0,
    URLSearchParams, Promise, fetch: opts.fetch, Blob: function () {}, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
    Date, Math, JSON, Number, String, Array, Object, Set, Map, Intl, Error, parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, RegExp
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  sandbox.addEventListener = () => {}; sandbox.removeEventListener = () => {}; sandbox.getComputedStyle = () => ({});
  vm.createContext(sandbox);
  vm.runInContext(cfgJs, sandbox);
  if (opts.lib === 'ok') vm.runInContext(libJs, sandbox);
  if (opts.lib === 'quebrada') vm.runInContext('window.qrcode = function () { return { addData() {}, make() { throw new Error("falhou"); }, getModuleCount() { return 0; }, isDark() { return false; } }; };', sandbox);
  vm.runInContext(appJs, sandbox);
  return { els, getEl, sandbox, docListeners, storage, copied };
}

const sleep = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 30; i += 1) await sleep(); }

function fetchFalso(valorTotalServidor) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.action === 'listar') return { text: async () => JSON.stringify({ ok: true, numeros: [] }) };
    if (body.action === 'reservar') {
      const r = { ok: true, numeros: body.numeros };
      if (valorTotalServidor !== undefined) r.valor_total = valorTotalServidor;
      return { text: async () => JSON.stringify(r) };
    }
    return { text: async () => JSON.stringify({ ok: false, error: 'nao usado' }) };
  };
}

async function iniciar(opts) {
  const env = makeEnv(opts);
  (env.docListeners.DOMContentLoaded || []).forEach((fn) => fn());
  await settle();
  return env;
}

async function reservar(env, numeros, nome, whats) {
  for (const n of numeros) {
    const chip = env.els.numbersGrid.children.find((c) => c.attrs['data-number'] === String(n));
    ok(!!chip, 'cota ' + n + ' aparece na grade');
    env.els.numbersGrid.listeners.click[0]({ target: { closest: () => chip } });
  }
  env.els.nome.value = nome; env.els.whatsapp.value = whats;
  await env.els.reserveForm.listeners.submit[0]({ preventDefault() {} });
  await settle();
}

// reconstroi a matriz a partir dos retangulos gravados e valida a geometria
function lerCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  ok(W >= 220 && canvas.height === W, 'canvas quadrado com >= 220 px (tem ' + W + ')');
  const fundo = ctx.rects[0];
  ok(fundo.x === 0 && fundo.y === 0 && fundo.w === W && fundo.h === W && fundo.color === '#ffffff', 'fundo branco cobrindo o canvas inteiro');
  const escuros = ctx.rects.slice(1);
  ok(escuros.length > 0 && escuros.every((r) => r.color === '#000000'), 'modulos escuros em preto');
  const s = escuros[0].w;
  ok(s >= 1 && escuros.every((r) => r.w === s && r.h === s && r.x % s === 0 && r.y % s === 0), 'modulos quadrados, em pixels inteiros (' + s + ' px)');
  ok(W % s === 0, 'tamanho do canvas e multiplo do modulo');
  const total = W / s;
  const n = total - 8;
  ok(escuros.every((r) => r.x >= 4 * s && r.x < W - 4 * s && r.y >= 4 * s && r.y < W - 4 * s), 'margem (quiet zone) de 4 modulos livre de pixels escuros');
  const m = Array.from({ length: n }, () => new Array(n).fill(false));
  escuros.forEach((r) => { m[r.y / s - 4][r.x / s - 4] = true; });
  return { n, m, versao: (n - 17) / 4, escuros: escuros.length };
}
const FINDER = ['1111111', '1000001', '1011101', '1011101', '1011101', '1000001', '1111111'];
function conferirMarcadores(g, rotulo) {
  const { n, m } = g;
  ok(Number.isInteger(g.versao) && g.versao >= 1 && g.versao <= 40, rotulo + ': tamanho = 17+4*versao (n=' + n + ', versao ' + g.versao + ')');
  [[0, 0, 'topo-esquerdo'], [0, n - 7, 'topo-direito'], [n - 7, 0, 'base-esquerdo']].forEach(([r0, c0, nome]) => {
    let igual = true;
    for (let r = 0; r < 7; r += 1) for (let c = 0; c < 7; c += 1) if (m[r0 + r][c0 + c] !== (FINDER[r][c] === '1')) igual = false;
    ok(igual, rotulo + ': marcador de localizacao ' + nome);
  });
  // separadores claros ao lado dos marcadores
  let sep = true;
  for (let i = 0; i < 8; i += 1) { if (m[7][i] || m[i][7]) sep = false; if (m[7][n - 1 - i] || m[i][n - 8]) sep = false; if (m[n - 8][i] || m[n - 1 - i][7]) sep = false; }
  ok(sep, rotulo + ': separadores claros em volta dos marcadores');
  ok(m[n - 8][8] === true, rotulo + ': modulo escuro fixo (padrao do QR)');
}
function conferirMesmoTexto(g, texto, rotulo) {
  const e = esperada(texto);
  ok(e.n === g.n, rotulo + ': mesma versao do QR do texto (' + e.n + ' modulos)');
  let dif = 0;
  for (let r = 0; r < e.n; r += 1) for (let c = 0; c < e.n; c += 1) if (e.dark(r, c) !== g.m[r][c]) dif += 1;
  ok(dif === 0, rotulo + ': a matriz desenhada e IDENTICA a do texto do copia e cola (diferencas: ' + dif + ')');
  const outro = esperada(texto.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')));
  let dif2 = 0;
  for (let r = 0; r < Math.min(e.n, outro.n); r += 1) for (let c = 0; c < Math.min(e.n, outro.n); c += 1) if (outro.dark(r, c) !== g.m[r][c]) dif2 += 1;
  ok(outro.n !== e.n || dif2 > 0, rotulo + ': (sanidade) texto diferente daria matriz diferente');
}

(async () => {
  // ---------- 4) Tela inicial: QR da chave, sem valor ----------
  {
    const env = await iniciar({ fetch: fetchFalso(), lib: 'ok' });
    const canvas = env.els.pixHomeQr;
    ok(canvas.hidden === false && env.els.pixHomeQrFallback.hidden === true, 'tela inicial: QR visivel, aviso de falha escondido');
    ok(/QR Code da chave Pix/.test(canvas.attrs['aria-label']) && canvas.attrs.role === 'img', 'tela inicial: alt claro (role=img + aria-label)');
    await env.els.copyPixStaticBtn.listeners.click[0]();
    ok(env.copied.length === 1, 'botao "Copiar código Pix" copiou algo');
    const code = env.copied[0];
    const campos = tlv(code);
    const mapa = Object.fromEntries(campos);
    ok(!('54' in mapa), 'chave sem valor: NAO tem campo 54');
    ok(code.slice(-8, -4) === '6304' && code.slice(-4) === crc16(code.slice(0, -4)), 'chave sem valor: CRC16 fecha');
    ok(campos[campos.length - 1][0] === '63', 'campo CRC e o ultimo');
    const conta = Object.fromEntries(tlv(mapa['26']));
    ok(conta['00'] === 'br.gov.bcb.pix' && conta['01'] === env.sandbox.RIFA_CONFIG.PIX_KEY, 'chave dentro do codigo == PIX_KEY');
    ok(mapa['59'] === 'ACAO ENTRE AMIGOS' && mapa['58'] === 'BR' && mapa['53'] === '986', 'recebedor ACAO ENTRE AMIGOS, pais e moeda');
    ok(!/WELINGTON|ALMIR|LEMGRUBER/i.test(code), 'nenhum nome de pessoa no codigo');
    const g = lerCanvas(canvas);
    conferirMarcadores(g, 'QR da chave');
    conferirMesmoTexto(g, code, 'QR da chave');
    await env.els.copyPixBtn.listeners.click[0]();
    ok(env.copied[1] === env.sandbox.RIFA_CONFIG.PIX_KEY, '"Copiar chave Pix" copia so a chave');
  }

  // ---------- 5) Janela do Pix apos reservar: QR com o valor ----------
  for (const [rotulo, servidor, esperado] of [['3 cotas pelo preco do site', undefined, '50.00'], ['servidor devolve R$ 60,00', 60, '60.00']]) {
    const env = await iniciar({ fetch: fetchFalso(servidor), lib: 'ok' });
    await reservar(env, [7, 12, 40], 'Maria da Silva', '22 99283-9362');
    ok(env.els.successModal.getAttribute('aria-hidden') === 'false', rotulo + ': janela do Pix abriu');
    const code = env.els.pixCopyPaste.value;
    const campos = tlv(code);
    const mapa = Object.fromEntries(campos);
    ok(mapa['54'] === esperado, rotulo + ': campo 54 = ' + esperado + ' (veio ' + mapa['54'] + ')');
    ok(code.slice(-4) === crc16(code.slice(0, -4)) && code.slice(-8, -4) === '6304', rotulo + ': CRC16 fecha');
    ok(/^R\$\s?\d+,\d{2}$/.test(env.els.modalTotal.textContent.replace(/ /g, ' ')), rotulo + ': "Valor a pagar" preenchido (' + env.els.modalTotal.textContent + ')');
    ok(env.els.modalTotal.textContent.replace(/ /g, ' ') === 'R$ ' + esperado.replace('.', ','), rotulo + ': valor em reais bate com o campo 54');
    const canvas = env.els.pixQrCode;
    ok(canvas.hidden === false && env.els.pixQrFallback.hidden === true, rotulo + ': QR visivel e aviso de falha escondido');
    ok(/QR Code Pix no valor de R\$/.test(canvas.attrs['aria-label']), rotulo + ': alt do QR cita o valor');
    const g = lerCanvas(canvas);
    conferirMarcadores(g, rotulo);
    conferirMesmoTexto(g, code, rotulo);
    await env.els.copyPixPayloadBtn.listeners.click[0]();
    await settle();
    ok(env.copied[env.copied.length - 1] === code, rotulo + ': botao copia exatamente o texto do copia e cola');
    ok(/Já vai com o valor de R\$/.test(env.els.statusMessageText.textContent), rotulo + ': aviso diz que o codigo ja leva o valor');
  }

  // ---------- 6) Falha da biblioteca nao quebra a pagina ----------
  for (const modo of ['ausente', 'quebrada']) {
    const env = await iniciar({ fetch: fetchFalso(), lib: modo === 'ausente' ? 'nenhuma' : 'quebrada' });
    ok(env.els.pixHomeQr.hidden === true && env.els.pixHomeQrFallback.hidden === false, 'biblioteca ' + modo + ': tela inicial esconde o QR e mostra o aviso');
    ok(env.els.numbersGrid.children.length > 0, 'biblioteca ' + modo + ': a cartela carrega normalmente');
    await env.els.copyPixStaticBtn.listeners.click[0]();
    ok(env.copied.length === 1 && env.copied[0].length > 50, 'biblioteca ' + modo + ': "copia e cola" da chave continua copiando');
    await reservar(env, [3], 'Joao', '22 98888-7777');
    ok(env.els.successModal.getAttribute('aria-hidden') === 'false', 'biblioteca ' + modo + ': a janela do Pix abre mesmo assim');
    ok(env.els.pixQrCode.hidden === true && env.els.pixQrFallback.hidden === false, 'biblioteca ' + modo + ': janela mostra so o aviso no lugar do QR');
    ok(/^000201/.test(env.els.pixCopyPaste.value) && /20\.00/.test(env.els.pixCopyPaste.value), 'biblioteca ' + modo + ': copia e cola com valor continua na tela');
    ok(/id="pixQrFallback"[^>]*>[^<]*copia e cola/i.test(html) && /id="pixHomeQrFallback"[^>]*>[^<]*código Pix/i.test(html), 'biblioteca ' + modo + ': avisos (texto fixo no HTML) mandam usar o copia e cola');
  }

  console.log('PASS: QR local verificado (' + checks + ' checks).');
})().catch((e) => { console.error(e); process.exit(1); });
