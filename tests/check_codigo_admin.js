// Contrato do backend (apps-script/codigo.gs) para o painel administrativo.
// Roda o Apps Script em um sandbox com planilha simulada: sem rede, sem Google.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

// GS_FILE permite rodar o mesmo contrato contra o artefato de producao (publicar/saida/codigo_PRODUCAO.gs).
const SOURCE = fs.readFileSync(process.env.GS_FILE || path.join(__dirname, '..', 'apps-script', 'codigo.gs'), 'utf8');
const COLS = ['numero', 'status', 'nome', 'whatsapp', 'valor', 'data_reserva', 'data_pagamento',
  'observacao', 'comprovante_nome', 'comprovante_url', 'data_comprovante', 'comprovante_tipo'];

function load(passwordMode, token) {
  const source = SOURCE.replace(/const ADMIN_EXIGE_SENHA = (true|false);/, 'const ADMIN_EXIGE_SENHA = ' + passwordMode + ';');
  assert(source.includes('ADMIN_EXIGE_SENHA = ' + passwordMode), 'flag ADMIN_EXIGE_SENHA nao encontrada em codigo.gs');

  const rows = [
    COLS.slice(),
    [5, 'reservado', 'Ana', '21999999999', 20, new Date('2026-10-01'), '', '', '', '', '', ''],
    [3, 'pago', 'Bia', '21988888888', 17, new Date('2026-10-02'), new Date('2026-10-03'), '', 'c.jpg', 'https://drive.example/c', '', 'image/jpeg'],
    [9, 'livre', '', '', '', '', '', '', '', '', '', '']
  ];
  const sheet = {
    getLastColumn: () => COLS.length,
    getLastRow: () => rows.length,
    setFrozenRows() {},
    autoResizeColumns() {},
    getRange(r, c, n, m) {
      return {
        getValues: () => rows.slice(r - 1, r - 1 + n).map((row) => { const out = row.slice(c - 1, c - 1 + m); while (out.length < m) out.push(''); return out; }),
        setValues(values) { values.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }); },
        setFontWeight() { return this; },
        setBackground() { return this; }
      };
    }
  };
  const props = token ? { ADMIN_TOKEN: token } : {};
  const cache = {};
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; } }) },
    ContentService: { createTextOutput: (text) => ({ text, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {},
    Session: {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const get = (params) => JSON.parse(ctx.doGet({ parameter: params }).text);
  return { post, get, rows };
}

let checks = 0;
function ok(condition, message) { assert(condition, message); checks += 1; }

// --- Modo teste (sem senha) ---------------------------------------------
{
  const api = load(false);

  const list = api.post({ action: 'listarAdmin' });
  ok(list.ok === true, 'listarAdmin deve funcionar no modo teste');
  ok(Array.isArray(list.reservas), 'listarAdmin retorna reservas[]');
  ok(JSON.stringify(list.reservas.map((r) => r.numero)) === '[3,5]', 'reservas ordenadas e sem cotas livres');
  const ana = list.reservas.find((r) => r.numero === 5);
  ok(ana.nome === 'Ana' && ana.whatsapp === '21999999999' && ana.valor === 20, 'listarAdmin traz nome, whatsapp e valor');
  const bia = list.reservas.find((r) => r.numero === 3);
  ok(bia.comprovante_url === 'https://drive.example/c' && bia.status === 'pago', 'listarAdmin traz comprovante e status');
  ok(list.total_numeros === 10000 && list.valor_numero === 20, 'listarAdmin informa total e valor da cota');

  const viaGet = api.get({ action: 'listarAdmin' });
  ok(viaGet.ok === false && /POST/.test(viaGet.error), 'listarAdmin via GET (URL) deve ser recusado');

  const pub = api.get({ action: 'listar', includeFree: 'true' });
  ok(pub.ok === true, 'listar publico funciona');
  pub.numeros.forEach((item) => {
    ok(Object.keys(item).sort().join() === 'numero,status', 'listar publico expoe apenas numero e status (sem dados pessoais)');
  });

  const confirm = api.post({ action: 'confirmarPagamento', numero: 5 });
  ok(confirm.ok === true && confirm.status === 'pago', 'confirmarPagamento marca como pago');
  ok(api.rows.find((r) => r[0] === 5)[1] === 'pago', 'planilha atualizada para pago');
  ok(api.rows.find((r) => r[0] === 5)[2] === 'Ana', 'confirmarPagamento preserva o nome');

  const free = api.post({ action: 'liberarNumero', numero: 5 });
  ok(free.ok === true && free.status === 'livre', 'liberarNumero devolve a cota');
  ok(api.rows.find((r) => r[0] === 5)[2] === '', 'liberarNumero limpa os dados pessoais');

  const bad = api.post({ action: 'confirmarPagamento', numero: 20000 });
  ok(bad.ok === false, 'numero fora de 0000-9999 e recusado');
  const missing = api.post({ action: 'confirmarPagamento' });
  ok(missing.ok === false, 'numero obrigatorio');
  const unknown = api.post({ action: 'apagarTudo' });
  ok(unknown.ok === false, 'acao desconhecida e recusada');
}

// --- Modo com senha -----------------------------------------------------
{
  const api = load(true, 's3cret');
  ok(api.post({ action: 'listarAdmin' }).ok === false, 'sem token deve ser recusado');
  ok(api.post({ action: 'listarAdmin', token: 'errado' }).ok === false, 'token errado deve ser recusado');
  ok(api.post({ action: 'listarAdmin', token: 's3cret' }).ok === true, 'token correto libera');
  ok(api.post({ action: 'listarAdmin', adminToken: 's3cret' }).ok === true, 'alias adminToken libera');
  ok(api.post({ action: 'confirmarPagamento', numero: 5 }).ok === false, 'confirmar sem token recusado');
  ok(api.rows.find((r) => r[0] === 5)[1] === 'reservado', 'planilha intacta apos tentativa sem token');
  ok(api.post({ action: 'liberarNumero', numero: 5, token: 'errado' }).ok === false, 'liberar com token errado recusado');
}

// --- Freio contra adivinhacao: 8 erros seguidos travam, acerto reinicia ---
{
  const api = load(true, 's3cret');
  for (let i = 0; i < 7; i++) ok(api.post({ action: 'listarAdmin', token: 'x' + i }).error === 'Não autorizado.', 'erro ' + (i + 1) + ' ainda so nega');
  ok(api.post({ action: 'listarAdmin', token: 's3cret' }).ok === true, 'acerto antes do limite libera e zera a contagem');
  for (let i = 0; i < 8; i++) api.post({ action: 'listarAdmin', token: 'y' + i });
  const travado = api.post({ action: 'listarAdmin', token: 's3cret' });
  ok(travado.ok === false && /Muitas tentativas/.test(travado.error), 'apos 8 erros seguidos ate a senha certa fica travada');
  ok(api.post({ action: 'confirmarPagamento', numero: 5, token: 's3cret' }).ok === false, 'travado vale para qualquer acao admin');
  ok(api.rows.find((r) => r[0] === 5)[1] === 'reservado', 'planilha intacta durante o bloqueio');
  ok(api.get({ action: 'listar', includeFree: 'true' }).ok === true, 'cartela publica segue funcionando durante o bloqueio');
}

// --- Comparacao da senha nao aceita parecida ------------------------------
{
  const api = load(true, 'acaoXX');
  ok(api.post({ action: 'listarAdmin', token: 'acaoX' }).ok === false, 'prefixo da senha nao libera');
  ok(api.post({ action: 'listarAdmin', token: 'acaoXXX' }).ok === false, 'senha com letra a mais nao libera');
  ok(api.post({ action: 'listarAdmin', token: 'acaoXX' }).ok === true, 'senha exata libera');
}

// --- Falha fechada: senha ligada mas ADMIN_TOKEN nao configurado ---------
{
  const api = load(true, null);
  ok(api.post({ action: 'listarAdmin' }).ok === false, 'sem ADMIN_TOKEN configurado nada admin roda');
  ok(api.post({ action: 'listarAdmin', token: '' }).ok === false, 'token vazio nao libera');
}

console.log('PASS: backend admin contracts verified (' + checks + ' checks).');
