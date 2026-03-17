@echo off
cd /d "C:\Users\DigiAi\Desktop\CRIPTO\cryptoedge-pro"
for /f "tokens=1,* delims==" %%a in (C:\Users\DigiAi\Desktop\CRIPTO\cryptoedge-pro\.bot.env) do (if not "%%a"=="" if not "%%a:~0,1%"=="#" set "%%a=%%b")
python "C:\Users\DigiAi\Desktop\CRIPTO\cryptoedge-pro\bot\gridbot.py"
