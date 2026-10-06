const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { makeTempDir } = require('./helpers/tmp');
const { PROVIDERS, detectProvider } = require('../src/main/mail/providers');
const { createAccountStore } = require('../src/main/mail/accounts');

// Reversible scrambling instead of real encryption: enough to tell clear text
// from stored text.
const crypto = {
  encrypt: (text) => Buffer.from([...Buffer.from(text, 'utf8')].map((b) => b ^ 0x5a)),
  decrypt: (buffer) => Buffer.from([...buffer].map((b) => b ^ 0x5a)).toString('utf8'),
};

function store(t) {
  const dir = makeTempDir(t);
  return { dir, accounts: createAccountStore(dir, crypto) };
}

test('detects the three providers and nothing else', () => {
  assert.equal(detectProvider('max@gmx.de'), 'gmx');
  assert.equal(detectProvider('Max@GMX.net'), 'gmx');
  assert.equal(detectProvider('max@gmx.at'), 'gmx');
  assert.equal(detectProvider('max@freenet.de'), 'freenet');
  assert.equal(detectProvider('max@gmail.com'), 'gmail');
  assert.equal(detectProvider(' max@googlemail.com '), 'gmail');
  assert.equal(detectProvider('max@web.de'), null);
  assert.equal(detectProvider('max@gmail.com.evil.org'), null);
  assert.equal(detectProvider('kein-at'), null);
  assert.equal(detectProvider(undefined), null);
});

test('provider presets use TLS ports and carry a hint', () => {
  assert.deepEqual(PROVIDERS.gmx.imap, { host: 'imap.gmx.net', port: 993 });
  assert.deepEqual(PROVIDERS.gmx.smtp, { host: 'mail.gmx.net', port: 587 });
  assert.deepEqual(PROVIDERS.freenet.imap, { host: 'mx.freenet.de', port: 993 });
  assert.deepEqual(PROVIDERS.freenet.smtp, { host: 'mx.freenet.de', port: 587 });
  assert.deepEqual(PROVIDERS.gmail.imap, { host: 'imap.gmail.com', port: 993 });
  assert.deepEqual(PROVIDERS.gmail.smtp, { host: 'smtp.gmail.com', port: 587 });
  for (const provider of Object.values(PROVIDERS)) {
    assert.ok(provider.label.length > 0);
    assert.ok(provider.hint.length > 0);
  }
});

test('save stores the password encrypted and list never returns it', (t) => {
  const { dir, accounts } = store(t);
  const saved = accounts.save({ address: ' max@gmx.de ', provider: 'gmx', password: 'geheim123' });
  assert.deepEqual(Object.keys(saved).sort(), ['address', 'id', 'provider']);
  assert.equal(saved.address, 'max@gmx.de');
  assert.deepEqual(accounts.list(), [saved]);
  const raw = fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8');
  assert.ok(!raw.includes('geheim123'));
});

test('getPassword returns the decrypted password, also from a new store', (t) => {
  const { dir, accounts } = store(t);
  const { id } = accounts.save({ address: 'max@gmx.de', provider: 'gmx', password: 'geheim ä 123' });
  assert.equal(accounts.getPassword(id), 'geheim ä 123');
  assert.equal(createAccountStore(dir, crypto).getPassword(id), 'geheim ä 123');
  assert.throws(() => accounts.getPassword('gibt-es-nicht'));
});

test('saving without password keeps the stored one', (t) => {
  const { accounts } = store(t);
  const { id } = accounts.save({ address: 'max@gmx.de', provider: 'gmx', password: 'alt' });
  const updated = accounts.save({ id, address: 'max@gmx.net', provider: 'gmx' });
  assert.equal(updated.id, id);
  assert.equal(accounts.getPassword(id), 'alt');
  assert.equal(accounts.list()[0].address, 'max@gmx.net');
  accounts.save({ id, address: 'max@gmx.net', provider: 'gmx', password: 'neu' });
  assert.equal(accounts.getPassword(id), 'neu');
  assert.equal(accounts.list().length, 1);
});

test('rejects unknown provider, bad address, duplicate address, new account without password', (t) => {
  const { accounts } = store(t);
  accounts.save({ address: 'max@gmx.de', provider: 'gmx', password: 'x' });
  assert.throws(() => accounts.save({ address: 'a@web.de', provider: 'web', password: 'x' }));
  assert.throws(() => accounts.save({ address: 'kein-at', provider: 'gmx', password: 'x' }));
  assert.throws(() => accounts.save({ address: 'MAX@gmx.de', provider: 'gmx', password: 'x' }));
  assert.throws(() => accounts.save({ address: 'neu@gmx.de', provider: 'gmx' }));
  assert.throws(() => accounts.save({ address: 'neu@gmx.de', provider: 'gmx', password: '' }));
  assert.throws(() => accounts.save({ id: 'fremd', address: 'neu@gmx.de', provider: 'gmx', password: 'x' }));
  assert.equal(accounts.list().length, 1);
});

test('remove deletes account and password', (t) => {
  const { dir, accounts } = store(t);
  const { id } = accounts.save({ address: 'max@gmx.de', provider: 'gmx', password: 'geheim' });
  accounts.remove(id);
  assert.deepEqual(accounts.list(), []);
  assert.throws(() => accounts.getPassword(id));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'accounts.json'), 'utf8')), []);
});

test('corrupt accounts file yields an empty list', (t) => {
  const { dir, accounts } = store(t);
  fs.writeFileSync(path.join(dir, 'accounts.json'), '{kaputt');
  assert.deepEqual(accounts.list(), []);
  fs.writeFileSync(path.join(dir, 'accounts.json'), '{"a":1}');
  assert.deepEqual(accounts.list(), []);
});

test('save leaves no temp file behind', (t) => {
  const { dir, accounts } = store(t);
  accounts.save({ address: 'max@gmx.de', provider: 'gmx', password: 'x' });
  assert.deepEqual(fs.readdirSync(dir), ['accounts.json']);
});

test('a password that can no longer be decrypted gives a readable instruction', (t) => {
  const dir = makeTempDir(t);
  const accounts = createAccountStore(dir, crypto);
  const { id } = accounts.save({ address: 'max@gmx.de', provider: 'gmx', password: 'geheim' });
  const broken = createAccountStore(dir, { encrypt: crypto.encrypt, decrypt: () => { throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.'); } });
  assert.throws(() => broken.getPassword(id), {
    message: 'Das gespeicherte Passwort lässt sich nicht mehr lesen. Bitte das Postfach in den Einstellungen entfernen und neu hinzufügen.',
  });
});
