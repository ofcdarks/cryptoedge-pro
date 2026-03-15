# 🚀 CryptoEdge Pro — Deploy em VPS com Domínio + HTTPS

## Requisitos
- VPS com Ubuntu 20.04+ (mín. 1GB RAM, 20GB SSD)
- Domínio apontando para o IP da VPS (registro A)
- Acesso SSH como root ou usuário sudo

---

## 1. Preparar o servidor

```bash
# Atualizar o sistema
sudo apt update && sudo apt upgrade -y

# Instalar Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Instalar PM2 (gerenciador de processos)
sudo npm install -g pm2

# Instalar Nginx
sudo apt install -y nginx

# Instalar Certbot (SSL gratuito)
sudo apt install -y certbot python3-certbot-nginx

# (Opcional) Instalar Python para o bot
sudo apt install -y python3 python3-pip
pip3 install python-binance python-dotenv requests
```

---

## 2. Fazer upload do projeto

```bash
# No seu computador local:
scp -r cryptoedge-pro/ root@SEU_IP:/var/www/

# OU clonar do repositório:
# cd /var/www && git clone https://github.com/seu-usuario/cryptoedge-pro.git
```

---

## 3. Instalar dependências e configurar

```bash
cd /var/www/cryptoedge-pro
npm install --production

# Criar arquivo .env
cp .env.example .env
nano .env
```

**Conteúdo do `.env`:**
```env
PORT=3000
NODE_ENV=production
DB_PATH=/var/data/cryptoedge

# IA Expert (obtenha em laozhang.ai)
LAOZHANG_API_KEY=sk-...
AI_MODEL=qwen3-30b-a3b

# Binance API (opcional para o bot)
BINANCE_API_KEY=
BINANCE_SECRET_KEY=

# Telegram (opcional)
TELEGRAM_TOKEN=
TELEGRAM_CHAT_ID=
```

```bash
# Criar pasta de dados persistentes
sudo mkdir -p /var/data/cryptoedge
sudo chown -R $USER:$USER /var/data/cryptoedge
```

---

## 4. Iniciar com PM2

```bash
cd /var/www/cryptoedge-pro

# Iniciar a aplicação
pm2 start server.js --name cryptoedge --env production

# Salvar para reiniciar após reboot
pm2 save
pm2 startup

# Verificar status
pm2 status
pm2 logs cryptoedge
```

---

## 5. Configurar Nginx como proxy reverso

```bash
sudo nano /etc/nginx/sites-available/cryptoedge
```

**Cole o conteúdo:**
```nginx
server {
    listen 80;
    server_name SEU_DOMINIO.com www.SEU_DOMINIO.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

```bash
# Ativar o site
sudo ln -s /etc/nginx/sites-available/cryptoedge /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 6. Instalar SSL gratuito (Let's Encrypt)

```bash
sudo certbot --nginx -d SEU_DOMINIO.com -d www.SEU_DOMINIO.com

# O Certbot configura HTTPS automaticamente!
# Certificado renova automaticamente a cada 90 dias.

# Verificar renovação automática
sudo certbot renew --dry-run
```

---

## 7. Firewall

```bash
sudo ufw allow 22      # SSH
sudo ufw allow 80      # HTTP (redireciona para HTTPS)
sudo ufw allow 443     # HTTPS
sudo ufw deny 3000     # Bloquear acesso direto ao Node
sudo ufw enable
```

---

## 8. Acessar a plataforma

Acesse: **https://SEU_DOMINIO.com**

No primeiro acesso, crie sua conta de administrador.

---

## Manutenção

```bash
# Ver logs em tempo real
pm2 logs cryptoedge

# Reiniciar após atualização
cd /var/www/cryptoedge-pro && git pull
pm2 restart cryptoedge

# Monitorar uso de recursos
pm2 monit

# Backup dos dados
tar -czf backup-$(date +%Y%m%d).tar.gz /var/data/cryptoedge/
```

---

## Configuração Nginx completa (após Certbot)

O Certbot modifica automaticamente o nginx.conf para incluir:
- Redirecionamento HTTP → HTTPS
- Certificados SSL
- Headers de segurança

Para adicionar headers extras de segurança:

```nginx
# Dentro do bloco server (porta 443)
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
```

---

## Estrutura de arquivos no servidor

```
/var/www/cryptoedge-pro/    ← código da aplicação
/var/data/cryptoedge/       ← banco de dados (NeDB .db files)
  ├── trades.db
  ├── admin.db
  ├── settings.db
  ├── analysis.db
  ├── watchlist.db
  └── alerts.db
```

---

## Custos estimados

| Recurso | Custo |
|---------|-------|
| VPS (1 vCPU, 2GB RAM) | ~$5-10/mês (DigitalOcean, Hetzner, Vultr) |
| Domínio .com | ~$10/ano |
| SSL (Let's Encrypt) | **Gratuito** |
| **Total** | ~$6-11/mês |

