const test = require('node:test');
const assert = require('node:assert/strict');

const { classify, groupNewsletters } = require('../src/main/mail/classify');
const { createModel } = require('../src/main/mail/learn');

const RULES = { keywords: ['Rechnung', 'Termin'], model: null, label: null };

function msg(overrides = {}) {
  return {
    account: 'acc1',
    uid: 1,
    fromName: 'Erika',
    fromAddress: 'erika@example.de',
    subject: 'Hallo',
    date: 1000,
    seen: false,
    flagged: false,
    listUnsubscribe: '',
    listUnsubscribePost: '',
    tokens: [],
    ...overrides,
  };
}

function trainedModel() {
  const examples = [];
  for (let i = 0; i < 6; i += 1) {
    examples.push({ label: true, tokens: ['mietvertrag', 'nebenkosten', 'abrechnung'] });
    examples.push({ label: false, tokens: ['gewinnspiel', 'rabatt', 'angebot'] });
  }
  return createModel(examples);
}

test('message with List-Unsubscribe is a newsletter', () => {
  assert.deepEqual(classify(msg({ listUnsubscribe: '<https://x.de/u>' }), RULES), { kind: 'newsletter', reason: null });
});

test('newsletter stays newsletter despite keyword, flag, own decision and model', () => {
  const m = msg({
    listUnsubscribe: '<https://x.de/u>', subject: 'Ihre Rechnung', flagged: true, tokens: ['mietvertrag', 'nebenkosten'],
  });
  assert.equal(classify(m, { ...RULES, model: trainedModel(), label: true }).kind, 'newsletter');
});

test('the user\'s own decision for a mail wins over everything else', () => {
  assert.deepEqual(
    classify(msg({ subject: 'Rechnung', flagged: true }), { ...RULES, label: false }),
    { kind: 'other', reason: 'Von dir als nicht wichtig eingeordnet' },
  );
  assert.deepEqual(
    classify(msg(), { ...RULES, label: true }),
    { kind: 'important', reason: 'Von dir als wichtig eingeordnet' },
  );
});

test('flagged message is important', () => {
  assert.deepEqual(classify(msg({ flagged: true }), RULES), { kind: 'important', reason: 'Markiert' });
});

test('without a trained model keywords in subject or text decide', () => {
  assert.deepEqual(classify(msg({ subject: 'Ihre RECHNUNG 10/2026' }), RULES), { kind: 'important', reason: 'Stichwort: Rechnung' });
  assert.deepEqual(classify(msg({ tokens: ['ihr', 'termin', 'morgen'] }), RULES), { kind: 'important', reason: 'Stichwort: Termin' });
  assert.deepEqual(classify(msg({ tokens: ['hallo'] }), RULES), { kind: 'other', reason: null });
  // An untrained model changes nothing.
  assert.equal(classify(msg({ subject: 'Rechnung' }), { ...RULES, model: createModel([]) }).reason, 'Stichwort: Rechnung');
});

test('a trained model decides by the content and names its confidence', () => {
  const rules = { ...RULES, model: trainedModel() };
  const important = classify(msg({ tokens: ['mietvertrag', 'nebenkosten', 'abrechnung'] }), rules);
  assert.equal(important.kind, 'important');
  assert.match(important.reason, /^Gelernt \(\d{2,3} %\)$/);

  const other = classify(msg({ subject: 'Rechnung', tokens: ['gewinnspiel', 'rabatt'] }), rules);
  assert.equal(other.kind, 'other');
  assert.match(other.reason, /^Gelernt \(\d{1,2} %\)$/);
});

test('a trained model that knows none of the words falls back to the keywords', () => {
  const rules = { ...RULES, model: trainedModel() };
  assert.deepEqual(classify(msg({ subject: 'Ihre Rechnung', tokens: ['unbekannt'] }), rules), { kind: 'important', reason: 'Stichwort: Rechnung' });
  assert.deepEqual(classify(msg({ tokens: ['unbekannt'] }), rules), { kind: 'other', reason: null });
});

test('empty subject, missing tokens and blank keywords do not throw or match', () => {
  assert.deepEqual(classify(msg({ subject: '', fromName: '', fromAddress: '', tokens: undefined }), RULES), { kind: 'other', reason: null });
  assert.equal(classify(msg({ subject: undefined }), { keywords: ['', '  '], model: null, label: null }).kind, 'other');
});

test('groups by account and address, not by display name', () => {
  const groups = groupNewsletters([
    msg({ uid: 1, fromName: 'Shop', fromAddress: 'news@a.de' }),
    msg({ uid: 2, fromName: 'Shop', fromAddress: 'news@b.de' }),
    msg({ uid: 3, fromName: 'Shop', fromAddress: 'NEWS@A.de' }),
    msg({ uid: 4, account: 'acc2', fromName: 'Shop', fromAddress: 'news@a.de' }),
  ]);
  assert.deepEqual(groups.map((g) => [g.key, g.count]), [
    ['acc1|news@a.de', 2], ['acc1|news@b.de', 1], ['acc2|news@a.de', 1],
  ]);
});

test('group carries count, last date, uids and the newest unsubscribe headers', () => {
  const [group] = groupNewsletters([
    msg({ uid: 5, date: 100, fromName: 'Alt', listUnsubscribe: '<https://old>' }),
    msg({ uid: 9, date: 300, fromName: 'Neu', listUnsubscribe: '<https://new>', listUnsubscribePost: 'List-Unsubscribe=One-Click' }),
    msg({ uid: 7, date: 200, listUnsubscribe: '<https://mid>' }),
  ]);
  assert.deepEqual(group, {
    key: 'acc1|erika@example.de',
    account: 'acc1',
    fromAddress: 'erika@example.de',
    fromName: 'Neu',
    count: 3,
    lastDate: 300,
    uids: [5, 9, 7],
    listUnsubscribe: '<https://new>',
    listUnsubscribePost: 'List-Unsubscribe=One-Click',
  });
});
