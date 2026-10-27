// Programa de vendedores (apps-script/codigo.gs): link com codigo, contagem so de cotas pagas e confirmadas,
// bonus de 5 cotas gratis a cada 100, entrega pelo admin, nada de dado pessoal na resposta publica.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const SOURCE = fs.readFileSync(process.env.GS_FILE || path.join(__dirname, '..', 'apps-script', 'codigo.gs'), 'utf8');
const COLS = ['numero', 'status', 'nome', 'whatsapp', 'valor', 'data_reserva', 'data_pagamento',
  'observacao', 'comprovante_nome', 'comprovante_url', 'data_comprovante', 'comprovante_tipo', 'indicador'];
const TOKEN = 'senha-de-teste';

function linha(numero, status, indicador, valor, nome) {
  return [numero, status, nome || 'Comprador ' + numero, '21955554444', valor === undefined ? 18.9 : valor,
    new Date('2026-10-27'), status === 'pago' ? new Date('2026-10-28') : '', '', '', '', '', '', indicador || ''];
}

function load(extra) {
  const rows = [COLS.slice()].concat(extra || []);
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
        setBackground() { return this; },
        setNumberFormat() { return this; }
      };
    }
  };
  const props = { ADMIN_TOKEN: TOKEN };
  const cache = {};
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, getId: () => 'PLANILHA-TESTE' }), flush() {} },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k], setProperty: (k, v) => { props[k] = String(v); } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: (k) => { delete cache[k]; } }) },
    ContentService: { createTextOutput: (text) => ({ text, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Utilities: {},
    Session: {}
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const get = (params) => JSON.parse(ctx.doGet({ parameter: params }).text);
  return { post, get, rows, ctx };
}

let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }

// --- sanitizacao do codigo (igual a do site) ----------------------------------------------
{
  const { ctx } = load();
  const s = (v) => vm.runInContext('sanitizeIndicador_(' + JSON.stringify(v) + ')', ctx);
  ok(s('Joao Silva') === 'joao-silva', 'espaco vira hifen, minusculas');
  ok(s('JOÃO') === 'joao', 'tira acento');
  ok(s('a') === '', 'codigo de 1 caractere e invalido');
  ok(s('') === '' && s(null) === '' && s(undefined) === '', 'vazio, nulo e indefinido viram vazio');
  ok(s('x'.repeat(40)).length === 24, 'corta em 24');
  ok(s('<script>alert(1)</script>') === 'scriptalert1script', 'tira simbolos perigosos');
  ok(s('=HYPERLINK("x")') === 'hyperlinkx', 'nao deixa formula de planilha');
}

// --- reserva guarda o codigo e preserva ao confirmar -------------------------------------
{
  const api = load();
  const r = api.post({ action: 'reservar', numeros: [10, 11, 12], nome: 'Maria', whatsapp: '21999998888', indicador: 'Joao Silva', valorTotal: 50 });
  ok(r.ok === true, 'reserva com indicador funciona');
  ok(api.rows.slice(1).every((row) => row[12] === 'joao-silva'), 'todas as cotas da reserva guardam o codigo do vendedor');
  const sem = api.post({ action: 'reservar', numeros: [20], nome: 'Pedro', whatsapp: '21999997777' });
  ok(sem.ok === true && api.rows.find((row) => row[0] === 20)[12] === '', 'reserva sem codigo fica sem vendedor');
  const lixo = api.post({ action: 'reservar', numeros: [21], nome: 'Pedro', whatsapp: '21999997777', indicador: '<b>' });
  ok(lixo.ok === true && api.rows.find((row) => row[0] === 21)[12] === 'b' || api.rows.find((row) => row[0] === 21)[12] === '', 'codigo lixo nao quebra a reserva');
  const pago = api.post({ action: 'confirmarPagamento', token: TOKEN, numero: 10 });
  ok(pago.ok === true && api.rows.find((row) => row[0] === 10)[12] === 'joao-silva', 'confirmar pagamento preserva o vendedor');
  api.post({ action: 'liberarNumero', token: TOKEN, numero: 11 });
  ok(api.rows.find((row) => row[0] === 11)[12] === '', 'liberar a cota apaga o vendedor');
}

// --- contagem: so cota paga com valor > 0 conta -------------------------------------------
{
  const rows = [];
  for (let i = 0; i < 37; i += 1) rows.push(linha(1000 + i, 'pago', 'ana'));
  for (let i = 0; i < 4; i += 1) rows.push(linha(2000 + i, 'reservado', 'ana'));
  for (let i = 0; i < 3; i += 1) rows.push(linha(3000 + i, 'pago', 'bia', 0)); // bonus
  const api = load(rows);
  const v = api.get({ action: 'vendedor', codigo: 'ANA' });
  ok(v.ok === true && v.codigo === 'ana', 'consulta pelo codigo (qualquer caixa)');
  ok(v.cotas_pagas === 37 && v.cotas_pendentes === 4, 'conta 37 pagas e 4 pendentes; pendente nao conta como venda');
  ok(v.blocos_fechados === 0 && v.bonus_ganho === 0 && v.faltam_para_proximo === 63, 'com 37 ainda nao ganhou bonus; faltam 63');
  const b = api.get({ action: 'vendedor', codigo: 'bia' });
  ok(b.cotas_pagas === 0 && b.bonus_entregue === 3, 'cota de bonus (valor 0) nao conta como venda');
  const nada = api.get({ action: 'vendedor', codigo: 'ninguem' });
  ok(nada.ok === true && nada.cotas_pagas === 0 && nada.faltam_para_proximo === 100, 'codigo sem vendas devolve zeros');
  const erro = api.get({ action: 'vendedor', codigo: '' });
  ok(erro.ok === false, 'codigo vazio da erro claro');
  ok(!/Comprador|21955554444|whatsapp|nome/i.test(JSON.stringify(v)), 'resposta publica do vendedor nunca traz nome ou telefone');
}

// --- bloco de 100 -> 5 cotas gratis; entrega pelo admin ---------------------------------------
{
  const rows = [];
  for (let i = 0; i < 205; i += 1) rows.push(linha(i, 'pago', 'carlos'));
  const api = load(rows);
  const v = api.get({ action: 'vendedor', codigo: 'carlos' });
  ok(v.cotas_pagas === 205 && v.blocos_fechados === 2 && v.bonus_ganho === 10 && v.bonus_a_entregar === 10 && v.faltam_para_proximo === 95, '205 pagas = 2 blocos = 10 cotas gratis');

  const rankSem = api.post({ action: 'rankingVendedores' });
  ok(rankSem.ok === false, 'ranking exige a senha');
  const rank = api.post({ action: 'rankingVendedores', token: TOKEN });
  ok(rank.ok === true && rank.vendedores.length === 1 && rank.vendedores[0].codigo === 'carlos' && rank.total_indicadas === 205, 'ranking mostra o vendedor');

  ok(api.post({ action: 'darBonus', codigo: 'carlos', nome: 'Carlos', numeros: [9000] }).ok === false, 'darBonus exige a senha');
  const demais = api.post({ action: 'darBonus', token: TOKEN, codigo: 'carlos', nome: 'Carlos', whatsapp: '21911112222', numeros: [9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010] });
  ok(demais.ok === false && /10 cota/.test(demais.error), 'nao entrega mais do que o vendedor ganhou');
  const ocupada = api.post({ action: 'darBonus', token: TOKEN, codigo: 'carlos', nome: 'Carlos', whatsapp: '21911112222', numeros: [5] });
  ok(ocupada.ok === false && /não está livre/.test(ocupada.error), 'nao entrega cota que ja foi vendida');
  const semNome = api.post({ action: 'darBonus', token: TOKEN, codigo: 'carlos', nome: '', numeros: [9000] });
  ok(semNome.ok === false, 'nome do vendedor e obrigatorio');

  const dado = api.post({ action: 'darBonus', token: TOKEN, codigo: 'carlos', nome: 'Carlos Lima', whatsapp: '21911112222', numeros: [9000, 9001, 9002, 9003] });
  ok(dado.ok === true && dado.bonus_a_entregar_restante === 6, 'entrega 4 cotas, restam 6');
  const linhaBonus = api.rows.find((row) => row[0] === 9000);
  ok(linhaBonus[1] === 'pago' && linhaBonus[4] === 0 && linhaBonus[12] === 'carlos' && linhaBonus[2] === 'Carlos Lima', 'cota de bonus: paga, valor 0, nome do vendedor, codigo');
  const v2 = api.get({ action: 'vendedor', codigo: 'carlos' });
  ok(v2.cotas_pagas === 205 && v2.bonus_entregue === 4 && v2.bonus_a_entregar === 6, 'o bonus entregue nao conta como venda e abate o a entregar');
  const lista = api.post({ action: 'listarAdmin', token: TOKEN });
  const rb = lista.reservas.find((r) => r.numero === 9000);
  ok(rb.bonus === true && rb.indicador === 'carlos' && rb.valor === 0, 'listarAdmin marca a cota de bonus');
  const normal = lista.reservas.find((r) => r.numero === 1);
  ok(normal.bonus === false && normal.indicador === 'carlos', 'cota normal nao e bonus');
  const pub = api.get({ action: 'listar' });
  ok(pub.numeros.some((n) => n.numero === 9000 && n.status === 'pago') && !/Carlos Lima|21911112222/.test(JSON.stringify(pub)), 'a lista publica mostra a cota paga sem dado pessoal');
}

// --- cobranca por URL continua proibida ----------------------------------------------------
{
  const api = load();
  ok(api.get({ action: 'vendedor', codigo: 'ana', token: 'x' }).ok === false, 'senha na URL continua recusada nas acoes novas');
}

console.log('PASS: programa de vendedores verificado (' + checks + ' checks).');
