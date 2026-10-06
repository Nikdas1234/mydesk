// Texts and numbers of the start page, the programs list and the update
// hints. Pure functions without DOM access.
import { formatBytes } from './format.js';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const UNUSED_DAYS = 180;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Guten Morgen" ... by the hour of the day (0-23). */
export function greeting(hour) {
  if (hour >= 5 && hour < 11) return 'Guten Morgen';
  if (hour >= 11 && hour < 18) return 'Guten Tag';
  if (hour >= 18 && hour < 23) return 'Guten Abend';
  return 'Gute Nacht';
}

/** "vor 5 Minuten", "vor 3 Tagen", "vor über 1 Jahr"; "noch nie" for null. */
export function agoText(ms, now) {
  if (ms === null || ms === undefined) return 'noch nie';
  const diff = Math.max(0, now - ms);
  if (diff < MINUTE) return 'gerade eben';
  if (diff < HOUR) return `vor ${plural(Math.floor(diff / MINUTE), 'Minute', 'Minuten')}`;
  if (diff < DAY) return `vor ${plural(Math.floor(diff / HOUR), 'Stunde', 'Stunden')}`;
  if (diff < 365 * DAY) return `vor ${plural(Math.floor(diff / DAY), 'Tag', 'Tagen')}`;
  return `vor über ${plural(Math.floor(diff / (365 * DAY)), 'Jahr', 'Jahren')}`;
}

/** Line under the greeting: the most recent check of any area. */
export function lastCheckedText(lastChecked, now) {
  const times = Object.values(lastChecked ?? {}).filter((value) => Number.isFinite(value));
  if (times.length === 0) return 'Noch nie geprüft';
  return `Zuletzt geprüft ${agoText(Math.max(...times), now)}`;
}

/** Number of programs whose last use is known and at least `days` ago. */
export function unusedSince(programs, days, now) {
  return programs.filter((program) => program.lastUsedMs !== null && now - program.lastUsedMs >= days * DAY).length;
}

export function lastUsedText(ms, now) {
  return ms === null ? 'Letzte Nutzung unbekannt' : `Zuletzt benutzt ${agoText(ms, now)}`;
}

/**
 * The lines of the tile "Das steht an": only what needs attention, each with
 * the view it leads to. `results` holds the last scan result per area (null =
 * not checked yet).
 */
export function todoItems(results, now) {
  const items = [];
  const { mail, junk, downloads, programs } = results;

  if (mail) {
    const unread = mail.important.filter((m) => !m.seen).length;
    if (mail.important.length > 0) {
      items.push({
        view: 'important',
        text: `${plural(mail.important.length, 'wichtige Mail', 'wichtige Mails')}, ${unread} ungelesen`,
        action: 'Ansehen',
      });
    }
    const open = mail.newsletters.filter((sender) => !sender.unsubscribed).length;
    if (open > 0) items.push({ view: 'newsletters', text: `${open} Newsletter-Absender zum Abmelden`, action: 'Abmelden' });
    const unsorted = mail.inbox.filter((m) => m.label === null).length;
    if (unsorted > 0 && !mail.learned.ready) {
      items.push({ view: 'sort', text: `${plural(unsorted, 'Mail wartet', 'Mails warten')} auf Einordnen`, action: 'Einordnen' });
    }
  }
  if (junk) {
    const bytes = junk.reduce((total, cat) => total + cat.bytes, 0);
    if (bytes > 0) items.push({ view: 'junk', text: `${formatBytes(bytes)} Systemmüll`, action: 'Bereinigen' });
  }
  if (downloads && downloads.length > 0) {
    const bytes = downloads.reduce((total, entry) => total + entry.size, 0);
    items.push({ view: 'downloads', text: `${plural(downloads.length, 'alter Download', 'alte Downloads')} (${formatBytes(bytes)})`, action: 'Ansehen' });
  }
  if (programs) {
    const unused = unusedSince(programs, UNUSED_DAYS, now);
    if (unused > 0) {
      items.push({ view: 'programs', text: `${plural(unused, 'Programm', 'Programme')} seit über 6 Monaten nicht benutzt`, action: 'Ansehen' });
    }
  }
  return items;
}

