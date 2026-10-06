const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { makeTempDir } = require('./helpers/tmp');
const { createMailService, createJsonLog } = require('../src/main/mail/service');
const { createTrainingStore } = require('../src/main/mail/learn');
const { MailError } = require('../src/main/mail/imap');
const { createDemoBackend } = require('../src/main/mail/demo');

const ONE_CLICK = 'List-Unsubscribe=One-Click';

function message(account, uid, overrides = {}) {
  return {
    account, uid, fromName: 'Erika', fromAddress: 'erika@example.de', subject: 'Hallo', date: uid * 1000,
    seen: true, flagged: false, listUnsubscribe: '', listUnsubscribePost: '', ...overrides,
  };
}

// Everything the service talks to, as recordable fakes. `texts` maps
// "<account>|<uid>" to the text of that mail.
function setup(t, { inboxes = {}, failing = {}, texts = {} } = {}) {
  const dir = makeTempDir(t);
  const accountList = [
    { id: 'a1', address: 'max@gmx.de', provider: 'gmx' },
    { id: 'a2', address: 'max@gmail.com', provider: 'gmail' },
  ];
  const settingsValue = { mailSinceDays: 90, importantKeywords: ['Rechnung'] };
  const log = { moved: [], sent: [], fetched: [], opened: [], texts: [], sinceDays: [], textRequests: [] };
  const deps = {
    accounts: {
      list: () => accountList,
      getPassword: (id) => `pw-${id}`,
      save: (account) => ({ id: 'neu', address: account.address, provider: account.provider }),
      remove: () => {},
    },
    settings: { load: () => settingsValue, save: (patch) => Object.assign(settingsValue, patch) },
    openMailbox: (account, password) => ({
      async fetchHeaders({ sinceDays, signal }) {
        log.sinceDays.push(sinceDays);
        if (signal?.aborted) throw new DOMException('cancelled', 'AbortError');
        if (failing[account.id]) throw failing[account.id];
        assert.equal(password, `pw-${account.id}`);
        return inboxes[account.id] ?? [];
      },
      async fetchTexts(uids) {
        log.textRequests.push([account.id, uids]);
        return new Map(uids.map((uid) => [uid, texts[`${account.id}|${uid}`] ?? '']));
      },
      async fetchText(uid) { log.texts.push([account.id, uid]); return `Text ${uid}`; },
      async moveToTrash(uids, options) {
        if (failing[`move-${account.id}`]) throw failing[`move-${account.id}`];
        log.moved.push([account.id, uids, options]);
        return uids.length;
      },
      async test() { if (failing[account.id]) throw failing[account.id]; },
    }),
    sendMail: async (mail) => { log.sent.push(mail); },
    fetch: async (url) => { log.fetched.push(url); return { status: 200 }; },
    openExternal: async (url) => { log.opened.push(url); },
    logStore: createJsonLog(path.join(dir, 'unsubscribed.json')),
    training: createTrainingStore(path.join(dir, 'training.json')),
    now: () => 5_000_000,
  };
  return { dir, deps, log, service: createMailService(deps) };
}

const INBOXES = {
  a1: [
    message('a1', 1, { subject: 'Ihre Rechnung', seen: false }),
    message('a1', 2, { fromName: 'Shop', fromAddress: 'news@shop.de', listUnsubscribe: '<https://shop.de/u>', listUnsubscribePost: ONE_CLICK }),
    message('a1', 3, { fromName: 'Shop', fromAddress: 'news@shop.de', listUnsubscribe: '<https://shop.de/u>', listUnsubscribePost: ONE_CLICK }),
    message('a1', 4, { subject: 'Wie gehts' }),
    message('a1', 5, { fromName: 'Blatt', fromAddress: 'post@blatt.de', listUnsubscribe: '<mailto:off@blatt.de>' }),
    message('a1', 6, { fromName: 'Ohne', fromAddress: 'x@ohne.de', listUnsubscribe: 'kaputt' }),
  ],
  a2: [
    message('a2', 9, { flagged: true }),
    message('a2', 8, { fromName: 'Web', fromAddress: 'info@web.org', listUnsubscribe: '<https://web.org/u>' }),
  ],
};

