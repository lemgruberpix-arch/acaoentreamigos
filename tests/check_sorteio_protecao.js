const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const cartaz = fs.readFileSync(path.join(root, 'cartaz.html'), 'utf8');
const canvas = fs.readFileSync(path.join(root, 'canvas-instagram.html'), 'utf8');

assert(/31\/12 pela Loteria Federal\*/.test(cartaz), 'cartaz precisa marcar a data com asterisco');
assert(/Se não houver extração da Loteria Federal nessa data, vale a primeira extração seguinte/.test(cartaz), 'cartaz precisa explicar a data alternativa');
assert(/SORTEIO 31\/12 • LOTERIA FEDERAL\*/.test(canvas), 'artes precisam marcar a data com asterisco');
assert(/Se não houver extração nessa data, vale a primeira extração seguinte/.test(canvas), 'artes precisam explicar a data alternativa');
assert(/ctx\.font = "700 42px Arial";\s*ctx\.fillText\("\*Se não houver extração nessa data/.test(canvas), 'rodapé A4 precisa usar ao menos 42 px (~10 pt a 300 dpi)');
assert(/drawVectorQrCode\(ctx, 76, 1502, 158\)/.test(canvas), 'QR do Story precisa ficar fora da faixa inferior de 250 px');
assert(/Link na bio/.test(canvas), 'Story e Feed precisam orientar para o link na bio');

console.log('PASS: protective draw-date copy verified (7 checks).');
