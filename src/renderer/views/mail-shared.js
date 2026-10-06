// Shared by the two mail views: the progress text of the running mail scan
// and the list of accounts.

let currentAccount = null;

// One listener for the lifetime of the page; it updates whichever progress
// row is on screen.
window.api.mail.onProgress((progress) => {
  currentAccount = progress.account;
  for (const row of document.querySelectorAll('[data-mail-progress]')) row.setText?.(mailProgressText());
});

/** "Prüfe max@gmx.de …" */
export function mailProgressText() {
  return currentAccount ? `Prüfe ${currentAccount} …` : 'Prüfe Postfächer …';
}

/** The configured accounts; an empty list if they cannot be read. */
export async function loadAccounts() {
  try {
    return await window.api.mail.accounts.list();
  } catch {
    return [];
  }
}
