// The program was called "Aufräumzentrale" up to version 0.2.x and kept its
// data in a folder of that name. On the first start under the new name the
// data files are copied over, so mailboxes, settings and everything learned
// are still there. Nothing of the user's data is ever overwritten and the old
// folder stays.
const fs = require('node:fs');
const path = require('node:path');

const USER_FILES = ['settings.json', 'accounts.json', 'training.json', 'unsubscribed.json', 'history.json'];

// The mailbox passwords in accounts.json are encrypted with a key that lives
// in this file of the data folder. Accounts without their key are unreadable.
const KEY_FILE = 'Local State';
// Written once the key question is settled for this folder, so the old key is
// never brought back over a state the program wrote later.
const KEY_MARKER = '.key-migrated';

const same = (a, b) => {
  try {
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
};

// Takes the old key along if (and only if) the accounts in the new folder are
// still exactly the old ones: on the first start, and to repair a folder where
// version 0.3.0 copied the accounts but not the key. Must run before the
// program first uses the encryption.
function migrateKey(from, to) {
  const marker = path.join(to, KEY_MARKER);
  if (fs.existsSync(marker)) return;
  const oldKey = path.join(from, KEY_FILE);
  const oldAccounts = path.join(from, 'accounts.json');
  if (!fs.existsSync(oldKey) || !fs.existsSync(oldAccounts)) return;
  fs.mkdirSync(to, { recursive: true });
  if (same(oldAccounts, path.join(to, 'accounts.json'))) fs.copyFileSync(oldKey, path.join(to, KEY_FILE));
  fs.writeFileSync(marker, 'The key of the former data folder was handled. Do not delete.\n');
}

// Returns the names of the data files that were copied. Never throws.
function migrateUserData({ from, to }) {
  const copied = [];
  try {
    if (path.resolve(from) === path.resolve(to) || !fs.existsSync(from)) return copied;
    for (const name of USER_FILES) {
      const source = path.join(from, name);
      const target = path.join(to, name);
      if (!fs.existsSync(source) || fs.existsSync(target)) continue;
      fs.mkdirSync(to, { recursive: true });
      fs.copyFileSync(source, target);
      copied.push(name);
    }
    migrateKey(from, to);
  } catch {
    // A failed copy must not stop the start; the program then begins empty.
  }
  return copied;
}

module.exports = { migrateUserData, USER_FILES };
