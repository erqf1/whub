'use strict';

// Alle Programme und Seiten, die W Hub zeigt. Texte wie auf den Websites (mert.win/<seite>), auf Englisch und Deutsch;
// andere Sprachen nehmen Englisch. Versionen, Neuerungen und Downloads kommen live aus den GitHub-Releases.
//
// win.kind:  inno     = Inno-Setup (Vidline, Clipline, JumpNDodge), still mit /VERYSILENT
//            nsis     = electron-builder-Installer (Webline, Textline, Picline, Convertline), still mit /S
//            portable = eine einzelne EXE, die W Hub selbst ablegt und verknüpft (GambelStrike 2)
// win.keys / win.names: woran W Hub das installierte Programm in der Windows-Liste "Apps & Features" erkennt.

const SITE = 'https://mert.win';

/** Dateinamen der Release-Pakete je System. flavor: deb | pacman | tar (Linux), arm64 | x64 (macOS) */
const QT_ASSETS = (lower, Name) => ({
  win: new RegExp(`^${Name}-windows-x64-setup\\.exe$`),
  deb: new RegExp(`^${lower}_amd64\\.deb$`),
  pacman: new RegExp(`^${lower}-x86_64\\.pkg\\.tar\\.zst$`),
  tar: new RegExp(`^${lower}-linux-x86_64\\.tar\\.gz$`),
  arm64: new RegExp(`^${Name}-macos-apple-silicon\\.dmg$`),
  x64: new RegExp(`^${Name}-macos-intel\\.dmg$`),
});
const EB_ASSETS = (Name) => ({
  win: new RegExp(`^${Name}-Setup-[\\d.]+\\.exe$`),
  deb: new RegExp(`^${Name}-[\\d.]+-amd64\\.deb$`),
  pacman: new RegExp(`^${Name}-[\\d.]+-x86_64\\.pacman$`),
  tar: new RegExp(`^${Name}-[\\d.]+-x64\\.tar\\.gz$`),
  arm64: new RegExp(`^${Name}-[\\d.]+-mac-arm64\\.zip$`),
  x64: new RegExp(`^${Name}-[\\d.]+-mac-x64\\.zip$`),
});

