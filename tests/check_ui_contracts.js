const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../assets/style.css'), 'utf8');

const requiredIds = [
  'valorNumeroHero', 'pixHero', 'dataSorteioHero',
  'refreshBtn', 'prevPanelBtn', 'nextPanelBtn', 'panelSelect',
  'searchNumberInput', 'searchNumberBtn', 'panelMetaText',
  'statusMessage', 'numbersGrid', 'selectedNumbersText', 'selectedTotalText',
  'reserveForm', 'reserveBtn', 'nome', 'whatsapp', 'observacao',
  'bottomSummary', 'bottomSelectedText', 'goToFormBtn',
  'successModal', 'modalNumbers', 'modalTotal', 'modalPixKey',
  'pixQrCode', 'pixCopyPaste', 'copyPixAgainBtn', 'copyPixPayloadBtn',
  'openWhatsAppBtn', 'btnDownloadReceipt', 'proofFile', 'proofFileName',
  'sendProofBtn', 'proofMessage', 'clearSelectionBtn'
];

for (const id of requiredIds) {
  assert(html.includes(`id="${id}"`), `Missing required element id="${id}"`);
}

const requiredQuickPicks = ['1', '3', '6', '10'];
for (const qp of requiredQuickPicks) {
  assert(html.includes(`data-quick-pick="${qp}"`), `Missing data-quick-pick="${qp}"`);
}

// Check 48px touch targets in CSS
assert(css.includes('min-height: 44px') || css.includes('min-height: 48px'), 'Missing touch target rule');
assert(css.includes('focus-visible'), 'Missing focus-visible a11y rule');
assert(css.includes('prefers-reduced-motion'), 'Missing reduced-motion a11y rule');

console.log('PASS: All UI contracts, quick picks, and a11y rules verified successfully!');
