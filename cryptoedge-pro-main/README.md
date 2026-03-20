# LaCasaStudio V2.0 — YouTube Production OS

Sistema completo de gestão e produção de vídeos para YouTube com multi-canais, storyboard visual, planner kanban e muito mais.

## Stack

- **Backend:** Node.js + Express + Prisma ORM + SQLite
- **Frontend:** React 18 + Vite + React Router
- **Auth:** JWT + bcrypt
- **Deploy:** Docker + EasyPanel

## Funcionalidades

- **Dashboard** — Visão geral de todos os canais
- **Planner Kanban** — Pipeline de 7 estágios (Ideia → Publicado)
- **Storyboard** — Editor visual de cenas por vídeo
- **Editor de Roteiro** — Escrita com contagem de palavras e tempo
- **Checklist de Publicação** — Garanta que tudo está pronto
- **Gerador SEO + IA** — Títulos, descrições e tags otimizados
- **Metas & OKRs** — Acompanhamento de objetivos por canal
- **Templates de Série** — Estruturas reutilizáveis
- **Calendário** — Agenda visual de publicações
- **Analytics** — Métricas por canal (Beta)
- **Orçamento** — Controle de receitas e despesas
- **Banco de Ativos** — Thumbnails, intros, overlays e mais
- **Equipe** — Gestão de membros com roles e status
- **Busca Global** — ⌘K para buscar em todo o sistema
- **Notificações** — Alertas de deadline e atividades

## Deploy no EasyPanel via Git

### 1. Suba para o GitHub

```bash
git init
git add .
git commit -m "LaCasaStudio V2.0"
git remote add origin https://github.com/SEU_USER/lacasastudio.git
git push -u origin main
```

### 2. No EasyPanel

1. Acesse seu painel EasyPanel
2. Clique em **"Create Service"** → **"App"**
3. Selecione **"GitHub"** como source
4. Escolha o repositório `lacasastudio`
5. Configure:
   - **Build Type:** Dockerfile
   - **Dockerfile Path:** `./Dockerfile`
   - **Port:** `3000`
6. Adicione as variáveis de ambiente:
   ```
   NODE_ENV=production
   PORT=3000
   JWT_SECRET=seu-segredo-super-forte-aqui-min-32-chars
   DATABASE_URL=file:/app/data/lacasastudio.db
   ```
7. Em **"Volumes"**, adicione:
   - **Container Path:** `/app/data`
   - **Name:** `lacasa-data`
8. Clique em **"Deploy"**

### 3. Configurar Domínio (Opcional)

No EasyPanel, vá em **Domains** e adicione seu domínio apontando para o serviço.

## Desenvolvimento Local

```bash
# Instalar dependências
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..

# Criar banco e seed
cd server
cp ../.env.example .env
npx prisma generate
npx prisma db push
node src/db/seed.js
cd ..

# Rodar em modo dev
npm run dev
```

O servidor roda em `http://localhost:3000` e o client em `http://localhost:5173`.

**Login padrão:** `admin@lacasa.com` / `admin123`

## Estrutura do Projeto

```
lacasastudio/
├── Dockerfile              # Multi-stage build
├── docker-compose.yml      # Dev/test local
├── package.json            # Raiz com scripts
├── .env.example            # Variáveis de ambiente
│
├── server/
│   ├── package.json
│   ├── prisma/
│   │   └── schema.prisma   # Modelos do banco
│   └── src/
│       ├── index.js         # Express server
│       ├── db/
│       │   ├── prisma.js    # Prisma singleton
│       │   └── seed.js      # Dados iniciais
│       ├── middleware/
│       │   └── auth.js      # JWT auth
│       └── routes/
│           ├── auth.js      # Login/register
│           ├── channels.js  # CRUD canais
│           ├── videos.js    # CRUD vídeos
│           ├── scenes.js    # Storyboard
│           ├── team.js      # Equipe
│           ├── assets.js    # Banco de ativos
│           ├── metas.js     # OKRs
│           ├── templates.js # Templates
│           ├── budget.js    # Orçamento
│           ├── notifications.js
│           └── checklists.js
│
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx          # Entry point
        ├── App.jsx            # Router + Layout
        ├── styles/global.css  # Reset + variables
        ├── lib/api.js         # API client
        ├── context/
        │   ├── AuthContext.jsx
        │   └── AppContext.jsx
        ├── components/shared/
        │   ├── UI.jsx         # Design system
        │   ├── Sidebar.jsx
        │   ├── TopBar.jsx
        │   ├── SearchOverlay.jsx
        │   └── NotifPanel.jsx
        └── pages/
            ├── Login.jsx
            ├── Dashboard.jsx
            ├── Planner.jsx
            ├── Storyboard.jsx
            ├── Editor.jsx
            ├── Checklist.jsx
            ├── Seo.jsx
            ├── Metas.jsx
            ├── Templates.jsx
            ├── Calendario.jsx
            ├── Analytics.jsx
            ├── Orcamento.jsx
            ├── Ativos.jsx
            └── Equipe.jsx
```

## API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/auth/register` | Criar conta |
| POST | `/api/auth/login` | Login |
| GET | `/api/auth/me` | Usuário atual |
| GET/POST/PUT/DELETE | `/api/channels` | Canais |
| GET/POST/PUT/DELETE | `/api/videos` | Vídeos |
| GET/POST/PUT/DELETE | `/api/scenes` | Cenas |
| GET/POST/PUT/DELETE | `/api/team` | Equipe |
| GET/POST/DELETE | `/api/assets` | Ativos |
| GET/POST/DELETE | `/api/metas` | Metas |
| GET/POST/DELETE | `/api/templates` | Templates |
| GET/POST/DELETE | `/api/budget` | Orçamento |
| GET/PUT | `/api/notifications` | Notificações |
| GET/POST/PUT/DELETE | `/api/checklists` | Checklists |
| GET | `/api/health` | Health check |

## Licença

MIT
