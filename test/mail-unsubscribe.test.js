const test = require('node:test');
const assert = require('node:assert/strict');

const { chooseMethod, browserMethod, execute } = require('../src/main/mail/unsubscribe');

const ONE_CLICK = 'List-Unsubscribe=One-Click';

test('one-click wins when Post header and https link are present', () => {
  const method = chooseMethod({
    listUnsubscribe: '<mailto:off@shop.de>, <https://shop.de/u?id=1>',
    listUnsubscribePost: ONE_CLICK,
  });
  assert.deepEqual(method, { type: 'oneclick', url: 'https://shop.de/u?id=1' });
});

test('one-click is not used for http links', () => {
  assert.deepEqual(
    chooseMethod({ listUnsubscribe: '<http://shop.de/u>', listUnsubscribePost: ONE_CLICK }),
    { type: 'browser', url: 'http://shop.de/u' },
  );
  assert.equal(
    chooseMethod({ listUnsubscribe: '<http://shop.de/u>, <mailto:off@shop.de>', listUnsubscribePost: ONE_CLICK }).type,
    'mail',
  );
});

test('mailto is used when no one-click is offered', () => {
  assert.deepEqual(
    chooseMethod({ listUnsubscribe: '<https://shop.de/u>, <mailto:a@b.de?subject=Abmelden>', listUnsubscribePost: '' }),
    { type: 'mail', to: 'a@b.de', subject: 'Abmelden', body: '' },
  );
  assert.deepEqual(
    chooseMethod({ listUnsubscribe: '<mailto:a@b.de?body=bitte%20abmelden>' }),
    { type: 'mail', to: 'a@b.de', subject: 'unsubscribe', body: 'bitte abmelden' },
  );
});

test('mailto drops cc, bcc and extra recipients', () => {
  assert.deepEqual(
    chooseMethod({ listUnsubscribe: '<mailto:a@b.de?bcc=x@y.de&cc=z@y.de&to=q@y.de&subject=S>' }),
    { type: 'mail', to: 'a@b.de', subject: 'S', body: '' },
  );
  assert.equal(chooseMethod({ listUnsubscribe: '<mailto:a@b.de,c@d.de>' }), null);
  assert.equal(chooseMethod({ listUnsubscribe: '<mailto:a@b.de%2Cc@d.de>' }), null);
});

test('mailto rejects line breaks in the address and flattens them in the subject', () => {
  assert.equal(chooseMethod({ listUnsubscribe: '<mailto:a@b.de%0d%0aBcc:x@y.de>' }), null);
  const method = chooseMethod({ listUnsubscribe: '<mailto:a@b.de?subject=Hi%0d%0aBcc:%20x@y.de>' });
  assert.equal(method.to, 'a@b.de');
  assert.ok(!/[\r\n]/.test(method.subject));
});

test('mailto limits subject and body length', () => {
  const method = chooseMethod({ listUnsubscribe: `<mailto:a@b.de?subject=${'s'.repeat(500)}&body=${'b'.repeat(5000)}>` });
  assert.equal(method.subject.length, 200);
  assert.equal(method.body.length, 2000);
});

test('an unusable mailto falls back to the browser link', () => {
  assert.deepEqual(
    chooseMethod({ listUnsubscribe: '<mailto:a@b.de,c@d.de>, <https://shop.de/u>' }),
    { type: 'browser', url: 'https://shop.de/u' },
  );
});

test('falls back to the first http(s) link for the browser', () => {
  assert.deepEqual(
    chooseMethod({ listUnsubscribe: '<https://shop.de/a>, <http://shop.de/b>' }),
    { type: 'browser', url: 'https://shop.de/a' },
  );
});

test('javascript:, file:, data: and garbage yield null', () => {
  for (const header of [
    '<javascript:alert(1)>', '<file:///C:/Windows/x.exe>', '<data:text/html,x>', 'kein eintrag',
    '', undefined, null, '<>', '<https://>', '<ftp://x.de/u>',
  ]) {
    assert.equal(chooseMethod({ listUnsubscribe: header, listUnsubscribePost: ONE_CLICK }), null, String(header));
  }
});

test('headers with spaces, line folds and several entries are parsed', () => {
  const method = chooseMethod({
    listUnsubscribe: ' <mailto:off@shop.de> ,\r\n\t< https://shop.de/u >',
    listUnsubscribePost: ' list-unsubscribe=one-click ',
  });
  assert.deepEqual(method, { type: 'oneclick', url: 'https://shop.de/u' });
});

test('execute posts the one-click body and reports the status', async () => {
  const calls = [];
  const fetchOk = async (url, options) => { calls.push({ url, options }); return { status: 200 }; };
  const ok = await execute({ type: 'oneclick', url: 'https://shop.de/u' }, { fetch: fetchOk });
  assert.deepEqual(ok, { type: 'oneclick', ok: true, detail: null });
  assert.equal(calls[0].url, 'https://shop.de/u');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.body, ONE_CLICK);
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.ok(calls[0].options.signal instanceof AbortSignal);

  const failed = await execute({ type: 'oneclick', url: 'https://shop.de/u' }, { fetch: async () => ({ status: 404 }) });
  assert.deepEqual(failed, { type: 'oneclick', ok: false, detail: 'Server antwortete mit 404' });
});

test('execute sends the mail or opens the browser', async () => {
  const sent = [];
  const opened = [];
  assert.deepEqual(
    await execute({ type: 'mail', to: 'a@b.de', subject: 'S', body: 'B' }, { sendMail: async (m) => { sent.push(m); } }),
    { type: 'mail', ok: true, detail: null },
  );
  assert.deepEqual(sent, [{ to: 'a@b.de', subject: 'S', body: 'B' }]);
  assert.deepEqual(
    await execute({ type: 'browser', url: 'https://shop.de/u' }, { openExternal: async (u) => { opened.push(u); } }),
    { type: 'browser', ok: true, detail: null },
  );
  assert.deepEqual(opened, ['https://shop.de/u']);
});

test('execute never throws', async () => {
  const boom = async () => { throw new Error('kaputt'); };
  assert.deepEqual(await execute({ type: 'oneclick', url: 'https://x.de' }, { fetch: boom }), { type: 'oneclick', ok: false, detail: 'kaputt' });
  assert.deepEqual(await execute({ type: 'mail', to: 'a@b.de', subject: '', body: '' }, { sendMail: boom }), { type: 'mail', ok: false, detail: 'kaputt' });
  assert.deepEqual(await execute({ type: 'browser', url: 'https://x.de' }, { openExternal: boom }), { type: 'browser', ok: false, detail: 'kaputt' });
  const odd = await execute({ type: 'fax' }, {});
  assert.equal(odd.ok, false);
});

test('a redirect after the one-click request counts as done', async () => {
  for (const status of [204, 302, 303]) {
    const result = await execute({ type: 'oneclick', url: 'https://shop.de/u' }, { fetch: async () => ({ status }) });
    assert.equal(result.ok, true, String(status));
  }
  const failed = await execute({ type: 'oneclick', url: 'https://shop.de/u' }, { fetch: async () => ({ status: 400 }) });
  assert.equal(failed.ok, false);
});

test('browserMethod offers the web link as a fallback, if there is one', () => {
  assert.deepEqual(
    browserMethod({ listUnsubscribe: '<mailto:off@shop.de>, <https://shop.de/u>' }),
    { type: 'browser', url: 'https://shop.de/u' },
  );
  assert.equal(browserMethod({ listUnsubscribe: '<mailto:off@shop.de>' }), null);
  assert.equal(browserMethod({ listUnsubscribe: '<javascript:alert(1)>' }), null);
});
