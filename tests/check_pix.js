// Pix: a chave e o recebedor publicados, o codigo "copia e cola" gerado pelo site e a ausencia da chave/nome antigos.
// Roda sem rede. Leitura do BR Code feita de forma independente (parser TLV + CRC16-CCITT).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// --- config publica ---
const sandbox = {}; sandbox.window = sandbox; vm.createContext(sandbox);
vm.runInContext(read('assets/config.js'), sandbox);
const CFG = sandbox.RIFA_CONFIG;
const KEY = CFG.PIX_KEY;
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(KEY), 'PIX_KEY e uma chave aleatoria (UUID minusculo)');
ok(CFG.PIX_RECEBEDOR === 'ACAO ENTRE AMIGOS', 'recebedor exibido no Pix = ACAO ENTRE AMIGOS');
ok(!/almir|lemgruber/i.test(JSON.stringify(CFG)), 'nome do dono nao aparece na configuracao publica');

// --- a copia embutida em index.html deve ser igual a config.js ---
const idx = read('index.html');
ok(idx.includes('PIX_KEY: "' + KEY + '"'), 'index.html: copia embutida da chave == config.js');
ok(idx.includes('PIX_RECEBEDOR: "ACAO ENTRE AMIGOS"'), 'index.html: recebedor == config.js');

// --- gera o Pix copia e cola com as funcoes REAIS de app.js ---
const app = read('assets/app.js');
function pegar(nome) {
  const i = app.indexOf('function ' + nome + '(');
  ok(i >= 0, 'funcao ' + nome + ' existe em app.js');
  const j = app.indexOf('\n  function ', i + 10);
  return app.slice(i, j > 0 ? j : undefined);
}
const corpo = ['getPixKey', 'buildPixPayload', 'tlv', 'crc16', 'sanitizePixText'].map(pegar).join('\n');
const build = new Function('CFG', corpo + '\nreturn buildPixPayload;')(CFG);
const payload = build({ amount: 50, txid: 'RIFA123' });

// parser TLV independente
function tlv(s) {
  const out = []; let i = 0;
  while (i < s.length) {
    const id = s.slice(i, i + 2); const len = Number(s.slice(i + 2, i + 4));
    ok(Number.isInteger(len) && i + 4 + len <= s.length, 'TLV bem formado em ' + id);
    out.push([id, s.slice(i + 4, i + 4 + len)]); i += 4 + len;
  }
  return out;
}
const campos = Object.fromEntries(tlv(payload));
function crc16(str) { let c = 0xffff; for (let i = 0; i < str.length; i += 1) { c ^= str.charCodeAt(i) << 8; for (let j = 0; j < 8; j += 1) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c.toString(16).toUpperCase().padStart(4, '0'); }
ok(payload.slice(-8, -4) === '6304', 'campo CRC e o ultimo');
ok(payload.slice(-4) === crc16(payload.slice(0, -4)), 'CRC16 do copia e cola confere');
const conta = Object.fromEntries(tlv(campos['26']));
ok(conta['00'] === 'br.gov.bcb.pix', 'GUI do Pix');
ok(conta['01'] === KEY, 'chave dentro do copia e cola == PIX_KEY');
ok(campos['59'] === 'ACAO ENTRE AMIGOS', 'nome do recebedor no copia e cola');
ok(campos['54'] === '50.00', 'valor formatado');
ok(campos['58'] === 'BR' && campos['53'] === '986', 'pais e moeda');
ok(!/WELINGTON|ALMIR|LEMGRUBER/i.test(payload), 'nenhum nome de pessoa no copia e cola');
ok(!payload.includes('22992836392'), 'chave antiga fora do copia e cola');

// --- chave/telefone antigos nao podem sobrar nos arquivos publicos ---
for (const f of ['index.html', 'cartaz.html', 'canvas-instagram.html', 'README.md', 'assets/config.js', 'assets/app.js']) {
  const t = read(f);
  ok(!t.includes('22992836392'), f + ': chave Pix antiga removida');
  ok(!/Titular:\s*WELINGTON/i.test(t) && !/Pix[^\n]{0,40}Welington/i.test(t), f + ': nome do antigo recebedor nao aparece junto da chave Pix');
}

console.log('PASS: pix verified (' + checks + ' checks).');