test('scan sorts the mails and lists everything that is no newsletter in the inbox', async (t) => {
  const { service, log } = setup(t, { inboxes: INBOXES });
  const result = await service.scan();

  assert.deepEqual(result.errors, []);
  assert.equal(result.sinceDays, 90);
  assert.deepEqual(result.important.map((m) => [m.account, m.uid, m.reason, m.address]), [
    ['a2', 9, 'Markiert', 'max@gmail.com'],
    ['a1', 1, 'Stichwort: Rechnung', 'max@gmx.de'],
  ]);
  assert.deepEqual(result.inbox.map((m) => [m.uid, m.important, m.label]), [
    [9, true, null], [4, false, null], [1, true, null],
  ]);
  assert.deepEqual(result.newsletters.map((n) => [n.key, n.count, n.method, n.unsubscribed]), [
    ['a1|news@shop.de', 2, 'oneclick', null],
    ['a1|post@blatt.de', 1, 'mail', null],
    ['a1|x@ohne.de', 1, null, null],
    ['a2|info@web.org', 1, 'browser', null],
  ]);
  assert.deepEqual(result.learned, { important: 0, other: 0, ready: false });
  assert.deepEqual(log.sinceDays, [90, 90]);
  // Neither raw headers nor the words of a mail go to the page.
  assert.equal(result.newsletters[0].listUnsubscribe, undefined);
  assert.equal(result.inbox[0].tokens, undefined);
});

test('texts are fetched only for mails that are no newsletters, and only once per session', async (t) => {
  const { service, log } = setup(t, { inboxes: INBOXES });
  await service.scan();
  assert.deepEqual(log.textRequests, [['a1', [1, 4]], ['a2', [9]]]);
  await service.scan();
  assert.equal(log.textRequests.length, 2);
});

test('a keyword in the text counts like one in the subject', async (t) => {
  const { service } = setup(t, { inboxes: INBOXES, texts: { 'a1|4': 'anbei die Rechnung für Oktober' } });
  assert.deepEqual((await service.scan()).important.map((m) => m.uid), [9, 4, 1]);
});

test('scan reports progress per account', async (t) => {
  const { service } = setup(t, { inboxes: INBOXES });
  const seen = [];
  await service.scan({ onProgress: (p) => seen.push(p) });
  assert.deepEqual(seen, [
    { account: 'max@gmx.de', done: 0, total: 2 },
    { account: 'max@gmail.com', done: 1, total: 2 },
  ]);
});

test('a failing account is reported and the others still deliver', async (t) => {
  const { service } = setup(t, {
    inboxes: INBOXES,
    failing: { a1: new MailError('auth', 'Anmeldung abgelehnt', 'LOGIN failed') },
  });
  const result = await service.scan();
  assert.deepEqual(result.errors, [{
    account: 'a1', address: 'max@gmx.de', kind: 'auth', message: 'Anmeldung abgelehnt',
    hint: 'IMAP in den GMX-Einstellungen freischalten',
  }]);
  assert.ok(!JSON.stringify(result).includes('pw-a1'));
  assert.deepEqual(result.important.map((m) => m.uid), [9]);
  assert.equal(result.newsletters.length, 1);
});

test('a network failure carries no provider hint', async (t) => {
  const { service } = setup(t, { failing: { a2: new MailError('network', 'Server nicht erreichbar') } });
  const { errors } = await service.scan();
  assert.deepEqual(errors, [{ account: 'a2', address: 'max@gmail.com', kind: 'network', message: 'Server nicht erreichbar', hint: null }]);
});

