# Stand W Hub 1.2.0

**IN ARBEIT** – Code fertig, Selbsttest in der CI grün (Windows 112/112, Hintergrund 32/32 auf Windows, Linux, macOS). Release-Lauf v1.2.0 läuft (von Hand gestartet, weil Tag-Pushes aus der Cloud-Session abgelehnt werden).

## Was neu ist

1. **Schnelle Downloads** (`src/installer.js`): Dateien ab 8 MB in Stücken zu 4 MB über bis zu 6 Verbindungen (HTTP Range).
   Jede Verbindung hat eine eigene Sitzung im Speicher (`session.fromPartition('whub-dl-N')`), sonst legt Chromium alle
   Anfragen an GitHub auf eine HTTP/2-Verbindung. Kein Range → am Stück. Stücke werden bis zu 3× neu versucht.
   SHA-256 danach über die ganze Datei. Abbrechen schließt alle Verbindungen und löscht die `.part`-Datei.
   Fortschritt höchstens alle 250 ms.
2. **Beim Start alles automatisch aktualisieren** (Einstellung `autoUpdate`, Standard aus): nach der ersten Prüfung
   (und bei jeder Hintergrundprüfung) werden alle still installierbaren Updates eingereiht. Laufende Programme werden
   übersprungen (nicht geschlossen, nicht gefragt) und nach 30 Minuten erneut versucht. Am Ende eine Meldung „Aktualisiert“.
   Unter Linux/macOS (Paket öffnet die Systeminstallation) bleibt es bei der Meldung.
3. **Mit dem System starten** (Einstellung `startWithSystem`, Standard aus): Windows/macOS über
   `app.setLoginItemSettings({ openAtLogin, args: ['--autostart'] })` (portable EXE: Pfad der echten EXE),
   Linux über `~/.config/autostart/win.mert.WHub.desktop`. Beim Autostart: kein Fenster, kein Renderer, keine
   Grafikbeschleunigung, nur Symbol im Infobereich (Öffnen / Nach Updates suchen / Beenden). Prüfung 15 s nach dem
   Start (offline: alle 10 min erneut) und alle 6 h. Mit der Option schließt das X nur das Fenster.
   Öffnen aus dem Hintergrund startet W Hub einmal neu (mit GPU), außer es läuft gerade eine Installation.
4. Texte in allen 12 Sprachen (11 neue Schlüssel), Selbsttest erweitert, README ergänzt, Version 1.2.0.

## Messwerte

| Was | Wert |
|---|---|
| GitHub, echtes Paket (97 MB, W Hub 1.1.0 .deb), 1 Verbindung | 23–24 MB/s |
| dasselbe, 4 Verbindungen | 37–43 MB/s |
| dasselbe, 6 Verbindungen (Standard) | 51–55 MB/s |
| Testserver, 1 MB/s je Verbindung gedrosselt (wie die lahme GitHub-Einzelverbindung) | 1,0 → 4,9 MB/s |
| Testserver ungedrosselt, Overhead | 140–190 MB/s, kein messbarer Nachteil |
| Leerlauf im Infobereich (Linux, Xvfb, PSS aller Prozesse) mit GPU | 252 MB |
| Leerlauf im Infobereich ohne GPU (so ausgeliefert) | 170 MB (Hauptprozess 89, Netzwerk 31, GPU-Rest 14, Zygote 34) |
| Zum Vergleich: mit offenem Fenster | 306 MB |
| CPU im Leerlauf (30 s gemessen) | 0 % |

(Die GitHub-Messung lief in einem Rechenzentrum; der Gewinn bei einer langsamen Heimleitung mit eingebrochener
Einzelverbindung entspricht eher der gedrosselten Messung.)

## Selbsttest

- `node build.mjs && node tools/run-selftest.js <ordner>`
- Teil 1 (nur Windows, FakeSetup.exe): + Range-Downloads beim großen Paket, sparsamer Fortschritt, Auto-Update
  mit geöffnetem Programm (übersprungen, später nachgeholt), Standardwerte aus.
- Teil 2 `tools/selftest-bg.js` (alle Systeme): Start ohne Fenster/Renderer/GPU, Symbol, Autostart-Eintrag,
  Prüfung beim Start, Auto-Update mit laufendem Programm, parallele Downloads (Prüfsumme, mehrere Verbindungen,
  schneller als eine, ohne Range, kaputte Stücke, Dauerfehler, Abbrechen ohne Reste), Leerlauf, Symbol-Menü
  „Nach Updates suchen“, Öffnen, Ein-/Ausschalten im Einstellungsdialog, X schließt nur das Fenster.
  CI: Windows Teil 1 112/112, Teil 2 auf Windows, Linux und macOS je 32/32.
- Neu: `.github/workflows/test.yml` – Selbsttest bei jedem Push auf main (Windows, Linux, macOS).

## Website (vom Nutzer hochzuladen)

- `website-update/hub/changelog-1.2.0.html` – Eintrag für `mert.win/hub/changelog.html` (oben einfügen; mert.win
  war aus der Cloud-Session nicht erreichbar, daher als Baustein – Klassen an die bestehende Seite anpassen).
