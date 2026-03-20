# CryptoEdge Pro — Changelog

## v2.0.0 — Segurança + Novas Features

### 🔒 Correções de Segurança (CRÍTICAS)
- **bcrypt** (12 rounds) substitui SHA-256 com salt fixo para senhas
  - Migração automática de hashes antigos no primeiro login
- **Autenticação em TODAS as rotas de trades** (`GET/POST/DELETE /api/trades`)
  - Era a falha mais grave: qualquer pessoa podia ler/criar/deletar trades sem login
- **Binance Secret criptografada** com AES-256-CBC antes de salvar no banco
  - Nova variável `ENCRYPTION_KEY` no `.env` (obrigatória em produção)
- **Webhook Token dedicado** — webhook MT5/ProfitChart não usa mais a Binance Key
  - Token gerado automaticamente por usuário, regenerável no perfil
- **Rate Limiting**: 10 tentativas de login por 15min, 120 req/min nas APIs
- **Helmet**: headers HTTP de segurança (XSS, clickjacking, MIME sniffing)
- **CORS restrito** ao `ALLOWED_ORIGIN` (sem fallback `true`)
- **Tabela `password_resets`** dedicada (separada de sessions)
- **Sanitização do bot config** contra command injection
- **Rota duplicada `/api/settings`** removida

### 🆕 Novas Features
- **Funding Rate Scanner** (`/api/funding-rates`)
  - Mostra funding rates de futuros perpétuos Binance em tempo real
  - Identifica extremos (>0.1% ou <-0.1%) como sinais contrários
  - Anualizado, próximo horário de funding, sinal por par
- **Correlation Matrix** (`/api/correlation`)
  - Heatmap de correlação entre pares (30 dias de retornos diários)
  - Presets: Top 10, DeFi, Layer 2, Meme, IA Tokens
  - Cores intuitivas: verde (positiva) → vermelho (negativa)
- **Diário de Trades Aprimorado**
  - Notas/aprendizado por trade
  - Tags (Scalp, Swing, FOMO, Revenge, Setup A, News)
  - Screenshot do gráfico (upload ou drag-and-drop)
  - Abas: Registrar / Histórico / Estatísticas
  - Busca e filtro no histórico
  - Análise por par e por tag
- **Export CSV** (`GET /api/trades/export/csv`)
  - Download direto com BOM UTF-8 para Excel brasileiro
- **Risk Manager** (no painel de risco)
  - Calculadora de tamanho de posição por % de risco
  - TP1 (1.5:1) e TP2 (3.0:1) automáticos
  - Margem necessária com alavancagem
- **Equity Curve Visual** no Backtesting
  - Canvas HTML5 renderizado pelo frontend após backtest
  - Gradiente verde/vermelho conforme resultado
- **PATCH `/api/trades/:id`** — editar trades existentes

### 🗄️ Banco de Dados
- Tabela `password_resets` dedicada
- Colunas novas em `trades`: `screenshot`, `notes`, `tags`
- Colunas novas em `users`: `binance_secret_enc`, `webhook_token`
- Migrations automáticas (retrocompatível com banco v1.x)
- `saveNow()` síncrono para operações financeiras críticas

### ⚙️ Configuração
```env
# NOVAS variáveis obrigatórias em produção:
ENCRYPTION_KEY=sua_chave_de_32_chars_aqui!!
ALLOWED_ORIGIN=https://seudominio.com
```

---
## v1.0.0 — Versão original
