const fs = require('node:fs');
const path = require('node:path');

const { classify, groupNewsletters } = require('./classify');
const { chooseMethod, browserMethod, execute } = require('./unsubscribe');
const { PROVIDERS, detectProvider } = require('./providers');
const { tokenize, createModel } = require('./learn');

// Small key -> value file, used to remember which senders were unsubscribed.
function createJsonLog(filePath) {
  function readAll() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }
  return {
    get: (key) => (Object.hasOwn(readAll(), key) ? readAll()[key] : null),
    set(key, value) {
      const all = { ...readAll(), [key]: value };
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const tmpPath = `${filePath}.${process.pid}.tmp`;
      try {
        fs.writeFileSync(tmpPath, JSON.stringify(all, null, 2), 'utf8');
        fs.renameSync(tmpPath, filePath);
      } catch (err) {
        fs.rmSync(tmpPath, { force: true });
        throw err;
      }
    },
  };
}

function isAbortError(err) {
  return Boolean(err) && err.name === 'AbortError';
}

// Readable failure of one account, with the provider's hint for login errors.
function describeFailure(account, err) {
  const kind = err?.kind ?? 'other';
  return {
    kind,
    message: err?.message ?? String(err),
    hint: kind === 'auth' ? PROVIDERS[account.provider]?.hint ?? null : null,
  };
}

