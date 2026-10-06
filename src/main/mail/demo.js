// Practice mailbox for the sandbox: made-up accounts and mails, no IMAP, no
// SMTP, no web access, no browser. Everything "sent" only lands in `actions`.

const { MailError } = require('./imap');

const DAY = 86_400_000;
const ONE_CLICK = 'List-Unsubscribe=One-Click';

function sampleInboxes(now) {
  const mail = (uid, daysAgo, fromName, fromAddress, subject, extra = {}) => ({
    uid,
    fromName,
    fromAddress,
    subject,
    date: now - daysAgo * DAY,
    seen: true,
    flagged: false,
    listUnsubscribe: '',
    listUnsubscribePost: '',
    text: `Guten Tag,\n\ndies ist eine Beispiel-Mail aus dem Übungsmodus: „${subject}“.\n\nViele Grüße\n${fromName}`,
    ...extra,
  });
  return {
    'demo-gmx': [
      mail(101, 1, 'Stadtwerke Musterstadt', 'service@stadtwerke-musterstadt.example', 'Ihre Rechnung für September 2026', { seen: false }),
      mail(102, 2, 'Zahnarztpraxis Dr. Beispiel', 'praxis@zahnarzt-beispiel.example', 'Erinnerung: Ihr Termin am Donnerstag', { seen: false }),
      mail(103, 3, 'Modehaus Nord', 'news@modehaus-nord.example', 'Nur heute: 20 % auf alles', {
        listUnsubscribe: '<https://modehaus-nord.example/abmelden?id=4711>', listUnsubscribePost: ONE_CLICK,
      }),
      mail(104, 9, 'Modehaus Nord', 'news@modehaus-nord.example', 'Die neue Herbstkollektion ist da', {
        listUnsubscribe: '<https://modehaus-nord.example/abmelden?id=4711>', listUnsubscribePost: ONE_CLICK,
      }),
      mail(105, 16, 'Modehaus Nord', 'news@modehaus-nord.example', 'Letzte Chance im Sommerschlussverkauf', {
        listUnsubscribe: '<https://modehaus-nord.example/abmelden?id=4711>', listUnsubscribePost: ONE_CLICK,
      }),
      mail(106, 4, 'Reiseblick', 'post@reiseblick.example', 'Ihr wöchentlicher Reise-Newsletter mit sehr vielen Angeboten für den Herbst und Winter', {
        listUnsubscribe: '<mailto:abmelden@reiseblick.example?subject=Abmelden>',
      }),
      mail(107, 11, 'Reiseblick', 'post@reiseblick.example', 'Fünf Ziele für den Kurzurlaub', {
        listUnsubscribe: '<mailto:abmelden@reiseblick.example?subject=Abmelden>',
      }),
      mail(108, 5, 'Tante Erna', 'erna@familie.example', 'Fotos vom Wochenende'),
      mail(109, 6, 'Paketdienst', 'noreply@paketdienst.example', 'Ihre Lieferung kommt morgen'),
    ],
    'demo-gmail': [
      mail(201, 1, 'Vermieter Schmidt', 'schmidt@hausverwaltung.example', 'Nebenkosten 2025', { flagged: true }),
      mail(202, 2, 'Technik-Magazin', 'redaktion@technik-magazin.example', 'Die Themen der Woche', {
        listUnsubscribe: '<https://technik-magazin.example/profil/abmelden>',
      }),
      mail(203, 7, 'Sportverein Musterstadt', 'vorstand@sv-musterstadt.example', 'Einladung zur Jahreshauptversammlung'),
      mail(204, 8, 'Rabattwelt', 'deals@rabattwelt.example', 'Deals des Tages', { listUnsubscribe: 'unbrauchbar' }),
      mail(205, 12, 'Bank Beispiel', 'sicherheit@bank-beispiel.example', 'Neue Anmeldung in Ihrem Konto', { seen: false }),
    ],
  };
}

function createDemoBackend({ now = Date.now } = {}) {
  const accountList = [
    { id: 'demo-gmx', address: 'max.beispiel@gmx.de', provider: 'gmx' },
    { id: 'demo-gmail', address: 'max.beispiel@gmail.com', provider: 'gmail' },
    { id: 'demo-freenet', address: 'altes.konto@freenet.de', provider: 'freenet' },
  ];
  const inboxes = sampleInboxes(now());
  const actions = [];
  let counter = 0;

  const accounts = {
    list: () => accountList.map((account) => ({ ...account })),
    getPassword: () => 'demo',
    save({ id, address, provider }) {
      const existing = accountList.find((account) => account.id === id);
      if (existing) {
        Object.assign(existing, { address, provider });
        return { ...existing };
      }
      counter += 1;
      const created = { id: `demo-neu-${counter}`, address, provider };
      accountList.push(created);
      return { ...created };
    },
    remove(id) {
      const index = accountList.findIndex((account) => account.id === id);
      if (index !== -1) accountList.splice(index, 1);
    },
  };

  function openMailbox(account) {
    const refuse = () => {
      throw new MailError('auth', 'Anmeldung abgelehnt', 'Beispiel: falsches Passwort');
    };
    if (account.id === 'demo-freenet') {
      return { fetchHeaders: async () => refuse(), fetchTexts: async () => refuse(), fetchText: async () => refuse(), moveToTrash: async () => refuse(), test: async () => refuse() };
    }
    const inbox = inboxes[account.id] ?? [];
    return {
      async fetchHeaders() {
        return inbox.map(({ text, ...header }) => ({ account: account.id, ...header }));
      },
      async fetchTexts(uids) {
        return new Map(uids.map((uid) => [uid, inbox.find((mail) => mail.uid === uid)?.text ?? '']));
      },
      async fetchText(uid) {
        const found = inbox.find((mail) => mail.uid === uid);
        if (!found) throw new MailError('other', 'Die Mail wurde im Postfach nicht mehr gefunden');
        return found.text;
      },
      async moveToTrash(uids /* , { fromAddress } */) {
        let moved = 0;
        for (const uid of uids) {
          const index = inbox.findIndex((mail) => mail.uid === uid);
          if (index !== -1) {
            inbox.splice(index, 1);
            moved += 1;
          }
        }
        return moved;
      },
      async test() {},
    };
  }

  return {
    accounts,
    openMailbox,
    actions,
    sendMail: async ({ to, subject }) => { actions.push({ type: 'mail', to, subject }); },
    fetch: async (url) => { actions.push({ type: 'oneclick', url }); return { status: 200 }; },
    openExternal: async (url) => { actions.push({ type: 'browser', url }); },
  };
}

module.exports = { createDemoBackend };
