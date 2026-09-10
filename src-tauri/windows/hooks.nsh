; Opinion Insights Browser - NSIS Safe Data Hook
; Ensures updates and uninstalls NEVER delete user profiles, cookies, proxies, or fingerprints without explicit user consent.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Ask user if they wish to delete their profile data on uninstall, defaulting to NO (keep data)
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Would you like to delete all your browser profiles, cookies, proxies, and local data?$\r$\n$\r$\nClick 'No' to keep your browser data intact for future use." IDNO keep_data
  DetailPrint "User chose to remove profile data..."
  RMDir /r "$APPDATA\opinion-insights-browser"
  Goto done_cleanup

keep_data:
  DetailPrint "Preserving user profiles, cookies, and proxies in $APPDATA\opinion-insights-browser."

done_cleanup:
!macroend
