/******************************************************
 * Rifa Honda XRE 190 2018 — Ação entre Amigos
 * Google Apps Script Backend (Google Sheets + Drive).
 * Escala: 10.000 cotas (0000 a 9999), R$ 20,00 por cota.
 *
 * Características principais:
 * - 10.000 cotas: NUMERO_INICIAL = 0, QUANTIDADE_NUMEROS = 10000 (0000 a 9999).
 * - VALOR_POR_NUMERO = 18,90 (R$ 18,90).
 * - Suporte a armazenamento esparso (números não registrados são 'livre' por padrão).
 * - Inicialização em lotes (batch chunks de 1.000 linhas) para evitar timeout.
 * - Concorrência segura via LockService (waitLock até 30s).
 * - Privacidade pública: action 'listar' remove nomes e telefones (PII sanitizado).
 * - Resultado do sorteio: 'registrarResultado' (admin, só POST, write-once) e 'resultado' (público, sem dados pessoais).
 ******************************************************/

const SHEET_NAME = 'Numeros';
const NUMERO_INICIAL = 0;
const QUANTIDADE_NUMEROS = 10000;
const START_NUMERO = NUMERO_INICIAL;
const TOTAL_NUMEROS = QUANTIDADE_NUMEROS;
const MAX_NUMERO = START_NUMERO + TOTAL_NUMEROS - 1; // 9999
const PANEL_SIZE = 100;
const VALOR_POR_NUMERO = 18.9;
const DEFAULT_VALOR_NUMERO = VALOR_POR_NUMERO;
const COMPROVANTES_FOLDER_NAME = 'Comprovantes - Rifa Honda XRE 190';
const BATCH_SIZE = 1000;

// Pacotes promocionais canônicos (quantidade, valor em centavos). Devem espelhar PROMOCOES_COTAS em assets/config.js.
const PACOTES_CENTAVOS = [[10, 16500], [6, 10000], [3, 5000]];
const MAX_COTAS_POR_RESERVA = 200;
const MAX_COMPROVANTE_BYTES = 5 * 1024 * 1024;
const MIMES_COMPROVANTE = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Padrão SEGURO (falha fechada): as ações administrativas exigem a senha. Só troque para false em planilha de TESTE sem dados
// reais: com false, qualquer pessoa com o endereço do Apps Script consegue ler nomes/WhatsApp e marcar cota como paga/livre.
const ADMIN_EXIGE_SENHA = true;
// Com ADMIN_EXIGE_SENHA = true, as ações administrativas exigem a propriedade de script ADMIN_TOKEN (Configurações do projeto > Propriedades do script).
// A confirmação automática só liga se a propriedade AUTO_CONFIRMAR for 'true'; o navegador nunca decide isso.

const COLS = [
  'numero',
  'status',
  'nome',
  'whatsapp',
  'valor',
  'data_reserva',
  'data_pagamento',
  'observacao',
  'comprovante_nome',
  'comprovante_url',
  'data_comprovante',
  'comprovante_tipo',
  'indicador'
];

const COL = COLS.reduce(function (acc, name, index) {
  acc[name] = index;
  return acc;
}, {});

function inicializarPlanilha() {
  return inicializarPlanilha_(false);
}

function inicializarPlanilhaCompleta() {
  return inicializarPlanilha_(true);
}

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    // Senha e códigos nunca na URL (a URL fica em registros e no histórico): recusa em GET e em POST.
    if (e && e.parameter) {
      ['token', 'adminToken', 'novaSenha', 'codigoPlanilha'].forEach(function (chave) {
        if (Object.prototype.hasOwnProperty.call(e.parameter, chave)) {
          throw new Error('Senha e códigos não podem ir na URL. Use o painel.');
        }
      });
    }
    const payload = parsePayload_(e);
    // Definido no servidor (sobrescreve qualquer valor do cliente): ações admin só via POST, nunca na URL.
    payload.__viaPost = Boolean(e && e.postData && e.postData.contents);
    const action = String(payload.action || 'listar').trim();

    if (action === 'listar') {
      return json_({
        ok: true,
        total_numeros: TOTAL_NUMEROS,
        numero_inicial: START_NUMERO,
        valor_numero: VALOR_POR_NUMERO,
        numeros: listarNumeros_(payload)
      });
    }

    if (action === 'reservar') {
      return json_(reservarNumeros_(payload));
    }

    if (action === 'enviarComprovante') {
      return json_(enviarComprovante_(payload));
    }

    if (action === 'listarAdmin') {
      requireAdmin_(payload);
      return json_({
        ok: true,
        total_numeros: TOTAL_NUMEROS,
        numero_inicial: START_NUMERO,
        valor_numero: VALOR_POR_NUMERO,
        reservas: listarReservasAdmin_()
      });
    }

    if (action === 'vendedor') {
      return json_(vendedorPublico_(payload.codigo));
    }

    if (action === 'rankingVendedores') {
      requireAdmin_(payload);
      return json_(rankingVendedores_());
    }

    if (action === 'darBonus') {
      requireAdmin_(payload);
      return json_(darBonus_(payload));
    }

    if (action === 'confirmarPagamento') {
      requireAdmin_(payload);
      payload.status = 'pago';
      return json_(atualizarStatus_(payload));
    }

    if (action === 'liberarNumero') {
      requireAdmin_(payload);
      payload.status = 'livre';
      return json_(atualizarStatus_(payload));
    }

    if (action === 'atualizarStatus') {
      requireAdmin_(payload);
      return json_(atualizarStatus_(payload));
    }

    if (action === 'trocarSenha') {
      requireAdmin_(payload);
      return json_(trocarSenha_(payload));
    }

    // Primeiro acesso: só funciona enquanto NÃO existe ADMIN_TOKEN e exige o código da planilha (o dono o tem na URL dela).
    if (action === 'definirSenhaInicial') {
      return json_(definirSenhaInicial_(payload));
    }

    // Pública (GET e POST): devolve só o resultado oficial, sem nenhum dado pessoal.
    if (action === 'resultado') {
      return json_(resultadoPublico_());
    }

    // Administrativa (só POST + senha, mesma trava de tentativas das demais).
    if (action === 'registrarResultado') {
      requireAdmin_(payload);
      return json_(registrarResultado_(payload));
    }

    if (action === 'inicializar') {
      requireAdmin_(payload);
      const prefillAll = payload.prefillAll === true || payload.prefillAll === 'true';
      const msg = inicializarPlanilha_(prefillAll);
      return json_({ ok: true, message: msg });
    }

    return json_({ ok: false, error: 'Ação inválida: ' + action });
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

