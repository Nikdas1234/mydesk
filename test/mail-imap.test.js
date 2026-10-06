const test = require('node:test');
const assert = require('node:assert/strict');

const { createMailbox, MailError } = require('../src/main/mail/imap');
const { sendUnsubscribeMail } = require('../src/main/mail/smtp');

const ACCOUNT = { id: 'acc1', address: 'max@gmx.de', provider: 'gmx' };
const DAY = 86_400_000;

function headerBlock(lines) {
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n`, 'utf8');
}

// Stand-in for an ImapFlow client: records every call, serves canned data.
function fakeClient({ messages = [], sources = {}, folders = [], failOn = {}, searchResult } = {}) {
  const calls = [];
  const step = (name, ...args) => {
    calls.push([name, ...args]);
    if (failOn[name]) throw failOn[name];
  };
  return {
    calls,
    async connect() { step('connect'); },
    async logout() { step('logout'); },
    async mailboxOpen(path, options) { step('mailboxOpen', path, options); },
    async search(query, options) {
      step('search', query, options);
      return searchResult ?? messages.map((m) => m.uid);
    },
    async* fetch(range, query, options) {
      step('fetch', range, query, options);
      if (query.source) {
        for (const uid of String(range).split(',')) {
          if (sources[uid] !== undefined) yield { uid: Number(uid), source: Buffer.from(sources[uid], 'utf8') };
        }
        return;
      }
      for (const message of messages) yield message;
    },
    async fetchOne(uid, query, options) {
      step('fetchOne', uid, query, options);
      return sources[uid] === undefined ? false : { uid: Number(uid), source: Buffer.from(sources[uid], 'utf8') };
    },
    async list() { step('list'); return folders; },
    async messageMove(range, destination, options) { step('messageMove', range, destination, options); return { uidMap: new Map() }; },
  };
}

function mailbox(client, password = 'geheim123') {
  const created = [];
  const box = createMailbox({
    account: ACCOUNT,
    password,
    createClient: (options) => { created.push(options); return client; },
  });
  return { box, created };
}

test('fetchHeaders maps envelope, flags and unsubscribe headers', async () => {
  const client = fakeClient({
    messages: [
      {
        uid: 7,
        envelope: { subject: 'Ihre Rechnung für März', from: [{ name: 'Müller GmbH', address: 'Info@Mueller.de' }] },
        flags: new Set(['\\Seen', '\\Flagged']),
        internalDate: new Date(1_700_000_000_000),
        headers: headerBlock([
          'List-Unsubscribe: <mailto:off@mueller.de>,',
          '\t<https://mueller.de/u?id=1>',
          'List-Unsubscribe-Post: List-Unsubscribe=One-Click',
        ]),
      },
      {
        uid: 8,
        envelope: { from: [{ address: 'x@y.de' }] },
        flags: new Set(),
        internalDate: new Date(1_700_000_100_000),
        headers: headerBlock([]),
      },
      { uid: 9, envelope: {}, internalDate: new Date(1_700_000_200_000) },
    ],
  });
  const { box } = mailbox(client);
  const result = await box.fetchHeaders({ sinceDays: 90, now: 1_700_001_000_000 });
  assert.deepEqual(result, [
    {
      account: 'acc1', uid: 7, fromName: 'Müller GmbH', fromAddress: 'info@mueller.de',
      subject: 'Ihre Rechnung für März', date: 1_700_000_000_000, seen: true, flagged: true,
      listUnsubscribe: '<mailto:off@mueller.de>, <https://mueller.de/u?id=1>',
      listUnsubscribePost: 'List-Unsubscribe=One-Click',
    },
    {
      account: 'acc1', uid: 8, fromName: '', fromAddress: 'x@y.de', subject: '', date: 1_700_000_100_000,
      seen: false, flagged: false, listUnsubscribe: '', listUnsubscribePost: '',
    },
    {
      account: 'acc1', uid: 9, fromName: '', fromAddress: '', subject: '', date: 1_700_000_200_000,
      seen: false, flagged: false, listUnsubscribe: '', listUnsubscribePost: '',
    },
  ]);
});

test('fetchHeaders opens the inbox read-only and searches since N days', async () => {
  const client = fakeClient({ messages: [{ uid: 1, envelope: {}, internalDate: new Date(5) }] });
  const { box, created } = mailbox(client);
  const now = 1_700_000_000_000;
  await box.fetchHeaders({ sinceDays: 30, now });

  assert.deepEqual(created[0], {
    host: 'imap.gmx.net', port: 993, secure: true, auth: { user: 'max@gmx.de', pass: 'geheim123' },
    logger: false, socketTimeout: 30000, connectionTimeout: 30000,
  });
  const byName = Object.fromEntries(client.calls.map((call) => [call[0], call]));
  assert.deepEqual(byName.mailboxOpen.slice(1), ['INBOX', { readOnly: true }]);
  // The time span goes to the server as a search, not as a long list of numbers.
  assert.equal(byName.search, undefined);
  assert.deepEqual(byName.fetch[1], { since: new Date(now - 30 * DAY) });
  assert.equal(byName.fetch[3].uid, true);
  assert.deepEqual(byName.fetch[2].headers, ['list-unsubscribe', 'list-unsubscribe-post']);
  assert.equal(byName.fetch[2].source, undefined);
  assert.equal(client.calls.at(-1)[0], 'logout');
});

test('fetchHeaders with an empty inbox yields nothing', async () => {
  const client = fakeClient();
  const { box } = mailbox(client);
  assert.deepEqual(await box.fetchHeaders({ sinceDays: 90 }), []);
});

test('fetchHeaders logs out even when fetching throws', async () => {
  const client = fakeClient({ failOn: { fetch: new Error('kaputt') } });
  const { box } = mailbox(client);
  await assert.rejects(box.fetchHeaders({ sinceDays: 90 }), MailError);
  assert.equal(client.calls.at(-1)[0], 'logout');
});

test('fetchHeaders stops on an aborted signal', async () => {
  const client = fakeClient({ messages: [{ uid: 1, envelope: {}, internalDate: new Date(5) }] });
  const { box } = mailbox(client);
  await assert.rejects(box.fetchHeaders({ sinceDays: 90, signal: AbortSignal.abort() }), { name: 'AbortError' });
});

test('fetchText prefers plain text and falls back to stripped html', async () => {
  const plain = [
    'From: a@b.de', 'Subject: Hallo', 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="x"', '',
    '--x', 'Content-Type: text/plain; charset=utf-8', '', 'Nur Text, Grüße', '',
    '--x', 'Content-Type: text/html; charset=utf-8', '', '<p>HTML-Fassung</p>', '--x--', '',
  ].join('\r\n');
  const html = [
    'From: a@b.de', 'Subject: Hallo', 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
    '<html><head><style>p{color:red}</style><script>alert(1)</script></head>',
    '<body><p>Hallo<br>Welt &amp; Co</p><img src="https://tracker.example/pixel.gif"><p>Zweiter Absatz</p></body></html>', '',
  ].join('\r\n');
  const client = fakeClient({ sources: { 3: plain, 4: html } });
  const { box } = mailbox(client);

  assert.equal((await box.fetchText(3)).trim(), 'Nur Text, Grüße');
  const text = await box.fetchText(4);
  assert.match(text, /Hallo\s*\n\s*Welt & Co/);
  assert.match(text, /Zweiter Absatz/);
  assert.ok(!/img|tracker|alert|color:red|</.test(text), text);
});

test('fetchText does not mark the message as seen', async () => {
  const client = fakeClient({ sources: { 3: 'Subject: x\r\n\r\nText' } });
  const { box } = mailbox(client);
  await box.fetchText(3);
  const byName = Object.fromEntries(client.calls.map((call) => [call[0], call]));
  assert.deepEqual(byName.mailboxOpen.slice(1), ['INBOX', { readOnly: true }]);
  assert.deepEqual(byName.fetchOne.slice(1), ['3', { source: true }, { uid: true }]);
  assert.equal(client.calls.at(-1)[0], 'logout');
});

test('fetchText limits the length and fails readably for a missing mail', async () => {
  const client = fakeClient({ sources: { 3: `Subject: x\r\n\r\n${'a'.repeat(300_000)}` } });
  const { box } = mailbox(client);
  assert.equal((await box.fetchText(3)).length, 200_000);
  await assert.rejects(box.fetchText(99), MailError);
});

test('moveToTrash uses the folder flagged \\Trash', async () => {
  for (const trashPath of ['Papierkorb', '[Gmail]/Papierkorb']) {
    const client = fakeClient({
      folders: [{ path: 'INBOX', specialUse: '\\Inbox' }, { path: 'Trash' }, { path: trashPath, specialUse: '\\Trash' }],
      searchResult: [4, 9],
    });
    const { box } = mailbox(client);
    assert.equal(await box.moveToTrash([4, 9, 9], { fromAddress: 'news@shop.de' }), 2);
    const byName = Object.fromEntries(client.calls.map((call) => [call[0], call]));
    assert.deepEqual(byName.mailboxOpen.slice(1), ['INBOX', undefined]);
    assert.deepEqual(byName.search.slice(1), [{ uid: '4,9', from: 'news@shop.de' }, { uid: true }]);
    assert.deepEqual(byName.messageMove.slice(1), ['4,9', trashPath, { uid: true }]);
    assert.equal(client.calls.at(-1)[0], 'logout');
  }
});

test('moveToTrash only moves mails that still come from that sender', async () => {
  // The server no longer finds uid 9 under this sender (mailbox changed since the scan).
  const client = fakeClient({ folders: [{ path: 'Trash', specialUse: '\\Trash' }], searchResult: [4] });
  const { box } = mailbox(client);
  assert.equal(await box.moveToTrash([4, 9], { fromAddress: 'news@shop.de' }), 1);
  const move = client.calls.find((call) => call[0] === 'messageMove');
  assert.equal(move[1], '4');

  const none = fakeClient({ folders: [{ path: 'Trash', specialUse: '\\Trash' }], searchResult: [] });
  assert.equal(await mailbox(none).box.moveToTrash([4], { fromAddress: 'news@shop.de' }), 0);
  assert.ok(!none.calls.some((call) => call[0] === 'messageMove'));

  await assert.rejects(mailbox(fakeClient()).box.moveToTrash([4], {}), MailError);
});

test('moveToTrash with nothing to move does not connect', async () => {
  const client = fakeClient();
  const { box } = mailbox(client);
  assert.equal(await box.moveToTrash([], { fromAddress: 'a@b.de' }), 0);
  assert.deepEqual(client.calls, []);
});

test('moveToTrash rejects anything that is not a positive whole uid', async () => {
  const client = fakeClient({ folders: [{ path: 'Trash', specialUse: '\\Trash' }] });
  const { box } = mailbox(client);
  await assert.rejects(box.moveToTrash([1, '2:*'], { fromAddress: 'a@b.de' }), MailError);
  await assert.rejects(box.moveToTrash([0], { fromAddress: 'a@b.de' }), MailError);
  assert.ok(!client.calls.some((call) => call[0] === 'messageMove'));
});

test('moveToTrash without trash folder fails with a readable error', async () => {
  const client = fakeClient({ folders: [{ path: 'INBOX' }, { path: 'Trash' }] });
  const { box } = mailbox(client);
  await assert.rejects(box.moveToTrash([1], { fromAddress: 'a@b.de' }), (err) => {
    assert.ok(err instanceof MailError);
    assert.equal(err.kind, 'other');
    assert.equal(err.message, 'Kein Papierkorb im Postfach gefunden');
    return true;
  });
  assert.ok(!client.calls.some((call) => call[0] === 'messageMove'));
});

test('auth failure becomes MailError auth without the password', async () => {
  const failure = Object.assign(new Error('Command failed: LOGIN max@gmx.de geheim123'), {
    authenticationFailed: true, responseText: 'Authentication failed (geheim123)',
  });
  const client = fakeClient({ failOn: { connect: failure } });
  const { box } = mailbox(client);
  await assert.rejects(box.test(), (err) => {
    assert.ok(err instanceof MailError);
    assert.equal(err.kind, 'auth');
    assert.ok(!err.message.includes('geheim123'));
    assert.ok(!String(err.serverText).includes('geheim123'));
    assert.ok(!String(err.stack).includes('geheim123'));
    assert.equal(err.cause, undefined);
    return true;
  });
});

test('timeout becomes MailError network', async () => {
  for (const code of ['ETIMEDOUT', 'ETIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET']) {
    const client = fakeClient({ failOn: { connect: Object.assign(new Error('nope'), { code }) } });
    const { box } = mailbox(client);
    await assert.rejects(box.test(), (err) => err instanceof MailError && err.kind === 'network', code);
  }
});

test('test() logs in, opens the inbox and logs out', async () => {
  const client = fakeClient();
  const { box } = mailbox(client);
  await box.test();
  assert.deepEqual(client.calls.map((call) => call[0]), ['connect', 'mailboxOpen', 'logout']);
});

test('sendUnsubscribeMail uses STARTTLS and the account address', async () => {
  const created = [];
  const sent = [];
  let closed = false;
  await sendUnsubscribeMail({
    account: ACCOUNT,
    password: 'geheim123',
    to: 'off@shop.de',
    subject: 'unsubscribe',
    body: 'bitte abmelden',
    createTransport: (options) => {
      created.push(options);
      return { sendMail: async (mail) => { sent.push(mail); }, close: () => { closed = true; } };
    },
  });
  assert.deepEqual(created[0], {
    host: 'mail.gmx.net', port: 587, secure: false, requireTLS: true,
    auth: { user: 'max@gmx.de', pass: 'geheim123' },
    connectionTimeout: 30000, greetingTimeout: 30000, socketTimeout: 30000,
  });
  assert.deepEqual(sent, [{ from: 'max@gmx.de', to: 'off@shop.de', subject: 'unsubscribe', text: 'bitte abmelden' }]);
  assert.equal(closed, true);
});

test('sendUnsubscribeMail reports failures without the password and closes', async () => {
  let closed = false;
  await assert.rejects(
    sendUnsubscribeMail({
      account: ACCOUNT,
      password: 'geheim123',
      to: 'off@shop.de',
      subject: 's',
      body: '',
      createTransport: () => ({
        sendMail: async () => { throw Object.assign(new Error('535 bad geheim123'), { code: 'EAUTH' }); },
        close: () => { closed = true; },
      }),
    }),
    (err) => err instanceof MailError && err.kind === 'auth' && !err.message.includes('geheim123'),
  );
  assert.equal(closed, true);
});

test('fetchTexts returns the text of many mails without marking them as seen', async () => {
  const sources = {};
  for (let uid = 1; uid <= 250; uid += 1) sources[uid] = `Subject: Nr ${uid}\r\n\r\nText der Mail ${uid}`;
  sources[7] = 'Subject: x\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Nur <b>HTML</b></p>';
  const client = fakeClient({ sources });
  const { box } = mailbox(client);
  const uids = Array.from({ length: 250 }, (_, i) => i + 1);
  const texts = await box.fetchTexts(uids);

  assert.equal(texts.size, 250);
  assert.equal(texts.get(250).trim(), 'Text der Mail 250');
  assert.equal(texts.get(7).trim(), 'Nur HTML');
  const fetches = client.calls.filter((call) => call[0] === 'fetch');
  // In blocks, so no command gets too long; only the beginning of each mail.
  assert.equal(fetches.length, 3);
  assert.deepEqual(fetches[0][2], { uid: true, source: { start: 0, maxLength: 32768 } });
  assert.deepEqual(client.calls.find((call) => call[0] === 'mailboxOpen').slice(1), ['INBOX', { readOnly: true }]);
  assert.equal(client.calls.at(-1)[0], 'logout');
});

test('fetchTexts with nothing to fetch does not connect, and stops when cancelled', async () => {
  const idle = fakeClient();
  assert.equal((await mailbox(idle).box.fetchTexts([])).size, 0);
  assert.deepEqual(idle.calls, []);
  const client = fakeClient({ sources: { 1: 'Subject: x\r\n\r\nText' } });
  await assert.rejects(mailbox(client).box.fetchTexts([1], { signal: AbortSignal.abort() }), { name: 'AbortError' });
});
