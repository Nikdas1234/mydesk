// Sorts messages into newsletter / important / other. Pure functions: a
// message and the rules in, verdict out. No network, no file access.

function lower(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

// The first keyword found in the subject or among the words of the text.
function matchingKeyword(message, keywords) {
  const subject = lower(message.subject);
  const tokens = new Set(message.tokens ?? []);
  for (const keyword of keywords ?? []) {
    const wanted = lower(keyword);
    if (!wanted) continue;
    if (subject.includes(wanted) || tokens.has(wanted)) return keyword;
  }
  return null;
}

// rules: { keywords, model (from learn.js, or null), label (the user's own
// decision for this very mail: true, false or null) }.
// message.tokens are the words of subject and text.
// Order: newsletter, own decision, flag in the mailbox, what was learned
// from earlier decisions, and only then the keywords.
function classify(message, rules) {
  if (lower(message.listUnsubscribe)) return { kind: 'newsletter', reason: null };

  if (rules.label === true) return { kind: 'important', reason: 'Von dir als wichtig eingeordnet' };
  if (rules.label === false) return { kind: 'other', reason: 'Von dir als nicht wichtig eingeordnet' };
  if (message.flagged) return { kind: 'important', reason: 'Markiert' };

  const tokens = message.tokens ?? [];
  const model = rules.model;
  if (model && model.ready && model.knows(tokens)) {
    const probability = model.score(tokens);
    const reason = `Gelernt (${Math.round(probability * 100)} %)`;
    return { kind: probability >= 0.5 ? 'important' : 'other', reason };
  }

  const keyword = matchingKeyword(message, rules.keywords);
  if (keyword !== null) return { kind: 'important', reason: `Stichwort: ${keyword}` };
  return { kind: 'other', reason: null };
}

// One entry per account + sender address (never per display name), most
// mails first. Name and unsubscribe headers come from the newest mail.
function groupNewsletters(messages) {
  const groups = new Map();
  for (const message of messages) {
    const address = lower(message.fromAddress);
    const key = `${message.account}|${address}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key, account: message.account, fromAddress: address, fromName: '', count: 0, lastDate: -Infinity, uids: [],
        listUnsubscribe: '', listUnsubscribePost: '',
      };
      groups.set(key, group);
    }
    group.count += 1;
    group.uids.push(message.uid);
    if (message.date > group.lastDate) {
      group.lastDate = message.date;
      group.fromName = message.fromName ?? '';
      group.listUnsubscribe = message.listUnsubscribe ?? '';
      group.listUnsubscribePost = message.listUnsubscribePost ?? '';
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

module.exports = { classify, groupNewsletters };
