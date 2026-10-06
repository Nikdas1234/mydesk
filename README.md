# MyDesk

Desktop-Programm für Windows 11 mit ruhiger, aufgeräumter Oberfläche. Es prüft die Postfächer bei GMX,
freenet und Gmail, listet wichtige Mails auf und meldet Newsletter per Klick ab. Außerdem findet es
Systemmüll, alte Downloads und selten genutzte Programme und löscht sie erst nach Klick und Rückfrage. Gebaut mit Electron (ein Framework, das eine Weboberfläche als normales Windows-Programm
verpackt) und Node.js.

MyDesk hieß bis Version 0.2.1 „Aufräumzentrale". Beim ersten Start unter dem neuen Namen werden
Postfächer, Einstellungen und Gelerntes aus dem alten Ordner `%APPDATA%\Aufräumzentrale` übernommen; der
alte Ordner bleibt unverändert liegen.

## Stand

- **Stufe 1 (Speicherplatz): fertig.** Systemmüll, Alte Downloads, Einstellungen. Der Bereich „Doppelte Dateien" wurde mit Version 0.3.1 wieder entfernt.
- **Stufe 2 (E-Mail): fertig gebaut, mit echten Postfächern noch nicht erprobt.** Wichtige Mails,
  Newsletter abmelden, Postfächer in den Einstellungen. Geprüft ist alles mit automatischen Tests und
  einem Beispiel-Postfach; der Zugriff auf echte Konten ist noch offen (siehe unten).

- **Stufe 4 (ab 0.3.0): Dashboard.** Startseite mit Kacheln, Symbolleiste, Bereich „Programme",
  Update-Fenster mit Changelog, Farbschema, Anleitungen über „?", Animationen.

## Starten

- **Normalfall:** Doppelklick auf die Verknüpfung `MyDesk` auf dem Desktop.
- **Alternative:** im Projektordner `npm start` ausführen.
- **Verknüpfung neu anlegen** (z. B. nach Verschieben des Projektordners): `npm run shortcut`. Eine
  vorhandene Verknüpfung gleichen Namens wird überschrieben.
- **Nach frischem Klonen** (Projekt neu aus Git geholt) zuerst `npm install`. Das lädt Electron in den
  Ordner `node_modules` (eine Abhängigkeit, also ein fremdes Paket, das das Programm braucht).

```powershell
cd '<Projektordner>'
npm install
npm run shortcut
```

## Postfächer einrichten

Unter „Einstellungen" → „Postfächer" trägst Du Adresse und Passwort ein und klickst „Konto hinzufügen".
Der Anbieter wird aus der Adresse erkannt. „Verbindung testen" zeigt, ob die Anmeldung klappt.

Der Zugriff läuft über IMAP (das Standardverfahren, mit dem Mailprogramme ein Postfach lesen). Jeder
Anbieter verlangt dafür eine einmalige Freigabe:

| Anbieter | Was vorher nötig ist |
|---|---|
| **GMX** | Im Webmail unter „Einstellungen" → „POP3/IMAP Abruf" den Abruf über IMAP erlauben. Passwort ist Dein normales GMX-Passwort. |
| **freenet** | Im freenet-Kundenbereich den Zugriff für externe Mailprogramme (IMAP) freischalten. Passwort ist Dein normales freenet-Mail-Passwort. |
| **Gmail** | Im Google-Konto die Bestätigung in zwei Schritten einschalten und danach ein **App-Passwort** erzeugen (ein eigenes 16-stelliges Passwort nur für dieses Programm). Dieses App-Passwort trägst Du ein, nicht Dein Google-Passwort. |

Die genauen Menünamen ändern die Anbieter gelegentlich. Meldet „Verbindung testen" „Anmeldung
abgelehnt", steht der passende Hinweis direkt daneben.

## Was der Mail-Bereich tut und was nicht

- **Geprüft wird nur der Posteingang**, standardmäßig die letzten 90 Tage. Der Spam-Ordner bleibt außen
  vor: Abmelden bei echtem Spam bestätigt dem Absender nur, dass die Adresse aktiv ist.
- **Die Prüfung verändert nichts im Postfach.** Auch das Anzeigen einer Mail im Programm markiert sie
  nicht als gelesen.
- **Newsletter** ist alles, was die Abmelde-Kopfzeile mitschickt (seriöse Versender müssen das). Ein
  Newsletter bleibt Newsletter, auch wenn im Betreff „Rechnung" steht.
