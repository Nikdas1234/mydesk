const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const { PROVIDERS } = require('./providers');

const FILE_NAME = 'accounts.json';
const ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mail accounts with their passwords. The password is stored only encrypted
// (encrypt/decrypt are passed in; in the app that is Electron's safeStorage)
// and is never part of what list() or save() return.
function createAccountStore(dir, { encrypt, decrypt }) {
  const filePath = path.join(dir, FILE_NAME);

  function readAll() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw.filter((entry) => entry
        && typeof entry.id === 'string'
        && typeof entry.address === 'string'
        && typeof entry.provider === 'string'
        && typeof entry.secret === 'string');
    } catch {
      // missing, unreadable or corrupt file: no accounts
      return [];
    }
  }

  function writeAll(entries) {
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      throw err;
    }
  }

  const publicView = ({ id, address, provider }) => ({ id, address, provider });

  function list() {
    return readAll().map(publicView);
  }

  function save({ id, address, provider, password } = {}) {
    const cleanAddress = typeof address === 'string' ? address.trim() : '';
    if (!ADDRESS.test(cleanAddress)) throw new Error('Die E-Mail-Adresse ist ungültig.');
    if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Dieser Anbieter wird nicht unterstützt (GMX, freenet, Gmail).');

    const entries = readAll();
    const existing = id === undefined ? undefined : entries.find((entry) => entry.id === id);
    if (id !== undefined && !existing) throw new Error('Dieses Konto gibt es nicht mehr.');
    const duplicate = entries.some((entry) => entry !== existing
      && entry.address.toLowerCase() === cleanAddress.toLowerCase());
    if (duplicate) throw new Error('Dieses Konto ist bereits eingerichtet.');

    const hasPassword = typeof password === 'string' && password.length > 0;
    if (!existing && !hasPassword) throw new Error('Das Passwort fehlt.');

    const entry = {
      id: existing ? existing.id : randomUUID(),
      address: cleanAddress,
      provider,
      secret: hasPassword ? encrypt(password).toString('base64') : existing.secret,
    };
    writeAll(existing ? entries.map((e) => (e === existing ? entry : e)) : [...entries, entry]);
    return publicView(entry);
  }

  function remove(id) {
    writeAll(readAll().filter((entry) => entry.id !== id));
  }

  function getPassword(id) {
    const entry = readAll().find((e) => e.id === id);
    if (!entry) throw new Error('Dieses Konto gibt es nicht mehr.');
    try {
      return decrypt(Buffer.from(entry.secret, 'base64'));
    } catch {
      // The key the password was encrypted with is gone (other Windows user,
      // copied data folder, ...). Only entering the password again helps.
      throw new Error('Das gespeicherte Passwort lässt sich nicht mehr lesen. Bitte das Postfach in den Einstellungen entfernen und neu hinzufügen.');
    }
  }

  return { list, save, remove, getPassword };
}

module.exports = { createAccountStore };
