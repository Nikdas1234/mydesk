const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/view-logic.js');

const file = (path, mtimeMs, size = 100) => ({ path, mtimeMs, size });
const group = (hash, files) => ({ hash, size: 100, reclaimableBytes: 100 * (files.length - 1), files });

test('parseNumber accepts only values inside the range', async () => {
  const { parseNumber } = await load();
  assert.equal(parseNumber('90', { min: 1, max: 3650, integer: true }), 90);
  assert.equal(parseNumber(' 5 ', { min: 1, max: 3650, integer: true }), 5);
  assert.equal(parseNumber('0', { min: 1, max: 3650, integer: true }), null);
  assert.equal(parseNumber('3651', { min: 1, max: 3650, integer: true }), null);
  assert.equal(parseNumber('2.5', { min: 1, max: 3650, integer: true }), null);
  assert.equal(parseNumber('', { min: 0, max: 102400 }), null);
  assert.equal(parseNumber('abc', { min: 0, max: 102400 }), null);
  assert.equal(parseNumber('Infinity', { min: 0, max: 102400 }), null);
  assert.equal(parseNumber('0', { min: 0, max: 102400 }), 0);
  assert.equal(parseNumber('0.5', { min: 0, max: 102400 }), 0.5);
  assert.equal(parseNumber('102400', { min: 0, max: 102400 }), 102400);
  assert.equal(parseNumber('102401', { min: 0, max: 102400 }), null);
});

const junkRow = (id, label, bytes, files, extra = {}) => ({ id, label, admin: false, bytes, files, unreadable: false, ...extra });

test('initialJunkSelection ticks categories with content but never the recycle bin', async () => {
  const { initialJunkSelection } = await load();
  const rows = [
    junkRow('userTemp', 'Temporäre Dateien', 4096, 3),
    junkRow('recycleBin', 'Papierkorb', 9999, 12),
    junkRow('browserCache', 'Browser-Cache', 0, 0),
    junkRow('windowsTemp', 'Temporäre Dateien von Windows', 10, 1, { admin: true }),
  ];
  assert.deepEqual([...initialJunkSelection(rows)].sort(), ['userTemp', 'windowsTemp']);
  assert.deepEqual([...initialJunkSelection([junkRow('recycleBin', 'Papierkorb', 5, 1)])], []);
});

test('junkConfirm lists every chosen category with count and size, then the sum', async () => {
  const { junkConfirm } = await load();
  const { message, details } = junkConfirm([
    junkRow('userTemp', 'Temporäre Dateien', 1024 * 1024, 3),
    junkRow('browserCache', 'Browser-Cache', 2 * 1024 * 1024, 1),
  ]);
  assert.equal(details.length, 3);
  assert.equal(details[0], 'Temporäre Dateien: 3 Dateien, 1,0 MB');
  assert.equal(details[1], 'Browser-Cache: 1 Datei, 2,0 MB');
  assert.equal(details[2], 'Summe: 4 Dateien, 3,0 MB');
  assert.match(message, /endgültig/);
  assert.doesNotMatch(message, /Papierkorb wird vollständig geleert/);
});

test('junkConfirm warns that the recycle bin is emptied completely, only when chosen', async () => {
  const { junkConfirm } = await load();
  const sentence = 'Der Papierkorb wird vollständig geleert – auch was seit der letzten Prüfung hineingelegt wurde.';
  const withBin = junkConfirm([junkRow('recycleBin', 'Papierkorb', 100, 2)]);
  assert.ok(withBin.message.includes(sentence));
  const without = junkConfirm([junkRow('userTemp', 'Temporäre Dateien', 100, 2)]);
  assert.ok(!without.message.includes('vollständig geleert'));
});

test('junkConfirm says "Größe unbekannt" for an unreadable category, never 0 B', async () => {
  const { junkConfirm } = await load();
  const { details } = junkConfirm([
    junkRow('windowsTemp', 'Temporäre Dateien von Windows', 0, 0, { admin: true, unreadable: true }),
    junkRow('userTemp', 'Temporäre Dateien', 1024, 1),
  ]);
  assert.equal(details[0], 'Temporäre Dateien von Windows: Größe unbekannt');
  assert.ok(details.every((line) => !line.includes('0 B')), details.join(' | '));
  assert.match(details[2], /^Summe: mindestens 1,0 KB, 1 Datei/);
  assert.match(details[2], /Größe unbekannt/);
});

