@echo off
title Aider - Moonshot API
echo ==========================================
echo Iniciando Aider com Kimi (Moonshot API)...
echo ==========================================
echo.

:: Substitua SUA_CHAVE_AQUI pela sua API Key real
set API_KEY=sk-HpDUJeC1mvkqwsnSbpeGrz5QRWMnrybWlfh9nvvCmLVrJDAT

aider --openai-api-base https://api.moonshot.ai/v1 --openai-api-key %API_KEY% --model openai/kimi-k2-0905-preview

echo.
pause