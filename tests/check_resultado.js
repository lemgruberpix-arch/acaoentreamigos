// Contrato do RESULTADO do sorteio (apps-script/codigo.gs): acao admin registrarResultado + acao publica resultado.
// Sandbox com planilha simulada (varias abas): sem rede, sem Google. GS_FILE roda contra outro artefato (ex.: producao).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SOURCE = fs.readFileSync(process.env.GS_FILE || path.join(__dirname, '..', 'apps-script', 'codigo.gs'), 'utf8');
const COLS = ['numero', 'status', 'nome', 'whatsapp', 'valor', 'data_reserva', 'data_pagamento',
  'observacao', 'comprovante_nome', 'comprovante_url', 'data_comprovante', 'comprovante_tipo', 'indicador'];
const TOKEN = 's3cret'; // valor de teste, so existe neste sandbox
const DATA = '2026-10-24';

// Marcadores de dados pessoais: se algum aparecer numa resposta publica, o teste falha.
const PII = ['NOMEUNICO', 'ZEQUINHA', '21977776666', '21966665555', 'COMPROVANTE_SECRETO', 'drive.example/segredo'];

function linha(numero, status, nome, whatsapp) {
  const pago = status === 'pago';
  return [numero, status, nome || '', whatsapp || '', status === 'livre' ? '' : 20, status === 'livre' ? '' : new Date('2026-10-01'),
    pago ? new Date('2026-10-03') : '', 'obs', status === 'livre' ? '' : 'COMPROVANTE_SECRETO.jpg',
    status === 'livre' ? '' : 'https://drive.example/segredo', '', status === 'livre' ? '' : 'image/jpeg'];
}

// vendas: { numero: 'pago' | 'reservado' | 'livre' }
function load(vendas, opts) {
  opts = opts || {};
  const passwordMode = opts.senha === false ? 'false' : 'true';
  const source = SOURCE.replace(/const ADMIN_EXIGE_SENHA = (true|false);/, 'const ADMIN_EXIGE_SENHA = ' + passwordMode + ';');
  assert(source.includes('ADMIN_EXIGE_SENHA = ' + passwordMode), 'flag ADMIN_EXIGE_SENHA nao encontrada em codigo.gs');

  const numeros = [COLS.slice()];
  Object.keys(vendas || {}).forEach((n) => {
    numeros.push(linha(Number(n), vendas[n], 'NOMEUNICO_' + n, n % 2 ? '21977776666' : '21966665555'));
  });
  // um "ZEQUINHA" no meio de tudo, para ter mais um marcador
  if (!opts.semIsca) numeros.push(linha(4321, 'pago', 'ZEQUINHA', '21977776666'));

  const sheets = {};
  const novaAba = (rows) => ({
    rows,
    getLastColumn: () => Math.max(rows[0] ? rows[0].length : 0, 1),
    getLastRow: () => rows.length,
    setFrozenRows() {},
    autoResizeColumns() {},
    getRange(r, c, n, m) {
      return {
        getValues: () => rows.slice(r - 1, r - 1 + n).map((row) => { const out = row.slice(c - 1, c - 1 + m); while (out.length < m) out.push(''); return out; }),
        setValues(values) { values.forEach((v, i) => { rows[r - 1 + i] = v.slice(); }); return this; },
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
        setBackground() { return this; }
      };
    }
  });
  sheets.Numeros = novaAba(numeros);
  if (opts.resultadoInicial) sheets.Resultado = novaAba(opts.resultadoInicial);

  const props = opts.semToken ? {} : { ADMIN_TOKEN: TOKEN };
  const cache = {};
  let locks = 0;
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (nome) => sheets[nome] || null,
        insertSheet: (nome) => { sheets[nome] = novaAba([]); return sheets[nome]; }
      }),
      flush() {}
    },
    LockService: { getScriptLock: () => ({ waitLock() { locks += 1; }, releaseLock() {} }) },
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
  const registrar = (extra) => post(Object.assign({ action: 'registrarResultado', token: TOKEN, dataExtracao: DATA }, extra));
  return { post, get, registrar, sheets, numeros, locks: () => locks };
}

let checks = 0;
function ok(condition, message) { assert(condition, message); checks += 1; }
function semPII(obj, onde, admin) {
  const txt = JSON.stringify(obj);
  PII.forEach((p) => ok(!txt.includes(p), onde + ': nao pode conter "' + p + '"'));
  ok(!/nome|whats|comprovante|reservad/i.test(Object.keys(obj).join(',')), onde + ': chaves sem dados pessoais');
  if (!admin) ok(!/status|apuracao|tipo/i.test(Object.keys(obj).join(',')), onde + ': chaves sem status de cotas');
}

