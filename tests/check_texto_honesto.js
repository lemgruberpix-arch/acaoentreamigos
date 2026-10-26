// Texto honesto: nenhuma frase que o app/organizador nao consegue cumprir ou provar pode voltar a aparecer
// no site, no cartaz ou no canvas do Instagram. Ignora comentarios CSS/HTML/JS.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
let checks = 0;
function ok(cond, msg) { assert(cond, msg); checks += 1; }

const PROIBIDAS = [
  [/avisado na hora/i, 'promete aviso instantaneo do ganhador (o aviso e por WhatsApp no mesmo dia)'],
  [/ganhador[^.\n]{0,40}na hora/i, 'ganhador "na hora"'],
  [/transmiss[aã]o integrada/i, 'diz que o app tem transmissao integrada propria'],
  [/pelo nosso canal do youtube/i, 'diz que o sorteio e feito pelo canal proprio (e a Loteria Federal/CAIXA)'],
  [/100% (oficial|auditad)/i, 'selo "100% oficial/auditado" sem prova'],
  [/auditad[oa]/i, '"auditado" sem prova'],
  [/mais escolhido/i, '"mais escolhido" sem prova'],
  [/mude de vida/i, 'promessa de mudar de vida'],
  [/mototaxist/i, 'publico fora do alvo (mototaxistas do Nordeste)'],
  [/nordeste/i, 'regiao fora do alvo'],
  [/davi e vit[oó]ria/i, 'nome da ação de teste anterior'],
  [/garantid[oa]/i, 'promessa de garantia'],
  [/[uú]ltimas cotas/i, 'urgencia que so vale se o contador real confirmar'],
  [/lucro|dinheiro f[aá]cil|renda extra/i, 'promessa de ganho'],
];

function semComentarios(t) {
  return t.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

for (const f of ['index.html', 'cartaz.html', 'canvas-instagram.html', 'README.md', 'regulamento.html']) {
  const t = semComentarios(fs.readFileSync(path.join(root, f), 'utf8'));
  PROIBIDAS.forEach(([re, why]) => ok(!re.test(t), f + ': ' + why));
}

// o que o site DEVE dizer sobre o sorteio (verdadeiro e igual em todo lugar)
const idx = semComentarios(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
ok(/Loteria Federal/.test(idx), 'index.html cita a Loteria Federal');
ok(/WhatsApp no mesmo dia/i.test(idx), 'index.html diz que o ganhador e avisado por WhatsApp no mesmo dia');
ok(/canal oficial da CAIXA/i.test(idx), 'index.html aponta o canal oficial da CAIXA');
ok(/UCPbhr02AfVb2nd5pm12BxTw/.test(idx), 'player usa o ID do canal oficial da CAIXA (verificado em 26/10/2026)');

// premio: moto OU R$ 20 mil no Pix, escolha do ganhador (decisao do Almir, 26/10/2026) - igual no site e na configuracao
const cfg = fs.readFileSync(path.join(root, 'assets', 'config.js'), 'utf8');
ok(/R\$ 20 mil no Pix/.test(cfg) && /escolha do ganhador/.test(cfg), 'config.js: PREMIO_RIFA traz moto ou R$ 20 mil no Pix (escolha do ganhador)');
ok(/O ganhador escolhe: a moto entregue em casa em até 20 dias ou R\$ 20 mil no Pix em até 12 horas/.test(idx), 'index.html: nota do asterisco com a escolha do ganhador');
ok(/contados da escolha do ganhador/.test(idx) && /até 20 \(vinte\) dias/.test(fs.readFileSync(path.join(root, 'regulamento.html'), 'utf8')) && /até 12 \(doze\) horas/.test(fs.readFileSync(path.join(root, 'regulamento.html'), 'utf8')), 'index e regulamento: prazos de 20 dias (moto) e 12 horas (Pix)');

// regulamento: link na cartela e mesma regra de sorteio no site e no regulamento (inclui a regra de fechamento)
const reg = semComentarios(fs.readFileSync(path.join(root, 'regulamento.html'), 'utf8'));
ok(/href="regulamento\.html"/.test(idx), 'index.html tem link para o regulamento');
ok(/id="regulamentoBtn"/.test(idx), 'index.html tem o botao "Ler o regulamento completo"');
ok(/imediatamente acima/.test(idx) && /imediatamente acima/.test(reg), 'site e regulamento trazem a regra de fechamento (cota vendida imediatamente acima)');
ok(/primeira extra[cç][aã]o seguinte/.test(idx) && /primeira extra[cç][aã]o seguinte/.test(reg), 'site e regulamento trazem a regra de data (sem extracao em 31/12, vale a seguinte)');
ok(/4 últimos dígitos do 1º prêmio/.test(idx) && /4 últimos dígitos do 1º prêmio/.test(reg), 'site e regulamento: mesma regra do 1o premio');
ok(/R\$ 20\.000/.test(reg) && /escolhe/.test(reg), 'regulamento traz a opcao de R$ 20 mil no Pix e a escolha do ganhador');
ok(!/autorizad[oa] (pel|pelo|pela)|n[úu]mero de autoriza/i.test(reg), 'regulamento NUNCA afirma autorizacao oficial');

ok(/até 5 \(cinco\) dias/.test(reg) && /sem ônus/.test(reg) && /nome, imagem e voz/.test(reg), 'regulamento: prazo de 5 dias para a escolha e autorizacao de imagem sem onus');

ok(/mais 5 \(cinco\) dias/.test(reg) && /perde o direito ao prêmio/.test(reg), 'regulamento: mais 5 dias de contato e perda do direito');

console.log('PASS: honest text verified (' + checks + ' checks).');
