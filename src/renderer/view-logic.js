// Pure logic of the views (Systemmüll, Mail, Einstellungen) and of
// the title bar hint (no DOM access).
import { formatBytes } from './format.js';

const plural = (n, one, many) => `${n.toLocaleString('de-DE')} ${n === 1 ? one : many}`;

/** Number from an input field, or null if it is empty, no number or out of range. */
export function parseNumber(text, { min, max, integer = false }) {
  const trimmed = String(text).trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  if (integer && !Number.isInteger(value)) return null;
  return value;
}

const normalizePath = (p) => p.replace(/[\\/]+$/, '').toLowerCase();

/** Is this extra folder one of the paths the last search did not find? */
export function initialJunkSelection(categories) {
  return new Set(categories.filter((cat) => cat.bytes > 0 && cat.id !== 'recycleBin').map((cat) => cat.id));
}

const RECYCLE_BIN_NOTE =
  'Der Papierkorb wird vollständig geleert – auch was seit der letzten Prüfung hineingelegt wurde.';

/**
 * Text of the confirmation for the ticked junk categories:
 * `message` (intro, plus the recycle bin warning if it is ticked) and
 * `details` (one line per category with count and size, the sum last).
 * A category that could not be read shows "Größe unbekannt" instead of 0 B.
 */
export function junkConfirm(chosen) {
  const details = chosen.map((cat) => (
    cat.unreadable
      ? `${cat.label}: Größe unbekannt`
      : `${cat.label}: ${plural(cat.files, 'Datei', 'Dateien')}, ${formatBytes(cat.bytes)}`
  ));

  const readable = chosen.filter((cat) => !cat.unreadable);
  const unknown = chosen.filter((cat) => cat.unreadable);
  const files = plural(readable.reduce((n, cat) => n + cat.files, 0), 'Datei', 'Dateien');
  const size = formatBytes(readable.reduce((n, cat) => n + cat.bytes, 0));
  details.push(
    unknown.length === 0
      ? `Summe: ${files}, ${size}`
      : `Summe: mindestens ${size}, ${files} – Größe unbekannt bei ${unknown.map((cat) => cat.label).join(', ')}`,
  );

  let message = 'Das wird endgültig gelöscht. Das lässt sich nicht rückgängig machen.';
  if (chosen.some((cat) => cat.id === 'recycleBin')) message += ` ${RECYCLE_BIN_NOTE}`;
  return { message, details };
}

/** Text of the practice-mode hint in the title bar; null in real mode. */
export function sandboxLabel(info) {
  if (!info || !info.sandbox) return null;
  return info.sandboxDir ? `Übungsmodus – ${info.sandboxDir}` : 'Übungsmodus';
}

// ---- mail ----

const senderName = (sender) => sender.fromName || sender.fromAddress;

/** Texts of the question before unsubscribing; they say which way is used. */
export function unsubscribeConfirm(sender) {
  const ways = {
    oneclick: 'Die Abmeldung wird direkt an den Absender gesendet.',
    mail: `Von ${sender.address} wird eine Abmelde-Mail an den Absender gesendet.`,
    browser: 'Der Abmeldelink wird im Browser geöffnet – dort schließt du die Abmeldung selbst ab.',
  };
  return {
    title: `Von ${senderName(sender)} abmelden?`,
    message: ways[sender.method] ?? '',
    confirmLabel: 'Abmelden',
  };
}

/** Texts of the question before moving a sender's mails to the mailbox trash. */
export function removeConfirm(sender) {
  const mails = `${sender.count} ${sender.count === 1 ? 'Mail' : 'Mails'}`;
  return {
    title: 'Mails entfernen?',
    message: `${mails} von ${senderName(sender)} in den Papierkorb des Postfachs verschieben?`,
    confirmLabel: 'Verschieben',
  };
}

