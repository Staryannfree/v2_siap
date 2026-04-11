@echo off
echo Iniciando build do SIAP Turbo...
npm run build
if %errorlevel% neq 0 (
    echo.
    echo ❌ Erro durante o build! Verifique as mensagens acima.
) else (
    echo.
    echo ✅ Build concluído com sucesso!
)
pause
