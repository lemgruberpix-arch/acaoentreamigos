const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const files = ['cartaz.html', 'canvas-instagram.html'];
const expectedUrl = 'https://lemgruberpix-arch.github.io/acaoentreamigos/';
let checks = 0;
function ok(value, message) { assert(value, message); checks += 1; }

for (const name of files) {
  const html = fs.readFileSync(path.join(ROOT, name), 'utf8');
  ok(!html.includes('acecarmorj.github.io'), name + ': URL antiga removida');
  ok(html.includes(expectedUrl), name + ': URL publica nova presente');
  ok((html.match(/https:\/\/lemgruberpix-arch\.github\.io\/acaoentreamigos\//g) || []).length === 1,
    name + ': URL publica definida uma unica vez');
  ok(/assets\/qrcode-rifa\.png/.test(html), name + ': usa QR local');
  ok(!/api\.qrserver\.com/.test(html), name + ': sem dependencia remota de QR em tempo de uso');
  ok(/assets\/capacete-premio\.jpg/.test(html), name + ': mostra o capacete');
  ok(/assets\/(xre190-hero\.jpg|motocross\.jpg|motocross-hero\.png)/.test(html), name + ': mostra a moto');
  ok(/3 (?:por|Cotas:?) R\$ 50/.test(html), name + ': combo de 3 correto');
  ok(/6 (?:por|Cotas:?) R\$ 100/.test(html), name + ': combo de 6 correto');
  ok(/10 (?:por|Cotas:?) R\$ 170/.test(html), name + ': combo de 10 correto');
  ok(!/3 (?:por|Cotas:?) R\$ 55|5 (?:por|Cotas:?) R\$ 90/.test(html), name + ': combos antigos removidos');

  const scripts = [];
  html.replace(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (_, code) => { scripts.push(code); return ''; });
  scripts.forEach((code, i) => { new vm.Script(code, { filename: name + '#script-' + i }); checks += 1; });
}

const canvas = fs.readFileSync(path.join(ROOT, 'canvas-instagram.html'), 'utf8');
ok(/id="feedCanvas" width="1080" height="1350"/.test(canvas), 'canvas Instagram retrato mede 1080x1350');
ok(/id="storyCanvas" width="1080" height="1920"/.test(canvas), 'canvas Stories mede 1080x1920');
ok(/id="posterA4Canvas" width="2480" height="3508"/.test(canvas), 'canvas A4 mede 2480x3508');

const qrPath = path.join(ROOT, 'assets', 'qrcode-rifa.png');
const qr = fs.readFileSync(qrPath);
ok(qr.length > 1000, 'QR local nao esta vazio');
ok(qr.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'QR local e PNG valido');
ok(qr.readUInt32BE(16) >= 1000 && qr.readUInt32BE(20) >= 1000, 'QR tem resolucao adequada para impressao');

console.log('PASS: poster and social contracts verified (' + checks + ' checks).');