test('a decision moves the mail at once and can be taken back', async (t) => {
  const { service } = setup(t, { inboxes: INBOXES });
  await service.scan();

  let result = await service.label({ account: 'a1', uid: 4, important: true });
  assert.deepEqual(result.important.map((m) => m.uid), [9, 4, 1]);
  const four = result.inbox.find((m) => m.uid === 4);
  assert.deepEqual([four.important, four.label, four.reason], [true, true, 'Von dir als wichtig eingeordnet']);
  assert.deepEqual(result.learned, { important: 1, other: 0, ready: false });

  result = await service.label({ account: 'a1', uid: 1, important: false });
  assert.deepEqual(result.important.map((m) => m.uid), [9, 4]);

  result = await service.label({ account: 'a1', uid: 1, important: null });
  assert.deepEqual(result.important.map((m) => m.uid), [9, 4, 1]);
  assert.deepEqual(result.learned, { important: 1, other: 0, ready: false });

  await assert.rejects(service.label({ account: 'a1', uid: 999, important: true }));
});

test('after enough decisions new mails are sorted by their content', async (t) => {
  const inbox = [];
  const texts = {};
  for (let uid = 1; uid <= 6; uid += 1) {
    inbox.push(message('a1', uid, { subject: `Abrechnung ${uid}` }));
    texts[`a1|${uid}`] = 'Mietvertrag Nebenkosten Abrechnung Hausverwaltung';
    inbox.push(message('a1', uid + 10, { subject: `Aktion ${uid}` }));
    texts[`a1|${uid + 10}`] = 'Gewinnspiel Rabatt Angebot Gutschein';
  }
  inbox.push(message('a1', 50, { subject: 'Neu', date: 99_000 }));
  texts['a1|50'] = 'Ihre Nebenkosten Abrechnung zum Mietvertrag';
  inbox.push(message('a1', 51, { subject: 'Rechnung', date: 98_000 }));
  texts['a1|51'] = 'Gewinnspiel mit Rabatt und Gutschein';

  const { service, deps } = setup(t, { inboxes: { a1: inbox }, texts });
  await service.scan();
  let result;
  for (let uid = 1; uid <= 6; uid += 1) {
    await service.label({ account: 'a1', uid, important: true });
    result = await service.label({ account: 'a1', uid: uid + 10, important: false });
  }
  assert.deepEqual(result.learned, { important: 6, other: 6, ready: true });
  const neu = result.inbox.find((m) => m.uid === 50);
  assert.equal(neu.important, true);
  assert.match(neu.reason, /^Gelernt \(\d+ %\)$/);
  // The keyword "Rechnung" no longer decides once the content says otherwise.
  assert.equal(result.inbox.find((m) => m.uid === 51).important, false);

  // What was learned survives a restart, and can be reset.
  const restarted = createMailService(deps);
  assert.equal((await restarted.scan()).inbox.find((m) => m.uid === 50).important, true);
  const reset = await restarted.resetLearning();
  assert.deepEqual(reset.learned, { important: 0, other: 0, ready: false });
  assert.equal(reset.inbox.find((m) => m.uid === 51).reason, 'Stichwort: Rechnung');
});

test('readText, unsubscribe and removeSender refuse unknown keys', async (t) => {
  const { service, log } = setup(t, { inboxes: INBOXES });
  await assert.rejects(service.readText({ account: 'a1', uid: 1 }));
  await service.scan();
  assert.equal(await service.readText({ account: 'a1', uid: 1 }), 'Text 1');
  await assert.rejects(service.readText({ account: 'a1', uid: 999 }));
  await assert.rejects(service.readText({ account: 'a2', uid: 1 }));
  await assert.rejects(service.unsubscribe('a1|fremd@x.de'));
  await assert.rejects(service.removeSender('a1|fremd@x.de'));
  await assert.rejects(service.unsubscribe('a1|x@ohne.de'), /Abmeldeweg/);
  assert.deepEqual(log.texts, [['a1', 1]]);
  assert.deepEqual([log.moved, log.sent, log.fetched, log.opened], [[], [], [], []]);
});