// Senha fácil de adivinhar exige freio: depois de ADMIN_MAX_FALHAS erros seguidos, o admin trava por ADMIN_BLOQUEIO_SEG
// (vale para todo mundo, inclusive o dono; acerto reinicia a contagem). O contador guarda só o número de erros, nunca a senha tentada.
const ADMIN_MAX_FALHAS = 8;
const ADMIN_BLOQUEIO_SEG = 600;
const ADMIN_CHAVE_FALHAS = 'admin_falhas';

/** Compara sem parar no primeiro caractere diferente (não vaza quantas letras acertaram). */
function sameText_(a, b) {
  const x = String(a);
  const y = String(b);
  let diff = x.length === y.length ? 0 : 1;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

/** Falha fechada: sem ADMIN_TOKEN configurado ou com token errado, nenhuma ação administrativa roda. */
function requireAdmin_(payload) {
  if (!payload.__viaPost) throw new Error('Ações administrativas só por POST.');
  if (!ADMIN_EXIGE_SENHA) return;
  // Conferir a senha e contar o erro é uma operação só: sob trava, pedidos simultâneos não subcontam as falhas.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cache = CacheService.getScriptCache();
    const falhas = Number(cache.get(ADMIN_CHAVE_FALHAS) || 0);
    if (falhas >= ADMIN_MAX_FALHAS) {
      throw new Error('Muitas tentativas erradas. Aguarde ' + Math.round(ADMIN_BLOQUEIO_SEG / 60) + ' minutos e tente de novo.');
    }
    const token = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
    if (!token || !sameText_(payload.token || payload.adminToken || '', token)) {
      cache.put(ADMIN_CHAVE_FALHAS, String(falhas + 1), ADMIN_BLOQUEIO_SEG);
      throw new Error('Não autorizado.');
    }
    if (falhas) cache.remove(ADMIN_CHAVE_FALHAS);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Troca a senha do painel (propriedade ADMIN_TOKEN). Exige a senha ATUAL (requireAdmin_ já conferiu) e nunca
 * registra nem devolve o valor. Zera a contagem de erros. A nova senha vale na hora, sem nova implantação.
 */
function validarNovaSenha_(valor) {
  const nova = String(valor === undefined || valor === null ? '' : valor);
  if (nova.length < 6 || nova.length > 64) throw new Error('A nova senha precisa ter de 6 a 64 caracteres.');
  if (/[\u0000-\u001f\u007f]/.test(nova) || nova !== nova.trim()) throw new Error('A nova senha não pode ter espaços nas pontas nem caracteres invisíveis.');
  return nova;
}

function trocarSenha_(payload) {
  const nova = validarNovaSenha_(payload.novaSenha);
  const atual = String(payload.token || payload.adminToken || '');
  if (sameText_(nova, atual)) throw new Error('A nova senha precisa ser diferente da atual.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const cache = CacheService.getScriptCache();
    const vigente = props.getProperty('ADMIN_TOKEN');
    // Reconfere dentro da trava: se outra troca ja mudou a senha, esta (com a senha velha) e recusada e conta como erro.
    if (!vigente || !sameText_(atual, vigente)) {
      const falhas = Number(cache.get(ADMIN_CHAVE_FALHAS) || 0);
      cache.put(ADMIN_CHAVE_FALHAS, String(falhas + 1), ADMIN_BLOQUEIO_SEG);
      throw new Error('Não autorizado.');
    }
    props.setProperty('ADMIN_TOKEN', nova);
    cache.remove(ADMIN_CHAVE_FALHAS);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, message: 'Senha trocada. Use a nova senha daqui em diante.' };
}

/**
 * Primeiro acesso: cria a senha do painel quando ainda NÃO existe ADMIN_TOKEN. Prova de dono = código da planilha
 * (o trecho grande da URL dela, que não aparece em nenhum lugar público). Só POST, usa a MESMA trava de tentativas
 * (8 erros = 10 min), nunca devolve nem registra a senha, e depois de criada esta ação deixa de funcionar.
 */
function definirSenhaInicial_(payload) {
  if (!payload.__viaPost) throw new Error('Ações administrativas só por POST.');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const cache = CacheService.getScriptCache();
    const falhas = Number(cache.get(ADMIN_CHAVE_FALHAS) || 0);
    if (falhas >= ADMIN_MAX_FALHAS) {
      throw new Error('Muitas tentativas erradas. Aguarde ' + Math.round(ADMIN_BLOQUEIO_SEG / 60) + ' minutos e tente de novo.');
    }
    const props = PropertiesService.getScriptProperties();
    if (props.getProperty('ADMIN_TOKEN')) throw new Error('A senha já foi criada. Para trocar, use "Trocar senha" no painel.');
    const codigo = String(payload.codigoPlanilha === undefined || payload.codigoPlanilha === null ? '' : payload.codigoPlanilha).trim();
    const real = String(SpreadsheetApp.getActiveSpreadsheet().getId());
    if (!codigo || !sameText_(codigo, real)) {
      cache.put(ADMIN_CHAVE_FALHAS, String(falhas + 1), ADMIN_BLOQUEIO_SEG);
      throw new Error('O código da planilha não confere.');
    }
    const nova = validarNovaSenha_(payload.novaSenha);
    props.setProperty('ADMIN_TOKEN', nova);
    cache.remove(ADMIN_CHAVE_FALHAS);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, message: 'Senha criada. Entre com ela no painel.' };
}

/** Texto livre vindo do público: corta tamanho, remove controles e neutraliza fórmulas de planilha (=, +, -, @). */
function cleanText_(value, maxLen) {
  let text = String(value === undefined || value === null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return text;
}

/** Número BR canônico para comparação exata: só dígitos, sem o prefixo de país 55 (DDD + número = 10 ou 11 dígitos). */
function canonicalPhone_(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.indexOf('55') === 0) digits = digits.slice(2);
  return digits;
}

/** Confere os primeiros bytes do arquivo (não confia no MIME enviado pelo navegador). */
function assinaturaComprovanteValida_(base64, mime) {
  let bytes;
  try {
    bytes = Utilities.base64Decode(base64);
  } catch (err) {
    return false;
  }
  if (!bytes || bytes.length < 12 || bytes.length > MAX_COMPROVANTE_BYTES) return false;
  const b = Array.prototype.slice.call(bytes, 0, 12).map(function (v) { return v & 0xff; });
  const ascii = function (from, to) { return String.fromCharCode.apply(null, b.slice(from, to)); };
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b[0] === 0x89 && ascii(1, 4) === 'PNG';
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (mime === 'application/pdf') return ascii(0, 4) === '%PDF';
  return false;
}

function normalizeWhatsapp_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) {
    throw new Error('WhatsApp inválido. Informe DDD + número.');
  }
  return digits;
}