// --- 1) 1o premio vendido (pago): vale o 1o ------------------------------------
{
  const api = load({ 1234: 'pago', 5678: 'pago' });
  const r = api.registrar({ premios: ['91234', '25678', '33333', '44444', '55555'] });
  ok(r.ok === true && r.registrado === true, 'registra o resultado');
  ok(r.numero_vencedor === '1234' && r.ordem_premio_usado === 1, '1o premio vendido: vence a cota do 1o (2o nao importa)');
  ok(r.status_cota === 'pago' && r.tipo === 'original', 'status_cota=pago e tipo=original');
}

// --- 2) 1o nao vendido -> 2o ----------------------------------------------------
{
  const api = load({ 5678: 'pago' }); // 1234 nao existe na planilha (livre por padrao)
  const r = api.registrar({ premios: ['91234', '25678', '33333', '44444', '55555'] });
  ok(r.numero_vencedor === '5678' && r.ordem_premio_usado === 2, '1o livre -> vale o 2o premio');
}

// --- 3) 1o a 4o nao vendidos -> 5o ----------------------------------------------
{
  const api = load({ 9999: 'pago', 1111: 'livre', 2222: 'reservado' });
  const r = api.registrar({ premios: ['01111', '12222', '33333', '44444', '59999'] });
  ok(r.numero_vencedor === '9999' && r.ordem_premio_usado === 5, '1o a 4o nao vendidos -> vale o 5o');
  ok(/1º:1111=livre/.test(r.apuracao) && /2º:2222=reservado/.test(r.apuracao) && /5º:9999=pago/.test(r.apuracao), 'apuracao (so no admin) explica cada premio checado');
}

// --- 4) nenhuma das 5 vendida -> regra de fechamento (cota vendida logo acima do 1o premio) --------
{
  const api = load({ 1000: 'reservado' }); // existe uma cota paga de isca (4321)
  const antes = JSON.stringify(api.numeros);
  const r = api.registrar({ premios: ['01000', '12000', '33000', '44000', '55000'] });
  ok(r.ok === true && r.numero_vencedor === '4321' && r.ordem_premio_usado === 6, 'nenhuma das 5 paga -> fechamento: a cota paga logo acima do 1o premio (ordem 6)');
  ok(/fechamento:4321=pago/.test(r.apuracao), 'a apuracao (so no admin) registra o fechamento');
  const pub = api.get({ action: 'resultado' });
  ok(pub.ok === true && pub.registrado === true && pub.numero_vencedor === '4321' && pub.ordem_premio_usado === 6, 'publico: mostra a cota 4321 e a ordem 6 (fechamento)');
  ok(JSON.stringify(api.numeros) === antes, 'a planilha de cotas nao e alterada ao registrar');
}
// --- 4b) fechamento volta ao 0000 depois do 9999 -------------------------------------------------
{
  const api = load({ 5: 'pago', 9998: 'reservado' }, { semIsca: true });
  const r = api.registrar({ premios: ['09999', '11111', '22222', '33333', '44444'] });
  ok(r.numero_vencedor === '0005' && r.ordem_premio_usado === 6, 'fechamento: depois do 9999 volta ao 0000 e acha a 0005');
}
// --- 4c) fechamento escolhe a PRIMEIRA paga acima, ignorando reservadas -----------------------------
{
  const api = load({ 2001: 'reservado', 2002: 'livre', 2003: 'pago', 2500: 'pago' }, { semIsca: true });
  const r = api.registrar({ premios: ['02000', '17777', '28888', '39999', '40001'] });
  ok(r.numero_vencedor === '2003' && r.ordem_premio_usado === 6, 'fechamento ignora reservada/livre e pega a primeira paga acima');
}
// --- 4d) nenhuma cota paga em lugar nenhum -> sem ganhador apuravel ------------------------------------
{
  const api = load({ 1000: 'reservado' }, { semIsca: true });
  const antes = JSON.stringify(api.numeros);
  const r = api.registrar({ premios: ['01000', '12000', '33000', '44000', '55000'] });
  ok(r.ok === true && r.status_cota === 'sem_ganhador_apuravel', 'sem nenhuma cota paga -> sem_ganhador_apuravel');
  ok(r.numero_vencedor === null && r.ordem_premio_usado === null, 'ninguem escolhido (numero e ordem nulos)');
  const pub = api.get({ action: 'resultado' });
  ok(pub.ok === true && pub.registrado === true && pub.numero_vencedor === null && pub.ordem_premio_usado === null, 'publico: registrado, mas sem numero vencedor');
  ok(JSON.stringify(api.numeros) === antes, 'a planilha de cotas nao e alterada ao registrar');
  const linhaRes = api.sheets.Resultado.rows[1];
  ok(linhaRes[8] === '' && linhaRes[9] === '', 'sem ganhador: nome/whatsapp vazios na aba Resultado');
}

