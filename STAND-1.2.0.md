# W Hub 1.2.0 – Arbeitsstand (Notizen, wird am Ende zur Übersicht)

## Auftrag
1. Downloads schneller machen (Ursache messen, beheben, Vorher/Nachher in Commit).
2. Einstellung „Beim Start alles automatisch aktualisieren“ (Standard aus). Laufende Programme überspringen, später nochmal versuchen.
3. Einstellung „Mit dem System starten“: Windows/macOS `app.setLoginItemSettings` mit `--autostart`, Linux `~/.config/autostart/*.desktop`. Beim Autostart kein Fenster, nur Tray (Öffnen / Nach Updates suchen / Beenden). Prüfung beim Start und alle 6 h. Ist die Option an, schließt X nur das Fenster. RAM/CPU im Leerlauf messen.
4. Texte in 12 Sprachen, Selbsttest erweitern, Version 1.2.0, README, Tag v1.2.0, Release prüfen. Website-Changelog nach `website-update/hub/`.

## Messungen Download (Linux-Cloud, Electron 43)
- Echter GitHub-Release (vidline-linux-x86_64.tar.gz, 69 MB), über den Cloud-Proxy:
  curl ~24 MB/s, W Hub alt ~23–33 MB/s. Hier begrenzt der Proxy, ein Unterschied ist so nicht zu sehen.
- Lokal ohne Netzgrenze (300 MB): reines Lesen ~450–640 MB/s, W Hub alt ~310–370 MB/s.
  → Die Verarbeitung in W Hub (Transform, Readable.fromWeb, Fortschritt) bremst nicht.
- Lokal mit Drossel 3 MB/s **je Verbindung** (wie das GitHub-CDN, 69 MB):
  alt 3,0 MB/s (23,3 s), neu **10,5 MB/s (6,6 s)** mit 4 parallelen Range-Verbindungen.
- Ursache also: eine einzige Verbindung, die das CDN bremst. Fix: Stücke über mehrere Verbindungen.
- Noch offen: Messung auf echtem Windows über einen CI-Lauf (curl vs. alt vs. neu gegen GitHub).

## Umgesetzt (src/installer.js, noch nicht getestet im Selbsttest)
- Erste Anfrage `Range: bytes=0-8MB`. Bei 206 laden 4 Verbindungen die restlichen 8-MB-Stücke,
  jede in eigener Sitzung (`session.fromPartition('whub-dl-N', { cache: false })`), damit Chromium nicht alles per HTTP/2 bündelt.
- Server ohne Range (200): am Stück wie bisher, Prüfsumme läuft mit.
- Parallel: Prüfsumme danach über die ganze Datei. 1-MB-Schreibblöcke an feste Stellen.
- Bis zu 4 Versuche je Stück, macht beim Abbruch der Verbindung an der alten Stelle weiter.
  Wiederholung läuft wieder über github.com (signierte Links laufen ab).
- Abbrechen bricht alle Verbindungen ab, wartet auf alle (allSettled), löscht `.part`.
- Fortschritt höchstens alle 250 ms (vorher 120 ms).

## Plan für den Rest
- main.js: Erst-Prüfung macht jetzt der Hauptprozess (für den Tray-Modus ohne Renderer).
- Auto-Update: `enqueue(id, 'update', { auto: true })`. Läuft das Programm → überspringen, in 15 min nochmal.
  Nur stille Fälle (Windows: Inno/NSIS/einzelne EXE). Unter Linux/macOS die Option ausblenden.
  Auch bei den 6-h-Prüfungen im Hintergrund. W Hub selbst: heruntergeladenes Update still installieren,
  wenn die Warteschlange leer ist. Merker-Datei, damit es nach dem Neustart versteckt bleibt, falls es vorher im Tray war.
- Autostart: eigenes Modul. Selbsttest benutzt einen eigenen Login-Item-Namen (`name`), damit der echte Eintrag unberührt bleibt.
  Portable: `PORTABLE_EXECUTABLE_FILE` als Pfad. macOS: `wasOpenedAtLogin`, Dock im Tray-Modus ausblenden.
- Tray immer da, wenn die Option an ist. `window-all-closed` beendet dann nicht. Bei `second-instance` und beim Klick auf eine Benachrichtigung bei Bedarf ein neues Fenster bauen.
- Selbsttest: Testserver mit Range und Datei > 8 MB (Parallelpfad), Abbrechen mitten im Parallel-Download,
  Auto-Update beim Start (inkl. „läuft gerade“ überspringen), Login-Item an/aus, Tray-Modus ohne Fenster.
  Selbsttest braucht Windows (csc) → neuer Workflow `selftest.yml` auf windows-latest, dort auch Download-Messung.
- Leistung im Tray-Modus messen (RSS aller Electron-Prozesse, CPU im Leerlauf).

## Website-Dateien für den Nutzer
- (kommt noch) `website-update/hub/changelog.html` o. ä. mit Eintrag 1.2.0