function parsePayload_(e) {
  let payload = {};

  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(function (key) {
      payload[key] = e.parameter[key];
    });
  }

  if (e && e.postData && e.postData.contents) {
    const raw = e.postData.contents;
    try {
      const parsed = JSON.parse(raw);
      payload = Object.assign(payload, parsed);
    } catch (ignore) {}
  }

  return payload;
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  ensureHeader_(sheet);
  return sheet;
}

function ensureHeader_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (v) {
    return String(v || '').trim();
  });

  const hasAnyHeader = header.some(function (v) { return v; });
  if (!hasAnyHeader) {
    sheet.getRange(1, 1, 1, COLS.length).setValues([COLS]);
    sheet.setFrozenRows(1);
    formatSheet_(sheet);
    return;
  }

  const missing = COLS.filter(function (col) {
    return header.indexOf(col) === -1;
  });

  if (missing.length) {
    sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
  }

  sheet.setFrozenRows(1);
  formatSheet_(sheet);
}

function formatSheet_(sheet) {
  sheet.getRange(1, 1, 1, COLS.length).setFontWeight('bold').setBackground('#e7f4ff');
  try { sheet.autoResizeColumns(1, COLS.length); } catch (ignore) {}
}

function isValidNumero_(n) {
  return typeof n === 'number' && !isNaN(n) && isFinite(n) && Math.floor(n) === n && n >= START_NUMERO && n <= MAX_NUMERO;
}

function formatCode_(n) {
  return String(n).padStart(4, '0');
}

/**
 * Inicialização com suporte a lote (batch chunking) e modo esparso.
 * Em modo padrão (prefillAll=false), apenas prepara o cabeçalho.
 * Em modo completo (prefillAll=true), preenche em lotes de 1.000 para não estourar o limite de tempo do Google.
 */
function inicializarPlanilha_(prefillAll) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    if (!prefillAll) {
      return 'Planilha preparada em modo esparso (0000 a 9999). Números sem reserva são livres por padrão.';
    }

    const lastRow = sheet.getLastRow();
    const rows = lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, COLS.length).getValues()
      : [];

    const existentes = {};
    rows.forEach(function (row) {
      const rawNum = row[COL.numero];
      if (rawNum !== '' && rawNum !== null && rawNum !== undefined) {
        const numero = Number(rawNum);
        if (isValidNumero_(numero)) existentes[numero] = true;
      }
    });

    const toAppend = [];
    for (let i = START_NUMERO; i <= MAX_NUMERO; i++) {
      if (!existentes[i]) {
        toAppend.push(linhaVazia_(i));
      }
    }

    // Gravação em lotes (chunks) para evitar timeout
    for (let offset = 0; offset < toAppend.length; offset += BATCH_SIZE) {
      const chunk = toAppend.slice(offset, offset + BATCH_SIZE);
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, chunk.length, COLS.length).setValues(chunk);
      SpreadsheetApp.flush();
    }

    formatSheet_(sheet);
    return 'Planilha pré-preenchida com sucesso com 10.000 cotas (0000 a 9999).';
  } finally {
    lock.releaseLock();
  }
}

/**
 * Listagem sanitizada para consulta pública.
 * Remove rigorosamente dados pessoais (nome, whatsapp, comprovante_url).
 * Retorna apenas { numero, status }.
 */
function listarNumeros_(payload) {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const opts = payload || {};
  const hasPanel = opts.panel !== undefined && opts.panel !== null && String(opts.panel).trim() !== '';
  const panelIndex = hasPanel ? Math.max(0, Math.min(99, Number(opts.panel) || 0)) : null;
  const panelFirst = panelIndex !== null ? START_NUMERO + panelIndex * PANEL_SIZE : START_NUMERO;
  const panelLast = panelIndex !== null ? Math.min(MAX_NUMERO, panelFirst + PANEL_SIZE - 1) : MAX_NUMERO;
  const includeAllFree = opts.includeFree === true || opts.includeFree === 'true';

  const values = sheet.getRange(2, 1, lastRow - 1, COLS.length).getValues();
  const out = [];

  for (let i = 0; i < values.length; i++) {
    const rawNum = values[i][COL.numero];
    if (rawNum === '' || rawNum === null || rawNum === undefined) continue;
    const numero = Number(rawNum);
    if (!isValidNumero_(numero)) continue;
    if (panelIndex !== null && (numero < panelFirst || numero > panelLast)) continue;

    const status = String(values[i][COL.status] || 'livre').toLowerCase().trim();
    if (!includeAllFree && status === 'livre') continue;

    // PRIVACIDADE PÚBLICA: apenas numero e status são expostos
    out.push({
      numero: numero,
      status: status
    });
  }

  return out.sort(function (a, b) {
    return Number(a.numero) - Number(b.numero);
  });
}

/**
 * Listagem completa para o painel do responsável (nome, WhatsApp, valor, datas, comprovante).
 * Só roda via requireAdmin_ (POST). Cotas livres não entram: o painel deduz as livres pelo total.
 */
function listarReservasAdmin_() {
  return getRowsWithIndex_(getSheet_())
    .map(function (item) { return item.data; })
    .filter(function (data) { return isValidNumero_(data.numero) && data.status !== 'livre'; })
    .sort(function (a, b) { return a.numero - b.numero; });
}