- **Wichtig** wird nach dem Inhalt entschieden, in dieser Reihenfolge:
  1. Deine eigene Entscheidung für genau diese Mail (Bereich „Einordnen").
  2. Im Postfach markiert (Fähnchen bzw. Stern).
  3. Was das Programm aus Deinen Entscheidungen gelernt hat (siehe unten).
  4. Ein Stichwort in Betreff oder Text, solange noch nichts gelernt ist oder die Mail kein
     bekanntes Wort enthält.
- **Einordnen und Lernen:** Der Bereich „Einordnen" zeigt alle Mails außer Newslettern. Mit
  „Wichtig" und „Nicht wichtig" entscheidest Du pro Mail; ein zweiter Klick nimmt die Entscheidung
  zurück. Ab je fünf wichtigen und nicht wichtigen Mails sortiert das Programm neue Mails nach ihren
  Wörtern (eine Wortstatistik, kein Sprachverstehen); der Grund lautet dann „Gelernt (87 %)".
  Gespeichert werden nur die Wörter der eingeordneten Mails, nie ihr Text, in
  `%APPDATA%\MyDesk\training.json`. „Gelerntes zurücksetzen" in den Einstellungen löscht das.
- **Mailtext wird mitgelesen:** Für die Einstufung lädt das Programm bei jeder Prüfung den Anfang
  (bis 32 KB) jeder Mail, die kein Newsletter ist. Das dauert bei vollen Postfächern spürbar länger
  als früher; innerhalb einer Sitzung wird jede Mail nur einmal geladen.
- **Abmelden** nutzt den ersten möglichen Weg und fragt vorher nach:
  1. direkt beim Absender (nur über eine verschlüsselte `https`-Adresse),
  2. per Abmelde-Mail von Deinem Konto an genau einen Empfänger,
  3. sonst öffnet sich der Abmeldelink im Browser, und Du schließt die Abmeldung dort selbst ab.
- **„Vorhandene Mails entfernen"** verschiebt die Mails dieses Absenders in den Papierkorb des
  Postfachs. „Alle abgemeldeten in den Papierkorb" (oben über der Liste) tut dasselbe für alle Absender, von denen
  Du Dich abgemeldet hast. Dort kannst Du sie wiederherstellen; endgültig gelöscht wird nichts.
- **Mailtext** wird als reiner Text gezeigt. Bilder und andere Inhalte aus dem Internet werden nie
  geladen, damit kein Absender das Öffnen mitbekommt.
- **Passwörter** speichert Windows verschlüsselt (an Dein Benutzerkonto gebunden) in
  `%APPDATA%\MyDesk\accounts.json`. Sie liegen nie im Projektordner, tauchen in keiner
  Fehlermeldung auf und werden nie an die Oberfläche zurückgegeben.
- **Weitergabe:** Mailinhalte gehen an niemanden. Verbindungen gibt es nur zu Deinem Mailanbieter und,
  beim Abmelden, zur Adresse des Newsletter-Absenders.

### Abnahme mit echten Postfächern (noch offen)

Das Programm wurde ohne Zugriff auf echte Konten gebaut. Diese Punkte kannst nur Du prüfen:

1. Je Anbieter ein Konto eintragen und „Verbindung testen".
2. „Jetzt prüfen": wichtige Mails und Newsletter erscheinen; im Webmail ist danach nichts als gelesen markiert.
3. Je einen Newsletter über jeden der drei Wege abmelden.
4. „Vorhandene Mails entfernen" bei einem Absender; die Mails liegen im Papierkorb des Postfachs.

## Was das Programm löscht und wohin

| Bereich | Was | Ziel | Adminrechte |
|---|---|---|---|
| Systemmüll | Temporäre Dateien (`%TEMP%`) | endgültig gelöscht | nein |
| Systemmüll | Temporäre Dateien von Windows (`C:\Windows\Temp`) | endgültig gelöscht | **ja** |
| Systemmüll | Papierkorb (alle Laufwerke; wird nie vorausgewählt) | endgültig gelöscht | nein |
| Systemmüll | Browser-Cache (Edge, Chrome, Firefox; nur die Cache-Ordner der Profile) | endgültig gelöscht | nein |
| Systemmüll | Reste von Windows-Updates (`C:\Windows\SoftwareDistribution\Download`) | endgültig gelöscht | **ja** |
| Systemmüll | Absturzberichte (`%LOCALAPPDATA%\CrashDumps`) | endgültig gelöscht | nein |
| Systemmüll | Absturzberichte von Windows (`C:\ProgramData\Microsoft\Windows\WER`) | endgültig gelöscht | **ja** |
| Alte Downloads | Einträge im Download-Ordner, länger als 90 Tage (einstellbar) unverändert | Windows-Papierkorb, wiederherstellbar | nein |

Bei den drei Kategorien mit Adminrechten fragt Windows einmal per UAC-Dialog (Benutzerkontensteuerung)
nach. Lehnst Du ab, sind die Kategorien ohne Adminrechte bereits bereinigt (sie laufen vorher); nur die
drei Admin-Kategorien bleiben unberührt, und das Programm meldet „Adminrechte wurden abgelehnt“. Endet
die Bereinigung mit Adminrechten ohne lesbares Ergebnis, steht dort „Ergebnis unbekannt – bitte neu
prüfen“.

**Schutzregeln:**

- In beiden Temp-Kategorien bleibt alles unberührt, was in den letzten 24 Stunden geändert wurde. Ein
  laufender Installer verliert so seine Arbeitsdateien nicht.
- Verknüpfungen und Junctions (Ordner-Verweise) **innerhalb** eines bereinigten Ordners werden nie
  verfolgt. Gelöscht wird höchstens der Verweis selbst, nie sein Ziel. Ist der Ordner selbst
  umgeleitet (z. B. `%TEMP%` per Junction), arbeitet das Programm ohne Adminrechte im Ziel; mit
  Adminrechten wird eine umgeleitete Wurzel übersprungen.
- Der Papierkorb wird beim Bereinigen vollständig geleert, auch was seit der letzten Prüfung
  hineingelegt wurde (die Rückfrage sagt das). Er ist daher nie vorausgewählt. Nach „In den
  Papierkorb“ bei Downloads steht Systemmüll wieder auf „noch nicht geprüft“.
- Ein Ordner in „Alte Downloads“ wird vor dem Verschieben neu gemessen; hat sich darin etwas geändert
  (Datei hinzugefügt, entfernt, verändert), wird er übersprungen.
- Browser-Verlauf, Lesezeichen, Passwörter und Cookies bleiben unberührt.
- Hat sich eine Datei seit der Suche verändert, wird sie übersprungen statt gelöscht. Dateien, die
  gerade in Benutzung sind, ebenfalls; sie werden am Ende als „übersprungen“ gezählt.
- Gelöscht wird nur nach Klick auf „Bereinigen“ bzw. „In den Papierkorb“ und anschließender Rückfrage.
  Bei Systemmüll nennt sie jede gewählte Kategorie einzeln mit Anzahl und Größe und darunter die
  Summe; bei Downloads Anzahl und Gesamtgröße.
- Windows-Werkzeuge (PowerShell, `whoami`) startet das Programm immer über ihren vollen Pfad unter
  `C:\Windows\System32`, nie über den bloßen Namen.

## Selten genutzte Programme

Der Bereich „Programme" listet installierte Programme auf, die am längsten nicht benutzten zuerst, mit
Größe, Installationsdatum und dem Knopf „Deinstallieren".

- **„Zuletzt benutzt" ist eine Schätzung.** Windows merkt sich nur Starts über Startmenü, Taskleiste und
  Explorer. Bei vielen Einträgen (Treiber, Hilfsprogramme, Laufzeitpakete) steht deshalb „Letzte
  Nutzung unbekannt"; das heißt nicht „nie benutzt".
- **„Deinstallieren"** startet nach einer Rückfrage den Deinstallierer des jeweiligen Programms. MyDesk
  entfernt nichts selbst. Je nach Programm fragt Windows nach Adminrechten.
- Apps aus dem Microsoft Store stehen nicht in der Liste.
- Gelesen wird die Liste aus der Windows-Registrierung, nur lesend.

## Ausprobieren ohne Risiko (Sandbox)

Die Sandbox (ein abgeschotteter Übungsbereich) ist ein Ordner mit Beispieldateien. Läuft das Programm
darin, arbeiten alle Bereiche nur in diesem Ordner. Echte Dateien sind nicht erreichbar.

**Woran Du den Übungsmodus erkennst:** In der Titelleiste steht dauerhaft ein farbig umrandeter Hinweis
„Übungsmodus – <Ordner>“. Fehlt er, arbeitet das Programm mit echten Dateien.

- Gelöschtes landet im Ordner `Papierkorb` innerhalb der Sandbox, nicht im echten Windows-Papierkorb.
- Es erscheint keine Adminrechte-Abfrage; die drei Admin-Kategorien arbeiten ebenfalls im Übungsordner.
- Die Kategorie Papierkorb ist in der Sandbox immer leer (0 B); gelöscht wird dort nur in den Ordner
  `Papierkorb` der Sandbox.
- Das Programm nimmt nur Ordner an, die das Skript angelegt hat: Es legt dort die Markierungsdatei
  `.mydesk-sandbox` ab. Ohne sie startet das Programm nicht (Schutz vor Tippfehlern wie `C:\`).
- Das Skript legt nur in einem **neuen oder leeren** Ordner an und bricht sonst ab. Der Pfad muss
  absolut sein, mit Laufwerksbuchstabe.

Sandbox anlegen (im Projektordner):

```powershell
node scripts/make-sandbox.js '<Ordner für die Sandbox>'
```

Programm in der Sandbox starten. Die Umgebungsvariable gilt nur für Programme, die aus **diesem**
PowerShell-Fenster gestartet werden (`npm start`). Die Desktop-Verknüpfung startet dagegen **immer** im
Echtbetrieb, egal ob die Variable irgendwo gesetzt ist:

```powershell
$env:MYDESK_SANDBOX = '<Ordner für die Sandbox>'
```

```powershell
npm start
```

Danach zurück in den Echtbetrieb: Variable entfernen (oder das Fenster schließen). Erst dann bearbeitet
auch ein weiterer Start aus diesem Fenster wieder echte Dateien.

```powershell
Remove-Item Env:MYDESK_SANDBOX
```

Neu beginnen: Sandbox-Ordner löschen und das Anlegen wiederholen.

**Mail im Übungsmodus:** Der Mail-Bereich arbeitet dort mit einem eingebauten Beispiel-Postfach
(erfundene Konten und Mails, darunter eines mit Anmeldefehler). Es gibt keine Verbindung zu einem
Mailanbieter, keine Abmelde-Mail wird wirklich gesendet und kein Browser geöffnet.

**Programme im Übungsmodus:** Der Bereich zeigt erfundene Programme; „Deinstallieren" entfernt dort nur
den Listeneintrag.

## Einstellungen

Der Eintrag „Einstellungen“ unten in der Seitenleiste bietet:

| Einstellung | Standard |
|---|---|
| Darstellung: Stil (Schlicht, Farbig, Liquid Glass) | Schlicht |
| Darstellung: Farbschema (Wie Windows, Hell, Dunkel) | Wie Windows |
| Darstellung: Animationen | an |
| Startseite: Name für die Begrüßung | leer |
| Startseite: Begrüßung, Datum und Uhrzeit, Zusammenfassung, Tipp des Tages (je ein Schalter) | alle an |
| Startseite: beim Start automatisch alles prüfen | aus |
| Startseite: Kacheln ein- und ausblenden | alle sichtbar |
| Postfächer: Konten hinzufügen, testen, entfernen | keine |
| Wichtige Mails: Zeitraum in Tagen | 90 |
| Wichtige Mails: Stichwörter in Betreff und Text | Rechnung, Mahnung, Zahlungserinnerung, Termin, Vertrag, Kündigung, Frist, Bescheid, Sicherheit, Passwort, Anmeldung, Lieferung, Bestellung |
| Wichtige Mails: Gelerntes zurücksetzen | – |
| Alte Downloads: älter als … Tage | 90 |

Die Einstellungen liegen in
`%APPDATA%\MyDesk\settings.json` (in der Sandbox: Ordner `settings` darin). Ist die Datei
beschädigt oder fehlt sie, gelten die Standardwerte.

## Weitergeben (Installer)

Der Installer (eine einzelne `.exe`, die das Programm auf einem anderen PC einrichtet) wird so gebaut:

```powershell
npm run dist
```

Das Ergebnis liegt in `dist\MyDesk-Setup-<Version>.exe` (rund 110 MB). Der Ordner `dist` wird
nicht ins Repository aufgenommen; der Installer lässt sich jederzeit neu bauen. Das Programmsymbol
(`build\icon.png` für den Installer, `build\icon.ico` für die Desktop-Verknüpfung) erzeugt
`npm run icon`.

- Der Empfänger braucht weder Node.js noch Adminrechte; installiert wird nur für sein Benutzerkonto.
- Der Installer legt Einträge im Startmenü und auf dem Desktop an und lässt sich über
  „Apps" in den Windows-Einstellungen wieder entfernen.
- Der Installer ist **nicht signiert**. Beim ersten Start zeigt Windows „Der Computer wurde durch
  Windows geschützt": dort „Weitere Informationen" und dann „Trotzdem ausführen" wählen.
- Jeder Empfänger hat eigene Einstellungen und eigene Postfächer; von Deinen Daten wird nichts
  mitgegeben.
- Der Übungsmodus (Sandbox) ist für die Entwicklung gedacht und beim Empfänger nicht eingerichtet.
- Neue Version: in `package.json` die Zahl bei `version` erhöhen, neu bauen, den neuen Installer
  weitergeben. Er ersetzt die alte Installation; die Einstellungen bleiben erhalten.

## Updates veröffentlichen

Das installierte Programm sieht bei jedem Start auf GitHub nach, ob es eine neuere Version gibt. Ist
eine da, meldet es das. Ohne Klick wird nichts geladen oder installiert. In den
Einstellungen steht unter „Programm" die aktuelle Version und „Nach Updates suchen".

Ist ein Update da, erscheint ein Fenster in der Mitte mit „Herunterladen" und „Später". Nach „Später"
bleibt ein roter Punkt am Einstellungen-Symbol, bis das Update installiert ist. Nach dem Update zeigt
das Programm beim ersten Start, was neu ist.

So bringst Du eine neue Version heraus:

1. In `src/renderer/changelog.js` oben einen Eintrag mit der neuen Versionsnummer und den Änderungen in
   Stichpunkten ergänzen. Das ist der Text, den die Nutzer nach dem Update sehen.
2. In `package.json` die Zahl bei `version` erhöhen (z. B. von `0.2.0` auf `0.2.1`).
2. Installer bauen:

```powershell
npm run dist
```

3. Die drei Dateien aus `dist` als Release (eine veröffentlichte Fassung) auf GitHub hochladen. `gh`
   ist das Kommandozeilenwerkzeug von GitHub; die Versionsnummer im Befehl anpassen:

```powershell
gh release create v0.2.1 dist\MyDesk-Setup-0.2.1.exe dist\MyDesk-Setup-0.2.1.exe.blockmap dist\latest.yml --title "Version 0.2.1" --notes "Was neu ist"
```

Wichtig dabei:

- Das GitHub-Repository muss **öffentlich** sein, sonst finden die anderen PCs
  nichts. Damit ist auch der Programmcode für jeden sichtbar.
- Die Datei `latest.yml` gehört immer dazu: Darin steht, welche Version aktuell ist, samt Prüfsumme
  des Installers. Ohne sie wird kein Update angezeigt.
- Der Name des Release muss `v` plus die Versionsnummer sein (`v0.2.1`).
- Updates gibt es nur in der installierten Fassung, nicht beim Start aus dem Projektordner und nicht
  im Übungsmodus.
- Fassungen vor 0.2.0 kennen die Update-Suche noch nicht. Dort muss einmalig von Hand der neue
  Installer ausgeführt werden.

## Tests

```powershell
npm test
```

Die Tests (automatische Prüfungen des Programmcodes) arbeiten ausschließlich in temporären Ordnern.
Gelöscht wird dabei nichts Echtes.

## Aufbau

| Ordner / Datei | Inhalt |
|---|---|
| `src/main/` | Hauptprozess: Fenster, Start (`main.js`), Anfragen der Oberfläche (`ipc.js`), Ordnerwahl echt oder Sandbox (`paths.js`), Einstellungen (`settings.js`), volle Pfade der Windows-Werkzeuge (`system-tools.js`) |
| `src/main/disk/` | Die Aufräumlogik: Systemmüll (`junk.js`), Bereinigen mit Adminrechten (`elevated.js`), Alte Downloads (`downloads.js`), Löschen mit Prüfung (`remove.js`), Ordner messen (`walk.js`) |
| `src/main/update.js` | Update-Suche und -Installation |
| `src/main/programs.js`, `history.js`, `migrate.js` | Installierte Programme, Zähler für die Startseite, Übernahme der Daten des alten Namens |
| `src/main/mail/` | Der Mail-Bereich: Lernen aus Entscheidungen (`learn.js`), Einstufung (`classify.js`), Abmeldeweg (`unsubscribe.js`), Konten (`accounts.js`, `providers.js`), Postfach lesen (`imap.js`), Abmelde-Mail senden (`smtp.js`), Ablauf (`service.js`), Beispiel-Postfach (`demo.js`) |
| `src/renderer/` | Oberfläche (HTML, CSS, JavaScript); `views/` enthält die neun Ansichten; `help.js` die Anleitungen, `changelog.js` die Änderungen je Version |
| `src/preload.js` | Schmale, feste Brücke zwischen Oberfläche und Hauptprozess |
| `scripts/` | `make-sandbox.js` (Sandbox anlegen), `create-shortcut.js` (Desktop-Verknüpfung) |
| `test/` | Tests |
| `docs/superpowers/specs/` | [Entwurf](docs/superpowers/specs/2026-10-04-aufraeumzentrale-design.md) |
| `docs/superpowers/plans/` | [Plan für Stufe 1](docs/superpowers/plans/2026-10-04-stufe-1-fenster-und-speicherplatz.md), [Plan für Stufe 2](docs/superpowers/plans/2026-10-05-stufe-2-mail.md) |
