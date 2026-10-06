const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/renderer/dashboard-logic.js');

const DAY = 86_400_000;
const NOW = new Date(2026, 9, 5, 18, 0).getTime();

test('greeting follows the time of day', async () => {
  const { greeting } = await load();
  assert.equal(greeting(6), 'Guten Morgen');
  assert.equal(greeting(11), 'Guten Tag');
  assert.equal(greeting(17), 'Guten Tag');
  assert.equal(greeting(18), 'Guten Abend');
  assert.equal(greeting(2), 'Gute Nacht');
});

test('agoText says how long something is ago', async () => {
  const { agoText } = await load();
  assert.equal(agoText(null, NOW), 'noch nie');
  assert.equal(agoText(NOW - 20_000, NOW), 'gerade eben');
  assert.equal(agoText(NOW - 60_000, NOW), 'vor 1 Minute');
  assert.equal(agoText(NOW - 5 * 60_000, NOW), 'vor 5 Minuten');
  assert.equal(agoText(NOW - 3_600_000, NOW), 'vor 1 Stunde');
  assert.equal(agoText(NOW - 7 * 3_600_000, NOW), 'vor 7 Stunden');
  assert.equal(agoText(NOW - DAY, NOW), 'vor 1 Tag');
  assert.equal(agoText(NOW - 45 * DAY, NOW), 'vor 45 Tagen');
  assert.equal(agoText(NOW - 400 * DAY, NOW), 'vor über 1 Jahr');
  assert.equal(agoText(NOW - 800 * DAY, NOW), 'vor über 2 Jahren');
});

test('lastCheckedText takes the most recent check', async () => {
  const { lastCheckedText } = await load();
  assert.equal(lastCheckedText({ mail: null, junk: null }, NOW), 'Noch nie geprüft');
  assert.equal(lastCheckedText({ mail: NOW - 3 * 3_600_000, junk: NOW - 7_200_000 }, NOW), 'Zuletzt geprüft vor 2 Stunden');
});

test('todoItems lists only what really needs attention', async () => {
  const { todoItems } = await load();
  assert.deepEqual(todoItems({ mail: null, junk: null, downloads: null, programs: null }, NOW), []);

  const items = todoItems({
    mail: {
      important: [{ seen: false }, { seen: true }, { seen: false }],
      inbox: [{ label: null }, { label: true }, { label: null }, { label: false }],
      newsletters: [{ count: 3, unsubscribed: null }, { count: 2, unsubscribed: { date: 1 } }, { count: 1, unsubscribed: null }],
      learned: { ready: false },
    },
    junk: [{ id: 'userTemp', bytes: 2048 }, { id: 'recycleBin', bytes: 0 }],
    downloads: [{ size: 1024 }, { size: 1024 }],
    programs: [{ lastUsedMs: NOW - 400 * DAY }, { lastUsedMs: NOW - 10 * DAY }, { lastUsedMs: null }, { lastUsedMs: NOW - 200 * DAY }],
  }, NOW);
  assert.deepEqual(items, [
    { view: 'important', text: '3 wichtige Mails, 2 ungelesen', action: 'Ansehen' },
    { view: 'newsletters', text: '2 Newsletter-Absender zum Abmelden', action: 'Abmelden' },
    { view: 'sort', text: '2 Mails warten auf Einordnen', action: 'Einordnen' },
    { view: 'junk', text: '2,0 KB Systemmüll', action: 'Bereinigen' },
    { view: 'downloads', text: '2 alte Downloads (2,0 KB)', action: 'Ansehen' },
    { view: 'programs', text: '2 Programme seit über 6 Monaten nicht benutzt', action: 'Ansehen' },
  ]);
});

test('todoItems leaves out what is empty or already learned', async () => {
  const { todoItems } = await load();
  const items = todoItems({
    mail: { important: [], inbox: [{ label: null }], newsletters: [], learned: { ready: true } },
    junk: [{ id: 'userTemp', bytes: 0 }],
    downloads: [],
    programs: [{ lastUsedMs: NOW - DAY }],
  }, NOW);
  assert.deepEqual(items, []);
});

test('unusedSince counts programs not used for the given number of days', async () => {
  const { unusedSince, lastUsedText } = await load();
  const programs = [{ lastUsedMs: NOW - 400 * DAY }, { lastUsedMs: null }, { lastUsedMs: NOW - 181 * DAY }, { lastUsedMs: NOW - 5 * DAY }];
  assert.equal(unusedSince(programs, 180, NOW), 2);
  assert.equal(lastUsedText(null, NOW), 'Letzte Nutzung unbekannt');
  assert.equal(lastUsedText(NOW - 400 * DAY, NOW), 'Zuletzt benutzt vor über 1 Jahr');
});

