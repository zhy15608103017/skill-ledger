: << 'CMDBLOCK'
@echo off
REM Cross-platform dispatcher for Skill Ledger hook scripts.
REM On Windows, cmd.exe runs this block and dispatches through Node.js.
REM On Unix-like shells, the leading ':' makes this batch block a no-op.

if "%~1"=="" (
    echo run-hook.cmd: missing script name >&2
    exit /b 1
)

set "HOOK_DIR=%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node "%HOOK_DIR%%~1" %2 %3 %4 %5 %6 %7 %8 %9
    exit /b %ERRORLEVEL%
)

exit /b 0
CMDBLOCK

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRIPT_NAME="$1"
shift
exec node "${SCRIPT_DIR}/${SCRIPT_NAME}" "$@"