/** Result line after an unsubscribe attempt. */
export function unsubscribeResultText(result) {
  if (!result.ok) return `Abmeldung fehlgeschlagen: ${result.detail || 'unbekannter Fehler'}`;
  if (result.type === 'mail') return 'Abmelde-Mail gesendet.';
  if (result.type === 'browser') return 'Im Browser geöffnet.';
  return 'Abgemeldet.';
}

/** "04.10.2026"; empty for a missing date. */
export function formatDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** "a@gmx.de: Anmeldung abgelehnt – IMAP freischalten". */
export function accountErrorText(error) {
  return `${error.address}: ${error.message}${error.hint ? ` – ${error.hint}` : ''}`;
}

/** Numbers for the two mail tiles of the overview; null = not checked yet. */
export function mailTiles(result) {
  if (!result) return null;
  return {
    important: result.important.length,
    unread: result.important.filter((mail) => !mail.seen).length,
    senders: result.newsletters.length,
    mails: result.newsletters.reduce((total, sender) => total + sender.count, 0),
  };
}

/** Line above the list in "Einordnen": how much the program has learned. */
export function learnedText(learned) {
  const { important, other, ready } = learned;
  if (important === 0 && other === 0) {
    return 'Noch nichts gelernt. Ordne Mails ein: ab je 5 wichtigen und nicht wichtigen sortiert das Programm neue Mails nach ihrem Inhalt.';
  }
  const total = important + other;
  const base = `Gelernt aus ${important} wichtigen und ${other} nicht wichtigen ${total === 1 ? 'Mail' : 'Mails'}.`;
  if (ready) return `${base} Neue Mails werden nach ihrem Inhalt sortiert.`;
  const missing = [];
  if (important < 5) missing.push(`${5 - important} wichtige`);
  if (other < 5) missing.push(`${5 - other} nicht wichtige`);
  return `${base} Es fehlen noch ${missing.join(' und ')}, bis das Programm nach dem Inhalt sortiert.`;
}

/**
 * What "remove the mails of all unsubscribed senders" would do right now.
 * `changes` holds what happened since the scan: key -> { unsubscribed?, removed? }.
 */
export function bulkRemove(senders, changes) {
  const affected = senders.filter((sender) => {
    const change = changes.get(sender.key) ?? {};
    return Boolean(change.unsubscribed ?? sender.unsubscribed) && !change.removed;
  });
  const mails = affected.reduce((total, sender) => total + sender.count, 0);
  return {
    senders: affected.length,
    mails,
    message: `${mails} ${mails === 1 ? 'Mail' : 'Mails'} von ${affected.length} abgemeldeten ${affected.length === 1 ? 'Absender' : 'Absendern'} in den Papierkorb des Postfachs verschieben?`,
  };
}

/** What the title bar shows about updates; null = nothing. */
export function updateBanner(state) {
  if (state.status === 'available') {
    return { text: `Version ${state.version} ist verfügbar`, action: 'download', label: 'Herunterladen' };
  }
  if (state.status === 'downloading') {
    return { text: `Version ${state.version} wird geladen … ${state.percent ?? 0} %`, action: null, label: null };
  }
  if (state.status === 'ready') {
    return { text: `Version ${state.version} ist bereit`, action: 'install', label: 'Neu starten und installieren' };
  }
  return null;
}

/** One line about version and update state for the settings page. */
export function updateStatusText(state) {
  const base = `Version ${state.currentVersion}`;
  const details = {
    disabled: 'Updates gibt es nur in der installierten Fassung.',
    checking: 'Suche nach Updates …',
    none: 'Das ist die neueste Version.',
    available: `Version ${state.version} ist verfügbar.`,
    downloading: `Version ${state.version} wird geladen … ${state.percent ?? 0} %`,
    ready: `Version ${state.version} ist bereit zum Installieren.`,
    error: `Update-Suche fehlgeschlagen: ${state.message}`,
  };
  return details[state.status] ? `${base} · ${details[state.status]}` : base;
}
