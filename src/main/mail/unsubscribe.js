// Picks the way to unsubscribe from a newsletter and carries it out.
// chooseMethod is pure; execute gets its network and mail access passed in.

const ONE_CLICK_BODY = 'List-Unsubscribe=One-Click';
const TIMEOUT_MS = 30_000;
const MAX_SUBJECT = 200;
const MAX_BODY = 2000;
const ADDRESS = /^[^\s@<>,;:"'()]+@[^\s@<>,;:"'()]+\.[^\s@<>,;:"'()]+$/;

// "<a>, <b>" -> ['a', 'b']; anything outside angle brackets is ignored.
function entries(header) {
  if (typeof header !== 'string') return [];
  return [...header.matchAll(/<([^<>]*)>/g)].map((match) => match[1].trim()).filter(Boolean);
}

function parseUrl(entry, protocols) {
  let url;
  try {
    url = new URL(entry);
  } catch {
    return null;
  }
  return protocols.includes(url.protocol) && url.hostname ? url : null;
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// Exactly one recipient; only subject and body are taken over, everything
// else (cc, bcc, to, ...) is dropped so nobody else can be addressed.
function parseMailto(entry) {
  if (!/^mailto:/i.test(entry)) return null;
  const rest = entry.slice('mailto:'.length);
  const queryStart = rest.indexOf('?');
  const to = decode(queryStart === -1 ? rest : rest.slice(0, queryStart));
  if (to === null || !ADDRESS.test(to)) return null;

  let subject = 'unsubscribe';
  let body = '';
  if (queryStart !== -1) {
    for (const pair of rest.slice(queryStart + 1).split('&')) {
      const eq = pair.indexOf('=');
      const name = (eq === -1 ? pair : pair.slice(0, eq)).toLowerCase();
      const value = decode(eq === -1 ? '' : pair.slice(eq + 1));
      if (value === null) continue;
      if (name === 'subject') subject = value.replace(/[\r\n]+/g, ' ').slice(0, MAX_SUBJECT);
      if (name === 'body') body = value.slice(0, MAX_BODY);
    }
  }
  return { type: 'mail', to, subject, body };
}

function chooseMethod({ listUnsubscribe, listUnsubscribePost } = {}) {
  const list = entries(listUnsubscribe);
  const oneClickOffered = typeof listUnsubscribePost === 'string'
    && listUnsubscribePost.toLowerCase().includes(ONE_CLICK_BODY.toLowerCase());

  if (oneClickOffered) {
    for (const entry of list) {
      const url = parseUrl(entry, ['https:']);
      if (url) return { type: 'oneclick', url: url.href };
    }
  }
  for (const entry of list) {
    const mail = parseMailto(entry);
    if (mail) return mail;
  }
  return browserMethod({ listUnsubscribe });
}

// The web link of the header, to be opened in the browser; null if there is none.
function browserMethod({ listUnsubscribe } = {}) {
  for (const entry of entries(listUnsubscribe)) {
    const url = parseUrl(entry, ['http:', 'https:']);
    if (url) return { type: 'browser', url: url.href };
  }
  return null;
}

// Never throws: a failure comes back as { ok: false, detail }.
async function execute(method, { fetch, sendMail, openExternal } = {}) {
  const type = method?.type;
  try {
    if (type === 'oneclick') {
      const response = await fetch(method.url, {
        method: 'POST',
        body: ONE_CLICK_BODY,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        // Not followed: many senders answer the request with a redirect to a
        // confirmation page, which means it was accepted.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ok = response.status >= 200 && response.status <= 399;
      return { type, ok, detail: ok ? null : `Server antwortete mit ${response.status}` };
    }
    if (type === 'mail') {
      await sendMail({ to: method.to, subject: method.subject, body: method.body });
      return { type, ok: true, detail: null };
    }
    if (type === 'browser') {
      await openExternal(method.url);
      return { type, ok: true, detail: null };
    }
    return { type: type ?? null, ok: false, detail: 'Unbekannter Abmeldeweg' };
  } catch (err) {
    return { type, ok: false, detail: err?.message ?? String(err) };
  }
}

module.exports = { chooseMethod, browserMethod, execute };
