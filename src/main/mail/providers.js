// Server presets for the three supported mail providers.

const PROVIDERS = Object.freeze({
  gmx: {
    label: 'GMX',
    imap: { host: 'imap.gmx.net', port: 993 },
    smtp: { host: 'mail.gmx.net', port: 587 },
    hint: 'IMAP in den GMX-Einstellungen freischalten',
    domains: ['gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch'],
  },
  freenet: {
    label: 'freenet',
    imap: { host: 'mx.freenet.de', port: 993 },
    smtp: { host: 'mx.freenet.de', port: 587 },
    hint: 'IMAP im freenet-Kundenbereich freischalten',
    domains: ['freenet.de'],
  },
  gmail: {
    label: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993 },
    smtp: { host: 'smtp.gmail.com', port: 587 },
    hint: 'Zwei-Faktor-Anmeldung und App-Passwort nötig',
    domains: ['gmail.com', 'googlemail.com'],
  },
});

// 'max@gmx.de' -> 'gmx'; unknown or malformed addresses -> null.
function detectProvider(address) {
  if (typeof address !== 'string') return null;
  const at = address.lastIndexOf('@');
  if (at === -1) return null;
  const domain = address.slice(at + 1).trim().toLowerCase();
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    if (provider.domains.includes(domain)) return id;
  }
  return null;
}

module.exports = { PROVIDERS, detectProvider };
