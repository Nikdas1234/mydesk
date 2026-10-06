const { PROVIDERS } = require('./providers');

const DAY_MS = 86_400_000;
const TIMEOUT_MS = 30_000;
const MAX_TEXT = 200_000;
// For sorting mails by content only the beginning of each mail is read.
const SNIPPET_BYTES = 32_768;
const SNIPPET_TEXT = 20_000;
const TEXT_BLOCK = 100;
const NETWORK_CODES = new Set([
  'ETIMEDOUT', 'ETIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH',
  'ECONNECTION', 'ESOCKET', 'NoConnection', 'EConnectionClosed',
]);
const AUTH_CODES = new Set(['EAUTH', 'AUTHENTICATIONFAILED']);

// kind: 'auth' (login refused), 'network' (server not reachable in time),
// 'other'. Never carries the password or the original error object.
class MailError extends Error {
  constructor(kind, message, serverText = null) {
    super(message);
    this.name = 'MailError';
    this.kind = kind;
    this.serverText = serverText;
  }
}

function scrub(text, password) {
  const value = typeof text === 'string' ? text : '';
  return password ? value.split(password).join('***') : value;
}

function toMailError(err, password) {
  if (err instanceof MailError || err?.name === 'AbortError') return err;
  const serverText = scrub(err?.responseText || err?.message || String(err), password);
  if (err?.authenticationFailed || AUTH_CODES.has(err?.code) || AUTH_CODES.has(err?.serverResponseCode)) {
    return new MailError('auth', 'Anmeldung abgelehnt', serverText);
  }
  if (NETWORK_CODES.has(err?.code)) return new MailError('network', 'Server nicht erreichbar', serverText);
  return new MailError('other', serverText || 'Unbekannter Fehler', serverText);
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new DOMException('The scan was cancelled', 'AbortError');
}

