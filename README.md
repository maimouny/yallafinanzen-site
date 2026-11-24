# yallafinanzen.de

Statische Website (kein Build). Netlify veröffentlicht den Inhalt dieses Ordners direkt.

## Rechtstexte
`impressum.html`, `datenschutz.html` und `erstinformation.html` sind auf Linda Polatschek ausgestellt (gemeinsames Layout: `legal.css`).

Was die Seite technisch nutzt (Grundlage der Datenschutzerklärung): Hosting Netlify; Formulare über Netlify Forms (Termin, Rückruf, Guide, Investieren); Weiterleitung jeder Anfrage nach monday.com (Kundensystem der BYB Agency GmbH als Auftragsverarbeiter); Calendly erst nach Klick auf „Kalender laden“; WhatsApp-/Telefon-Links; Schriften lokal (auch Tajawal); keine Cookies, kein Tracking. Wer hier etwas Neues einbindet (Video, Analyse, Pixel, externe Schrift), muss die Datenschutzerklärung anpassen und ggf. eine Einwilligung einholen.

`check.html`, `invest.html`, `investieren.html` und `preise.html` sind fast identische Landingpage-Varianten für Werbung und bleiben bewusst auf `noindex` (doppelte Inhalte). Alle anderen Seiten sind für Suchmaschinen freigegeben.

## monday.com-Anbindung
`netlify/functions/submission-created.mjs` läuft automatisch nach jeder geprüften Formular-Einsendung und legt in monday einen Eintrag samt Update mit allen Angaben an. Funktioniert nur, wenn Netlify die Seite über Git oder die Netlify CLI deployt (nicht per Drag-and-drop).

Den API-Token **nie** ins Repo, in Chats oder E-Mails. Am besten einen eigenen monday-Nutzer anlegen, der nur das Lead-Board sieht, und dessen Token nehmen (ein Token hat alle Rechte seines Nutzers).

Eintragen in Netlify: Site configuration → Environment variables → Add a variable → Key `MONDAY_API_TOKEN`, Haken bei „Contains secret values“, Scope „Functions“. Alternativ im Terminal (der Wert bleibt lokal):
`netlify env:set MONDAY_API_TOKEN "<token>" --secret --scope functions`

Umgebungsvariablen in Netlify (Site configuration → Environment variables), Werte nie ins Repo:

| Variable | Pflicht | Inhalt |
|---|---|---|
| `MONDAY_API_TOKEN` | ja | persönlicher API-Token aus monday (Profil → Developers) |
| `MONDAY_BOARD_ID` | ja | ID des Lead-Boards (aus der Board-URL) |
| `MONDAY_GROUP_ID` | nein | Gruppe, in die neue Leads sollen |
| `MONDAY_COLUMN_EMAIL` | nein | Spalten-ID einer Spalte vom Typ **E-Mail** |
| `MONDAY_COLUMN_PHONE` | nein | Spalten-ID einer Spalte vom Typ **Telefon** (Nummer mit Ländervorwahl + Flagge) |
| `MONDAY_COLUMN_CHANNEL` | nein | Spalten-ID einer Spalte vom Typ **Status**: „WhatsApp“ oder „Rückmeldung in 24 Std.“ (Labels werden automatisch angelegt) |
| `MONDAY_COLUMN_SOURCE` | nein | Spalten-ID einer **Text**-Spalte: Formular · Seite, z. B. „investieren · /preise“ |
| `MONDAY_COLUMN_LANGUAGE` | nein | Spalten-ID einer **Text**-Spalte (ar/de/en) |
| `MONDAY_COLUMN_CAMPAIGN` | nein | Spalten-ID einer **Text**-Spalte: `utm_campaign` der Werbeanzeige |

Der Eintrag heißt wie der Vorname (sonst Telefonnummer/E-Mail); alle Angaben stehen zusätzlich als Update am Eintrag.

## Funnels
Jeder Funnel fragt Vorname und Handynummer ab (Nummer wird geprüft und mit Ländervorwahl gespeichert) und hat zwei Wege, die beide den Lead speichern:
- **WhatsApp**: Lead mit Kontaktweg „WhatsApp“, danach öffnet sich WhatsApp (0163 1549878) mit den Antworten.
- **Absenden**: Lead mit Kontaktweg „Rückmeldung in 24 Std.“ und Bestätigung „Wir melden uns innerhalb von 24 Stunden“.

Auf `check.html` und `invest.html` führen die WhatsApp-Buttons in Checkliste/Video-Block zum Formular, damit kein Lead verloren geht.

Schlägt die Übertragung fehl, bleibt die Anfrage in Netlify Forms erhalten; der Fehler steht ohne personenbezogene Daten im Function-Log.

Tests: `node --test tests/`

## Sicherheit
`_headers` setzt HSTS, nosniff, Referrer-/Permissions-Policy und eine Content-Security-Policy (nur eigene Quellen, Calendly als einzige erlaubte Einbettung). Neue externe Quellen dort freigeben und in `datenschutz.html` beschreiben. Nach dem Deploy prüfen:
`curl -sI https://yallafinanzen.de/ | grep -i -E "strict-transport|content-security|nosniff"`