test('sandboxLabel is null in real mode and names the folder in practice mode', async () => {
  const { sandboxLabel } = await load();
  assert.equal(sandboxLabel({ sandbox: false, sandboxDir: null }), null);
  assert.equal(sandboxLabel(null), null);
  assert.equal(sandboxLabel(undefined), null);
  assert.equal(sandboxLabel({ sandbox: true, sandboxDir: 'C:\\Test\\Sb' }), 'Übungsmodus – C:\\Test\\Sb');
  assert.equal(sandboxLabel({ sandbox: true, sandboxDir: null }), 'Übungsmodus');
});

// ---- mail ----

test('unsubscribeConfirm explains the way that will be used', async () => {
  const { unsubscribeConfirm } = await load();
  const base = { fromName: 'Modehaus', fromAddress: 'news@mode.example', address: 'max@gmx.de' };
  assert.deepEqual(unsubscribeConfirm({ ...base, method: 'oneclick' }), {
    title: 'Von Modehaus abmelden?',
    message: 'Die Abmeldung wird direkt an den Absender gesendet.',
    confirmLabel: 'Abmelden',
  });
  assert.equal(
    unsubscribeConfirm({ ...base, method: 'mail' }).message,
    'Von max@gmx.de wird eine Abmelde-Mail an den Absender gesendet.',
  );
  assert.equal(
    unsubscribeConfirm({ ...base, method: 'browser' }).message,
    'Der Abmeldelink wird im Browser geöffnet – dort schließt du die Abmeldung selbst ab.',
  );
  assert.equal(unsubscribeConfirm({ ...base, fromName: '', method: 'oneclick' }).title, 'Von news@mode.example abmelden?');
});

test('removeConfirm names count and sender', async () => {
  const { removeConfirm } = await load();
  assert.deepEqual(removeConfirm({ fromName: 'Modehaus', fromAddress: 'n@m.example', count: 3 }), {
    title: 'Mails entfernen?',
    message: '3 Mails von Modehaus in den Papierkorb des Postfachs verschieben?',
    confirmLabel: 'Verschieben',
  });
  assert.match(removeConfirm({ fromName: '', fromAddress: 'n@m.example', count: 1 }).message, /^1 Mail von n@m\.example /);
});

test('unsubscribeResultText covers every outcome', async () => {
  const { unsubscribeResultText } = await load();
  assert.equal(unsubscribeResultText({ type: 'oneclick', ok: true }), 'Abgemeldet.');
  assert.equal(unsubscribeResultText({ type: 'mail', ok: true }), 'Abmelde-Mail gesendet.');
  assert.equal(unsubscribeResultText({ type: 'browser', ok: true }), 'Im Browser geöffnet.');
  assert.equal(unsubscribeResultText({ type: 'mail', ok: false, detail: 'Server nicht erreichbar' }), 'Abmeldung fehlgeschlagen: Server nicht erreichbar');
  assert.equal(unsubscribeResultText({ type: 'mail', ok: false, detail: null }), 'Abmeldung fehlgeschlagen: unbekannter Fehler');
});

test('formatDate and accountErrorText are readable', async () => {
  const { formatDate, accountErrorText } = await load();
  assert.equal(formatDate(new Date(2026, 9, 4, 12).getTime()), '04.10.2026');
  assert.equal(formatDate(0), '');
  assert.equal(
    accountErrorText({ address: 'a@gmx.de', message: 'Anmeldung abgelehnt', hint: 'IMAP freischalten' }),
    'a@gmx.de: Anmeldung abgelehnt – IMAP freischalten',
  );
  assert.equal(accountErrorText({ address: 'a@gmx.de', message: 'Server nicht erreichbar', hint: null }), 'a@gmx.de: Server nicht erreichbar');
});

test('mailTiles sums up the scan for the overview', async () => {
  const { mailTiles } = await load();
  assert.deepEqual(mailTiles(null), null);
  assert.deepEqual(
    mailTiles({
      important: [{ seen: false }, { seen: true }, { seen: false }],
      newsletters: [{ count: 3 }, { count: 2 }],
      errors: [],
    }),
    { important: 3, unread: 2, senders: 2, mails: 5 },
  );
});

