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
  const hooks = {};
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, getId: () => 'PLANILHA-ID-DE-TESTE' }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() { if (hooks.aoTravar) { const f = hooks.aoTravar; hooks.aoTravar = null; f(); } }, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k], setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; } }) },
    ContentService: { createTextOutput: (text) => ({ text, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {},
    Session: {}
  };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const get = (params) => JSON.parse(ctx.doGet({ parameter: params }).text);
  // POST com credenciais na query string (?token=...), alem do corpo JSON
  const postComQuery = (query, body) => JSON.parse(ctx.doPost({ parameter: query, postData: { contents: JSON.stringify(body) } }).text);
  return { post, get, postComQuery, rows, props, cache, hooks };
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
  ok(list.total_numeros === 10000 && list.valor_numero === 18.9, 'listarAdmin informa total e valor da cota');

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

// --- Trocar senha pelo painel ---------------------------------------------
{
  const api = load(true, 'senha-atual');
  ok(api.post({ action: 'trocarSenha', novaSenha: 'nova-senha-1' }).ok === false, 'trocar senha sem a senha atual e recusado');
  ok(api.post({ action: 'trocarSenha', token: 'errada', novaSenha: 'nova-senha-1' }).ok === false, 'trocar senha com senha atual errada e recusado');
  ok(api.post({ action: 'trocarSenha', token: 'senha-atual', novaSenha: '123' }).ok === false, 'senha nova curta demais e recusada');
  ok(api.post({ action: 'trocarSenha', token: 'senha-atual', novaSenha: ' espaco-na-ponta ' }).ok === false, 'senha com espaco nas pontas e recusada');
  ok(api.post({ action: 'trocarSenha', token: 'senha-atual', novaSenha: 'senha-atual' }).ok === false, 'senha igual a atual e recusada');
  ok(api.post({ action: 'trocarSenha', token: 'senha-atual', novaSenha: 'x'.repeat(65) }).ok === false, 'senha com mais de 64 caracteres e recusada');
  ok(api.post({ action: 'listarAdmin', token: 'senha-atual' }).ok === true, 'a senha atual continua valendo depois das tentativas recusadas');
  const troca = api.post({ action: 'trocarSenha', token: 'senha-atual', novaSenha: 'nova-senha-1' });
  ok(troca.ok === true, 'troca com a senha atual correta funciona');
  ok(!JSON.stringify(troca).includes('nova-senha-1') && !JSON.stringify(troca).includes('senha-atual'), 'a resposta nunca devolve nenhuma das senhas');
  ok(api.post({ action: 'listarAdmin', token: 'senha-atual' }).ok === false, 'a senha antiga deixa de valer na hora');
  ok(api.post({ action: 'listarAdmin', token: 'nova-senha-1' }).ok === true, 'a senha nova passa a valer na hora');
  ok(api.get({ action: 'trocarSenha', token: 'nova-senha-1', novaSenha: 'outra-senha-2' }).ok === false, 'trocar senha por GET (URL) e recusado');
}

// --- Primeiro acesso: criar a senha pelo painel, com o codigo da planilha -----
{
  const api = load(true, null); // sem ADMIN_TOKEN: nada admin roda (falha fechada)
  ok(api.post({ action: 'listarAdmin', token: 'qualquer' }).ok === false, 'antes do primeiro acesso nada admin roda');
  ok(api.get({ action: 'definirSenhaInicial', codigoPlanilha: 'PLANILHA-ID-DE-TESTE', novaSenha: 'primeira-senha' }).ok === false, 'primeiro acesso por GET (URL) e recusado');
  const semCodigo = api.post({ action: 'definirSenhaInicial', novaSenha: 'primeira-senha' });
  ok(semCodigo.ok === false && /não confere/.test(semCodigo.error), 'sem o codigo da planilha e recusado');
  const errado = api.post({ action: 'definirSenhaInicial', codigoPlanilha: 'outro-id', novaSenha: 'primeira-senha' });
  ok(errado.ok === false && /não confere/.test(errado.error), 'codigo da planilha errado e recusado');
  ok(api.post({ action: 'definirSenhaInicial', codigoPlanilha: 'PLANILHA-ID-DE-TESTE', novaSenha: '123' }).ok === false, 'senha curta demais e recusada mesmo com o codigo certo');
  ok(api.post({ action: 'listarAdmin', token: 'primeira-senha' }).ok === false, 'senha recusada nao ficou valendo');
  const criou = api.post({ action: 'definirSenhaInicial', codigoPlanilha: '  PLANILHA-ID-DE-TESTE  ', novaSenha: 'primeira-senha' });
  ok(criou.ok === true, 'codigo certo + senha valida cria a senha');
  ok(!JSON.stringify(criou).includes('primeira-senha') && !JSON.stringify(criou).includes('PLANILHA-ID-DE-TESTE'), 'a resposta nao devolve a senha nem o codigo');
  ok(api.post({ action: 'listarAdmin', token: 'primeira-senha' }).ok === true, 'a senha criada vale na hora');
  const denovo = api.post({ action: 'definirSenhaInicial', codigoPlanilha: 'PLANILHA-ID-DE-TESTE', novaSenha: 'outra-senha-9' });
  ok(denovo.ok === false && /já foi criada/.test(denovo.error), 'depois de criada, o primeiro acesso deixa de funcionar (nao da para sequestrar)');
  ok(api.post({ action: 'listarAdmin', token: 'outra-senha-9' }).ok === false, 'a tentativa de sequestro nao mudou a senha');
}
{
  const api = load(true, null);
  for (let i = 0; i < 8; i++) api.post({ action: 'definirSenhaInicial', codigoPlanilha: 'chute-' + i, novaSenha: 'primeira-senha' });
  const travado = api.post({ action: 'definirSenhaInicial', codigoPlanilha: 'PLANILHA-ID-DE-TESTE', novaSenha: 'primeira-senha' });
  ok(travado.ok === false && /Muitas tentativas/.test(travado.error), '8 chutes de codigo travam ate o codigo certo');
  ok(api.post({ action: 'listarAdmin', token: 'primeira-senha' }).ok === false, 'durante a trava nenhuma senha foi criada');
}
{
  const api = load(true, 'senha-ja-existente');
  const r = api.post({ action: 'definirSenhaInicial', codigoPlanilha: 'PLANILHA-ID-DE-TESTE', novaSenha: 'nova-tentativa-1' });
  ok(r.ok === false && /já foi criada/.test(r.error), 'com senha ja existente o primeiro acesso e recusado');
  ok(api.post({ action: 'listarAdmin', token: 'senha-ja-existente' }).ok === true, 'a senha existente continua valendo');
}

// --- Correcoes da revisao independente (Codex #1866) ----------------------------
{
  // (1) trocar senha: reconfere a senha ATUAL dentro da trava (uma troca concorrente ja mudou a senha)
  const api = load(true, 'senha-atual');
  api.hooks.aoTravar = () => { api.props.ADMIN_TOKEN = 'trocada-por-outro-pedido'; }; // outro pedido troca a senha enquanto este espera a trava
  const r = api.post({ action: 'trocarSenha', token: 'senha-atual', novaSenha: 'minha-nova-senha' });
  ok(r.ok === false && /Não autorizado/.test(r.error), 'troca concorrente com a senha velha e recusada dentro da trava');
  ok(api.props.ADMIN_TOKEN === 'trocada-por-outro-pedido', 'a senha da troca concorrente NAO foi sobrescrita pela velha');
  ok(Number(api.cache.admin_falhas) === 1, 'a troca recusada conta como erro na trava');
  ok(api.post({ action: 'listarAdmin', token: 'trocada-por-outro-pedido' }).ok === true, 'a senha vigente continua valendo');
}
{
  // (2) a conferencia e a contagem de erros acontecem sob a trava do script
  const api = load(true, 'senha-atual');
  let travou = 0;
  api.hooks.aoTravar = () => { travou += 1; };
  api.post({ action: 'listarAdmin', token: 'errada' });
  ok(travou === 1, 'requireAdmin_ confere a senha e conta o erro sob o LockService');
}
{
  // (3) senha/codigos nunca na URL, em GET ou POST (a URL fica em registros)
  const api = load(true, 'senha-atual');
  const naUrl = api.postComQuery({ token: 'senha-atual' }, { action: 'listarAdmin' });
  ok(naUrl.ok === false && /URL/.test(naUrl.error), 'POST com ?token= na URL e recusado mesmo com a senha certa');
  ok(api.postComQuery({ novaSenha: 'qualquer-coisa' }, { action: 'trocarSenha', token: 'senha-atual' }).ok === false, 'POST com ?novaSenha= na URL e recusado');
  ok(api.postComQuery({ codigoPlanilha: 'PLANILHA-ID-DE-TESTE' }, { action: 'definirSenhaInicial', novaSenha: 'primeira-senha' }).ok === false, 'POST com ?codigoPlanilha= na URL e recusado');
  ok(api.postComQuery({ adminToken: 'senha-atual' }, { action: 'listarAdmin' }).ok === false, 'POST com ?adminToken= na URL e recusado');
  ok(api.get({ action: 'listar', token: 'x' }).ok === false, 'GET publico com token na URL tambem e recusado');
  ok(api.post({ action: 'listarAdmin', token: 'senha-atual' }).ok === true, 'a senha no CORPO continua funcionando');
  ok(api.get({ action: 'listar' }).ok === true, 'GET publico sem credenciais continua funcionando');
}

// --- Falha fechada: senha ligada mas ADMIN_TOKEN nao configurado ---------
{
  const api = load(true, null);
  ok(api.post({ action: 'listarAdmin' }).ok === false, 'sem ADMIN_TOKEN configurado nada admin roda');
  ok(api.post({ action: 'listarAdmin', token: '' }).ok === false, 'token vazio nao libera');
}

console.log('PASS: backend admin contracts verified (' + checks + ' checks).');
