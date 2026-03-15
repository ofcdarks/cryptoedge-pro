# 🚀 Deploy CryptoEdge Pro no EasyPanel

## PRÉ-REQUISITOS
- Conta no GitHub (gratuita)
- VPS com EasyPanel instalado
- Domínio apontando para o IP da VPS

---

## PARTE 1 — Versionar no Git/GitHub

### 1.1 — Instalar Git (se não tiver)
```bash
# Windows: baixe em https://git-scm.com/download/win
# Mac:     brew install git
# Linux:   sudo apt install git
```

### 1.2 — Configurar Git (primeira vez)
```bash
git config --global user.name  "Seu Nome"
git config --global user.email "seu@email.com"
```

### 1.3 — Criar repositório no GitHub
1. Acesse **github.com** → clique em **"New repository"**
2. Nome: `cryptoedge-pro`
3. Visibilidade: **Private** (recomendado — contém sua plataforma)
4. Clique em **"Create repository"**

### 1.4 — Inicializar Git no projeto
```bash
# Entre na pasta do projeto
cd cryptoedge-pro

# Inicializar repositório Git
git init

# Adicionar todos os arquivos (o .gitignore já exclui node_modules, data/, .env)
git add .

# Primeiro commit
git commit -m "🚀 Initial commit — CryptoEdge Pro v1.0"

# Conectar ao GitHub (copie a URL do seu repositório)
git remote add origin https://github.com/SEU_USUARIO/cryptoedge-pro.git

# Enviar para o GitHub
git branch -M main
git push -u origin main
```

✅ **Seu código está no GitHub!**

---

## PARTE 2 — Configurar EasyPanel

### 2.1 — Criar novo projeto no EasyPanel
1. Abra o EasyPanel: `https://seu-vps.com:3000`
2. Clique em **"Create Project"**
3. Nome: `cryptoedge`

### 2.2 — Criar serviço App
1. Dentro do projeto → **"Create Service"** → **"App"**
2. Nome: `cryptoedge-pro`
3. Source: **"GitHub"**
4. Repositório: selecione `cryptoedge-pro`
5. Branch: `main`
6. Build Method: **"Dockerfile"** ✅

### 2.3 — Configurar variáveis de ambiente
No EasyPanel → aba **"Environment"**:

```
PORT=3000
NODE_ENV=production
DB_PATH=/data
LAOZHANG_API_KEY=sk-sua-chave-aqui
AI_MODEL=qwen3-30b-a3b
BINANCE_API_KEY=
BINANCE_SECRET_KEY=
TELEGRAM_TOKEN=
TELEGRAM_CHAT_ID=
```

### 2.4 — Configurar Volume (banco de dados persistente)
1. Aba **"Volumes"** → **"Add Volume"**
2. Name: `cryptoedge-data`
3. Mount Path: `/data`
4. Size: `1GB`

⚠️ **IMPORTANTE:** Sem o volume, o banco de dados é apagado ao reiniciar!

### 2.5 — Configurar Domínio + HTTPS
1. Aba **"Domains"** → **"Add Domain"**
2. Domain: `cryptoedge.seudominio.com`
3. Port: `3000`
4. HTTPS: **Ativado** ✅ (EasyPanel configura Let's Encrypt automaticamente!)

### 2.6 — Deploy!
1. Clique em **"Deploy"**
2. Aguarde o build (2-5 minutos)
3. Acesse: `https://cryptoedge.seudominio.com`

---

## PARTE 3 — Primeiro acesso

1. Abra `https://cryptoedge.seudominio.com`
2. Tela de **primeiro acesso** → crie sua conta admin
3. Preencha usuário e senha (mínimo 6 caracteres)
4. Clique em **"Criar conta e entrar"**

✅ **Plataforma online!**

---

## PARTE 4 — Atualizações futuras

Quando quiser atualizar a plataforma:

```bash
# Faça suas alterações nos arquivos...

# Adicionar alterações
git add .

# Commit com descrição
git commit -m "✨ feat: nova funcionalidade X"

# Enviar para GitHub
git push origin main
```

No EasyPanel:
- O deploy pode ser **automático** (configure webhook do GitHub)
- Ou manual: clique em **"Redeploy"** no painel

---

## PARTE 5 — Backup do banco de dados

```bash
# Acessar o container via EasyPanel Terminal
# Ou via SSH na VPS:

# Copiar banco de dados para backup
docker cp cryptoedge-pro_container:/data/cryptoedge.db ./backup-$(date +%Y%m%d).db

# Restaurar backup
docker cp backup-20250101.db cryptoedge-pro_container:/data/cryptoedge.db
docker restart cryptoedge-pro_container
```

---

## Estrutura de arquivos no GitHub

```
cryptoedge-pro/
├── 📄 Dockerfile          ← Build instructions para EasyPanel
├── 📄 server.js           ← Backend Node.js
├── 📄 db.js               ← Camada SQLite
├── 📄 package.json        ← Dependências
├── 📄 .env.example        ← Template de variáveis (commit isso)
├── 📄 .gitignore          ← Exclui node_modules, data/, .env
├── 📄 ecosystem.config.js ← Config PM2
├── 📁 public/             ← Frontend (HTML/CSS/JS)
├── 📁 bot/                ← Scripts Python do bot
└── 📄 EASYPANEL.md        ← Este guia
```

---

## Dicas de segurança

✅ **NUNCA faça commit do `.env`** — ele está no `.gitignore`
✅ Use repositório **privado** no GitHub  
✅ Configure senha forte no primeiro acesso
✅ Mantenha `BOT_TESTNET=true` até ter certeza do que está fazendo
✅ Faça backup semanal do banco de dados

---

## Custos estimados

| Recurso | Custo |
|---------|-------|
| VPS mínima (1 vCPU, 2GB RAM) | €4-6/mês (Hetzner) |
| Domínio .com | ~R$50/ano |
| SSL (Let's Encrypt via EasyPanel) | **Gratuito** |
| GitHub (repo privado) | **Gratuito** |
| **Total** | ~€5-7/mês |
