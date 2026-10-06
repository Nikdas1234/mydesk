const { test } = require('node:test');
const assert = require('node:assert/strict');

test('resultText shows the freed size only when nothing else happened', async () => {
  const { resultText } = await import('../src/renderer/feedback.js');
  assert.equal(resultText({ freedBytes: 5 * 1024 ** 2, skipped: 0 }), '5,0 MB freigegeben');
  assert.equal(resultText({ freedBytes: 0 }), '0 B freigegeben');
});

test('resultText adds skipped files and declined categories', async () => {
  const { resultText } = await import('../src/renderer/feedback.js');
  assert.equal(
    resultText({ freedBytes: 1536, skipped: 3 }),
    '1,5 KB freigegeben · 3 übersprungen',
  );
  assert.equal(
    resultText({ freedBytes: 1536, skipped: 0, declined: ['Papierkorb'] }),
    '1,5 KB freigegeben · Papierkorb nicht bereinigt – Adminrechte wurden abgelehnt',
  );
  assert.equal(
    resultText({ freedBytes: 1536, skipped: 2, declined: ['A', 'B'] }),
    '1,5 KB freigegeben · 2 übersprungen · A, B nicht bereinigt – Adminrechte wurden abgelehnt',
  );
});

test('resultText names categories whose result is unknown', async () => {
  const { resultText } = await import('../src/renderer/feedback.js');
  assert.equal(
    resultText({ freedBytes: 0, skipped: 0, unknown: ['A', 'B'] }),
    '0 B freigegeben · A, B: Ergebnis unbekannt – bitte neu prüfen',
  );
  assert.equal(
    resultText({ freedBytes: 1536, skipped: 1, declined: ['X'], unknown: ['Y'] }),
    '1,5 KB freigegeben · 1 übersprungen · X nicht bereinigt – Adminrechte wurden abgelehnt · Y: Ergebnis unbekannt – bitte neu prüfen',
  );
});
