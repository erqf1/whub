; W Hub - Desktop-Symbol nur bei der ERSTEN Installation anlegen.
;
; electron-builder legt das Desktop-Symbol mit createDesktopShortcut: true bei jedem Lauf des Installers neu an,
; sobald allowToChangeInstallationDirectory an ist und der Installer nicht mit --updated läuft: das Symbol springt an
; eine andere Stelle bzw. kommt zurück, nachdem man es gelöscht hat. Deshalb steht in package.json
; createDesktopShortcut: false (electron-builder fasst das Symbol dann weder beim Installieren noch beim
; Deinstallieren an) und dieses Include übernimmt:
;   - Erst-Installation (keine frühere W-Hub-Installation in HKCU/HKLM): Symbol anlegen
;   - Update (Setup über eine vorhandene Version, Auto-Updater mit --updated, stilles /S): nie anfassen.
;     Einzige Ausnahme: hat der Uninstaller einer alten Version (bis 1.2.2) das vorhandene Symbol gerade gelöscht,
;     wird genau diese Datei zurückgelegt.
;   - echtes Deinstallieren: Symbol entfernen (beim Update ruft der Installer den alten Uninstaller mit --updated)

; Variablen nur im Installer (sonst warnt makensis beim Uninstaller-Bau, und electron-builder bricht bei Warnungen ab)
!ifndef BUILD_UNINSTALLER
  Var whubFirstInstall
  Var whubDeskUser
  Var whubDeskAll
!endif

!macro whubRestoreDesktopContext
  ${if} $installMode == "all"
    SetShellVarContext all
  ${else}
    SetShellVarContext current
  ${endif}
!macroend

!macro customInit
  StrCpy $whubFirstInstall "1"
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 != ""
    StrCpy $whubFirstInstall "0"
  ${endif}
  ReadRegStr $0 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${if} $0 != ""
    StrCpy $whubFirstInstall "0"
  ${endif}
  ${if} ${isUpdated}
    StrCpy $whubFirstInstall "0"
  ${endif}
  ; vorhandenes Symbol sichern, bevor der alte Uninstaller läuft
  InitPluginsDir
  StrCpy $whubDeskUser "0"
  StrCpy $whubDeskAll "0"
  SetShellVarContext current
  ${if} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $whubDeskUser "1"
    CopyFiles /SILENT "$DESKTOP\${SHORTCUT_NAME}.lnk" "$PLUGINSDIR\whub-desktop-user.lnk"
  ${endif}
  SetShellVarContext all
  ${if} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $whubDeskAll "1"
    CopyFiles /SILENT "$DESKTOP\${SHORTCUT_NAME}.lnk" "$PLUGINSDIR\whub-desktop-all.lnk"
  ${endif}
  !insertmacro whubRestoreDesktopContext
!macroend

!macro customInstall
  ${if} $whubFirstInstall == "1"
    ${ifNot} ${isNoDesktopShortcut}
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${endif}
  ${else}
    SetShellVarContext current
    ${if} $whubDeskUser == "1"
    ${AndIfNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      CopyFiles /SILENT "$PLUGINSDIR\whub-desktop-user.lnk" "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${endif}
    SetShellVarContext all
    ${if} $whubDeskAll == "1"
    ${AndIfNot} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
      CopyFiles /SILENT "$PLUGINSDIR\whub-desktop-all.lnk" "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${endif}
    !insertmacro whubRestoreDesktopContext
  ${endif}
  System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    WinShell::UninstShortcut "$oldDesktopLink"
    Delete "$oldDesktopLink"
    ${if} "$oldDesktopLink" != "$DESKTOP\${SHORTCUT_NAME}.lnk"
      Delete "$DESKTOP\${SHORTCUT_NAME}.lnk"
    ${endif}
    System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
  ${endif}
!macroend
