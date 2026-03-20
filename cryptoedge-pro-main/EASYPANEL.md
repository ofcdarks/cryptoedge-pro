# 🚀 CryptoEdge Pro v2.0 — Deploy no EasyPanel

> Guia completo e atualizado. Tempo estimado: **15–20 minutos**.

---

## Índice
1. [Pré-requisitos](#1-pré-requisitos)
2. [Subir código no GitHub](#2-subir-código-no-github)
3. [Criar projeto no EasyPanel](#3-criar-projeto-no-easypanel)
4. [Configurar variáveis de ambiente](#4-configurar-variáveis-de-ambiente)
5. [Configurar volume (banco de dados)](#5-configurar-volume-banco-de-dados)
6. [Configurar domínio + HTTPS](#6-configurar-domínio--https)
7. [Fazer o deploy](#7-fazer-o-deploy)
8. [Primeiro acesso](#8-primeiro-acesso)
9. [Atualizações automáticas](#9-atualizações-automáticas)
10. [Backup do banco de dados](#10-backup-do-banco-de-dados)
11. [Solução de problemas](#11-solução-de-problemas)

---

## 1. Pré-requisitos

| Item | Onde obter |
|------|-----------|
| VPS com Ubuntu 22.04+ | Hetzner, DigitalOcean, Vultr (~€4-6/mês) |
| EasyPanel instalado na VPS | `curl -sSL https://get.easypanel.io | sh` |
| Domínio apontando para o IP da VPS | Registro.br, Namecheap, Cloudflare |
| Conta GitHub gratuita | github.com |

---

## 2. Subir código no GitHub

### 2.1 — Configurar Git (primeira vez)
```bash
git config --global user.name  "Seu Nome"
git config --global user.email "seu@email.com"
```

### 2.2 — Criar repositório no GitHub
1. Acesse **github.com** → botão verde **"New"**
2. Nome: `cryptoedge-pro`
3. Visibilidade: **Private** ← obrigatório (contém seu código)
4. **Não** marque "Initialize with README"
5. Clique **"Create repository"**

### 2.3 — Enviar o projeto
```bash
# Entre na pasta do projeto descompactado
cd cryptoedge-pro-v2

# Inicializar Git
git init
git add .
git commit -m "🚀 CryptoEdge Pro v2.0"

# Conectar ao GitHub (copie a URL do seu repositório)
git remote add origin https://github.com/SEU_USUARIO/cryptoedge-pro.git
git branch -M main
git push -u origin main
```

> ✅ Seu código está no GitHub. O `.gitignore` já exclui `.env`, `node_modules/` e `data/`.

---

## 3. Criar projeto no EasyPanel

1. Abra o EasyPanel: `https://IP-DA-VPS:3000`
2. **"Create Project"** → Nome: `cryptoedge`
3. Dentro do projeto → **"Create Service"** → **"App"**
4. Preencha:

| Campo | Valor |
|-------|-------|
| **Name** | `cryptoedge-pro` |
| **Source** | GitHub |
| **Repository** | `SEU_USUARIO/cryptoedge-pro` |
| **Branch** | `main` |
| **Build Method** | `Dockerfile` ← importante |

---

## 4. Configurar variáveis de ambiente

Na aba **"Environment"** do serviço, adicione cada variável:

### Obrigatórias
```
PORT=3000
NODE_ENV=production
DB_PATH=/data
```

### 🔒 Segurança — CRÍTICAS (novas no v2)
```
# Gere uma chave segura rodando no seu terminal:
# node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
ENCRYPTION_KEY=cole_aqui_a_chave_gerada_acima

# Seu domínio completo (com https://)
ALLOWED_ORIGIN=https://cryptoedge.seudominio.com
```

### IA Expert (opcional mas recomendado)
```
LAOZHANG_API_KEY=sk-sua-chave-laozhang
LAOZHANG_BASE_URL=https://api.laozhang.ai/v1
AI_MODEL=qwen3-30b-a3b
```

### Binance (para saldo real e bot)
```
BINANCE_API_KEY=sua_binance_api_key
BINANCE_SECRET_KEY=sua_binance_secret_key
```

### Telegram (notificações do bot)
```
TELEGRAM_TOKEN=1234567890:AAFxxxxxxxxxx
TELEGRAM_CHAT_ID=-100123456789
```

### SMTP — Reset de senha por e-mail (opcional)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=seu@gmail.com
SMTP_PASS=senha_de_app_gmail
SMTP_FROM="CryptoEdge Pro <noreply@seudominio.com>"
APP_URL=https://cryptoedge.seudominio.com
```

> 💡 **Gmail:** Ative 2FA → gere senha de app em myaccount.google.com/apppasswords

---

## 5. Configurar volume (banco de dados)

⚠️ **Sem o volume o banco é apagado a cada deploy!**

Na aba **"Volumes"** → **"Add Volume"**:

| Campo | Valor |
|-------|-------|
| **Name** | `cryptoedge-data` |
| **Mount Path** | `/data` |
| **Size** | `2 GB` |

---

## 6. Configurar domínio + HTTPS

Na aba **"Domains"** → **"Add Domain"**:

| Campo | Valor |
|-------|-------|
| **Domain** | `cryptoedge.seudominio.com` |
| **Port** | `3000` |
| **HTTPS** | ✅ Ativado (Let's Encrypt automático) |

> ✅ O EasyPanel configura o HTTPS automaticamente — não precisa fazer nada a mais.

---

## 7. Fazer o deploy

1. Clique em **"Deploy"** (ou **"Build & Deploy"**)
2. Acompanhe os logs na aba **"Deployments"**
3. O build leva **2–5 minutos** na primeira vez
4. Quando aparecer ✅ **"Running"** → está online!

**Verificar se está funcionando:**
```
https://cryptoedge.seudominio.com/api/health
```
Deve retornar: `{"status":"ok", ...}`

---

## 8. Primeiro acesso

1. Abra `https://cryptoedge.seudominio.com`
2. Será exibida a tela de **configuração inicial**
3. Crie sua conta de administrador:
   - Usuário (sem espaços)
   - Senha (mínimo 6 caracteres) — **use uma senha forte!**
4. Clique em **"Criar conta e entrar"**

> ✅ Plataforma online! Você é o admin.

### Primeiros passos após login:
- **Meu Perfil** → Adicionar Binance API Key e Secret
- **Configurações do Bot** → Definir estratégia e capital
- **Admin** → Configurar modo de registro (invite/open/closed)
- **Admin** → Gerar código de convite para novos usuários

---

## 9. Atualizações automáticas

### Opção A — Auto-deploy com GitHub Webhook (recomendado)

No EasyPanel → aba **"Deployments"** → copie o **Webhook URL**

No GitHub → repositório → **Settings** → **Webhooks** → **Add webhook**:
- Payload URL: cole o URL do EasyPanel
- Content type: `application/json`
- Events: **"Just the push event"**

Agora, toda vez que fizer `git push`, o EasyPanel fará o deploy automático.

### Opção B — Deploy manual

```bash
# Faça alterações no código...
git add .
git commit -m "✨ Melhoria X"
git push origin main
```
No EasyPanel → clique em **"Redeploy"**

---

## 10. Backup do banco de dados

### Backup manual via EasyPanel Terminal

No EasyPanel → serviço → aba **"Terminal"**:
```bash
# Dentro do container:
cp /data/cryptoedge.db /data/backup-$(date +%Y%m%d-%H%M).db
ls -lh /data/
```

### Backup via SSH na VPS
```bash
# Na sua VPS:
docker cp cryptoedge-pro:/data/cryptoedge.db ./backup-$(date +%Y%m%d).db

# Baixar para seu computador (do seu computador):
scp usuario@IP-VPS:~/backup-$(date +%Y%m%d).db ./
```

### Restaurar backup
```bash
# Parar o serviço no EasyPanel primeiro, depois:
docker cp backup-20250101.db cryptoedge-pro:/data/cryptoedge.db
# Reiniciar o serviço no EasyPanel
```

### Backup automático com cron (recomendado)
```bash
# Na VPS, editar crontab:
crontab -e

# Adicionar (backup diário às 3h):
0 3 * * * docker cp cryptoedge-pro:/data/cryptoedge.db /backups/ce-$(date +\%Y\%m\%d).db
# Manter apenas últimos 30 dias:
0 4 * * * find /backups -name "ce-*.db" -mtime +30 -delete
```

---

## 11. Solução de problemas

### App não inicia — verificar logs
No EasyPanel → serviço → aba **"Logs"**

### Erro: "ENCRYPTION_KEY não definida"
→ Adicione `ENCRYPTION_KEY` nas variáveis de ambiente do EasyPanel

### Erro: "Cannot connect to database"
→ Verifique se o volume `/data` está montado corretamente

### WebSocket de preços não conecta
→ Verifique se o domínio usa HTTPS — WebSocket precisa de WSS em produção
→ O EasyPanel com HTTPS já configura WSS automaticamente

### Bot não inicia via painel
→ O bot Python precisa de `BINANCE_API_KEY` e `BINANCE_SECRET_KEY` configurados
→ Mantenha `BOT_TESTNET=true` até validar

### "Too many requests" nos logs
→ Normal — é o rate limiter protegendo. Aumente `max` no `apiLimiter` se necessário.

### Resetar senha de admin (emergência)
No Terminal do EasyPanel:
```bash
node -e "
const db = require('./db');
const bcrypt = require('bcrypt');
db.init().then(async () => {
  const hash = await bcrypt.hash('nova_senha_aqui', 12);
  db.run('UPDATE users SET password=? WHERE role=\"admin\"', [hash]);
  db.saveNow();
  console.log('Senha resetada!');
  process.exit(0);
});
"
```

---

## Estrutura de arquivos no repositório

```
cryptoedge-pro/
├── Dockerfile            ← Build para EasyPanel (Node 20 Alpine)
├── docker-compose.yml    ← Para testes locais
├── nginx.conf            ← Se usar Nginx externo (opcional)
├── server.js             ← Backend Node.js (v2 — segurança reforçada)
├── db.js                 ← Banco SQLite com migrations automáticas
├── package.json          ← Dependências (inclui bcrypt, helmet, rate-limit)
├── .env.example          ← Template — copie para .env
├── .gitignore            ← Exclui .env, node_modules, data/
├── public/
│   ├── index.html        ← App SPA
│   ├── js/
│   │   ├── app.js        ← Frontend principal (~5600 linhas)
│   │   └── features.js   ← Novas features v2.0
│   └── css/app.css
├── bot/
│   ├── gridbot.py        ← Bot de trading Python
│   ├── backtest.py       ← Engine de backtesting
│   ├── patterns.py       ← Detecção de padrões técnicos
│   ├── analysis_ai.py    ← Análise com IA
│   ├── scanner.py        ← Scanner de mercado
│   └── requirements.txt  ← Dependências Python
└── templates/email.js    ← Templates de e-mail
```

---

## Custos estimados de infraestrutura

| Recurso | Provedor | Custo |
|---------|----------|-------|
| VPS 2 vCPU / 4GB RAM | Hetzner CX22 | €4.35/mês |
| Domínio .com | Namecheap | ~R$60/ano |
| SSL (Let's Encrypt) | EasyPanel automático | **Grátis** |
| GitHub repo privado | GitHub | **Grátis** |
| **Total** | | **~€5/mês** |

---

## Checklist de segurança pré-produção

- [ ] `ENCRYPTION_KEY` definida (chave de 32 chars única)
- [ ] `ALLOWED_ORIGIN` definida com seu domínio HTTPS
- [ ] `NODE_ENV=production`
- [ ] Repositório GitHub em modo **Private**
- [ ] Volume `/data` configurado (banco persistente)
- [ ] Senha do admin é forte (12+ caracteres)
- [ ] `BOT_TESTNET=true` até testar em produção
- [ ] Backup automático configurado
- [ ] HTTPS ativado no domínio

---

*CryptoEdge Pro v2.0 — Deploy guide atualizado em 2026*
