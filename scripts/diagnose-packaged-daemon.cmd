@echo off
setlocal EnableExtensions

rem Run this file from the extracted KodaX Space application directory.
rem It reproduces the exact Electron -> Node -> KodaX CLI daemon bootstrap used
rem by current packaged builds, but keeps stderr visible in a local log.

cd /d "%~dp0"

set "APP_DIR=%CD%"
set "APP_EXE=%APP_DIR%\KodaX Space.exe"
set "KODAX_CLI=%APP_DIR%\resources\app.asar\node_modules\@kodax-ai\kodax\dist\kodax_cli.js"
set "SCRUB_IMPORT=data:text/javascript,delete%%20process.env.ELECTRON_RUN_AS_NODE"
set "DIAG_LOG=%APP_DIR%\kodax-daemon-bootstrap-diagnostic.log"

if not exist "%APP_EXE%" (
  echo [FAIL] KodaX Space.exe was not found beside this diagnostic script.
  echo Copy this .cmd file into the extracted application directory and run it again.
  pause
  exit /b 2
)

if defined KODAX_PROFILE_DIR (
  set "CONFIG_HOME=%KODAX_PROFILE_DIR%"
) else if defined KODAX_HOME (
  set "CONFIG_HOME=%KODAX_HOME%"
) else (
  set "CONFIG_HOME=%USERPROFILE%\.kodax"
)

set "SESSIONS_DIR=%CONFIG_HOME%\sessions"
set "ELECTRON_RUN_AS_NODE=1"
set "KODAX_DAEMON_SERVE=1"
set "KODAX_HOME=%CONFIG_HOME%"

> "%DIAG_LOG%" echo KodaX Space daemon bootstrap diagnostic
>>"%DIAG_LOG%" echo Started: %DATE% %TIME%
>>"%DIAG_LOG%" echo App: "%APP_EXE%"
>>"%DIAG_LOG%" echo Config home: "%CONFIG_HOME%"
if defined NODE_OPTIONS (
  >>"%DIAG_LOG%" echo NODE_OPTIONS present: yes
) else (
  >>"%DIAG_LOG%" echo NODE_OPTIONS present: no
)
>>"%DIAG_LOG%" echo.

echo ============================================================
echo KodaX Space packaged daemon bootstrap diagnostic
echo ============================================================
echo.
echo 1. Keep KodaX Space completely closed before running this file.
echo 2. This does not change the saved Daemon/Embedded preference.
echo 3. An active Embedded owner or shared daemon client will safely block it.
echo 4. Output is saved to:
echo    %DIAG_LOG%
echo.
echo [1/2] Testing the packaged KodaX CLI import...

"%APP_EXE%" --import "%SCRUB_IMPORT%" "%KODAX_CLI%" --version >>"%DIAG_LOG%" 2>&1
set "CLI_EXIT=%ERRORLEVEL%"

if not "%CLI_EXIT%"=="0" (
  echo [FAIL] The packaged KodaX CLI exited with code %CLI_EXIT%.
  >>"%DIAG_LOG%" echo CLI import exit code: %CLI_EXIT%
  echo.
  type "%DIAG_LOG%"
  echo.
  echo Please send this complete output to the KodaX Space team.
  pause
  exit /b %CLI_EXIT%
)

>>"%DIAG_LOG%" echo CLI import exit code: 0
>>"%DIAG_LOG%" echo.

echo [PASS] The packaged KodaX CLI can be imported.
echo.
echo [2/2] Starting the Coder daemon in the foreground...
echo.
echo If this window stays open, the daemon process did not crash.
echo Keep it open and launch KodaX Space normally:
echo   - If Space now works, the defect is in detached child startup.
echo   - If Space still fails, the defect is after daemon startup/attachment.
echo.
echo If this command exits, the real exception and exit code will be printed.
echo.

"%APP_EXE%" --import "%SCRUB_IMPORT%" "%KODAX_CLI%" daemon serve --profile coder --home "%USERPROFILE%" --config-home "%CONFIG_HOME%" --sessions-dir "%SESSIONS_DIR%" >>"%DIAG_LOG%" 2>&1
set "DAEMON_EXIT=%ERRORLEVEL%"

>>"%DIAG_LOG%" echo.
>>"%DIAG_LOG%" echo Daemon serve exit code: %DAEMON_EXIT%

echo [FAIL] The daemon exited with code %DAEMON_EXIT%.
echo.
type "%DIAG_LOG%"
echo.
echo Please send this complete output to the KodaX Space team.
pause
exit /b %DAEMON_EXIT%