test('unsubscribe uses the chosen way with the right account', async (t) => {
  const { service, log } = setup(t, { inboxes: INBOXES });
  await service.scan();

  assert.deepEqual(await service.unsubscribe('a1|news@shop.de'), {
    type: 'oneclick', ok: true, detail: null, unsubscribed: { date: 5_000_000, type: 'oneclick' }, browserAvailable: false,
  });
  assert.deepEqual(log.fetched, ['https://shop.de/u']);

  await service.unsubscribe('a1|post@blatt.de');
  assert.deepEqual(log.sent, [{
    account: { id: 'a1', address: 'max@gmx.de', provider: 'gmx' }, password: 'pw-a1',
    to: 'off@blatt.de', subject: 'unsubscribe', body: '',
  }]);

  assert.equal((await service.unsubscribe('a2|info@web.org')).type, 'browser');
  assert.deepEqual(log.opened, ['https://web.org/u']);
});

test('successful unsubscribe is remembered across service instances, a failed one is not', async (t) => {
  const { service, deps } = setup(t, { inboxes: INBOXES });
  await service.scan();
  await service.unsubscribe('a1|news@shop.de');
  const again = createMailService(deps);
  assert.deepEqual((await again.scan()).newsletters[0].unsubscribed, { date: 5_000_000, type: 'oneclick' });

  deps.sendMail = async () => { throw new Error('Server nicht erreichbar'); };
  const failing = createMailService(deps);
  await failing.scan();
  const result = await failing.unsubscribe('a1|post@blatt.de');
  assert.deepEqual([result.ok, result.unsubscribed, result.browserAvailable], [false, null, false]);
  assert.equal((await failing.scan()).newsletters[1].unsubscribed, null);
});

test('a failed unsubscribe can be repeated in the browser', async (t) => {
  const { deps, log } = setup(t, { inboxes: INBOXES });
  deps.fetch = async () => ({ status: 500 });
  const service = createMailService(deps);
  await service.scan();
  assert.equal((await service.unsubscribe('a1|news@shop.de')).browserAvailable, true);
  const inBrowser = await service.unsubscribe('a1|news@shop.de', { browser: true });
  assert.deepEqual([inBrowser.type, inBrowser.ok], ['browser', true]);
  assert.deepEqual(log.opened, ['https://shop.de/u']);
  await assert.rejects(service.unsubscribe('a1|post@blatt.de', { browser: true }), /Abmeldelink/);
});

test('removeSender moves exactly the uids of that sender, once', async (t) => {
  const { service, log } = setup(t, { inboxes: INBOXES });
  await service.scan();
  assert.deepEqual(await service.removeSender('a1|news@shop.de'), { moved: 2 });
  assert.deepEqual(log.moved, [['a1', [2, 3], { fromAddress: 'news@shop.de' }]]);
  await assert.rejects(service.removeSender('a1|news@shop.de'));
  assert.equal(log.moved.length, 1);
});

test('removeUnsubscribed moves the mails of all unsubscribed senders and of nobody else', async (t) => {
  const { service, log } = setup(t, { inboxes: INBOXES });
  await service.scan();
  assert.deepEqual(await service.removeUnsubscribed(), { moved: 0, senders: [], failed: [] });

  await service.unsubscribe('a1|news@shop.de');
  await service.unsubscribe('a2|info@web.org');
  assert.deepEqual(await service.removeUnsubscribed(), {
    moved: 3, senders: ['a1|news@shop.de', 'a2|info@web.org'], failed: [],
  });
  assert.deepEqual(log.moved, [
    ['a1', [2, 3], { fromAddress: 'news@shop.de' }],
    ['a2', [8], { fromAddress: 'info@web.org' }],
  ]);
  // Nothing is left to move a second time.
  assert.deepEqual(await service.removeUnsubscribed(), { moved: 0, senders: [], failed: [] });
});

