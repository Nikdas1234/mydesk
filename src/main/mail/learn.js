// Learns from the user's own decisions which mails are important: a simple
// word statistic (naive Bayes over the words of subject and text). Everything
// stays on this computer.

const fs = require('node:fs');
const path = require('node:path');

const MIN_PER_CLASS = 5;
const MAX_TOKENS = 400;
const MIN_LENGTH = 3;
const MAX_LENGTH = 30;

// The distinct words of a text: lower-cased, letters only, 3 to 30 characters.
function tokenize(text) {
  if (typeof text !== 'string') return [];
  const seen = new Set();
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) continue;
    seen.add(word);
    if (seen.size >= MAX_TOKENS) break;
  }
  return [...seen];
}

// examples: [{ label: boolean, tokens: string[] }]. The model is `ready` once
// there are at least MIN_PER_CLASS examples of each kind; `score(tokens)` is
// the probability (0..1) that a mail with these words is important.
function createModel(examples) {
  const docs = { true: 0, false: 0 };
  const seenIn = { true: new Map(), false: new Map() };
  for (const example of examples) {
    const key = String(example.label === true);
    docs[key] += 1;
    for (const token of new Set(example.tokens)) {
      seenIn[key].set(token, (seenIn[key].get(token) ?? 0) + 1);
    }
  }
  const total = docs.true + docs.false;

  function score(tokens) {
    if (total === 0) return 0.5;
    // Log odds, starting neutral: how often the user says "important" must not
    // decide on its own. Only words known from the examples count.
    let logOdds = 0;
    for (const token of new Set(tokens)) {
      const inImportant = seenIn.true.get(token) ?? 0;
      const inOther = seenIn.false.get(token) ?? 0;
      if (inImportant + inOther === 0) continue;
      const pImportant = (inImportant + 1) / (docs.true + 2);
      const pOther = (inOther + 1) / (docs.false + 2);
      logOdds += Math.log(pImportant / pOther);
    }
    return 1 / (1 + Math.exp(-logOdds));
  }

  // true if at least one of the words occurred in the examples
  const knows = (tokens) => tokens.some((token) => seenIn.true.has(token) || seenIn.false.has(token));

  return {
    knows,
    ready: docs.true >= MIN_PER_CLASS && docs.false >= MIN_PER_CLASS,
    counts: { important: docs.true, other: docs.false },
    score,
  };
}

// The user's decisions, one per mail (id = "<account>|<uid>"), newest last.
// Only the words of a mail are kept, never its text.
function createTrainingStore(filePath, { limit = 2000 } = {}) {
  function all() {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!Array.isArray(raw)) return [];
      return raw.filter((e) => e && typeof e.id === 'string' && typeof e.label === 'boolean' && Array.isArray(e.tokens));
    } catch {
      return [];
    }
  }

  function write(entries) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(entries), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      fs.rmSync(tmpPath, { force: true });
      throw err;
    }
  }

  return {
    all,
    get: (id) => all().find((entry) => entry.id === id) ?? null,
    set(id, { label, tokens }) {
      const rest = all().filter((entry) => entry.id !== id);
      rest.push({ id, label: label === true, tokens: tokens.slice(0, MAX_TOKENS) });
      write(rest.slice(-limit));
    },
    remove(id) {
      write(all().filter((entry) => entry.id !== id));
    },
    clear() {
      write([]);
    },
  };
}

module.exports = {
  tokenize, createModel, createTrainingStore, MIN_PER_CLASS, MAX_TOKENS,
};