// --- 5) reservado sem pagar NAO e vendido ---------------------------------------
{
  const api = load({ 1234: 'reservado', 5678: 'pago' });
  const r = api.registrar({ premios: ['91234', '25678', '33333', '44444', '55555'] });
  ok(r.numero_vencedor === '5678' && r.ordem_premio_usado === 2, 'cota reservada (mesmo com comprovante) nao conta: passa para o 2o');
}

// --- 6) zeros a esquerda ---------------------------------------------------------
{
  const api = load({ 7: 'pago', 70: 'pago' });
  const r = api.registrar({ premios: ['30007', '00070', '1', '2', '3'].map((x, i) => (i < 2 ? x : '9999' + i)) });
  ok(r.numero_vencedor === '0007' && r.ordem_premio_usado === 1, 'premio terminado em 0007 -> cota 0007 (texto com zeros)');
  ok(typeof r.numero_vencedor === 'string' && r.numero_vencedor.length === 4, 'numero_vencedor sempre com 4 caracteres');
  const pub = api.get({ action: 'resultado' });
  ok(pub.numero_vencedor === '0007', 'publico tambem devolve "0007"');
  ok(pub.premios[0] === '30007' && pub.premios[1] === '00070', 'premios guardam os zeros a esquerda');
  const api2 = load({ 7: 'pago', 70: 'pago' });
  const r2 = api2.registrar({ premios: ['00070', '30007', '11111', '22222', '33333'] });
  ok(r2.numero_vencedor === '0070' && r2.ordem_premio_usado === 1, '00070 vira cota 0070 (nao confunde com 0007)');
  // se a planilha devolver o texto como numero (7), o publico ainda mostra "0007"
  api.sheets.Resultado.rows[1][3] = 7;
  ok(api.get({ action: 'resultado' }).numero_vencedor === '0007', 'numero lido como 7 volta formatado "0007"');
}

// --- 7) write-once e corrigir:true com historico ---------------------------------
{
  const api = load({ 1234: 'pago', 5678: 'pago' });
  const p1 = ['91234', '25678', '33333', '44444', '55555'];
  const p2 = ['95678', '21234', '33333', '44444', '55555'];
  ok(api.registrar({ premios: p1 }).ok === true, 'primeiro registro vale');
  const rec = api.registrar({ premios: p2 });
  ok(rec.ok === false && /Já existe/.test(rec.error) && /corrigir/.test(rec.error), 'segundo registro sem corrigir e recusado com mensagem clara');
  ok(api.registrar({ premios: p2, corrigir: false }).ok === false, 'corrigir:false tambem recusa');
  ok(api.registrar({ premios: p2, corrigir: 'sim' }).ok === false, 'corrigir diferente de true recusa');
  ok(api.get({ action: 'resultado' }).numero_vencedor === '1234', 'resultado original segue valendo apos tentativas recusadas');
  ok(api.sheets.Resultado.rows.length === 2, 'tentativas recusadas nao gravam linhas');
  const original = JSON.stringify(api.sheets.Resultado.rows[1]);
  const cor = api.registrar({ premios: p2, corrigir: true });
  ok(cor.ok === true && cor.tipo === 'correcao' && cor.numero_vencedor === '5678', 'corrigir:true grava a correcao');
  ok(api.sheets.Resultado.rows.length === 3, 'correcao e uma NOVA linha');
  ok(JSON.stringify(api.sheets.Resultado.rows[1]) === original, 'a linha antiga continua identica no historico');
  ok(api.get({ action: 'resultado' }).numero_vencedor === '5678', 'o publico passa a ver a correcao (ultima linha)');
  ok(api.sheets.Resultado.rows[2][6] === 'correcao' && api.sheets.Resultado.rows[1][6] === 'original', 'historico marca original e correcao');
  ok(api.locks() > 0, 'a gravacao usa o LockService');
}