test('removeUnsubscribed reports a failing mailbox and still handles the others', async (t) => {
  const { service } = setup(t, {
    inboxes: INBOXES,
    failing: { 'move-a1': new MailError('network', 'Server nicht erreichbar') },
  });
  await service.scan();
  await service.unsubscribe('a1|news@shop.de');
  await service.unsubscribe('a2|info@web.org');
  assert.deepEqual(await service.removeUnsubscribed(), {
    moved: 1, senders: ['a2|info@web.org'], failed: [{ key: 'a1|news@shop.de', message: 'Server nicht erreichbar' }],
  });
});

test('cancelled scan rejects with AbortError and registers nothing', async (t) => {
  const { service } = setup(t, { inboxes: INBOXES });
  await assert.rejects(service.scan({ signal: AbortSignal.abort() }), { name: 'AbortError' });
  await assert.rejects(service.readText({ account: 'a1', uid: 1 }));
});

test('saveAccount detects the provider and rejects unknown ones', async (t) => {
  const { service } = setup(t);
  assert.deepEqual(await service.saveAccount({ address: 'neu@freenet.de', password: 'x' }), {
    id: 'neu', address: 'neu@freenet.de', provider: 'freenet',
  });
  await assert.rejects(service.saveAccount({ address: 'neu@web.de', password: 'x' }), /nicht unterstützt/);
});

test('testAccount reports success or the readable failure', async (t) => {
  const { service } = setup(t, { failing: { a2: new MailError('auth', 'Anmeldung abgelehnt') } });
  assert.deepEqual(await service.testAccount('a1'), { ok: true, message: null, hint: null });
  assert.deepEqual(await service.testAccount('a2'), {
    ok: false, message: 'Anmeldung abgelehnt', hint: 'Zwei-Faktor-Anmeldung und App-Passwort nötig',
  });
  await assert.rejects(service.testAccount('gibt-es-nicht'));
});

test('json log survives a corrupt file', (t) => {
  const file = path.join(makeTempDir(t), 'log.json');
  require('node:fs').writeFileSync(file, '{kaputt');
  const store = createJsonLog(file);
  assert.equal(store.get('k'), null);
  store.set('k', { date: 1, type: 'mail' });
  assert.deepEqual(createJsonLog(file).get('k'), { date: 1, type: 'mail' });
});

test('demo backend: a full round works without any network', async (t) => {
  const dir = makeTempDir(t);
  const demo = createDemoBackend({ now: () => 1_800_000_000_000 });
  const settingsValue = { mailSinceDays: 90, importantKeywords: ['Rechnung', 'Termin'] };
  const service = createMailService({
    ...demo,
    settings: { load: () => settingsValue, save: (patch) => Object.assign(settingsValue, patch) },
    logStore: createJsonLog(path.join(dir, 'u.json')),
    training: createTrainingStore(path.join(dir, 't.json')),
  });
  const result = await service.scan();
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].kind, 'auth');
  assert.ok(result.important.length >= 3);
  assert.ok(result.inbox.length > result.important.length);
  const methods = result.newsletters.map((n) => n.method);
  assert.deepEqual([...new Set(methods)].sort(), ['browser', 'mail', 'oneclick', null].sort());

  const withMethod = result.newsletters.filter((n) => n.method !== null);
  for (const sender of withMethod) assert.equal((await service.unsubscribe(sender.key)).ok, true, sender.key);
  assert.deepEqual(demo.actions.map((a) => a.type).sort(), withMethod.map((n) => n.method).sort());
  const first = result.important[0];
  assert.ok((await service.readText({ account: first.account, uid: first.uid })).length > 10);
  assert.ok((await service.removeUnsubscribed()).moved >= withMethod.length);
});
