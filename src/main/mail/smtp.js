const { PROVIDERS } = require('./providers');
const { toMailError } = require('./imap');

const TIMEOUT_MS = 30_000;

function defaultCreateTransport(options) {
  return require('nodemailer').createTransport(options);
}

// Sends the unsubscribe mail from the account itself. STARTTLS is mandatory.
async function sendUnsubscribeMail({ account, password, to, subject, body, createTransport = defaultCreateTransport }) {
  const server = PROVIDERS[account.provider].smtp;
  let transport;
  try {
    transport = createTransport({
      host: server.host,
      port: server.port,
      secure: false,
      requireTLS: true,
      auth: { user: account.address, pass: password },
      connectionTimeout: TIMEOUT_MS,
      greetingTimeout: TIMEOUT_MS,
      socketTimeout: TIMEOUT_MS,
    });
    await transport.sendMail({ from: account.address, to, subject, text: body });
  } catch (err) {
    throw toMailError(err, password);
  } finally {
    transport?.close();
  }
}

module.exports = { sendUnsubscribeMail };