/** Text and fill of one drive bar; `low` = less than 10 % free. */
export function driveInfo(drive) {
  const usedPercent = drive.totalBytes > 0 ? Math.round(((drive.totalBytes - drive.freeBytes) / drive.totalBytes) * 100) : 0;
  return {
    label: `${drive.letter}: ${formatBytes(drive.freeBytes)} frei von ${formatBytes(drive.totalBytes)}`,
    usedPercent,
    low: drive.totalBytes > 0 && drive.freeBytes / drive.totalBytes < 0.1,
  };
}

/** 1 if a is newer than b, -1 if older, 0 if equal ("0.2.10" > "0.2.9"). */
export function compareVersions(a, b) {
  const parts = (text) => String(text ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * The change-log entries to show after an update: everything newer than the
 * version seen last, up to the running version. On the very first start only
 * the running version's entry.
 */
export function changelogSince(entries, lastSeen, current) {
  const upToCurrent = entries.filter((entry) => compareVersions(entry.version, current) <= 0);
  if (!lastSeen) return upToCurrent.filter((entry) => compareVersions(entry.version, current) === 0);
  return upToCurrent.filter((entry) => compareVersions(entry.version, lastSeen) > 0);
}

/** true while an update is waiting to be downloaded or installed. */
export function needsUpdateBadge(state) {
  return Boolean(state) && ['available', 'downloading', 'ready'].includes(state.status);
}

/** "Guten Abend, Alex"; without a name just the greeting. */
export function greetingLine(hour, name) {
  const trimmed = String(name ?? '').trim();
  return trimmed ? `${greeting(hour)}, ${trimmed}` : greeting(hour);
}

/** "Dienstag, 6. Oktober · 17:05". */
export function dateLine(date) {
  const day = date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  const time = date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

/**
 * One sentence under the greeting: the important mails that wait and the
 * space that can be freed. Before the first check: when was checked last.
 */
export function summaryText(results, lastChecked, now) {
  const { mail, junk, downloads } = results;
  if (Object.values(results).every((result) => result === null)) {
    const last = lastCheckedText(lastChecked, now);
    return last === 'Noch nie geprüft' ? 'Noch nichts geprüft. „Alles prüfen" zeigt, was ansteht.' : `${last}.`;
  }
  const parts = [];
  const important = mail ? mail.important.length : 0;
  if (important > 0) parts.push(plural(important, 'wichtige Mail wartet', 'wichtige Mails warten'));
  const bytes = (junk ?? []).reduce((total, cat) => total + cat.bytes, 0)
    + (downloads ?? []).reduce((total, entry) => total + entry.size, 0);
  if (bytes > 0) parts.push(`${formatBytes(bytes)} lassen sich freigeben`);
  if (parts.length === 0) return 'Alles erledigt. Im Moment steht nichts an.';
  return `${parts.join(', und ')}.`;
}

export const TIPS = [
  'Ordne ein paar Mails ein, dann sortiert MyDesk neue Mails nach ihrem Inhalt.',
  '„Alles prüfen" schaut in einem Durchgang in Postfächer, Systemmüll, Downloads und Programme.',
  'Nach dem Abmelden von einem Newsletter kannst du seine alten Mails mit einem Klick in den Papierkorb legen.',
  'Alte Downloads landen im Windows-Papierkorb und lassen sich von dort zurückholen.',
  'Systemmüll wird endgültig gelöscht. Schau vor dem Bereinigen kurz auf die Liste.',
  'In den Einstellungen legst du fest, ab wie vielen Tagen ein Download als alt gilt.',
  'Kacheln, die du nicht brauchst, blendest du in den Einstellungen unter „Startseite" aus.',
  'Das Fragezeichen neben einer Überschrift erklärt den Bereich Schritt für Schritt.',
  'Ein roter Punkt an den Einstellungen heißt: Es gibt eine neue Version von MyDesk.',
  'Programme, die du seit über 6 Monaten nicht benutzt hast, findest du unter „Programme".',
  'Bei Gmail brauchst du ein App-Passwort, nicht dein normales Passwort. Die Hilfe bei „Postfächer" zeigt den Weg.',
  'Eigene Stichwörter für wichtige Mails trägst du in den Einstellungen ein.',
  'Die schmale Leiste links zeigt die Namen der Bereiche, wenn du oben auf die drei Striche klickst.',
  'Schlicht, Farbig oder Liquid Glass: Den Stil wählst du in den Einstellungen unter „Darstellung".',
  'Ist ein Laufwerksbalken rot, sind dort weniger als 10 % frei.',
];

/** The tip of the day: the same all day, the next one tomorrow. */
export function tipOfDay(date) {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
  return TIPS[day % TIPS.length];
}