function rowToObject_(row) {
  return {
    numero: Number(row[COL.numero]),
    status: String(row[COL.status] || 'livre').toLowerCase().trim(),
    nome: row[COL.nome] || '',
    whatsapp: row[COL.whatsapp] || '',
    valor: Number(row[COL.valor] || 0),
    data_reserva: dateToIso_(row[COL.data_reserva]),
    data_pagamento: dateToIso_(row[COL.data_pagamento]),
    observacao: row[COL.observacao] || '',
    comprovante_nome: row[COL.comprovante_nome] || '',
    comprovante_url: row[COL.comprovante_url] || '',
    data_comprovante: dateToIso_(row[COL.data_comprovante]),
    comprovante_tipo: row[COL.comprovante_tipo] || '',
    indicador: row[COL.indicador] || '',
    bonus: String(row[COL.status] || '').toLowerCase().trim() === 'pago' && row[COL.valor] === 0
  };
}

function dateToIso_(value) {
  if (!value) return '';
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return value.toISOString();
  }
  return String(value);
}

function getRowsWithIndex_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, COLS.length).getValues();
  const rows = [];
  for (let index = 0; index < values.length; index++) {
    const rawNum = values[index][COL.numero];
    if (rawNum === '' || rawNum === null || rawNum === undefined) continue;
    const norm = normalizeRow_(values[index]);
    rows.push({
      rowIndex: index + 2,
      values: norm,
      data: rowToObject_(norm)
    });
  }
  return rows;
}

/** Linha vazia (cota livre) com a largura certa da planilha. */
function linhaVazia_(numero) {
  const linha = [numero, 'livre'];
  while (linha.length < COLS.length) linha.push('');
  return linha;
}

function normalizeRow_(row) {
  const out = row.slice(0, COLS.length);
  while (out.length < COLS.length) out.push('');
  return out;
}

/**
 * Reserva de cotas com LockService para garantir integridade e atomicidade sob concorrência.
 */
function reservarNumeros_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const rows = getRowsWithIndex_(sheet);
    const byNumber = {};
    rows.forEach(function (item) {
      if (isValidNumero_(item.data.numero)) {
        byNumber[Number(item.data.numero)] = item;
      }
    });

    const numeros = parseNumeros_(payload.numeros);
    if (!numeros.length) throw new Error('Nenhum número válido informado (0000 a 9999).');
    if (numeros.length > MAX_COTAS_POR_RESERVA) {
      throw new Error('Máximo de ' + MAX_COTAS_POR_RESERVA + ' cotas por reserva.');
    }

    const nome = cleanText_(payload.nome, 80);
    const observacao = cleanText_(payload.observacao, 200);
    const indicador = sanitizeIndicador_(payload.indicador);
    if (nome.length < 2) throw new Error('Nome obrigatório.');
    const whatsapp = normalizeWhatsapp_(payload.whatsapp);
    const preco = calcularPrecoPromocional_(numeros.length);
    validarTotalInformado_(payload.valorTotal, preco.total);
    const valoresPorNumero = distribuirTotalPorCotas_(preco.total, numeros.length);

    numeros.forEach(function (numero, index) {
      const item = byNumber[numero];
      if (item && item.data.status !== 'livre') {
        throw new Error('A cota ' + formatCode_(numero) + ' acabou de ser reservada por outra pessoa.');
      }
    });

    const now = new Date();
    const rowsToAppend = [];

    numeros.forEach(function (numero, index) {
      const item = byNumber[numero];
      const newRow = [
        numero,
        'reservado',
        nome,
        whatsapp,
        valoresPorNumero[index],
        now,
        '',
        observacao,
        '',
        '',
        '',
        '',
        indicador
      ];
      if (item) {
        sheet.getRange(item.rowIndex, 1, 1, COLS.length).setValues([newRow]);
      } else {
        rowsToAppend.push(newRow);
      }
    });

    if (rowsToAppend.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, COLS.length).setValues(rowsToAppend);
    }

    return {
      ok: true,
      numeros: numeros,
      valor_base: preco.base,
      desconto: preco.desconto,
      valor_total: preco.total,
      message: 'Reserva realizada com sucesso!'
    };
  } finally {
    lock.releaseLock();
  }
}

/** Regras canônicas de pacotes (PACOTES_CENTAVOS): 10 por 165, 6 por 100, 3 por 50; sobra vale R$ 18,90. Cobra sempre o MENOR preço possível (ex.: 12 cotas = 6+6 = R$ 200, não 10+2 avulsas = R$ 210). */
function calcularPrecoPromocional_(quantidade) {
  const qtd = Number(quantidade);
  if (!Number.isInteger(qtd) || qtd < 1) throw new Error('Quantidade de cotas inválida.');

  const unitCentavos = Math.round(VALOR_POR_NUMERO * 100);
  const melhor = [0];
  for (let n = 1; n <= qtd; n++) {
    let custo = melhor[n - 1] + unitCentavos;
    PACOTES_CENTAVOS.forEach(function (pacote) {
      if (n >= pacote[0]) custo = Math.min(custo, melhor[n - pacote[0]] + pacote[1]);
    });
    melhor[n] = custo;
  }

  const base = (qtd * unitCentavos) / 100;
  const total = melhor[qtd] / 100;
  return { base: base, desconto: Math.round((base - total) * 100) / 100, total: total };
}

function validarTotalInformado_(informado, esperado) {
  if (informado === undefined || informado === null || informado === '') return;
  const valor = Number(informado);
  if (!Number.isFinite(valor) || Math.round(valor * 100) !== Math.round(esperado * 100)) {
    throw new Error('O valor da reserva não corresponde às promoções vigentes. Atualize a seleção e tente novamente.');
  }
}

function distribuirTotalPorCotas_(total, quantidade) {
  const totalCentavos = Math.round(total * 100);
  const baseCentavos = Math.floor(totalCentavos / quantidade);
  const extras = totalCentavos % quantidade;
  const valores = [];
  for (let index = 0; index < quantidade; index += 1) {
    valores.push((baseCentavos + (index < extras ? 1 : 0)) / 100);
  }
  return valores;
}

/**
 * Envio de comprovante anexado via Drive com concorrência segura.
 */
