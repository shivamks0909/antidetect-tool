@echo off
cd /d "%~dp0\.."
echo [INFO] Setting up Tauri Signing Environment...
set "TAURI_SIGNING_PRIVATE_KEY_PATH=%CD%\.tauri\updater.key"
set "TAURI_SIGNING_PRIVATE_KEY=%CD%\.tauri\updater.key"
set "TAURI_SIGNING_PRIVATE_KEY_PASSWORD=OpinionInsightsSecureUpdateKey2026"
echo [INFO] Key Path: %TAURI_SIGNING_PRIVATE_KEY_PATH%
echo [INFO] Running Tauri Production Build...
call npx tauri build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Tauri build failed with exit code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)
echo [SUCCESS] Tauri production build and signing complete!