test('driveInfo describes a drive for its bar', async () => {
  const { driveInfo } = await load();
  assert.deepEqual(driveInfo({ letter: 'C', totalBytes: 1000 * 1024 ** 3, freeBytes: 250 * 1024 ** 3 }), {
    label: 'C: 250,0 GB frei von 1000,0 GB', usedPercent: 75, low: false,
  });
  assert.equal(driveInfo({ letter: 'D', totalBytes: 100, freeBytes: 5 }).low, true);
  assert.equal(driveInfo({ letter: 'E', totalBytes: 0, freeBytes: 0 }).usedPercent, 0);
});

test('versions are compared number by number', async () => {
  const { compareVersions } = await load();
  assert.equal(compareVersions('0.3.0', '0.2.1'), 1);
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.2.1', '0.3.0'), -1);
  assert.equal(compareVersions('', '0.1.0'), -1);
});

test('changelogSince returns what is new since the last seen version', async () => {
  const { changelogSince } = await load();
  const entries = [
    { version: '0.3.0', items: ['c'] },
    { version: '0.2.1', items: ['b'] },
    { version: '0.2.0', items: ['a'] },
  ];
  // First start ever (or first start of a version that knows the change log): only the current version.
  assert.deepEqual(changelogSince(entries, '', '0.3.0').map((e) => e.version), ['0.3.0']);
  assert.deepEqual(changelogSince(entries, '0.2.0', '0.3.0').map((e) => e.version), ['0.3.0', '0.2.1']);
  assert.deepEqual(changelogSince(entries, '0.3.0', '0.3.0'), []);
  // Never shows versions newer than the running one.
  assert.deepEqual(changelogSince(entries, '0.2.0', '0.2.1').map((e) => e.version), ['0.2.1']);
  // A downgrade shows nothing.
  assert.deepEqual(changelogSince(entries, '0.3.0', '0.2.1'), []);
});

test('needsUpdateBadge is true while an update waits', async () => {
  const { needsUpdateBadge } = await load();
  for (const status of ['available', 'downloading', 'ready']) assert.equal(needsUpdateBadge({ status }), true, status);
  for (const status of ['idle', 'checking', 'none', 'error', 'disabled']) assert.equal(needsUpdateBadge({ status }), false, status);
  assert.equal(needsUpdateBadge(null), false);
});

test('greetingLine adds the name when one is set', async () => {
  const { greetingLine } = await load();
  assert.equal(greetingLine(19, 'Alex'), 'Guten Abend, Alex');
  assert.equal(greetingLine(8, '  '), 'Guten Morgen');
  assert.equal(greetingLine(8, undefined), 'Guten Morgen');
});

test('dateLine shows weekday, date and time', async () => {
  const { dateLine } = await load();
  assert.equal(dateLine(new Date(2026, 9, 6, 17, 5)), 'Dienstag, 6. Oktober · 17:05');
});

test('summaryText says in one sentence what is waiting', async () => {
  const { summaryText } = await load();
  const none = { mail: null, junk: null, downloads: null, programs: null };
  assert.equal(summaryText(none, null, NOW), 'Noch nichts geprüft. „Alles prüfen" zeigt, was ansteht.');
  assert.equal(summaryText(none, { junk: NOW - 2 * DAY }, NOW), 'Zuletzt geprüft vor 2 Tagen.');

  const mail = { important: [{ seen: false }, { seen: true }, { seen: true }] };
  const junk = [{ bytes: 1024 ** 3 }, { bytes: 1024 ** 3 }];
  const downloads = [{ size: 1024 ** 3 }];
  assert.match(summaryText({ ...none, mail, junk, downloads }, null, NOW), /^3 wichtige Mails warten, und 3[,0]* GB lassen sich freigeben\.$/);
  assert.equal(summaryText({ ...none, mail: { important: [{ seen: false }] } }, null, NOW), '1 wichtige Mail wartet.');
  assert.match(summaryText({ ...none, junk }, null, NOW), /^2[,0]* GB lassen sich freigeben\.$/);
  assert.equal(summaryText({ ...none, mail: { important: [] }, junk: [] }, null, NOW), 'Alles erledigt. Im Moment steht nichts an.');
});

test('tipOfDay gives the same tip all day and another one the next day', async () => {
  const { tipOfDay, TIPS } = await load();
  assert.ok(TIPS.length >= 10);
  const morning = tipOfDay(new Date(2026, 9, 6, 7, 0));
  assert.equal(tipOfDay(new Date(2026, 9, 6, 23, 30)), morning);
  assert.notEqual(tipOfDay(new Date(2026, 9, 7, 7, 0)), morning);
  assert.ok(TIPS.includes(morning));
});
