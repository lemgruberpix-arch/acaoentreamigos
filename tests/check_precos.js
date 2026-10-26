// Preco dos combos: servidor (apps-script/codigo.gs) e site (assets/app.js) devem cobrar EXATAMENTE o mesmo valor,
// e esse valor deve ser o MENOR possivel (nunca pior que qualquer combinacao de pacotes + cotas avulsas).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }

// --- servidor: carrega o Apps Script em sandbox e le a funcao ---
const gs = fs.readFileSync(path.join(root, 'apps-script', 'codigo.gs'), 'utf8');
const sandbox = {
  console,
  SpreadsheetApp: {}, LockService: {}, PropertiesService: {}, CacheService: {}, ContentService: { MimeType: {} },
  Utilities: {}, Session: {}, DriveApp: {}
};
vm.createContext(sandbox);
vm.runInContext(gs + '\nthis.__preco = calcularPrecoPromocional_; this.__pacotes = PACOTES_CENTAVOS; this.__unit = VALOR_POR_NUMERO;', sandbox);
const servidor = (n) => sandbox.__preco(n).total;
const pacotes = sandbox.__pacotes.map((p) => ({ size: p[0], cents: p[1] }));
const unit = sandbox.__unit * 100;

// --- site: extrai getPromotionPricing de app.js e roda com a mesma configuracao ---
const app = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8');
const start = app.indexOf('function getPromotionPricing(quantity)');
const end = app.indexOf('function setLoading(isLoading)');
ok(start > 0 && end > start, 'getPromotionPricing encontrada em assets/app.js');
const cfgSrc = fs.readFileSync(path.join(root, 'assets', 'config.js'), 'utf8');
const site = {};
site.window = site;
vm.createContext(site);
vm.runInContext(cfgSrc, site);
const CFG = site.RIFA_CONFIG;
ok(CFG && Array.isArray(CFG.PROMOCOES_COTAS), 'config.js expoe RIFA_CONFIG.PROMOCOES_COTAS');
const fn = new Function('CFG', 'getValuePerNumber', app.slice(start, end) + '\nreturn getPromotionPricing;')(CFG, () => Number(CFG.VALOR_NUMERO));
const cliente = (n) => fn(n).total;

// os pacotes do site e do servidor tem de ser os mesmos
const siteP = CFG.PROMOCOES_COTAS.map((p) => [Number(p.quantidade), Math.round(Number(p.valor) * 100)]).sort((a, b) => b[0] - a[0]);
const servP = pacotes.map((p) => [p.size, p.cents]).sort((a, b) => b[0] - a[0]);
ok(JSON.stringify(siteP) === JSON.stringify(servP), 'pacotes do site == pacotes do servidor');
ok(Number(CFG.VALOR_NUMERO) * 100 === unit, 'valor da cota do site == servidor');

// --- referencia independente: forca bruta sobre todas as combinacoes de pacotes ---
function referencia(n) {
  let melhor = Infinity;
  const [a, b, c] = pacotes;
  for (let i = 0; i * a.size <= n; i += 1) {
    for (let j = 0; i * a.size + j * b.size <= n; j += 1) {
      for (let k = 0; i * a.size + j * b.size + k * c.size <= n; k += 1) {
        const resto = n - i * a.size - j * b.size - k * c.size;
        melhor = Math.min(melhor, i * a.cents + j * b.cents + k * c.cents + resto * unit);
      }
    }
  }
  return melhor / 100;
}

for (let n = 1; n <= 200; n += 1) {
  const ref = referencia(n);
  ok(servidor(n) === ref, 'servidor cobra o minimo para ' + n + ' cotas (esperado ' + ref + ', veio ' + servidor(n) + ')');
  ok(cliente(n) === ref, 'site cobra o minimo para ' + n + ' cotas (esperado ' + ref + ', veio ' + cliente(n) + ')');
  ok(cliente(n) === servidor(n), 'site == servidor para ' + n + ' cotas');
  ok(servidor(n) <= n * (unit / 100), 'nunca mais caro que cotas avulsas (' + n + ')');
}

// casos que o calculo antigo cobrava a mais
[[12, 200], [15, 250], [18, 300], [1, 20], [3, 50], [6, 100], [10, 170], [20, 340]].forEach(([n, v]) => {
  ok(servidor(n) === v, 'servidor: ' + n + ' cotas = R$ ' + v);
  ok(cliente(n) === v, 'site: ' + n + ' cotas = R$ ' + v);
});

console.log('PASS: pricing verified, server == site == minimum (' + checks + ' checks).');