const APPS = [
  {
    id: 'vid', name: 'Vidline', repo: 'erqf1/vidline', color: '#14b8a6', category: 'apps', site: `${SITE}/vid/`,
    keywords: 'video player music editor cutline mp4 mp3 cut schneiden musik',
    win: { kind: 'inno', keys: ['{B7D0C3E2-5A41-4C7E-9B61-3F2A8E6D1C90}_is1'], names: /^(Vidline|Cutline)\b/, exe: 'Vidline.exe' },
    linux: { pkg: 'cutline' }, mac: { app: 'Vidline.app' },
    assets: QT_ASSETS('vidline', 'Vidline'),
    tagline: { en: 'Your video player. It edits, too.', de: 'Dein Videoplayer. Der auch schneidet.' },
    about: {
      en: 'Vidline opens instantly, plays your videos and music and stays out of the way. Want to change something? Press E and cut, blur, add music and export right there.',
      de: 'Vidline öffnet sofort, spielt Videos und Musik ab und steht nicht im Weg. Willst du etwas ändern? E drücken, schneiden, verwischen, Musik drunterlegen und direkt exportieren.',
    },
    features: [
      { en: ['Opens instantly', 'Double-click a video and it plays. No import, no project, no waiting.'], de: ['Öffnet sofort', 'Doppelklick auf ein Video und es läuft. Kein Import, kein Projekt, kein Warten.'] },
      { en: ['Your music looks this good', 'The cover fills the window, softly blurred, with title and artist in front. Tags can be edited right in Vidline.'], de: ['So gut sieht deine Musik aus', 'Das Cover füllt das Fenster, weich verwischt, davor Titel und Interpret. Tags bearbeitest du direkt in Vidline.'] },
      { en: ['Music plugin', 'A library with albums, artists and playlists, a queue with shuffle and repeat, and downloads by link.'], de: ['Musik-Plugin', 'Bibliothek mit Alben, Interpreten und Playlists, Warteschlange mit Zufall und Wiederholen, Download per Link.'] },
      { en: ['Edit with one key', 'Cut, blur, add music and export with GPU acceleration. 12 designs, any color.'], de: ['Bearbeiten mit einer Taste', 'Schneiden, verwischen, Musik drunterlegen und mit der Grafikkarte exportieren. 12 Designs, jede Farbe.'] },
    ],
    shots: ['player.webp', 'library-%L.webp', 'music.webp', 'theme-studio.webp', 'theme-light.webp'],
  },
  {
    id: 'clip', name: 'Clipline', repo: 'erqf1/clipline', color: '#f43f5e', category: 'apps', site: `${SITE}/clip/`,
    keywords: 'clip replay record recorder gaming shadowplay aufnehmen aufnahme',
    win: { kind: 'inno', keys: ['{4F2C9A61-7D3B-4E8A-A5C2-9B1E6D0F3A77}_is1'], names: /^Clipline\b/, exe: 'Clipline.exe' },
    linux: { pkg: 'clipline' }, mac: { app: 'Clipline.app' },
    assets: QT_ASSETS('clipline', 'Clipline'),
    tagline: { en: 'That moment? It\'s already saved.', de: 'Der Moment? Ist schon gespeichert.' },
    about: {
      en: 'Clipline records quietly in the background and keeps the last minutes in memory. Press one key and the moment you just saw becomes a clip – no recording to start, no giant files.',
      de: 'Clipline nimmt leise im Hintergrund auf und behält die letzten Minuten im Speicher. Eine Taste, und der Moment, den du gerade gesehen hast, wird zum Clip – ohne Aufnahme starten, ohne riesige Dateien.',
    },
    features: [
      { en: ['Set it up once', 'Pick your folder, clip length, quality and key. Clipline shows the RAM it needs before you start.'], de: ['Einmal einrichten', 'Ordner, Clip-Länge, Qualität und Taste wählen. Clipline zeigt vorher, wie viel Arbeitsspeicher es braucht.'] },
      { en: ['One key', 'Something great happened? Press your key and the last moments land as an MP4, with sound.'], de: ['Eine Taste', 'Etwas Geniales passiert? Taste drücken, die letzten Momente landen als MP4 im Ordner, mit Ton.'] },
      { en: ['You choose what is recorded', 'Which monitor, system sound and whether your microphone is in the clip.'], de: ['Du bestimmst, was drauf ist', 'Welcher Bildschirm, Systemton und ob dein Mikrofon mit in den Clip kommt.'] },
      { en: ['0 MB until you clip', '10 seconds to 10 minutes of replay buffer, nothing is written to disk before you press the key.'], de: ['0 MB, bis du clipst', '10 Sekunden bis 10 Minuten Puffer, auf die Platte kommt erst etwas, wenn du die Taste drückst.'] },
    ],
    shots: ['gallery-%L.webp', 'wizard1-%L.webp', 'wizard3-%L.webp'],
  },
  {
    id: 'html', name: 'Webline', repo: 'erqf1/webline', color: '#6366f1', category: 'apps', site: `${SITE}/html/`,
    keywords: 'html pdf viewer launcher webcase app browser',
    win: { kind: 'nsis', names: /^(Webline|Webcase) \d/, exe: 'Webline.exe' },
    linux: { pkg: 'webcase' }, mac: { app: 'Webline.app' },
    assets: EB_ASSETS('Webline'),
    tagline: { en: 'Your HTML files, as real programs.', de: 'Deine HTML-Dateien als echte Programme.' },
    about: {
      en: 'Double-click an HTML file and it runs in its own window – no address bar, no tabs, no browser around it. Webline also opens PDFs, pictures, videos, music and text files, and remembers everything in one tidy launcher.',
      de: 'Doppelklick auf eine HTML-Datei und sie läuft im eigenen Fenster – ohne Adressleiste, ohne Tabs, ohne Browser drumherum. Webline öffnet auch PDFs, Bilder, Videos, Musik und Textdateien und merkt sich alles in einem aufgeräumten Launcher.',
    },
    features: [
      { en: ['It runs alone', 'Every file gets its own window and its own storage – games keep their saves, tools their settings.'], de: ['Läuft für sich', 'Jede Datei bekommt ihr eigenes Fenster und ihren eigenen Speicher – Spiele behalten Spielstände, Tools ihre Einstellungen.'] },
      { en: ['Find it again', 'Everything you opened lands in the launcher. Search, rename, start – one click.'], de: ['Alles wiederfinden', 'Alles, was du geöffnet hast, landet im Launcher. Suchen, umbenennen, starten – ein Klick.'] },
      { en: ['Six kinds of files', 'HTML, PDF, pictures, video, music and text, with their own file icons.'], de: ['Sechs Dateiarten', 'HTML, PDF, Bilder, Video, Musik und Text, mit eigenen Dateisymbolen.'] },
    ],
    shots: ['launcher-%L.webp', 'pdf.webp', 'markdown.webp'],
  },
  {
    id: 'text', name: 'Textline', repo: 'erqf1/textline', color: '#f5a524', category: 'apps', site: `${SITE}/text/`, web: `${SITE}/text/editor/`,
    keywords: 'text code editor python notepad thonny programmieren',
    win: { kind: 'nsis', names: /^Textline \d/, exe: 'Textline.exe' },
    linux: { pkg: 'textline' }, mac: { app: 'Textline.app' },
    assets: EB_ASSETS('Textline'),
    tagline: { en: 'Text and code, with colour and Python.', de: 'Text und Code, mit Farben und Python.' },
    about: {
      en: 'A fast editor for everything from notes to Python projects: colours for over 140 languages, indenting that just works, and Python built in – run with F5, answer input() in the console, install packages like in Thonny.',
      de: 'Ein schneller Editor für alles von Notizen bis Python-Projekten: Farben für über 140 Sprachen, Einrücken, das einfach funktioniert, und Python eingebaut – mit F5 starten, input() in der Konsole beantworten, Pakete installieren wie in Thonny.',
    },
    features: [
      { en: ['Open, write, run', 'Textline recognises the language by the file name or first line. F5 starts Python files.'], de: ['Öffnen, schreiben, starten', 'Textline erkennt die Sprache am Dateinamen oder an der ersten Zeile. F5 startet Python-Dateien.'] },
      { en: ['Packages like in Thonny', 'Install numpy and friends into Textline\'s own environment with one click.'], de: ['Pakete wie in Thonny', 'numpy und Co. mit einem Klick in Textlines eigene Umgebung installieren.'] },
      { en: ['Everything a good editor needs', 'Colours, indenting, closing brackets, find & replace, multiple cursors.'], de: ['Alles, was ein guter Editor braucht', 'Farben, Einrücken, Klammern schließen, Suchen und Ersetzen, mehrere Cursor.'] },
      { en: ['Also in the browser', 'The same editor runs on mert.win/text/editor – no install needed.'], de: ['Auch im Browser', 'Derselbe Editor läuft auf mert.win/text/editor – ohne Installation.'] },
    ],
    shots: ['editor-%L.webp', 'run-%L.webp', 'packages-%L.webp', 'simple-%L.webp'],
  },
  {
    id: 'pic', name: 'Picline', repo: 'erqf1/picline', color: '#b84fe8', category: 'apps', site: `${SITE}/pic/`, web: `${SITE}/pic/app/`,
    keywords: 'image editor paint pixel art photo bild malen zeichnen minecraft textur',
    win: { kind: 'nsis', names: /^Picline \d/, exe: 'Picline.exe' },
    linux: { pkg: 'picline' }, mac: { app: 'Picline.app' },
    assets: EB_ASSETS('Picline'),
    tagline: { en: 'Paint, pixel, crop – down to the last pixel.', de: 'Malen, pixeln, zuschneiden – bis zum letzten Pixel.' },
    about: {
      en: 'An image editor for drawings, photos and pixel art: brushes, a pixel pen with mirror painting, shapes, text, layers and effects – and zoom down to a single pixel.',
      de: 'Ein Bildeditor für Zeichnungen, Fotos und Pixelgrafik: Pinsel, Pixelstift mit Spiegelmalen, Formen, Text, Ebenen und Effekte – und Zoom bis auf einen einzelnen Pixel.',
    },
    features: [
      { en: ['Pixel pen', 'Pixel-perfect lines and mirror painting for symmetrical designs in half the time.'], de: ['Pixelstift', 'Pixelgenaue Linien und Spiegelmalen für symmetrische Designs in der halben Zeit.'] },
      { en: ['Opens as a viewer first', 'Flip through the folder with the arrow keys, click "Edit" when you want to change something.'], de: ['Erst ein Betrachter', 'Mit den Pfeiltasten durch den Ordner blättern, auf „Bearbeiten“ klicken, wenn du etwas ändern willst.'] },
      { en: ['Layers and effects', '12 tools from brush to crop, layers, and zoom from 1 % to 102 400 %.'], de: ['Ebenen und Effekte', '12 Werkzeuge vom Pinsel bis zum Zuschneiden, Ebenen und Zoom von 1 % bis 102 400 %.'] },
      { en: ['Also in the browser', 'Picline runs on mert.win/pic/app too.'], de: ['Auch im Browser', 'Picline läuft auch auf mert.win/pic/app.'] },
    ],
    shots: ['paint-%L.webp', 'pixel-%L.webp', 'layers-%L.webp', 'effects-%L.webp'],
  },
  {
    id: 'convert', name: 'Convertline', repo: 'erqf1/convertline', color: '#0ea5e9', category: 'apps', legacy: true, site: `${SITE}/convert/`,
    keywords: 'convert converter ffmpeg mp4 mp3 png jpg pdf umwandeln konvertieren',
    win: { kind: 'nsis', names: /^Convertline \d/, exe: 'Convertline.exe' },
    linux: { pkg: 'convertline' }, mac: { app: 'Convertline.app' },
    assets: EB_ASSETS('Convertline'),
    tagline: { en: 'Drop it in, pick a format, done.', de: 'Reinziehen, Format wählen, fertig.' },
    about: {
      en: 'Convertline converts videos, music, images and documents in batches. It runs on your computer, so nothing gets uploaded and there is no size limit.',
      de: 'Convertline wandelt Videos, Musik, Bilder und Dokumente stapelweise um. Es läuft auf deinem Computer, also wird nichts hochgeladen und es gibt keine Größengrenze.',
    },
    features: [
      { en: ['Mixed batches, one click', 'One target for videos, one for music, one for images and one for documents. Any file can get its own.'], de: ['Gemischte Stapel, ein Klick', 'Ein Ziel für Videos, eins für Musik, eins für Bilder und eins für Dokumente. Jede Datei kann ein eigenes bekommen.'] },
      { en: ['Right-click on Windows', '"Convert with Convertline" right in the Explorer menu.'], de: ['Rechtsklick unter Windows', '„Mit Convertline umwandeln“ direkt im Explorer-Menü.'] },
      { en: ['59 file types', 'Reads 59 kinds of files, everything stays local.'], de: ['59 Dateitypen', 'Liest 59 Dateiarten, alles bleibt auf deinem Computer.'] },
    ],
    shots: ['queue-%L.webp', 'image-%L.webp', 'done-%L.webp'],
  },
  {
    id: 'gamble', name: 'GambelStrike 2', repo: 'erqf1/GambelStrike2', color: '#a855f7', category: 'games', site: `${SITE}/gamble/`, web: `${SITE}/gamble/`,
    keywords: 'game shooter fps roulette spiel ballern bots',
    win: { kind: 'portable', exe: 'GambelStrike2.exe' },
    assets: { win: /^GambelStrike2-v[\d.]+-Windows\.exe$/, html: /^GambelStrike2-v[\d.]+-offline\.html$/ },
    tagline: { en: 'Shooter with wheels of fortune for your loadout.', de: 'Shooter mit Glücksrädern für die Ausrüstung.' },
    about: {
      en: 'A free-for-all shooter against bots. Before every round you spin six wheels – HP, speed, damage, main weapon, secondary and knife – and never know which loadout you start with. Runs offline, on phones too.',
      de: 'Ein Free-for-All-Shooter gegen Bots. Vor jeder Runde drehst du sechs Glücksräder – HP, Speed, Damage, Hauptwaffe, Zweitwaffe und Messer – und weißt nie, mit welchem Loadout du startest. Läuft offline, auch auf dem Handy.',
    },
    features: [
      { en: ['10 or 25 players', 'Free-for-all against bots on Easy, Normal or Hard, on two maps with map voting.'], de: ['10 oder 25 Spieler', 'Free-for-All gegen Bots auf Easy, Normal oder Hard, auf zwei Maps mit Map-Voting.'] },
      { en: ['Skins and cases', '13 weapons, 8 knives including Butterfly and Karambit, skins in 7 rarities.'], de: ['Skins und Cases', '13 Waffen, 8 Messer mit Butterfly und Karambit, Skins in 7 Raritäten.'] },
      { en: ['Touch controls', 'On phones and tablets with a move stick, swipe to look and fire buttons.'], de: ['Touch-Steuerung', 'Auf Handy und Tablet mit Bewegungs-Stick, Wischen zum Umsehen und Feuerknöpfen.'] },
    ],
    shots: [],
  },
  {
    id: 'jump', name: 'JumpNDodge', repo: 'erqf1/JumpNDodge', color: '#f97316', category: 'games', site: `${SITE}/jump/`,
    keywords: 'game jump dodge spiel springen multiplayer online rangliste rust',
    // Rust Edition (ab 5.0): Pakete wie bei Vidline. Gleiche AppId wie der alte Installer -> Update an Ort und Stelle.
    // dataDir: Spielstand liegt neben der EXE und wird beim Verschieben mitgenommen
    win: { kind: 'inno', keys: ['{B44A592F-4DB5-4419-BCA6-7C5F80AA4472}_is1'], names: /^JumpNDodge\b/, exe: 'JumpNDodge.exe', dataDir: 'data' },
    linux: { pkg: 'jumpndodge' }, mac: { app: 'JumpNDodge.app' },
    assets: QT_ASSETS('jumpndodge', 'JumpNDodge'),
    tagline: { en: 'Jump, dodge, survive – now online.', de: 'Springen, ausweichen, überleben – jetzt auch online.' },
    about: {
      en: 'The first W Software game, now as the Rust Edition: jump over obstacles, dodge what falls from above and survive as long as you can. Eight difficulties, powers, cosmetics, two players on one keyboard, online versus and co-op and an online leaderboard.',
      de: 'Das erste Spiel von W Software, jetzt als Rust Edition: über Hindernisse springen, ausweichen, was von oben kommt, und so lange wie möglich überleben. Acht Schwierigkeiten, Powers, Kosmetik, zwei Spieler an einer Tastatur, Online-VS und -Koop und eine Online-Rangliste.',
    },
    features: [
      { en: ['Online with a friend', 'Create a room, send the 4-character code, play versus or co-op. Or host your own server.'], de: ['Online zu zweit', 'Raum erstellen, 4-stelligen Code schicken, VS oder Koop spielen. Oder selbst einen Server hosten.'] },
      { en: ['Eight difficulties', 'From Easy to Hell and Dynamic, which gets faster the longer you survive.'], de: ['Acht Schwierigkeiten', 'Von Leicht bis Hölle und Dynamisch, das immer schneller wird, je länger du durchhältst.'] },
      { en: ['Powers and cosmetics', 'Spin for powers, equip trails, hats and faces and show them off.'], de: ['Powers und Kosmetik', 'Powers erdrehen, Spuren, Hüte und Gesichter ausrüsten und zeigen.'] },
      { en: ['Smooth and sharp', 'Runs at your monitor\'s refresh rate (144/165 Hz) and stays sharp at any scaling and in fullscreen.'], de: ['Flüssig und scharf', 'Läuft mit der Bildrate deines Monitors (144/165 Hz) und bleibt bei jeder Skalierung und im Vollbild scharf.'] },
    ],
    shots: ['game.webp', 'online.webp', 'menu.webp'],
  },
  // ---- Web-Programme: fest eingebaut und offline nutzbar (Kategorie webapps). Quelle: mert.win<root>, beim Bauen als
  // Schnappschuss mitgeliefert, danach still aktualisiert. Neue Programme: nur hier eintragen.
  //   root  = Ordner auf der Website (Startseite des Programms), icon = Symbol auf der Website
  //   net   = ehrlicher Hinweis, was trotzdem Internet braucht (fehlt = läuft komplett offline)
  //   soon  = erst zeigen, sobald es auf der Website liegt (bzw. im Schnappschuss ist)
  {
    id: 'qr', name: 'QR-Codes', category: 'webapps', color: '#64748b', root: '/qr/', icon: '/app-icons/qr-192.png', site: `${SITE}/qr/`,
    keywords: 'qr code generator scanner wlan wifi kontakt link logo barcode',
    tagline: { en: 'Design QR codes and scan them.', de: 'QR-Codes gestalten und scannen.' },
    about: {
      en: 'Design QR codes with colours, gradients, dot styles, a logo and a frame – for links, Wi-Fi, contacts, pictures and more. With a scanner for the camera and for images.',
      de: 'QR-Codes gestalten – Farben, Verläufe, Punkt-Stile, Logo, Rahmen – für Links, WLAN, Kontakte, Bilder und mehr. Dazu ein Scanner für Kamera und Bilder.',
    },
    features: [
      { en: ['Your style', 'Dots, corners, gradients, a logo in the middle and a frame with text.'], de: ['Dein Stil', 'Punkte, Ecken, Verläufe, ein Logo in der Mitte und ein Rahmen mit Text.'] },
      { en: ['Everything a QR code can hold', 'Links, Wi-Fi access, contacts, e-mails, places and more.'], de: ['Alles, was in einen QR-Code passt', 'Links, WLAN-Zugang, Kontakte, E-Mails, Orte und mehr.'] },
      { en: ['Scanner included', 'Read QR codes with the camera or from a picture.'], de: ['Mit Scanner', 'QR-Codes mit der Kamera oder aus einem Bild lesen.'] },
    ],
    net: { en: 'QR codes with a picture behind them upload the picture to Shareline – that needs internet.', de: 'QR-Codes mit einem Bild dahinter laden das Bild zu Shareline hoch – das braucht Internet.' },
  },
  {
    id: 'skin', name: 'Skin-Editor', category: 'webapps', color: '#10b981', root: '/skin/', icon: '/app-icons/skin-192.png', site: `${SITE}/skin/`,
    keywords: 'minecraft skin cape editor 3d',
    tagline: { en: 'Edit skins and capes in 3D.', de: 'Skins und Capes in 3D bearbeiten.' },
    about: {
      en: 'A Minecraft skin and cape editor with a 3D view, layers, mirroring, undo and animated MinecraftCapes capes.',
      de: 'Minecraft Skin- und Cape-Editor mit 3D-Ansicht, Ebenen, Spiegeln, Rückgängig und animierten MinecraftCapes-Capes.',
    },
    features: [
      { en: ['Paint in 3D', 'Draw right on the model or on the flat texture, with mirroring for both sides.'], de: ['In 3D malen', 'Direkt am Modell oder auf der flachen Textur malen, mit Spiegeln für beide Seiten.'] },
      { en: ['Layers and undo', 'Hat and jacket layers, undo and redo.'], de: ['Ebenen und Rückgängig', 'Hut- und Jacken-Ebene, Rückgängig und Wiederholen.'] },
      { en: ['Capes', 'Design capes, animated ones too, and save them as images.'], de: ['Capes', 'Capes gestalten, auch animierte, und als Bild speichern.'] },
    ],
    net: { en: 'Loading a skin or cape by player name (Mojang, textures.minecraft.net, MinecraftCapes) needs internet.', de: 'Skins und Capes nach Spielername laden (Mojang, textures.minecraft.net, MinecraftCapes) braucht Internet.' },
  },
  {
    id: 'bg', name: 'Hintergrund entfernen', category: 'webapps', color: '#e11d48', root: '/hintergrund/', icon: '/app-icons/bg-192.png', site: `${SITE}/hintergrund/`,
    keywords: 'background remover hintergrund entfernen freistellen foto bild ki ai',
    tagline: { en: 'Remove the background from photos.', de: 'Hintergrund aus Fotos entfernen.' },
    about: {
      en: 'Removes the background from photos, free and right on your computer. Your pictures never leave your device.',
      de: 'Entfernt den Hintergrund aus Fotos – kostenlos und direkt auf deinem Computer. Deine Bilder verlassen nie dein Gerät.',
    },
    features: [
      { en: ['One click', 'Drop in a photo, the background is gone.'], de: ['Ein Klick', 'Foto reinziehen, der Hintergrund ist weg.'] },
      { en: ['Stays on your device', 'The AI runs on your computer, nothing is uploaded.'], de: ['Bleibt bei dir', 'Die KI rechnet auf deinem Computer, hochgeladen wird nichts.'] },
    ],
    net: { en: 'The AI model (RMBG-1.4) and its runtime come from the internet (Hugging Face, jsDelivr) – removing needs a connection until they have been loaded once.', de: 'Das KI-Modell (RMBG-1.4) und die Rechen-Bibliothek kommen aus dem Internet (Hugging Face, jsDelivr) – zum Entfernen braucht es eine Verbindung, bis sie einmal geladen sind.' },
  },
  {
    id: 'mc', name: 'Minecraft-Tools', category: 'webapps', color: '#16a34a', root: '/mc/', icon: '/app-icons/mc-192.png', site: `${SITE}/mc/`,
    keywords: 'minecraft befehle commands give summon tellraw banner schild rüstung trims crafting map art',
    tagline: { en: 'Commands, banners, armour and map art.', de: 'Befehle, Banner, Rüstung und Map-Art.' },
    about: {
      en: 'Minecraft tools: commands for every version (/give, /summon, /tellraw), a banner and shield designer, armour with trims and leather colours, a crafting calculator and map art.',
      de: 'Minecraft-Tools: Befehle für jede Version (/give, /summon, /tellraw), Banner- und Schild-Designer, Rüstung mit Trims und Lederfarben, Crafting-Rechner und Map-Art.',
    },
    features: [
      { en: ['Commands for every version', '/give, /summon and /tellraw, built with a form instead of by hand.'], de: ['Befehle für jede Version', '/give, /summon und /tellraw, mit Formular statt von Hand.'] },
      { en: ['Banners and shields', 'Layer patterns and colours and get the command.'], de: ['Banner und Schilde', 'Muster und Farben stapeln und den Befehl bekommen.'] },
      { en: ['Crafting and map art', 'What you need for a recipe, and pictures as map art.'], de: ['Crafting und Map-Art', 'Was du für ein Rezept brauchst, und Bilder als Map-Art.'] },
    ],
    net: { en: 'Item, recipe and mob lists come from GitHub (minecraft-data) – without internet they are missing.', de: 'Item-, Rezept- und Mob-Listen kommen von GitHub (minecraft-data) – ohne Internet fehlen sie.' },
  },
  {
    id: 'pse', name: 'Periodensystem', category: 'webapps', color: '#38bdf8', root: '/periodensystem/', icon: '/app-icons/pse-192.png', site: `${SITE}/periodensystem/`,
    keywords: 'chemie periodensystem elemente chemistry periodic table quiz molmasse',
    tagline: { en: 'All 118 elements, molar masses and a quiz.', de: 'Alle 118 Elemente, Molmassen und Quiz.' },
    about: {
      en: 'Interactive periodic table: all 118 elements with a profile and atom model, state at any temperature, a discovery timeline, a molar mass calculator and a quiz.',
      de: 'Interaktives Periodensystem: alle 118 Elemente mit Steckbrief und Atommodell, Aggregatzustand bei jeder Temperatur, Entdeckungs-Zeitstrahl, Molmassen-Rechner und Quiz.',
    },
    features: [
      { en: ['Every element', 'Profile, atom model and values for all 118 elements.'], de: ['Jedes Element', 'Steckbrief, Atommodell und Werte für alle 118 Elemente.'] },
      { en: ['Molar mass', 'Type a formula – brackets and hydrates work too.'], de: ['Molmasse', 'Summenformel eingeben – Klammern und Hydrate gehen auch.'] },
      { en: ['Quiz', 'Practise symbols and names.'], de: ['Quiz', 'Symbole und Namen üben.'] },
    ],
  },
  {
    id: 'web', name: 'Webgames', category: 'webapps', color: '#8b7dff', root: '/web/', icon: '/app-icons/web-192.png', site: `${SITE}/web/`,
    keywords: 'spiele games snake tetris 2048 flappy pacman sudoku wordle solitär',
    tagline: { en: '25 classics for your break.', de: '25 Klassiker für die Pause.' },
    about: { en: 'Snake, Tetris, 2048, Flappy, Pac-Man, Sudoku, Wordle and many more – with records that stay on your computer.', de: 'Snake, Tetris, 2048, Flappy, Pac-Man, Sudoku, Wordle und viele mehr – mit Rekorden, die auf deinem Computer bleiben.' },
  },
  {
    id: 'deal', name: 'Dealline', category: 'webapps', color: '#0d9488', root: '/deal/', icon: '/deal/icon-192.png', site: `${SITE}/deal/`, soon: true,
    keywords: 'deal vertrag abmachung vereinbarung unterschreiben unterschrift regeln pdf contract agreement sign',
    tagline: { en: 'Put deals in writing and sign them.', de: 'Deals festhalten und unterschreiben.' },
    about: {
      en: 'Write down deals with others – what it is about, who does what, rules for everyone or for single people – sign them, share them as a link and download them as a PDF or picture.',
      de: 'Deals mit anderen festhalten – worum es geht, wer was macht, Regeln für alle oder einzelne – unterschreiben, als Link teilen und als PDF oder Bild herunterladen.',
    },
    features: [
      { en: ['Sign together', 'Everyone signs right in the deal; signatures from a returned link are merged.'], de: ['Gemeinsam unterschreiben', 'Alle unterschreiben direkt im Deal; Unterschriften aus einem zurückgeschickten Link werden übernommen.'] },
      { en: ['The link is the deal', 'The whole deal sits inside the link – nothing is stored on a server.'], de: ['Der Link ist der Deal', 'Der ganze Deal steckt im Link – nichts liegt auf einem Server.'] },
      { en: ['PDF, picture, print', 'Download as PDF or PNG, print it, or save it as a .json file.'], de: ['PDF, Bild, Drucken', 'Als PDF oder PNG speichern, drucken oder als .json-Datei sichern.'] },
    ],
  },

  // ---- im Browser: brauchen den Server (Sync, Dateien), werden online im eigenen Fenster geöffnet
  {
    id: 'voca', name: 'Voca', category: 'web', color: '#10b981', site: `${SITE}/`, web: `${SITE}/`,
    keywords: 'latein vokabeln latin vocabulary schule lernen',
    tagline: { en: 'Practice Latin vocabulary and forms.', de: 'Latein-Vokabeln und Formen üben.' },
    about: { en: 'Vocabulary trainer for Latin with forms, tests and progress that syncs between your devices.', de: 'Vokabeltrainer für Latein mit Formen, Tests und Fortschritt, der zwischen deinen Geräten synchronisiert wird.' },
  },
  {
    id: 'files', name: 'Files', category: 'web', color: '#10b981', site: `${SITE}/files/`, web: `${SITE}/files/`,
    keywords: 'dateien teilen share upload download ordner cloud',
    tagline: { en: 'Share files and folders with direct links.', de: 'Dateien und Ordner teilen, mit Direktlinks.' },
    about: { en: 'Upload files and folders and share them with direct links. Members get their own area.', de: 'Dateien und Ordner hochladen und mit Direktlinks teilen. Mitglieder bekommen einen eigenen Bereich.' },
  },
];