// --- 8) so POST; publico em GET e POST --------------------------------------------
{
  const api = load({ 1234: 'pago' });
  const viaGet = api.get({ action: 'registrarResultado', token: TOKEN, dataExtracao: DATA, premios: JSON.stringify(['91234', '1', '2', '3', '4']) });
  ok(viaGet.ok === false && /POST|n[ãa]o podem ir na URL/.test(viaGet.error), 'registrarResultado via GET (URL) e recusado');
  ok(!api.sheets.Resultado, 'GET recusado nao cria nem grava a aba Resultado');
  const modoTeste = load({ 1234: 'pago' }, { senha: false });
  ok(modoTeste.get({ action: 'registrarResultado', dataExtracao: DATA, premios: ['91234', '11111', '22222', '33333', '44444'] }).ok === false, 'mesmo sem senha (modo teste) GET continua recusado');
  ok(modoTeste.post({ action: 'registrarResultado', dataExtracao: DATA, premios: ['91234', '11111', '22222', '33333', '44444'] }).ok === true, 'modo teste sem senha: POST registra (igual as outras acoes)');
  ok(api.get({ action: 'resultado' }).registrado === false, 'publico via GET funciona (sem resultado)');
  ok(api.post({ action: 'resultado' }).registrado === false, 'publico via POST funciona (sem resultado)');
  const antes = api.get({ action: 'resultado' });
  ok(JSON.stringify(antes) === JSON.stringify({ ok: true, registrado: false }), 'sem resultado: exatamente {ok:true, registrado:false}');
  ok(!api.sheets.Resultado, 'consulta publica nao cria a aba Resultado');
  api.registrar({ premios: ['91234', '11111', '22222', '33333', '44444'] });
  const g = api.get({ action: 'resultado' });
  const p = api.post({ action: 'resultado' });
  ok(JSON.stringify(g) === JSON.stringify(p), 'GET e POST devolvem a mesma coisa');
  ok(Object.keys(g).sort().join() === 'data_extracao,numero_vencedor,ok,ordem_premio_usado,premios,registrado', 'publico expoe SOMENTE os 6 campos combinados');
  ok(g.data_extracao === DATA && g.registrado === true && Array.isArray(g.premios) && g.premios.length === 5, 'campos publicos com o formato esperado');
}

// --- 9) senha: ausente/errada recusadas e CONTANDO na trava -----------------------
{
  const api = load({ 1234: 'pago' });
  const body = { action: 'registrarResultado', dataExtracao: DATA, premios: ['91234', '11111', '22222', '33333', '44444'] };
  ok(api.post(body).error === 'Não autorizado.', 'sem senha: recusado');
  ok(api.post(Object.assign({ token: 'errada' }, body)).error === 'Não autorizado.', 'senha errada: recusado');
  ok(!api.sheets.Resultado, 'recusado nao grava nada');
  for (let i = 0; i < 6; i++) api.post(Object.assign({ token: 'x' + i }, body));
  // ate aqui: 8 erros (1 sem senha + 1 errada + 6) => travado, ate a senha certa
  const travado = api.registrar({ premios: body.premios });
  ok(travado.ok === false && /Muitas tentativas/.test(travado.error), '8 erros em registrarResultado travam; senha certa tambem fica travada');
  ok(!api.sheets.Resultado, 'durante o bloqueio nada e gravado');
  ok(api.post({ action: 'listarAdmin', token: TOKEN }).ok === false, 'a trava vale tambem para as outras acoes admin (contador compartilhado)');
  ok(api.get({ action: 'resultado' }).ok === true, 'consulta publica segue funcionando durante o bloqueio');
}
{
  // erros em OUTRA acao admin tambem contam para registrarResultado (mesmo contador)
  const api = load({ 1234: 'pago' });
  for (let i = 0; i < 8; i++) api.post({ action: 'listarAdmin', token: 'y' + i });
  ok(/Muitas tentativas/.test(api.registrar({ premios: ['91234', '11111', '22222', '33333', '44444'] }).error), 'erros acumulados em listarAdmin travam registrarResultado');
  // acerto zera
  const api2 = load({ 1234: 'pago' });
  for (let i = 0; i < 7; i++) api2.post({ action: 'registrarResultado', token: 'z' + i });
  ok(api2.registrar({ premios: ['91234', '11111', '22222', '33333', '44444'] }).ok === true, 'antes do limite a senha certa registra');
  const api3 = load({ 1234: 'pago' }, { semToken: true });
  ok(api3.registrar({ premios: ['91234', '11111', '22222', '33333', '44444'] }).ok === false, 'sem ADMIN_TOKEN configurado nada e registrado (falha fechada)');
}