function enviarComprovante_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const rows = getRowsWithIndex_(sheet);
    const byNumber = {};
    rows.forEach(function (item) {
      if (isValidNumero_(item.data.numero)) {
        byNumber[Number(item.data.numero)] = item;
      }
    });

    const numeros = parseNumeros_(payload.numeros);
    if (!numeros.length) throw new Error('Nenhum número informado para vincular ao comprovante.');

    if (numeros.length > MAX_COTAS_POR_RESERVA) {
      throw new Error('Máximo de ' + MAX_COTAS_POR_RESERVA + ' cotas por comprovante.');
    }

    const arquivoBase64 = String(payload.arquivoBase64 || '').replace(/\s+/g, '');
    const arquivoNome = sanitizeFileName_(payload.arquivoNome || 'comprovante.jpg');
    const arquivoMime = String(payload.arquivoMime || '').trim().toLowerCase();
    // Quem decide a confirmação automática é o servidor (propriedade AUTO_CONFIRMAR), nunca o navegador.
    const autoConfirmar = PropertiesService.getScriptProperties().getProperty('AUTO_CONFIRMAR') === 'true';

    if (!arquivoBase64) throw new Error('Comprovante não enviado.');
    if (MIMES_COMPROVANTE.indexOf(arquivoMime) === -1) {
      throw new Error('Tipo de arquivo não permitido. Envie imagem (JPG, PNG, WebP) ou PDF.');
    }
    if (arquivoBase64.length > Math.ceil(MAX_COMPROVANTE_BYTES * 4 / 3) + 4) {
      throw new Error('Comprovante grande demais (máximo 5 MB).');
    }

    if (!assinaturaComprovanteValida_(arquivoBase64, arquivoMime)) {
      throw new Error('O arquivo não parece ser uma imagem ou PDF válido.');
    }

    // O comprovante só vincula a cotas reservadas (nunca pagas/livres) pelo mesmo WhatsApp (número completo) da reserva.
    const whatsappInformado = normalizeWhatsapp_(payload.whatsapp);
    numeros.forEach(function (numero) {
      const item = byNumber[numero];
      if (!item || item.data.status === 'livre') {
        throw new Error('A cota ' + formatCode_(numero) + ' está livre e não possui reserva pendente.');
      }
      if (item.data.status === 'pago') {
        throw new Error('A cota ' + formatCode_(numero) + ' já está paga.');
      }
      const dono = canonicalPhone_(item.data.whatsapp);
      if (!dono || dono !== canonicalPhone_(whatsappInformado)) {
        throw new Error('O WhatsApp informado não confere com o da reserva da cota ' + formatCode_(numero) + '.');
      }
    });

    const now = new Date();
    const fileUrl = saveProofFile_(arquivoBase64, arquivoNome, arquivoMime, numeros, now);
    const finalStatus = autoConfirmar ? 'pago' : 'reservado';

    numeros.forEach(function (numero) {
      const item = byNumber[numero];
      const row = normalizeRow_(item.values);
      row[COL.status] = finalStatus;
      // Nome, WhatsApp e valor da reserva original são preservados (o comprovante não os sobrescreve).
      row[COL.valor] = Number(row[COL.valor] || VALOR_POR_NUMERO);
      row[COL.data_reserva] = row[COL.data_reserva] || now;
      if (autoConfirmar) row[COL.data_pagamento] = now;
      row[COL.comprovante_nome] = arquivoNome;
      row[COL.comprovante_url] = fileUrl;
      row[COL.data_comprovante] = now;
      row[COL.comprovante_tipo] = arquivoMime;
      sheet.getRange(item.rowIndex, 1, 1, COLS.length).setValues([row]);
    });

    return {
      ok: true,
      numeros: numeros,
      status: finalStatus,
      comprovante_url: fileUrl,
      message: autoConfirmar ? 'Comprovante recebido e pagamento confirmado!' : 'Comprovante recebido para conferência.'
    };
  } finally {
    lock.releaseLock();
  }
}

function saveProofFile_(base64, name, mimeType, numeros, date) {
  const folder = getOrCreateFolder_(COMPROVANTES_FOLDER_NAME);
  const decoded = Utilities.base64Decode(base64);
  if (decoded.length > MAX_COMPROVANTE_BYTES) throw new Error('Comprovante grande demais (máximo 5 MB).');
  const formattedNums = numeros.slice(0, 8).map(formatCode_).join('-');
  const cleanName = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-num-' + formattedNums + '-' + name;
  const blob = Utilities.newBlob(decoded, mimeType, cleanName);
  // Comprovante é dado pessoal: fica privado na pasta do responsável (sem link público).
  const file = folder.createFile(blob);
  return file.getUrl();
}

function getOrCreateFolder_(name) {
  const it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(name);
}

function atualizarStatus_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const sheet = getSheet_();
    const rows = getRowsWithIndex_(sheet);
    const rawNum = payload.numero;
    if (rawNum === undefined || rawNum === null || String(rawNum).trim() === '') {
      throw new Error('Número obrigatório.');
    }
    const numero = Number(rawNum);
    const status = String(payload.status || '').toLowerCase().trim();

    if (!isValidNumero_(numero)) {
      throw new Error('Número inválido. Use entre 0000 e 9999.');
    }
    if (['livre', 'reservado', 'pago'].indexOf(status) === -1) {
      throw new Error('Status inválido. Use livre, reservado ou pago.');
    }

    const item = rows.find(function (row) { return Number(row.data.numero) === numero; });
    const current = item ? normalizeRow_(item.values) : linhaVazia_(numero);
    const now = new Date();
    let targetRow = null;

    if (status === 'livre') {
      targetRow = linhaVazia_(numero);
    } else if (status === 'reservado') {
      targetRow = [
        numero,
        'reservado',
        String(payload.nome || current[COL.nome] || 'Reserva manual').trim(),
        String(payload.whatsapp || current[COL.whatsapp] || '').trim(),
        Number(payload.valorPorNumero || current[COL.valor] || VALOR_POR_NUMERO),
        current[COL.data_reserva] || now,
        '',
        String(payload.observacao || current[COL.observacao] || '').trim(),
        current[COL.comprovante_nome] || '',
        current[COL.comprovante_url] || '',
        current[COL.data_comprovante] || '',
        current[COL.comprovante_tipo] || '',
        current[COL.indicador] || ''
      ];
    } else if (status === 'pago') {
      targetRow = [
        numero,
        'pago',
        String(payload.nome || current[COL.nome] || '').trim(),
        String(payload.whatsapp || current[COL.whatsapp] || '').trim(),
        Number(payload.valorPorNumero || current[COL.valor] || VALOR_POR_NUMERO),
        current[COL.data_reserva] || now,
        now,
        String(payload.observacao || current[COL.observacao] || '').trim(),
        current[COL.comprovante_nome] || '',
        current[COL.comprovante_url] || '',
        current[COL.data_comprovante] || '',
        current[COL.comprovante_tipo] || '',
        current[COL.indicador] || ''
      ];
    }

    if (item) {
      sheet.getRange(item.rowIndex, 1, 1, COLS.length).setValues([targetRow]);
    } else if (status !== 'livre') {
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, COLS.length).setValues([targetRow]);
    }

    return { ok: true, numero: numero, status: status, message: 'Status atualizado com sucesso.' };
  } finally {
    lock.releaseLock();
  }
}

