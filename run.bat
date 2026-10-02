@echo off
title Hire a Dealer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is required but was not found on your PATH.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting Hire a Dealer...
echo   Your browser will open automatically. Keep this window open.
echo.

node server.mjs

echo.
echo   Server stopped.
pause
