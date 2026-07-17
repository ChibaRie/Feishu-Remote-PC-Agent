@echo off
cd /d "%~dp0"
echo 正在启动 claudecode_lark_mcp...
npm run build
if errorlevel 1 exit /b %errorlevel%
npm start
pause