/******************************************************
 * RESULTADO DO SORTEIO
 * Regra pública (a mesma que está no site): Loteria Federal (CAIXA). Vale o número formado pelos 4 últimos dígitos
 * do 1º prêmio; se a cota não foi vendida, apura-se sucessivamente pelo 2º, 3º, 4º e 5º prêmios.
 ******************************************************/
const RESULTADO_SHEET_NAME = 'Resultado';
const RESULTADO_COLS = [
  'data_registro', 'data_extracao', 'premios', 'numero_vencedor', 'ordem_premio_usado', 'status_cota',
  'tipo', 'apuracao', 'nome', 'whatsapp'
];
const RC = RESULTADO_COLS.reduce(function (acc, name, index) { acc[name] = index; return acc; }, {});
const QTD_PREMIOS = 5;
const MIN_DIGITOS_PREMIO = 4;
const MAX_DIGITOS_PREMIO = 10;
// DEFINIÇÃO DE "COTA VENDIDA": só o status 'pago' (pagamento confirmado) conta. 'reservado' (mesmo com comprovante
// enviado e ainda não conferido) e 'livre' NÃO são vendidas e passam para o prêmio seguinte.
const STATUS_COTA_VENDIDA = 'pago';
const STATUS_SEM_GANHADOR = 'sem_ganhador_apuravel';

/** Últimos 4 dígitos do prêmio como número de cota (0000 a 9999). Preserva zeros à esquerda ao formatar com formatCode_. */
function cotaDoPremio_(premio) {
  return Number(String(premio).slice(-4));
}

function validarPremios_(input) {
  let lista = input;
  if (typeof lista === 'string') {
    try { lista = JSON.parse(lista); } catch (ignore) { lista = null; }
  }
  if (!Array.isArray(lista) || lista.length !== QTD_PREMIOS) {
    throw new Error('Informe exatamente os ' + QTD_PREMIOS + ' prêmios da Loteria Federal.');
  }
  return lista.map(function (item, index) {
    // Número do JSON perderia zeros à esquerda (ex.: o zero à esquerda se perderia): só texto é aceito.
    if (typeof item !== 'string') throw new Error('O ' + (index + 1) + 'º prêmio deve ser enviado como texto, só com dígitos.');
    const texto = item.trim();
    if (!/^\d+$/.test(texto)) throw new Error('O ' + (index + 1) + 'º prêmio deve ter só dígitos (sem letras, espaços ou sinais).');
    if (texto.length < MIN_DIGITOS_PREMIO) throw new Error('O ' + (index + 1) + 'º prêmio precisa ter pelo menos ' + MIN_DIGITOS_PREMIO + ' dígitos.');
    if (texto.length > MAX_DIGITOS_PREMIO) throw new Error('O ' + (index + 1) + 'º prêmio tem dígitos demais.');
    return texto;
  });
}

function validarDataExtracao_(valor) {
  const texto = String(valor === undefined || valor === null ? '' : valor).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) throw new Error('Data da extração inválida. Use AAAA-MM-DD.');
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (ano < 2020 || d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) {
    throw new Error('Data da extração inválida. Use AAAA-MM-DD.');
  }
  // Não aceita extração no futuro (1 dia de folga por fuso horário).
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new Error('A data da extração não pode ser futura.');
  return texto;
}

const ORDEM_FECHAMENTO = 6; // 1..5 = prêmio usado; 6 = regra de fechamento (próxima cota vendida acima do 1º prêmio)

/** Aplica a regra pública sobre as linhas da planilha de cotas. Não escreve nada. */
function apurarVencedor_(premios, rows) {
  const porNumero = {};
  rows.forEach(function (item) {
    if (!isValidNumero_(item.data.numero)) return;
    const n = Number(item.data.numero);
    // Se por algum motivo houver linha repetida, 'pago' prevalece.
    if (!porNumero[n] || item.data.status === STATUS_COTA_VENDIDA) porNumero[n] = item;
  });
  const apuracao = [];
  for (let i = 0; i < premios.length; i++) {
    const numero = cotaDoPremio_(premios[i]);
    const item = porNumero[numero];
    const status = item ? item.data.status : 'livre';
    apuracao.push((i + 1) + 'º:' + formatCode_(numero) + '=' + status);
    if (status === STATUS_COTA_VENDIDA) {
      return { numero: numero, ordem: i + 1, status_cota: STATUS_COTA_VENDIDA, item: item, apuracao: apuracao.join('; ') };
    }
  }
  // Regra de fechamento (pública): se nenhuma das 5 cotas apuradas foi vendida, vale a cota VENDIDA de numeração
  // imediatamente acima da do 1º prêmio, voltando ao 0000 depois do 9999. 'ordem' 6 = regra de fechamento.
  const base = cotaDoPremio_(premios[0]);
  for (let passo = 1; passo < TOTAL_NUMEROS; passo++) {
    const candidato = (base + passo) % TOTAL_NUMEROS;
    const achado = porNumero[candidato];
    if (achado && achado.data.status === STATUS_COTA_VENDIDA) {
      apuracao.push('fechamento:' + formatCode_(candidato) + '=' + STATUS_COTA_VENDIDA);
      return { numero: candidato, ordem: ORDEM_FECHAMENTO, status_cota: STATUS_COTA_VENDIDA, item: achado, apuracao: apuracao.join('; ') };
    }
  }
  return { numero: null, ordem: null, status_cota: STATUS_SEM_GANHADOR, item: null, apuracao: apuracao.join('; ') };
}