const byId = Object.fromEntries(APPS.map((a) => [a.id, a]));
const CATEGORIES = ['apps', 'games', 'webapps', 'web'];
const WEBAPPS = APPS.filter((a) => a.category === 'webapps');

/** Text in der gewünschten Sprache, sonst Englisch */
const loc = (obj, lang) => (obj ? obj[lang] || obj.en || '' : '');

/** Bildname mit Sprache: %L wird de oder en */
const shotFile = (name, lang) => name.replace('%L', lang === 'de' ? 'de' : 'en');

/** Passendes Paket aus einem Release für dieses System (null = keins) */
function pickAsset(app, assets, { platform, arch, flavor }) {
  const a = app.assets;
  if (!a || !assets) return null;
  let re = null;
  if (platform === 'win32') re = a.win;
  else if (platform === 'darwin') re = a[arch === 'arm64' ? 'arm64' : 'x64'] || a.html;
  else re = a[flavor] || a.tar || a.html;
  if (!re) return null;
  return assets.find((x) => re.test(x.name)) || null;
}

/** Versionen vergleichen: 1.10.0 > 1.9.2; Tags wie "installer" zählen als 0 */
function parseVersion(v) {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(v || ''));
  return m ? [+m[1], +(m[2] || 0), +(m[3] || 0)] : null;
}
function newer(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i];
  return false;
}

module.exports = { APPS, byId, CATEGORIES, WEBAPPS, loc, shotFile, pickAsset, parseVersion, newer };