// The mail workflow: check the mailboxes, sort the mails, unsubscribe.
// deps: accounts (account store), settings (settings store),
//   openMailbox(account, password) -> { fetchHeaders, fetchTexts, fetchText, moveToTrash, test },
//   sendMail({ account, password, to, subject, body }), fetch, openExternal,
//   logStore (createJsonLog), training (createTrainingStore), now() (optional).
// Reading a mail, deciding about it, unsubscribing and removing mails only
// work for what the last scan returned.
function createMailService(deps) {
  const {
    accounts, settings, openMailbox, sendMail, fetch, openExternal, logStore, training, now = Date.now,
  } = deps;

  const messageKey = (account, uid) => `${account}|${uid}`;

  // What the last scan found; the basis for every later action.
  let last = null; // { messages, errors, addressOf, sinceDays }
  let senders = new Map(); // newsletter senders of the last scan, by key
  // Words of the mails read in this session (never written to disk), so a
  // second scan does not fetch the same texts again.
  const tokenCache = new Map();

  function accountById(id) {
    const account = accounts.list().find((entry) => entry.id === id);
    if (!account) throw new Error('Dieses Konto gibt es nicht mehr.');
    return account;
  }

  function mailboxOf(account) {
    return openMailbox(account, accounts.getPassword(account.id));
  }

  // Sorts the mails of the last scan with the current rules and decisions.
  // No network access: after a decision the lists change at once.
  function evaluate() {
    const { messages, errors, addressOf, sinceDays } = last;
    const examples = training.all();
    const model = createModel(examples);
    const labels = new Map(examples.map((example) => [example.id, example.label]));
    const keywords = settings.load().importantKeywords;

    const inbox = [];
    const newsletterMessages = [];
    for (const message of messages) {
      const key = messageKey(message.account, message.uid);
      const label = labels.has(key) ? labels.get(key) : null;
      const verdict = classify(message, { keywords, model, label });
      if (verdict.kind === 'newsletter') {
        newsletterMessages.push(message);
        continue;
      }
      const { listUnsubscribe, listUnsubscribePost, tokens, ...shown } = message;
      inbox.push({
        ...shown,
        address: addressOf.get(message.account),
        important: verdict.kind === 'important',
        reason: verdict.reason,
        label,
      });
    }
    inbox.sort((a, b) => b.date - a.date);

    senders = new Map();
    const newsletters = groupNewsletters(newsletterMessages).map((group) => {
      senders.set(group.key, group);
      const { listUnsubscribe, listUnsubscribePost, uids, ...shown } = group;
      return {
        ...shown,
        address: addressOf.get(group.account),
        method: chooseMethod(group)?.type ?? null,
        unsubscribed: logStore.get(group.key),
      };
    });

    return {
      important: inbox.filter((mail) => mail.important),
      inbox,
      newsletters,
      errors,
      sinceDays,
      learned: { ...model.counts, ready: model.ready },
    };
  }

  async function scan({ signal, onProgress } = {}) {
    last = null;
    senders = new Map();
    const sinceDays = settings.load().mailSinceDays;
    const list = accounts.list();
    const throwIfAborted = () => {
      if (signal?.aborted) throw new DOMException('The scan was cancelled', 'AbortError');
    };

    const messages = [];
    const errors = [];
    for (const [index, account] of list.entries()) {
      throwIfAborted();
      onProgress?.({ account: account.address, done: index, total: list.length });
      try {
        const mailbox = mailboxOf(account);
        const headers = await mailbox.fetchHeaders({ sinceDays, signal });
        // The text is only needed for mails that are no newsletters.
        const missing = headers
          .filter((m) => !String(m.listUnsubscribe ?? '').trim() && !tokenCache.has(messageKey(m.account, m.uid)))
          .map((m) => m.uid);
        if (missing.length > 0) {
          const texts = await mailbox.fetchTexts(missing, { signal });
          for (const uid of missing) {
            const header = headers.find((m) => m.uid === uid);
            tokenCache.set(messageKey(account.id, uid), tokenize(`${header.subject ?? ''} ${texts.get(uid) ?? ''}`));
          }
        }
        for (const header of headers) {
          messages.push({ ...header, tokens: tokenCache.get(messageKey(header.account, header.uid)) ?? [] });
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        errors.push({ account: account.id, address: account.address, ...describeFailure(account, err) });
      }
    }
    throwIfAborted();

    last = {
      messages, errors, sinceDays, addressOf: new Map(list.map((account) => [account.id, account.address])),
    };
    return evaluate();
  }

  function knownMessage(account, uid) {
    const found = last?.messages.find((m) => m.account === account && m.uid === uid);
    if (!found) throw new Error('Diese Mail stammt nicht aus der letzten Prüfung.');
    return found;
  }

  async function readText({ account, uid } = {}) {
    knownMessage(account, uid);
    return mailboxOf(accountById(account)).fetchText(uid);
  }

  // The user's decision for one mail: true = important, false = not
  // important, null = take the decision back. Returns the re-sorted lists.
  async function label({ account, uid, important } = {}) {
    const message = knownMessage(account, uid);
    const key = messageKey(account, uid);
    if (important === null) training.remove(key);
    else training.set(key, { label: important === true, tokens: message.tokens });
    return evaluate();
  }

  async function resetLearning() {
    training.clear();
    return last ? evaluate() : null;
  }

  function knownSender(key) {
    const group = senders.get(key);
    if (!group) throw new Error('Dieser Absender stammt nicht aus der letzten Prüfung.');
    return group;
  }

  // browser: true opens the sender's web link instead of the automatic way
  // (offered after the automatic way failed).
  async function unsubscribe(key, { browser = false } = {}) {
    const group = knownSender(key);
    const method = browser ? browserMethod(group) : chooseMethod(group);
    if (!method) throw new Error(browser ? 'Kein Abmeldelink für den Browser angegeben.' : 'Kein Abmeldeweg angegeben.');
    const account = accountById(group.account);
    const result = await execute(method, {
      fetch,
      openExternal,
      sendMail: (mail) => sendMail({ account, password: accounts.getPassword(account.id), ...mail }),
    });
    let unsubscribed = null;
    if (result.ok) {
      unsubscribed = { date: now(), type: result.type };
      logStore.set(key, unsubscribed);
    }
    const browserAvailable = !result.ok && method.type !== 'browser' && browserMethod(group) !== null;
    return { ...result, unsubscribed, browserAvailable };
  }

  async function moveGroup(group) {
    const moved = await mailboxOf(accountById(group.account)).moveToTrash(group.uids, { fromAddress: group.fromAddress });
    // The mails are gone from the inbox: a second click must not find them.
    senders.delete(group.key);
    const gone = new Set(group.uids);
    last.messages = last.messages.filter((m) => !(m.account === group.account && gone.has(m.uid)));
    return moved;
  }

  async function removeSender(key) {
    return { moved: await moveGroup(knownSender(key)) };
  }

  // Moves the mails of every sender the user has unsubscribed from. A sender
  // whose mailbox fails is reported, the others are still handled.
  async function removeUnsubscribed() {
    const groups = [...senders.values()].filter((group) => logStore.get(group.key) !== null);
    let moved = 0;
    const done = [];
    const failed = [];
    for (const group of groups) {
      try {
        moved += await moveGroup(group);
        done.push(group.key);
      } catch (err) {
        failed.push({ key: group.key, message: err?.message ?? String(err) });
      }
    }
    return { moved, senders: done, failed };
  }

  async function saveAccount({ id, address, password } = {}) {
    const provider = detectProvider(address);
    if (!provider) throw new Error('Dieser Anbieter wird nicht unterstützt (GMX, freenet, Gmail).');
    return accounts.save({ id, address, provider, password });
  }

  async function testAccount(id) {
    const account = accountById(id);
    try {
      await mailboxOf(account).test();
      return { ok: true, message: null, hint: null };
    } catch (err) {
      const { message, hint } = describeFailure(account, err);
      return { ok: false, message, hint };
    }
  }

  return {
    scan,
    readText,
    label,
    resetLearning,
    unsubscribe,
    removeSender,
    removeUnsubscribed,
    saveAccount,
    testAccount,
    learned: async () => {
      const model = createModel(training.all());
      return { ...model.counts, ready: model.ready };
    },
    listAccounts: async () => accounts.list(),
    removeAccount: async (id) => accounts.remove(id),
  };
}

module.exports = { createMailService, createJsonLog };