// Reads one header from the raw header block the server returns (folded
// lines are joined).
function headerValue(block, name) {
  if (!block) return '';
  const unfolded = block.toString('utf8').replace(/\r?\n[ \t]+/g, ' ');
  const wanted = `${name.toLowerCase()}:`;
  for (const line of unfolded.split(/\r?\n/)) {
    if (line.toLowerCase().startsWith(wanted)) return line.slice(wanted.length).trim();
  }
  return '';
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Good enough to read a mail: drops scripts, styles and all tags, keeps line
// structure. Nothing is ever loaded from the network.
function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[<>]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function defaultCreateClient(options) {
  const { ImapFlow } = require('imapflow');
  return new ImapFlow(options);
}

// One mailbox of one account. Every method opens its own connection and
// closes it again. account: { id, address, provider }.
function createMailbox({ account, password, createClient = defaultCreateClient }) {
  const server = PROVIDERS[account.provider].imap;

  async function withClient(work) {
    let client;
    try {
      client = createClient({
        host: server.host,
        port: server.port,
        secure: true,
        auth: { user: account.address, pass: password },
        logger: false,
        socketTimeout: TIMEOUT_MS,
        connectionTimeout: TIMEOUT_MS,
      });
      await client.connect();
      return await work(client);
    } catch (err) {
      throw toMailError(err, password);
    } finally {
      try {
        await client?.logout();
      } catch {
        // the connection is gone already
      }
    }
  }

  // Headers of the inbox mails of the last sinceDays days. Changes nothing
  // in the mailbox.
  function fetchHeaders({ sinceDays, now = Date.now(), signal } = {}) {
    return withClient(async (client) => {
      throwIfAborted(signal);
      await client.mailboxOpen('INBOX', { readOnly: true });
      const messages = [];
      const query = {
        uid: true, envelope: true, flags: true, internalDate: true,
        headers: ['list-unsubscribe', 'list-unsubscribe-post'],
      };
      // The time span is given as a search, so even a very full inbox needs no
      // long list of mail numbers.
      const range = { since: new Date(now - sinceDays * DAY_MS) };
      for await (const item of client.fetch(range, query, { uid: true })) {
        throwIfAborted(signal);
        const from = item.envelope?.from?.[0] ?? {};
        const flags = item.flags ?? new Set();
        messages.push({
          account: account.id,
          uid: item.uid,
          fromName: from.name ?? '',
          fromAddress: (from.address ?? '').toLowerCase(),
          subject: item.envelope?.subject ?? '',
          date: item.internalDate ? new Date(item.internalDate).getTime() : 0,
          seen: flags.has('\\Seen'),
          flagged: flags.has('\\Flagged'),
          listUnsubscribe: headerValue(item.headers, 'list-unsubscribe'),
          listUnsubscribePost: headerValue(item.headers, 'list-unsubscribe-post'),
        });
      }
      return messages;
    });
  }

  // Text of many mails (the first 32 KB of each), for sorting them by
  // content. Read-only: no mail gets marked as read. A mail that cannot be
  // read yields an empty text. Resolves to a Map uid -> text.
  async function fetchTexts(uids, { signal } = {}) {
    const unique = [...new Set(uids)].filter((uid) => Number.isInteger(uid) && uid > 0);
    const texts = new Map();
    if (unique.length === 0) return texts;
    return withClient(async (client) => {
      throwIfAborted(signal);
      await client.mailboxOpen('INBOX', { readOnly: true });
      const { simpleParser } = require('mailparser');
      const query = { uid: true, source: { start: 0, maxLength: SNIPPET_BYTES } };
      for (let i = 0; i < unique.length; i += TEXT_BLOCK) {
        const block = unique.slice(i, i + TEXT_BLOCK);
        for await (const item of client.fetch(block.join(','), query, { uid: true })) {
          throwIfAborted(signal);
          let text = '';
          try {
            const parsed = await simpleParser(item.source, { skipHtmlToText: true, skipTextToHtml: true });
            text = parsed.text && parsed.text.trim() ? parsed.text : htmlToText(parsed.html || '');
          } catch {
            // unreadable mail: sorted by its subject alone
          }
          texts.set(item.uid, text.slice(0, SNIPPET_TEXT));
        }
      }
      return texts;
    });
  }

  // Plain text of one mail. The inbox is opened read-only, so the mail
  // stays unread.
  function fetchText(uid) {
    return withClient(async (client) => {
      await client.mailboxOpen('INBOX', { readOnly: true });
      const item = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!item || !item.source) throw new MailError('other', 'Die Mail wurde im Postfach nicht mehr gefunden');
      const { simpleParser } = require('mailparser');
      // No generated text: for html-only mails our own converter is used, which
      // keeps image addresses (tracking pixels) out of the text.
      const parsed = await simpleParser(item.source, { skipHtmlToText: true, skipTextToHtml: true });
      const text = parsed.text && parsed.text.trim() ? parsed.text : htmlToText(parsed.html || '');
      return text.slice(0, MAX_TEXT);
    });
  }

  // Moves mails of one sender from the inbox to the mailbox's own trash
  // folder. The server is asked again which of the mails still come from
  // that sender; only those are moved (the inbox may have changed since the scan).
  async function moveToTrash(uids, { fromAddress } = {}) {
    const unique = [...new Set(uids)];
    if (unique.length === 0) return 0;
    if (!unique.every((uid) => Number.isInteger(uid) && uid > 0)) throw new MailError('other', 'Ungültige Mail-Kennung');
    if (typeof fromAddress !== 'string' || !fromAddress.includes('@')) throw new MailError('other', 'Der Absender fehlt');
    return withClient(async (client) => {
      const folders = await client.list();
      const trash = folders.find((folder) => folder.specialUse === '\\Trash');
      if (!trash) throw new MailError('other', 'Kein Papierkorb im Postfach gefunden');
      await client.mailboxOpen('INBOX', undefined);
      const found = await client.search({ uid: unique.join(','), from: fromAddress }, { uid: true });
      const confirmed = unique.filter((uid) => (found || []).includes(uid));
      if (confirmed.length === 0) return 0;
      await client.messageMove(confirmed.join(','), trash.path, { uid: true });
      return confirmed.length;
    });
  }

  function test() {
    return withClient(async (client) => {
      await client.mailboxOpen('INBOX', { readOnly: true });
    });
  }

  return { fetchHeaders, fetchTexts, fetchText, moveToTrash, test };
}

module.exports = { createMailbox, MailError, toMailError, htmlToText };
