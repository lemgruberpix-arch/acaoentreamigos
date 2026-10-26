const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const audio = fs.readFileSync(path.join(root, 'assets', 'motorcycle-rev.mp3'));
const credits = fs.readFileSync(path.join(root, 'docs', 'audio-assets.md'), 'utf8');

assert(/id="engineAudio"[^>]+preload="auto"[^>]+src="assets\/motorcycle-rev\.mp3"/.test(html), 'áudio real precisa ser pré-carregado para tocar sem atraso');
assert(/playMotoSound/.test(html) && /toggleSoundBtn/.test(html), 'controle acessível de som precisa continuar ligado');
assert(audio.length > 50000, 'gravação real editada precisa ter conteúdo de áudio suficiente');
assert(audio.subarray(0, 3).toString('ascii') === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0), 'arquivo precisa ser MP3 válido');
assert(/CC0/.test(credits) && /Joseph Sardin/.test(credits) && /bigsoundbank\.com/.test(credits), 'origem e licença do áudio precisam estar registradas');

console.log('PASS: real motorcycle acceleration audio verified (5 checks).');
