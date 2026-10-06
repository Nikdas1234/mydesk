// Short instructions behind a "?" button, shown right where they are needed.
import { infoDialog } from './info-dialog.js';

const TOPICS = {
  accounts: {
    title: 'Postfach hinzufügen',
    intro: 'Unterstützt werden GMX, freenet und Gmail. Jeder Anbieter verlangt vorher eine einmalige Freigabe.',
    sections: [
      {
        heading: 'GMX',
        numbered: true,
        lines: [
          'Im Browser bei GMX anmelden und das Postfach öffnen.',
          'Einstellungen (Zahnrad) → „POP3/IMAP Abruf".',
          '„POP3 und IMAP Zugriff erlauben" anhaken und speichern.',
          'Hier Adresse und Dein normales GMX-Passwort eintragen.',
        ],
      },
      {
        heading: 'freenet',
        numbered: true,
        lines: [
          'Im Browser bei freenet Mail anmelden.',
          'In den Einstellungen den Zugriff für externe Mailprogramme (IMAP) freischalten.',
          'Hier Adresse und Dein freenet-Mail-Passwort eintragen.',
        ],
      },
      {
        heading: 'Gmail',
        numbered: true,
        lines: [
          'myaccount.google.com → „Sicherheit" → „Bestätigung in zwei Schritten" einschalten.',
          'myaccount.google.com/apppasswords öffnen, einen Namen eingeben (z. B. MyDesk) und „Erstellen" klicken.',
          'Das 16-stellige App-Passwort kopieren. Google zeigt es nur einmal.',
          'Hier die Gmail-Adresse und dieses App-Passwort eintragen, nicht Dein Google-Passwort.',
        ],
      },
      {
        heading: 'Danach',
        lines: [
          '„Konto hinzufügen" klicken, dann in der Zeile des Kontos „Verbindung testen".',
          'Steht dort „Anmeldung abgelehnt", ist meist das Passwort falsch oder die Freigabe fehlt.',
          'Das Passwort speichert Windows verschlüsselt auf diesem PC.',
        ],
      },
    ],
  },
  sort: {
    title: 'Einordnen und Lernen',
    intro: 'Hier stehen alle Mails außer Newslettern. Mit Deinen Entscheidungen lernt das Programm, was Dir wichtig ist.',
    sections: [
      {
        lines: [
          '„Wichtig" und „Nicht wichtig" gelten sofort für diese Mail. Ein zweiter Klick nimmt die Entscheidung zurück.',
          'Ab je fünf wichtigen und nicht wichtigen Mails sortiert das Programm neue Mails nach ihren Wörtern. Der Grund lautet dann „Gelernt" mit einer Prozentzahl.',
          'Vorher gelten die Stichwörter aus den Einstellungen, in Betreff und Text.',
          'Im Postfach markierte Mails (Fähnchen oder Stern) gelten immer als wichtig.',
          'Gespeichert werden nur einzelne Wörter der eingeordneten Mails, nie ihr Text. „Gelerntes zurücksetzen" steht in den Einstellungen.',
        ],
      },
    ],
  },
  newsletters: {
    title: 'Newsletter abmelden',
    intro: 'Als Newsletter gilt jede Mail, die eine Abmelde-Kopfzeile mitschickt.',
    sections: [
      {
        heading: 'Abmelden nutzt den ersten möglichen Weg',
        numbered: true,
        lines: [
          'Direkt beim Absender, über eine verschlüsselte Adresse.',
          'Per Abmelde-Mail von Deinem Konto.',
          'Sonst öffnet sich der Abmeldelink im Browser, und Du schließt die Abmeldung dort selbst ab.',
        ],
      },
      {
        heading: 'Mails entfernen',
        lines: [
          '„Vorhandene Mails entfernen" verschiebt die Mails dieses Absenders in den Papierkorb des Postfachs.',
          '„Alle abgemeldeten in den Papierkorb" tut das für alle Absender, von denen Du Dich abgemeldet hast.',
          'Im Papierkorb des Postfachs lassen sie sich wiederherstellen.',
        ],
      },
    ],
  },
  junk: {
    title: 'Systemmüll',
    intro: 'Dateien, die Windows und Programme zurücklassen und die sich gefahrlos löschen lassen.',
    sections: [
      {
        lines: [
          'Systemmüll wird endgültig gelöscht, nicht in den Papierkorb verschoben.',
          'In den Temp-Ordnern bleibt liegen, was in den letzten 24 Stunden geändert wurde.',
          'Beim Browser-Cache bleiben Verlauf, Lesezeichen, Passwörter und Cookies unberührt.',
          'Kategorien mit „benötigt Adminrechte": Windows fragt beim Bereinigen einmal nach.',
          'Der Papierkorb ist nie vorausgewählt. Wird er angehakt, wird er vollständig geleert.',
          'Dateien, die gerade benutzt werden, werden übersprungen.',
        ],
      },
    ],
  },
  downloads: {
    title: 'Alte Downloads',
    sections: [
      {
        lines: [
          'Gezeigt werden Einträge im Download-Ordner, die länger als die eingestellte Zahl von Tagen nicht geändert wurden.',
          'Ein Unterordner zählt als ein Eintrag. Liegt eine frische Datei darin, gilt er nicht als alt.',
          'Gelöschtes landet im Windows-Papierkorb und lässt sich wiederherstellen.',
        ],
      },
    ],
  },
  programs: {
    title: 'Selten genutzte Programme',
    intro: 'Die Liste zeigt installierte Programme, die am längsten nicht benutzten zuerst.',
    sections: [
      {
        lines: [
          '„Zuletzt benutzt" ist eine Schätzung: Windows merkt sich nur Starts über Startmenü, Taskleiste und Explorer.',
          '„Letzte Nutzung unbekannt" heißt nicht „nie benutzt". Treiber und Hilfsprogramme werden nie direkt gestartet.',
          '„Deinstallieren" startet nach Rückfrage den Deinstallierer des Programms. Je nach Programm fragt Windows nach Adminrechten.',
          'Apps aus dem Microsoft Store stehen nicht in der Liste.',
        ],
      },
    ],
  },
  updates: {
    title: 'Updates',
    sections: [
      {
        lines: [
          'Beim Start sucht das Programm nach einer neueren Version.',
          'Ist eine da, erscheint ein Hinweis und ein Punkt an den Einstellungen.',
          '„Herunterladen" lädt das Update, „Neu starten und installieren" spielt es ein.',
          'Ohne Deinen Klick wird nichts geladen oder installiert.',
          'Nach dem Update zeigt das Programm, was sich geändert hat.',
        ],
      },
    ],
  },
};

/** A small round "?" button that opens the instructions for `topic`. */
export function helpButton(topic) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = 'help-button';
  node.textContent = '?';
  node.title = 'Anleitung';
  node.setAttribute('aria-label', `Anleitung: ${TOPICS[topic].title}`);
  node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    infoDialog(TOPICS[topic]);
  });
  return node;
}

export const HELP_TOPICS = Object.keys(TOPICS);