function getResultadoSheet_(criar) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RESULTADO_SHEET_NAME);
  if (!sheet) {
    if (!criar) return null;
    sheet = ss.insertSheet(RESULTADO_SHEET_NAME);
  }
  if (criar && sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, RESULTADO_COLS.length).setValues([RESULTADO_COLS]);
    try { sheet.setFrozenRows(1); } catch (ignore) {}
  }
  return sheet;
}

/** Linhas do histórico de resultados, da mais antiga para a mais recente. Vale a ÚLTIMA. */
function lerResultados_(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, RESULTADO_COLS.length).getValues();
  const out = [];
  values.forEach(function (row) {
    const premios = String(row[RC.premios] === undefined || row[RC.premios] === null ? '' : row[RC.premios]).split(',').map(function (p) { return p.trim(); }).filter(Boolean);
    if (premios.length !== QTD_PREMIOS) return;
    const bruto = row[RC.numero_vencedor];
    const semNumero = bruto === '' || bruto === null || bruto === undefined;
    out.push({
      data_registro: String(row[RC.data_registro] || ''),
      data_extracao: dateToIsoDay_(row[RC.data_extracao]),
      premios: premios,
      numero_vencedor: semNumero ? null : formatCode_(Number(bruto)),
      ordem_premio_usado: semNumero ? null : Number(row[RC.ordem_premio_usado]),
      status_cota: String(row[RC.status_cota] || ''),
      tipo: String(row[RC.tipo] || '')
    });
  });
  return out;
}

function dateToIsoDay_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  return String(value || '');
}

/** Resposta pública: monta o objeto campo a campo (lista branca). Nunca lê nome, WhatsApp nem comprovante. */
function resultadoPublico_() {
  const historico = lerResultados_(getResultadoSheet_(false));
  if (!historico.length) return { ok: true, registrado: false };
  const atual = historico[historico.length - 1];
  return {
    ok: true,
    registrado: true,
    data_extracao: atual.data_extracao,
    premios: atual.premios.slice(),
    numero_vencedor: atual.numero_vencedor,
    ordem_premio_usado: atual.ordem_premio_usado
  };
}

/**
 * Registra o resultado (admin). Write-once: se já existe resultado, só aceita com corrigir:true — e a correção vira
 * uma NOVA linha (o histórico nunca é apagado nem sobrescrito). Nome e WhatsApp do ganhador ficam só na aba privada
 * 'Resultado' (para auditoria); o dono vê o contato pelo painel (listarAdmin). Esta resposta também não os devolve.
 */
function registrarResultado_(payload) {
  const premios = validarPremios_(payload.premios);
  const dataExtracao = validarDataExtracao_(payload.dataExtracao);
  const corrigir = payload.corrigir === true || payload.corrigir === 'true';

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getResultadoSheet_(true);
    const historico = lerResultados_(sheet);
    if (historico.length && !corrigir) {
      const atual = historico[historico.length - 1];
      throw new Error('Já existe um resultado registrado (extração de ' + atual.data_extracao + '). ' +
        'Ele não pode ser trocado por engano. Para corrigir de propósito, envie corrigir: true; o registro anterior fica guardado no histórico.');
    }

    const apurado = apurarVencedor_(premios, getRowsWithIndex_(getSheet_()));
    const tipo = historico.length ? 'correcao' : 'original';
    const dono = apurado.item ? apurado.item.data : null;
    const linha = [
      new Date().toISOString(),
      dataExtracao,
      premios.join(','),
      apurado.numero === null ? '' : formatCode_(apurado.numero),
      apurado.ordem === null ? '' : apurado.ordem,
      apurado.status_cota,
      tipo,
      apurado.apuracao,
      dono ? String(dono.nome || '') : '',
      dono ? String(dono.whatsapp || '') : ''
    ];
    const destino = sheet.getRange(sheet.getLastRow() + 1, 1, 1, RESULTADO_COLS.length);
    // Formato texto: a planilha não pode transformar "0007" em 7 nem "2026-10-24" em data.
    try { destino.setNumberFormat('@'); } catch (ignore) {}
    destino.setValues([linha]);

    return {
      ok: true,
      registrado: true,
      data_extracao: dataExtracao,
      premios: premios,
      numero_vencedor: apurado.numero === null ? null : formatCode_(apurado.numero),
      ordem_premio_usado: apurado.ordem,
      status_cota: apurado.status_cota,
      tipo: tipo,
      apuracao: apurado.apuracao,
      message: apurado.numero === null
        ? 'Resultado registrado: nenhuma das 5 cotas apuradas foi vendida (paga). Ninguém foi escolhido.'
        : 'Resultado registrado. Cota vencedora: ' + formatCode_(apurado.numero) + ' (' + apurado.ordem + 'º prêmio). Veja o contato do ganhador no painel.'
    };
  } finally {
    lock.releaseLock();
  }
}

function parseNumeros_(input) {
  let numeros = input;

  if (typeof input === 'string') {
    try {
      numeros = JSON.parse(input);
    } catch (ignore) {
      numeros = input.split(',');
    }
  }

  if (!Array.isArray(numeros)) numeros = [numeros];

  const unique = {};
  numeros.forEach(function (item) {
    if (item === '' || item === null || item === undefined) return;
    if (typeof item === 'number') {
      if (isValidNumero_(item)) unique[item] = true;
      return;
    }
    const rawStr = String(item).trim();
    if (!rawStr) return;
    if (/^\d+$/.test(rawStr)) {
      const n = Number(rawStr);
      if (isValidNumero_(n)) unique[n] = true;
      return;
    }
    const match = rawStr.match(/(?:^|[^-\d])(\d{1,4})(?!\d)/);
    if (match) {
      const parsed = Number(match[1]);
      if (isValidNumero_(parsed)) unique[parsed] = true;
    }
  });

  return Object.keys(unique).map(Number).sort(function (a, b) { return a - b; });
}