// --- 10) resposta publica sem dados pessoais --------------------------------------
{
  const api = load({ 1234: 'pago', 5678: 'reservado' });
  api.registrar({ premios: ['91234', '25678', '34321', '44444', '55555'] });
  const pub = api.get({ action: 'resultado' });
  semPII(pub, 'resultado publico (ganhador pago)');
  const pubPost = api.post({ action: 'resultado', token: TOKEN });
  semPII(pubPost, 'resultado publico via POST com token');
  // ganhador = ZEQUINHA: o nome dele esta na planilha e na aba privada, mas nunca na resposta
  const api2 = load({ 5678: 'reservado' });
  const adm = api2.registrar({ premios: ['94321', '25678', '33333', '44444', '55555'] });
  ok(adm.numero_vencedor === '4321', 'ganhador ZEQUINHA (cota 4321)');
  semPII(adm, 'resposta do registrarResultado (admin)', true);
  semPII(api2.get({ action: 'resultado' }), 'resultado publico (ganhador ZEQUINHA)');
  const priv = api2.sheets.Resultado.rows[1];
  ok(priv[8] === 'ZEQUINHA' && priv[9] === '21977776666', 'nome/whatsapp do ganhador ficam SO na aba privada Resultado');
  const lista = api2.post({ action: 'listarAdmin', token: TOKEN });
  const z = lista.reservas.find((x) => x.numero === 4321);
  ok(z && z.nome === 'ZEQUINHA' && z.whatsapp === '21977776666', 'listarAdmin segue mostrando o contato do ganhador ao dono');
  const listaPub = api2.get({ action: 'listar', includeFree: 'true' });
  listaPub.numeros.forEach((x) => ok(Object.keys(x).sort().join() === 'numero,status', 'listar publico continua so numero e status'));
}

// --- 11) premios e data invalidos ---------------------------------------------------
{
  const api = load({ 1234: 'pago' });
  const bom = ['91234', '11111', '22222', '33333', '44444'];
  const recusa = (extra, msg) => { const r = api.registrar(extra); ok(r.ok === false && typeof r.error === 'string' && r.error.length > 10, msg + ' -> ' + r.error); };
  recusa({ premios: ['9123a', '11111', '22222', '33333', '44444'] }, 'letras no premio');
  recusa({ premios: ['91 34', '11111', '22222', '33333', '44444'] }, 'espaco no premio');
  recusa({ premios: ['-1234', '11111', '22222', '33333', '44444'] }, 'sinal no premio');
  recusa({ premios: ['123', '11111', '22222', '33333', '44444'] }, 'premio com 3 digitos');
  recusa({ premios: ['', '11111', '22222', '33333', '44444'] }, 'premio vazio');
  recusa({ premios: ['91234', '11111', '22222', '33333'] }, 'so 4 premios');
  recusa({ premios: bom.concat(['55555']) }, '6 premios');
  recusa({ premios: [91234, 11111, 22222, 33333, 44444] }, 'premios como numero (perderiam zeros)');
  recusa({ premios: ['91234', null, '22222', '33333', '44444'] }, 'premio nulo');
  recusa({ premios: '91234' }, 'premios nao e lista');
  recusa({}, 'premios ausentes');
  recusa({ premios: ['1'.repeat(11), '11111', '22222', '33333', '44444'] }, 'premio com digitos demais');
  recusa({ premios: bom, dataExtracao: '' }, 'data vazia');
  recusa({ premios: bom, dataExtracao: '24/10/2026' }, 'data em formato BR');
  recusa({ premios: bom, dataExtracao: '2026-02-30' }, 'data inexistente');
  recusa({ premios: bom, dataExtracao: '2026-13-01' }, 'mes 13');
  recusa({ premios: bom, dataExtracao: '2999-01-01' }, 'data futura');
  recusa({ premios: bom, dataExtracao: 20261024 }, 'data numerica');
  ok(!api.sheets.Resultado || api.sheets.Resultado.rows.length <= 1, 'entradas invalidas nao gravam resultado');
  ok(api.registrar({ premios: ['91234', '1111', '22222', '33333', '44444'] }).ok === true, 'premio com exatamente 4 digitos e aceito (>=4)');
  ok(api.get({ action: 'resultado' }).premios[1] === '1111', 'premio de 4 digitos guardado como veio');
}

// --- 12) acao sem alterar o que ja existia -----------------------------------------
{
  const api = load({ 1234: 'pago' });
  ok(api.post({ action: 'apagarResultado', token: TOKEN }).ok === false, 'nao existe acao para apagar resultado');
  ok(api.post({ action: 'registrarResultados', token: TOKEN }).ok === false, 'nome de acao parecido nao e aceito');
}

console.log('PASS: contrato do resultado verificado (' + checks + ' checks).');
