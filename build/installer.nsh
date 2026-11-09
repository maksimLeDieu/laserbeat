; LaserBeat - réglages supplémentaires de l'installateur NSIS (inclus par electron-builder)
; Ajoute une page « Options » avec la case « Lancer Musique ML au démarrage de Windows »
; (décochée par défaut). Le lancement au démarrage passe par la clé Run de l'utilisateur.

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!define LB_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define LB_RUN_NAME "LaserBeat"

!ifndef BUILD_UNINSTALLER
  Var LB_AutoStartBox
  Var LB_AutoStart

  !macro customPageAfterChangeDir
    Page custom LB_OptionsPageCreate LB_OptionsPageLeave
  !macroend

  Function LB_OptionsPageCreate
    ${If} $LB_AutoStart == ""
      ReadRegStr $0 HKCU "${LB_RUN_KEY}" "${LB_RUN_NAME}"
      ${If} $0 != ""
        StrCpy $LB_AutoStart ${BST_CHECKED}
      ${EndIf}
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Options" "Choisissez comment Musique ML doit démarrer."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateCheckbox} 0 12u 100% 12u "Lancer Musique ML au démarrage de Windows"
    Pop $LB_AutoStartBox
    ${If} $LB_AutoStart == ${BST_CHECKED}
      ${NSD_Check} $LB_AutoStartBox
    ${EndIf}
    ${NSD_CreateLabel} 0 32u 100% 36u "Si cette case est cochée, Musique ML s'ouvrira tout seul à l'ouverture de la session Windows. Vous pourrez changer ce choix en relançant l'installateur."
    Pop $0
    nsDialogs::Show
  FunctionEnd

  Function LB_OptionsPageLeave
    ${NSD_GetState} $LB_AutoStartBox $LB_AutoStart
  FunctionEnd

  !macro customInstall
    ; Installation silencieuse (mise à jour automatique) : la page Options n'est pas affichée,
    ; on garde donc le réglage « démarrage de Windows » tel qu'il était.
    ${IfNot} ${Silent}
      ${If} $LB_AutoStart == ${BST_CHECKED}
        WriteRegStr HKCU "${LB_RUN_KEY}" "${LB_RUN_NAME}" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
      ${Else}
        DeleteRegValue HKCU "${LB_RUN_KEY}" "${LB_RUN_NAME}"
      ${EndIf}
    ${EndIf}
  !macroend
!endif

!macro customUnInstall
  ; Lors d'une mise à jour, l'ancien désinstallateur est lancé : on garde le réglage,
  ; le nouvel installateur le réécrit selon la case cochée.
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "${LB_RUN_KEY}" "${LB_RUN_NAME}"
  ${EndIf}
!macroend
