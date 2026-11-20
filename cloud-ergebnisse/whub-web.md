ERGEBNIS CLOUD-SESSION whub-web

1. Aufgabe und Status
   W Hub 1.3.0: Web-Programme fest eingebaut und offline nutzbar, Desktop-Symbol nur bei der Erst-Installation,
   mehr Website-Bilder, Changelog. Status: FERTIG, Release v1.3.0 veröffentlicht. PR nach main offen (nicht gemergt).

2. Branch, Commits, PR, Release, CI
   - Branch: claude/focused-fermat-f9htjo (u. a. 0ac8886, bb015c4, 5c5ebed, 32c6be4, fc028e4, 0137d15, ca75e63,
     03bed1f = Website-Bilder vom Workflow, dazu dieser Ergebnis-Commit)
   - PR: https://github.com/erqf1/whub/pull/1 (offen)
   - Release: https://github.com/erqf1/whub/releases/tag/v1.3.0 – per Release-Workflow (workflow_dispatch, tag=v1.3.0)
     vom Branch-Stand 03bed1f gebaut; Tag liegt auf 03bed1f. Alle 14 Dateien dran: WHub-Setup-1.3.0.exe (+blockmap),
     WHub-1.3.0-portable.exe, .deb, .pacman, .tar.gz, mac-arm64.zip, mac-x64.zip (+blockmaps), latest.yml,
     latest-mac.yml, latest-linux.yml. Release-Notiz: „W Hub 1.3.0. Alle Neuerungen: https://mert.win/hub/changelog.html“
   - CI: Selbsttest (Windows, Linux, macOS) grün auf ca75e63 (inkl. NSIS-Probebau unter Windows); Release-Workflow
     alle 5 Jobs grün. Der Testlauf auf 03bed1f (nur Bilder, vom Bot gepusht) stand auf „action_required“
     (Bot-Commits brauchen Freigabe); der Lauf auf dem Ergebnis-Commit startet normal.

3. Was geändert wurde
   - Neue Kategorie/Bereich „Web-Programme“ (Leiste, Entdecken-Filter, Detailseiten): QR-Codes, Skin-Editor,
     Hintergrund entfernen, Minecraft-Tools, Periodensystem, Webgames, Dealline (ist inzwischen auf mert.win).
     Liste als Daten in src/shared/catalog.js (category 'webapps', root, icon, net-Hinweis, soon).
   - src/webapps.js: lädt jede Seite von https://mert.win/<ordner>/ mit Cookie w_zugang=w samt aller Dateien
     (href/src/srcset, url()/@import, import/fetch/new URL, feste Pfade in JS, Manifest, app-sw.js-Listen), nur
     gleicher Server; Seiten nur im eigenen Ordner; dazu fest versionierte CDN-Bibliotheken (jsDelivr/unpkg/cdnjs,
     ohne Cookie) – nötig, sonst laufen z. B. die QR-Codes offline gar nicht. Speicher nach SHA-256 (index.json + blobs).
   - src/webprograms.js: Protokoll whub-web://mert.win/ (Website-Wurzel als Basis), eigenes Fenster ohne Adressleiste,
     eigener Speicher je Programm (persist:web-<id>), nicht gespeicherte Pfade (z. B. /share/api) online mit Cookie
     durchgereicht, sonst Offline-Hinweisseite; stiller Abgleich beim Start und alle 6 h (If-None-Match/
     If-Modified-Since + Prüfsumme), Knopf „Von mert.win aktualisieren“; alter localStorage aus W Hub ≤1.2
     (https://mert.win im Web-App-Fenster) wird einmal übernommen. Ehrliche „Braucht Internet“-Hinweise je Programm.
   - Schnappschuss beim Bauen: tools/fetch-webapps.js -> webapps-snapshot/ -> resources/webapps (extraResources);
     mert.win nicht erreichbar = Warnung, kein Abbruch. Release-Workflow ruft es auf (aktuell 7/7, ~1,7 MB).
   - Desktop-Symbol: build/installer.nsh (createDesktopShortcut: false + eigene Logik): nur bei Erst-Installation
     anlegen, Updates nie anfassen (ein vom alten 1.2.x-Uninstaller gelöschtes Symbol wird zurückgelegt),
     echtes Deinstallieren entfernt es. Ursache: allowToChangeInstallationDirectory schaltet electron-builders
     Keep-Shortcuts ohne --updated ab.
   - Gleicher Fehler beim Aktualisieren anderer Programme über W Hub behoben: electron-builder-Programme bekommen bei
     Updates --updated, Inno-Programme /MERGETASKS=!desktopicon.
   - Selbsttest Teil 3 tools/selftest-web.js (alle Systeme), Teil-1-Erwartungen angepasst, test.yml auch für PRs +
     NSIS-Probebau, neuer Workflow siteshots.yml, tools/siteshots.js (35 Bilder), README, Version 1.3.0.
   - Website: website-updates/changelog-1.3.0.html und website-updates/img/*.webp (35 Bilder, hell+dunkel, DE+EN:
     home, discover, app, app-pic, updates, webapps, webapp-skin, settings, dazu open-pse/qr/web/deal).

4. Was getestet wurde
   - mert.win war aus der Cloud erreichbar (mit Cookie 200, ohne 302); echter Schnappschuss 7/7 lokal und in der CI.
   - Selbsttest Web-Programme 61/61 (Linux lokal, Windows, macOS in CI): Mini-Server mit Cookie-Schutz (ohne 403,
     mit ok), Build-Skript online und ohne Server, offline ausliefern, absolute Pfade, CDN offline, Ordner ohne /,
     Online-Durchreichen mit Cookie, Update-Erkennung (304/Hash), neues Programm erscheint, Zugang abgelehnt,
     Offline-Abgleich, Oberfläche, eigener Speicher, Übernahme des alten Speichers.
   - Windows-Teil 1 (111 Prüfungen) und Hintergrund-Teil (32) grün in der CI.
   - NICHT getestet: echtes Installieren/Aktualisieren des NSIS-Installers mit Desktop-Symbol auf einem Windows-PC
     (nur Probebau); ob die Inno-Installer von Vidline/Clipline/JumpNDodge die Aufgabe wirklich „desktopicon“ nennen
     (andere Repos nicht lesbar). GitHub-API für fremde Repos aus der Cloud gesperrt -> Bilder per Workflow aufgenommen.

5. Offene Punkte / was der Nutzer tun muss
   - PR #1 nach main mergen (Release ist schon vom Branch-Stand gebaut; main hat die Änderungen erst nach dem Merge).
   - Einmal auf Windows prüfen: Update von 1.2.2 auf 1.3.0 lässt das Desktop-Symbol an seinem Platz; gelöschtes
     Symbol kommt nicht wieder.
   - Website-Schnipsel und Bilder hochladen (siehe 6).

6. Nächste Schritte für die Haupt-Session
   - website-updates/changelog-1.3.0.html oben in Websites/hub/changelog.html einfügen (Klassen an die Seite anpassen).
   - website-updates/img/*.webp nach Websites/hub/img/ übernehmen und auf mert.win/hub einbauen (Web-Programme-Bereich,
     geöffnete Programme, Einstellungen, hell/dunkel).
   - Hub-Seite: neuen Punkt „Web-Programme, fest eingebaut, offline“ ergänzen.