function sanitizeFileName_(name) {
  return String(name || 'comprovante.jpg')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 90);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/******************************************************
 * PROGRAMA DE VENDEDORES (indicação por link)
 * Qualquer amigo divulga o link com ?v=codigo. A cada 100 cotas PAGAS e confirmadas por esse código, ele ganha
 * 5 cotas grátis (entregues pelo organizador durante as vendas). Só conta cota paga com valor > 0; as cotas de
 * bônus (valor 0) não contam para o próprio bônus. A resposta pública traz só contagens, nunca nomes ou telefones.
 ******************************************************/
const COTAS_POR_BLOCO = 100;
const BONUS_POR_BLOCO = 5;

/** Código do vendedor: minúsculas, sem acento, só letras, números, - e _ (2 a 24). Vazio se não servir. */
function sanitizeIndicador_(value) {
  let text = String(value === undefined || value === null ? '' : value).toLowerCase().trim();
  if (text.normalize) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  text = text.replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  return text.length >= 2 ? text : '';
}

function contarVendedores_(rows) {
  const porCodigo = {};
  rows.forEach(function (item) {
    const data = item.data;
    const codigo = sanitizeIndicador_(data.indicador);
    if (!codigo || !isValidNumero_(data.numero)) return;
    const v = porCodigo[codigo] || (porCodigo[codigo] = { codigo: codigo, cotas_pagas: 0, cotas_pendentes: 0, bonus_entregue: 0 });
    if (data.status === 'pago' && data.bonus) v.bonus_entregue += 1;
    else if (data.status === 'pago' && data.valor > 0) v.cotas_pagas += 1;
    else if (data.status === 'reservado') v.cotas_pendentes += 1;
  });
  return porCodigo;
}

function completarVendedor_(v) {
  const blocos = Math.floor(v.cotas_pagas / COTAS_POR_BLOCO);
  const ganho = blocos * BONUS_POR_BLOCO;
  v.blocos_fechados = blocos;
  v.bonus_ganho = ganho;
  v.bonus_a_entregar = Math.max(0, ganho - v.bonus_entregue);
  v.faltam_para_proximo = COTAS_POR_BLOCO - (v.cotas_pagas % COTAS_POR_BLOCO);
  return v;
}

/** Consulta pública do vendedor: só contagens. */
function vendedorPublico_(codigoBruto) {
  const codigo = sanitizeIndicador_(codigoBruto);
  if (!codigo) throw new Error('Informe o seu código (2 a 24 letras ou números).');
  const mapa = contarVendedores_(getRowsWithIndex_(getSheet_()));
  const v = completarVendedor_(mapa[codigo] || { codigo: codigo, cotas_pagas: 0, cotas_pendentes: 0, bonus_entregue: 0 });
  return {
    ok: true,
    codigo: v.codigo,
    cotas_pagas: v.cotas_pagas,
    cotas_pendentes: v.cotas_pendentes,
    blocos_fechados: v.blocos_fechados,
    bonus_ganho: v.bonus_ganho,
    bonus_entregue: v.bonus_entregue,
    bonus_a_entregar: v.bonus_a_entregar,
    faltam_para_proximo: v.faltam_para_proximo,
    cotas_por_bloco: COTAS_POR_BLOCO,
    bonus_por_bloco: BONUS_POR_BLOCO
  };
}

/** Só administrador: lista de vendedores com o que cada um já ganhou e o que falta entregar. */
function rankingVendedores_() {
  const mapa = contarVendedores_(getRowsWithIndex_(getSheet_()));
  const vendedores = Object.keys(mapa).map(function (k) { return completarVendedor_(mapa[k]); })
    .sort(function (a, b) { return b.cotas_pagas - a.cotas_pagas || (a.codigo < b.codigo ? -1 : 1); });
  const total = vendedores.reduce(function (acc, v) { return acc + v.cotas_pagas; }, 0);
  return { ok: true, vendedores: vendedores, total_indicadas: total, cotas_por_bloco: COTAS_POR_BLOCO, bonus_por_bloco: BONUS_POR_BLOCO };
}

/** Só administrador: entrega cotas de bônus (valor 0, status pago) ao vendedor, até o limite que ele ganhou. */
function darBonus_(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getSheet_();
    const rows = getRowsWithIndex_(sheet);
    const codigo = sanitizeIndicador_(payload.codigo);
    if (!codigo) throw new Error('Informe o código do vendedor.');
    const nome = cleanText_(payload.nome, 80);
    if (nome.length < 2) throw new Error('Nome obrigatório.');
    const whatsapp = normalizeWhatsapp_(payload.whatsapp);
    const numeros = parseNumeros_(payload.numeros);
    if (!numeros.length) throw new Error('Nenhum número válido informado (0000 a 9999).');

    const mapa = contarVendedores_(rows);
    const v = completarVendedor_(mapa[codigo] || { codigo: codigo, cotas_pagas: 0, cotas_pendentes: 0, bonus_entregue: 0 });
    if (numeros.length > v.bonus_a_entregar) {
      throw new Error('Esse vendedor tem ' + v.bonus_a_entregar + ' cota(s) de bônus a receber agora.');
    }

    const byNumber = {};
    rows.forEach(function (item) {
      if (isValidNumero_(item.data.numero)) byNumber[Number(item.data.numero)] = item;
    });
    numeros.forEach(function (numero) {
      const item = byNumber[numero];
      if (item && item.data.status !== 'livre') {
        throw new Error('A cota ' + formatCode_(numero) + ' não está livre.');
      }
    });

    const now = new Date();
    const novas = [];
    numeros.forEach(function (numero) {
      const linha = [numero, 'pago', nome, whatsapp, 0, now, now, 'Bônus de indicação (' + codigo + ')', '', '', '', '', codigo];
      const item = byNumber[numero];
      if (item) sheet.getRange(item.rowIndex, 1, 1, COLS.length).setValues([linha]);
      else novas.push(linha);
    });
    if (novas.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, novas.length, COLS.length).setValues(novas);
    }
    return {
      ok: true,
      codigo: codigo,
      numeros: numeros,
      bonus_a_entregar_restante: v.bonus_a_entregar - numeros.length,
      message: 'Bônus entregue.'
    };
  } finally {
    lock.releaseLock();
  }
}
