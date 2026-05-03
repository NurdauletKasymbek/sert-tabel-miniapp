@echo off
cd /d "%~dp0"

if not exist "bot\.env" (
  copy "bot\.env.example" "bot\.env" >nul
)

notepad "bot\.env"
