# W Hub

Alle Programme von W Software an einem Ort: durchblättern, suchen, installieren und aktuell halten.

![W Hub](https://mert.win/hub/img/home-de.webp)

- **Meine Programme:** alle installierten Programme und die Web-Apps als Start-Kacheln, sortierbar per Ziehen und in eigenen Ordnern.
- **Web-Apps als eigene App:** Voca, Files & Co. öffnen in einem eigenen Fenster mit eigenem Speicher, wie mit Webline geöffnet.
- **Entdecken:** Programme, Spiele und alles, was im Browser läuft. Jede App hat ihre eigene Seite wie auf der Website, mit Bildern, Funktionen und den Neuerungen der letzten Versionen.
- **Installieren mit einem Klick:** W Hub lädt das passende Paket direkt aus dem GitHub-Release des Programms, prüft die Prüfsumme und installiert still im Hintergrund.
- **Updates:** W Hub erkennt, welche Programme schon da sind und in welcher Version, zeigt neue Versionen an und aktualisiert auf Wunsch alle auf einmal. Updates landen dort, wo das Programm schon ist.
- **Öffnen, im Ordner zeigen und deinstallieren** direkt aus der Kachel.
- **Gemeinsamer Installationsordner** (Windows, optional): neue Installationen landen dort, schon installierte Programme zieht W Hub auf Wunsch um.
- 12 Sprachen, hell und dunkel, eigene Akzentfarbe, Stil Acryl.

## Download

Unter **[Releases](https://github.com/erqf1/whub/releases/latest)**:

| System | Datei |
|---|---|
| Windows | `WHub-Setup-….exe` (Installer) oder `WHub-…-portable.exe` |
| Linux | `.deb`, `.pacman` oder `.tar.gz` |
| macOS 12 Monterey und neuer | `WHub-…-mac-arm64.zip` (Apple Silicon) oder `…-mac-x64.zip` (Intel) |

macOS: Die App ist nicht von Apple beglaubigt. Beim ersten Start Rechtsklick → **Öffnen**, oder unter *Systemeinstellungen → Datenschutz & Sicherheit* „Trotzdem öffnen“. Meldet macOS „beschädigt“, hilft im Terminal: `xattr -cr "/Applications/W Hub.app"`.

Unter Linux und macOS lädt W Hub das Paket herunter und öffnet es; die Installation schließt das System ab.

## Wie W Hub arbeitet

- Versionen und Downloads kommen über die GitHub-API aus den Releases der Repos (`erqf1/vidline`, `erqf1/clipline`, `erqf1/webline`, `erqf1/textline`, `erqf1/picline`, `erqf1/convertline`, `erqf1/GambelStrike2`, …). Antworten werden mit ETag zwischengespeichert, unveränderte Releases zählen so nicht gegen das GitHub-Limit.
- Installierte Programme erkennt W Hub unter Windows an der Liste „Apps & Features“ (Uninstall-Einträge), unter Linux an dpkg/pacman und unter macOS an `/Applications`.
- Stille Installation: Inno Setup mit `/VERYSILENT`, electron-builder-Installer mit `/S`; Updates behalten „nur für mich“ bzw. „für alle Benutzer“ bei.
- Programme ohne Installer (GambelStrike 2) legt W Hub unter `%LOCALAPPDATA%\W Hub\Apps` (bzw. im gewählten Installationsordner) ab und legt eine Verknüpfung im Startmenü an.
- Eigener Installationsordner: Inno Setup mit `/DIR="…"`, electron-builder mit `/D=…` (immer zuletzt, ohne Anführungszeichen). Verschieben = neuestes Paket laden und prüfen, still deinstallieren, still im neuen Ordner installieren; Daten neben der EXE (JumpNDodge `data`) werden mitkopiert.

## Selbst bauen

```
npm install
npm start            # Entwicklung
npm run build:win    # Windows-Pakete nach dist/
npm run icon         # assets/icon.* aus dem Logo neu erzeugen
```

Selbsttest (unsichtbar, mit Testserver statt GitHub und einem Test-Installer, der nichts installiert):

```
node tools/run-selftest.js
node tools/run-selftest.js <ordner> --exe dist/win-unpacked/WHub.exe   # das fertige Programm testen
```

## Lizenz

Apache License 2.0