test('learnedText explains how far the learning is', async () => {
  const { learnedText } = await load();
  assert.equal(
    learnedText({ important: 0, other: 0, ready: false }),
    'Noch nichts gelernt. Ordne Mails ein: ab je 5 wichtigen und nicht wichtigen sortiert das Programm neue Mails nach ihrem Inhalt.',
  );
  assert.equal(
    learnedText({ important: 3, other: 1, ready: false }),
    'Gelernt aus 3 wichtigen und 1 nicht wichtigen Mails. Es fehlen noch 2 wichtige und 4 nicht wichtige, bis das Programm nach dem Inhalt sortiert.',
  );
  assert.equal(
    learnedText({ important: 7, other: 2, ready: false }),
    'Gelernt aus 7 wichtigen und 2 nicht wichtigen Mails. Es fehlen noch 3 nicht wichtige, bis das Programm nach dem Inhalt sortiert.',
  );
  assert.equal(
    learnedText({ important: 6, other: 9, ready: true }),
    'Gelernt aus 6 wichtigen und 9 nicht wichtigen Mails. Neue Mails werden nach ihrem Inhalt sortiert.',
  );
});

test('bulkRemove describes what the button for all unsubscribed senders would do', async () => {
  const { bulkRemove } = await load();
  const senders = [
    { key: 'a', count: 3, unsubscribed: { date: 1 } },
    { key: 'b', count: 2, unsubscribed: null },
    { key: 'c', count: 4, unsubscribed: null },
    { key: 'd', count: 5, unsubscribed: { date: 1 } },
  ];
  // c was unsubscribed in this session, d's mails were already removed.
  const changes = new Map([['c', { unsubscribed: { date: 2 } }], ['d', { removed: true }]]);
  assert.deepEqual(bulkRemove(senders, changes), {
    senders: 2,
    mails: 7,
    message: '7 Mails von 2 abgemeldeten Absendern in den Papierkorb des Postfachs verschieben?',
  });
  assert.equal(bulkRemove([senders[1]], new Map()).senders, 0);
  assert.equal(
    bulkRemove([senders[0]], new Map()).message,
    '3 Mails von 1 abgemeldeten Absender in den Papierkorb des Postfachs verschieben?',
  );
});

test('updateBanner says what the title bar shows for every update state', async () => {
  const { updateBanner } = await load();
  const s = (status, extra = {}) => ({ status, currentVersion: '0.1.0', version: null, percent: null, message: null, ...extra });
  for (const quiet of ['disabled', 'idle', 'checking', 'none', 'error']) assert.equal(updateBanner(s(quiet)), null, quiet);
  assert.deepEqual(updateBanner(s('available', { version: '0.2.0' })), {
    text: 'Version 0.2.0 ist verfügbar', action: 'download', label: 'Herunterladen',
  });
  assert.deepEqual(updateBanner(s('downloading', { version: '0.2.0', percent: 42 })), {
    text: 'Version 0.2.0 wird geladen … 42 %', action: null, label: null,
  });
  assert.deepEqual(updateBanner(s('ready', { version: '0.2.0' })), {
    text: 'Version 0.2.0 ist bereit', action: 'install', label: 'Neu starten und installieren',
  });
});

test('updateStatusText describes the state for the settings page', async () => {
  const { updateStatusText } = await load();
  const s = (status, extra = {}) => ({ status, currentVersion: '0.1.0', version: null, percent: null, message: null, ...extra });
  assert.equal(updateStatusText(s('disabled')), 'Version 0.1.0 · Updates gibt es nur in der installierten Fassung.');
  assert.equal(updateStatusText(s('none')), 'Version 0.1.0 · Das ist die neueste Version.');
  assert.equal(updateStatusText(s('checking')), 'Version 0.1.0 · Suche nach Updates …');
  assert.equal(updateStatusText(s('available', { version: '0.2.0' })), 'Version 0.1.0 · Version 0.2.0 ist verfügbar.');
  assert.equal(updateStatusText(s('error', { message: 'offline' })), 'Version 0.1.0 · Update-Suche fehlgeschlagen: offline');
  assert.equal(updateStatusText(s('idle')), 'Version 0.1.0');
});
