'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// PWA — Service Worker Registration
// ─────────────────────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[PWA] Service worker registered:', reg.scope);
        // Check for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showToast('🔄 Atualização disponível! Recarregue para aplicar.', false);
            }
          });
        });
      })
      .catch(err => console.log('[PWA] SW registration failed:', err));
  });
}

// PWA Install prompt
let _pwaInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaInstallPrompt = e;
  // Show install button after login
  setTimeout(() => showPWAInstallBanner(), 3000);
});

function showPWAInstallBanner() {
  if (!_pwaInstallPrompt) return;
  if (localStorage.getItem('pwa_dismissed')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-banner';
  banner.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9998;background:var(--bg1);border:1px solid rgba(240,185,11,0.4);border-radius:12px;padding:14px 16px;max-width:300px;box-shadow:0 8px 32px rgba(0,0,0,0.4);animation:loginEnter 0.3s ease';
  const closeBtn  = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'margin-left:auto;background:none;border:none;color:var(--t3);cursor:pointer;font-size:16px';
  closeBtn.onclick = dismissPWA;
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:10px;margin-bottom:10px';
  header.innerHTML = '<div style="width:36px;height:36px;background:#F0B90B;border-radius:8px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:#000;flex-shrink:0">C</div><div><div style="font-size:13px;font-weight:600">Instalar CryptoEdge</div><div style="font-size:11px;color:var(--t3)">Acesso rápido pelo celular/PC</div></div>';
  header.appendChild(closeBtn);
  const instBtn = document.createElement('button');
  instBtn.textContent = '📱 Instalar App';
  instBtn.style.cssText = 'flex:1;padding:8px;background:#F0B90B;border:none;border-radius:6px;font-size:12px;font-weight:700;color:#000;cursor:pointer';
  instBtn.onclick = installPWA;
  const laterBtn = document.createElement('button');
  laterBtn.textContent = 'Agora não';
  laterBtn.style.cssText = 'padding:8px 12px;background:transparent;border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--t2);cursor:pointer';
  laterBtn.onclick = () => banner.remove();
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px';
  btns.appendChild(instBtn); btns.appendChild(laterBtn);
  banner.appendChild(header); banner.appendChild(btns);
  document.body.appendChild(banner);
}

function dismissPWA(){const b=document.getElementById('pwa-banner');if(b)b.remove();localStorage.setItem('pwa_dismissed','1');}
async function installPWA() {
  if (!_pwaInstallPrompt) return;
  _pwaInstallPrompt.prompt();
  const { outcome } = await _pwaInstallPrompt.userChoice;
  if (outcome === 'accepted') {
    showToast('✅ App instalado com sucesso!');
    const b = document.getElementById('pwa-banner');
    if (b) b.remove();
  }
  _pwaInstallPrompt = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// COOKIE CONSENT
// ─────────────────────────────────────────────────────────────────────────────
function initCookieConsent() {
  if (!localStorage.getItem('ce_cookie_consent')) {
    setTimeout(() => {
      const banner = document.getElementById('cookie-banner');
      if (banner) banner.style.display = 'block';
    }, 800);
  }
}

function acceptCookies() {
  localStorage.setItem('ce_cookie_consent', 'accepted');
  const b = document.getElementById('cookie-banner');
  if (b) { b.style.transition = 'opacity 0.3s'; b.style.opacity = '0'; setTimeout(()=>b.remove(),300); }
}

function rejectCookies() {
  localStorage.setItem('ce_cookie_consent', 'essential');
  const b = document.getElementById('cookie-banner');
  if (b) { b.style.transition = 'opacity 0.3s'; b.style.opacity = '0'; setTimeout(()=>b.remove(),300); }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-USER: Registration + Profile
// ─────────────────────────────────────────────────────────────────────────────
function showForm(form) {
  ['setup-form','login-form','register-form'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = id.replace('-form','') === form ? 'block' : 'none';
  });
  const errEl = document.getElementById('login-error');
  if (errEl) { errEl.style.display='none'; errEl.textContent=''; }
}

async function doRegister() {
  const user   = document.getElementById('reg-user')?.value.trim();
  const pass   = document.getElementById('reg-pass')?.value;
  const email  = document.getElementById('reg-email')?.value.trim();
  const invite = document.getElementById('reg-invite')?.value.trim();
  const terms  = document.getElementById('reg-terms')?.checked;

  if (!user || !pass) return showLoginError('Preencha usuário e senha');
  if (pass.length < 6) return showLoginError('Senha deve ter mínimo 6 caracteres');
  if (!terms) return showLoginError('Você deve aceitar os Termos de Uso para continuar');

  const btn = document.getElementById('reg-btn');
  const txt = document.getElementById('reg-btn-text');
  if (btn) { btn.disabled=true; if(txt) txt.textContent='Criando conta...'; }
  try {
    const r = await fetch('/api/auth/register', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username:user, password:pass, email:email||undefined, inviteCode:invite||undefined })
    });
    const d = await r.json();
    if (!d.ok) { showLoginError(d.error||'Erro ao criar conta'); return; }
    auth.save(d.token, d.username);
    if (d.role) localStorage.setItem('ce_role', d.role);
    localStorage.setItem('ce_pass', pass);
    const btnEl = document.getElementById('reg-btn');
    if (btnEl) { btnEl.style.background='linear-gradient(135deg,#3FB950,#2ea043)'; btnEl.innerHTML='<span>✅ Conta criada!</span>'; }
    setTimeout(() => enterApp(), 500);
  } catch(e) {
    showLoginError('Erro de conexão: ' + e.message);
  } finally {
    if (btn && !btn.innerHTML.includes('✅')) { btn.disabled=false; if(txt) txt.textContent='Criar conta'; }
  }
}

// Load user profile from server and store role/plan
async function loadUserProfile() {
  try {
    const r = await fetch('/api/auth/me', { headers: auth.headers() });
    const d = await r.json();
    if (!d.ok) return;
    const u = d.user;
    localStorage.setItem('ce_role', u.role);
    localStorage.setItem('ce_plan', u.plan);
    // Show admin badge if admin
    if (u.role === 'admin') {
      localStorage.setItem('ce_role', 'admin');
      document.body.classList.add('admin-mode');
      const adminNav = document.getElementById('nav-admin');
      if (adminNav) adminNav.style.display = 'flex';
      const nameEl = document.getElementById('user-name');
      if (nameEl) nameEl.innerHTML = u.username + ' <span style="background:#F0B90B;color:#000;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700">ADMIN</span>';
    }
    // Store for bot config (user's own Binance key)
    if (u.has_binance_key) window._userHasBinance = true;
  } catch(e) {}
}


// ─── Login Particles ──────────────────────────────────────────────────────────
function initLoginParticles() {
  const canvas = document.getElementById('login-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const particles = Array.from({ length: 55 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    r: Math.random() * 2 + 0.5,
    dx: (Math.random() - 0.5) * 0.4,
    dy: (Math.random() - 0.5) * 0.4,
    opacity: Math.random() * 0.5 + 0.1,
    color: Math.random() > 0.7 ? '#F0B90B' : '#ffffff',
  }));

  let animId;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.opacity;
      ctx.fill();
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > canvas.width)  p.dx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
    });
    // Draw subtle connecting lines
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = '#F0B90B';
          ctx.globalAlpha = 0.04 * (1 - dist / 100);
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    animId = requestAnimationFrame(draw);
  }
  draw();

  window.addEventListener('resize', () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  });

  // Stop when login screen hidden
  window._stopParticles = () => { cancelAnimationFrame(animId); };
}

// Show current domain in login subtitle
function updateLoginSubtitle() {
  const sub = document.getElementById('login-subtitle-text');
  if (!sub) return;
  const host = window.location.hostname;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168');
  if (!isLocal && host) {
    sub.textContent = '🌐 ' + host;
    sub.style.color = 'var(--gold)';
    sub.style.fontWeight = '500';
  }
}


// ─── Global fetch interceptor — injeta token + trata 401 ─────────────────────
const _origFetch = window.fetch;
window.fetch = async function(...args) {
  // Auto-inject x-auth-token em todas as chamadas /api/ (exceto auth pública)
  const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
  const skipAuth = ['/api/auth/login','/api/auth/register','/api/auth/setup',
                    '/api/auth/forgot-password','/api/auth/reset-password','/api/health'];
  if (url.includes('/api/') && !skipAuth.some(p => url.includes(p))) {
    // Usar localStorage diretamente (auth object pode não estar definido ainda)
    const token = (window.auth && window.auth.token) || localStorage.getItem('ce_token') || '';
    if (token) {
      args[1] = args[1] ? { ...args[1] } : {};
      args[1].headers = { 'x-auth-token': token, ...args[1].headers };
    }
  }

  const r = await _origFetch(...args);

  // Trata 401 — tenta renovar sessão automaticamente
  if (r.status === 401 && url.includes('/api/') && !url.includes('/api/auth/')) {
    if (!window._refreshingSession) {
      window._refreshingSession = true;
      try {
        const storedUser = localStorage.getItem('ce_user');
        const storedPass = localStorage.getItem('ce_pass');
        if (storedUser && storedPass) {
          const ref = await _origFetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({username: storedUser, password: storedPass})
          });
          const rd = await ref.json();
          if (rd.ok) {
            if (window.auth) auth.save(rd.token, rd.username);
            else { localStorage.setItem('ce_token', rd.token); localStorage.setItem('ce_user', rd.username); }
            showToast('🔄 Sessão renovada automaticamente');
            window._refreshingSession = false;
            // Retry with new token
            const newArgs = [...args];
            newArgs[1] = newArgs[1] ? { ...newArgs[1] } : {};
            newArgs[1].headers = { ...newArgs[1].headers, 'x-auth-token': rd.token };
            return _origFetch(...newArgs);
          }
        }
      } catch(e) {}
      window._refreshingSession = false;
    }
  }
  return r;
};


// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  prices: {},
  activePair: 'BTCUSDT',
  aiHistory: [],
  ws: null,
  wsRetry: 0,
  tvWidget: null
};

const PAIRS = [
  // ── Large Cap ──────────────────────────────────────────────────────────────
  { sym:'BTCUSDT',   name:'Bitcoin',           base:'BTC'    },
  { sym:'ETHUSDT',   name:'Ethereum',          base:'ETH'    },
  { sym:'BNBUSDT',   name:'BNB',               base:'BNB'    },
  { sym:'SOLUSDT',   name:'Solana',            base:'SOL'    },
  { sym:'XRPUSDT',   name:'XRP',               base:'XRP'    },
  { sym:'ADAUSDT',   name:'Cardano',           base:'ADA'    },
  { sym:'DOGEUSDT',  name:'Dogecoin',          base:'DOGE'   },
  { sym:'AVAXUSDT',  name:'Avalanche',         base:'AVAX'   },
  { sym:'DOTUSDT',   name:'Polkadot',          base:'DOT'    },
  { sym:'TRXUSDT',   name:'TRON',              base:'TRX'    },
  { sym:'LTCUSDT',   name:'Litecoin',          base:'LTC'    },
  { sym:'LINKUSDT',  name:'Chainlink',         base:'LINK'   },
  { sym:'BCHUSDT',   name:'Bitcoin Cash',      base:'BCH'    },
  { sym:'XLMUSDT',   name:'Stellar',           base:'XLM'    },
  { sym:'ETCUSDT',   name:'Ethereum Classic',  base:'ETC'    },
  { sym:'VETUSDT',   name:'VeChain',           base:'VET'    },
  { sym:'HBARUSDT',  name:'Hedera',            base:'HBAR'   },
  { sym:'ICPUSDT',   name:'Internet Computer', base:'ICP'    },
  { sym:'FILUSDT',   name:'Filecoin',          base:'FIL'    },
  { sym:'ATOMUSDT',  name:'Cosmos',            base:'ATOM'   },
  // ── DeFi ───────────────────────────────────────────────────────────────────
  { sym:'UNIUSDT',   name:'Uniswap',           base:'UNI'    },
  { sym:'AAVEUSDT',  name:'Aave',              base:'AAVE'   },
  { sym:'MKRUSDT',   name:'Maker',             base:'MKR'    },
  { sym:'CRVUSDT',   name:'Curve',             base:'CRV'    },
  { sym:'SNXUSDT',   name:'Synthetix',         base:'SNX'    },
  { sym:'GRTUSDT',   name:'The Graph',         base:'GRT'    },
  { sym:'COMPUSDT',  name:'Compound',          base:'COMP'   },
  { sym:'BALUSDT',   name:'Balancer',          base:'BAL'    },
  { sym:'SUSHIUSDT', name:'SushiSwap',         base:'SUSHI'  },
  { sym:'YFIUSDT',   name:'Yearn Finance',     base:'YFI'    },
  { sym:'1INCHUSDT', name:'1inch',             base:'1INCH'  },
  { sym:'DYDXUSDT',  name:'dYdX',              base:'DYDX'   },
  { sym:'LRCUSDT',   name:'Loopring',          base:'LRC'    },
  { sym:'ZRXUSDT',   name:'0x Protocol',       base:'ZRX'    },
  // ── Layer 2 & Scaling ──────────────────────────────────────────────────────
  { sym:'MATICUSDT', name:'Polygon',           base:'MATIC'  },
  { sym:'ARBUSDT',   name:'Arbitrum',          base:'ARB'    },
  { sym:'OPUSDT',    name:'Optimism',          base:'OP'     },
  { sym:'STRKUSDT',  name:'Starknet',          base:'STRK'   },
  { sym:'IMXUSDT',   name:'Immutable X',       base:'IMX'    },
  { sym:'METISUSDT', name:'Metis',             base:'METIS'  },
  // ── AI & Data ──────────────────────────────────────────────────────────────
  { sym:'FETUSDT',   name:'Fetch.AI',          base:'FET'    },
  { sym:'RENDERUSDT',name:'Render',            base:'RENDER' },
  { sym:'WLDUSDT',   name:'Worldcoin',         base:'WLD'    },
  { sym:'AGIXUSDT',  name:'SingularityNET',    base:'AGIX'   },
  { sym:'OCEANUSDT', name:'Ocean Protocol',    base:'OCEAN'  },
  { sym:'TAIUSDT',   name:'TARS AI',           base:'TAI'    },
  // ── Meme Coins ─────────────────────────────────────────────────────────────
  { sym:'SHIBUSDT',  name:'Shiba Inu',         base:'SHIB'   },
  { sym:'PEPEUSDT',  name:'Pepe',              base:'PEPE'   },
  { sym:'WIFUSDT',   name:'dogwifhat',         base:'WIF'    },
  { sym:'FLOKIUSDT', name:'Floki',             base:'FLOKI'  },
  { sym:'BONKUSDT',  name:'Bonk',              base:'BONK'   },
  { sym:'MEMEUSDT',  name:'Memecoin',          base:'MEME'   },
  { sym:'BRETTUSDT', name:'Brett',             base:'BRETT'  },
  // ── Solana Ecosystem ───────────────────────────────────────────────────────
  { sym:'JUPUSDT',   name:'Jupiter',           base:'JUP'    },
  { sym:'JTOUSDT',   name:'Jito',              base:'JTO'    },
  { sym:'RAYUSDT',   name:'Raydium',           base:'RAY'    },
  { sym:'PYTHUSDT',  name:'Pyth Network',      base:'PYTH'   },
  { sym:'JITOSOLUSDT',name:'JitoSOL',          base:'JITOSOL'},
  // ── New Layer 1s ───────────────────────────────────────────────────────────
  { sym:'NEARUSDT',  name:'NEAR Protocol',     base:'NEAR'   },
  { sym:'APTUSDT',   name:'Aptos',             base:'APT'    },
  { sym:'SUIUSDT',   name:'Sui',               base:'SUI'    },
  { sym:'SEIUSDT',   name:'Sei',               base:'SEI'    },
  { sym:'INJUSDT',   name:'Injective',         base:'INJ'    },
  { sym:'TIAUSDT',   name:'Celestia',          base:'TIA'    },
  { sym:'ALTUSDT',   name:'AltLayer',          base:'ALT'    },
  { sym:'DYMUSDT',   name:'Dymension',         base:'DYM'    },
  { sym:'TAOUSDT',   name:'Bittensor',         base:'TAO'    },
  { sym:'KASUSDT',   name:'Kaspa',             base:'KAS'    },
  // ── Gaming & Metaverse ─────────────────────────────────────────────────────
  { sym:'AXSUSDT',   name:'Axie Infinity',     base:'AXS'    },
  { sym:'SANDUSDT',  name:'The Sandbox',       base:'SAND'   },
  { sym:'MANAUSDT',  name:'Decentraland',      base:'MANA'   },
  { sym:'ENJUSDT',   name:'Enjin Coin',        base:'ENJ'    },
  { sym:'GALAUSDT',  name:'Gala',              base:'GALA'   },
  { sym:'IMXUSDT',   name:'Immutable',         base:'IMX'    },
  { sym:'PIXELUSDT', name:'Pixels',            base:'PIXEL'  },
  { sym:'RONUSDT',   name:'Ronin',             base:'RON'    },
  // ── Infrastructure ─────────────────────────────────────────────────────────
  { sym:'RUNEUSDT',  name:'THORChain',         base:'RUNE'   },
  { sym:'ALGOUSDT',  name:'Algorand',          base:'ALGO'   },
  { sym:'QNTUSDT',   name:'Quant',             base:'QNT'    },
  { sym:'FLOWUSDT',  name:'Flow',              base:'FLOW'   },
  { sym:'APEUSDT',   name:'ApeCoin',           base:'APE'    },
  { sym:'LDOUSDT',   name:'Lido DAO',          base:'LDO'    },
  { sym:'RPLLUSDT',  name:'Rocket Pool',       base:'RPL'    },
  { sym:'STXUSDT',   name:'Stacks',            base:'STX'    },
  { sym:'CFXUSDT',   name:'Conflux',           base:'CFX'    },
  { sym:'EGLDUSDT',  name:'MultiversX',        base:'EGLD'   },
  { sym:'THETAUSDT', name:'Theta Network',     base:'THETA'  },
  { sym:'FTMUSDT',   name:'Fantom',            base:'FTM'    },
  { sym:'NEOUSDT',   name:'NEO',               base:'NEO'    },
  { sym:'WAVESUSDT', name:'Waves',             base:'WAVES'  },
  { sym:'KSMUSDT',   name:'Kusama',            base:'KSM'    },
  { sym:'ZILUSDT',   name:'Zilliqa',           base:'ZIL'    },
  { sym:'ICXUSDT',   name:'ICON',              base:'ICX'    },
  { sym:'ONTUSDT',   name:'Ontology',          base:'ONT'    },
  { sym:'BATUSDT',   name:'Basic Attention',   base:'BAT'    },
  // ── Privacy Coins ──────────────────────────────────────────────────────────
  { sym:'XMRUSDT',   name:'Monero',            base:'XMR'    },
  { sym:'ZECUSDT',   name:'Zcash',             base:'ZEC'    },
  { sym:'DASHUSDT',  name:'Dash',              base:'DASH'   },
  // ── Exchange Tokens ────────────────────────────────────────────────────────
  { sym:'OKBUSDT',   name:'OKB',               base:'OKB'    },
  { sym:'GTUSDT',    name:'Gate Token',        base:'GT'     },
  { sym:'CROUPDTSDT',name:'Crypto.com',        base:'CRO'    },
];

const fmt = (n, d=2) => { const v = parseFloat(n); return isNaN(v) ? '0,00' : v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
const fmtUSD = (n, d=2) => '$' + fmt(n, d);
const el = id => document.getElementById(id);

// ─── Navigation ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    const panel = el('panel-' + item.dataset.panel);
    if (panel) panel.classList.add('active');
    // Para polling do bot ao sair do painel
    if (item.dataset.panel !== 'botcontrol' && _botAutoRefresh) {
      clearInterval(_botAutoRefresh); _botAutoRefresh = null;
      const autoBtn = document.getElementById('bc-auto-btn');
      if (autoBtn) autoBtn.textContent = 'Auto OFF';
    }
    if (item.dataset.panel === 'dashboard') { loadTrades(); loadFearGreed(); }
    if (item.dataset.panel === 'calculator') { calcLev(); }
    if (item.dataset.panel === 'risk') { calcRisk(); }
    if (item.dataset.panel === 'gridbot') { calcGrid(); }
    if (item.dataset.panel === 'journal')     { loadTrades(); loadStats(); }
    if (item.dataset.panel === 'botcontrol')  {
      loadBotStatus(); loadBotLogs(); loadBotConfig(); checkBotKeysWarning();
      // Auto-inicia o polling de status ao abrir o painel
      if (!_botAutoRefresh) {
        _botAutoRefresh = setInterval(() => { loadBotLogs(); loadBotStatus(); }, 10000);
        const btn = document.getElementById('bc-auto-btn');
        if (btn) btn.textContent = 'Auto ON ⚡';
      }
    }
    if (item.dataset.panel === 'analysisai')  { buildAnalysisSymbolSelector(); switchAITab('analyze'); }
    if (item.dataset.panel === 'profile')      { loadProfile(); }
    if (item.dataset.panel === 'admin')        { loadAdminPanel(); switchAdminTab('users'); }
    if (item.dataset.panel === 'alerts')      { loadAlerts(); buildAlertSymbolSelector(); }
    if (item.dataset.panel === 'scanner')     { /* ready on click */ }
    if (item.dataset.panel === 'backtest')    { btStratChange(); }
    if (item.dataset.panel === 'pnlchart')   { loadPnLChart('week'); }
  });
});

// ─── Clock ────────────────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  el('clock').textContent = now.toLocaleTimeString('pt-BR') + ' UTC-3';
}
setInterval(updateClock, 1000);
updateClock();

// ─── WebSocket + REST Fallback ────────────────────────────────────────────────
let _restInterval = null;

function setStatus(live, text) {
  const dot = document.getElementById('ws-dot');
  const lbl = document.getElementById('ws-status');
  if (dot) dot.className = 'status-dot ' + (live ? 'live' : 'idle');
  if (lbl) lbl.textContent = text;
}

async function fetchPricesREST() {
  // Try server proxy
  try {
    const r = await fetch('/api/prices');
    const j = await r.json();
    if (j.ok && j.data && j.data.length) {
      j.data.forEach(t => handleTicker(t));
      setStatus(true, 'Ao vivo');
      return true;
    }
  } catch(e) {}
  // Direct Binance (browser can usually reach it)
  try {
    // Fetch all tracked pairs directly from Binance
    const SYMS = PAIRS.map(p => p.sym).filter((v,i,a) => a.indexOf(v) === i); // deduplicate
    // Binance URL limit — fetch in batches of 50
    const batch1 = SYMS.slice(0, 50);
    const batch2 = SYMS.slice(50);
    const url  = '/api/binance/ticker?symbols=' + encodeURIComponent(JSON.stringify(batch1));
    const r    = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    if (Array.isArray(data) && data.length) {
      data.forEach(t => handleTicker({
        s: t.symbol, c: t.lastPrice, P: t.priceChangePercent,
        h: t.highPrice, l: t.lowPrice, v: t.volume, q: t.quoteVolume
      }));
      // Fetch second batch
      if (batch2.length > 0) {
        try {
          const url2 = '/api/binance/ticker?symbols=' + encodeURIComponent(JSON.stringify(batch2));
          const r2 = await fetch(url2, { signal: AbortSignal.timeout(8000) });
          const d2 = await r2.json();
          if (Array.isArray(d2)) d2.forEach(t => handleTicker({
            s: t.symbol, c: t.lastPrice, P: t.priceChangePercent,
            h: t.highPrice, l: t.lowPrice, v: t.volume, q: t.quoteVolume
          }));
        } catch(e2) {}
      }
      setStatus(true, 'Binance direto');
      return true;
    }
  } catch(e) {}
  setStatus(false, 'Sem dados');
  return false;
}

function startRESTFallback() {
  if (_restInterval) return;
  fetchPricesREST();
  _restInterval = setInterval(fetchPricesREST, 5000);
}

function stopRESTFallback() {
  if (_restInterval) { clearInterval(_restInterval); _restInterval = null; }
}

// ─── WebSocket — Binance Prices ───────────────────────────────────────────────
function connectWS() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl    = `${protocol}//${location.host}/ws`;
  let   wsTimeout = setTimeout(() => {
    try { state.ws && state.ws.close(); } catch(e) {}
    startRESTFallback();
  }, 8000);

  try { state.ws = new WebSocket(wsUrl); } catch(e) {
    clearTimeout(wsTimeout);
    startRESTFallback();
    return;
  }

  state.ws.onopen = () => {
    clearTimeout(wsTimeout);
    stopRESTFallback();
    setStatus(true, 'Ao vivo');
    state.wsRetry = 0;
  };

  state.ws.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data && data.type === 'ws_connected') return;
      if (data && data.stream && data.data) handleTicker(data.data);
    } catch(e) {}
  };

  state.ws.onclose = () => {
    clearTimeout(wsTimeout);
    setStatus(false, 'Reconectando...');
    const delay = Math.min(3000 * Math.pow(1.5, state.wsRetry), 30000);
    state.wsRetry++;
    if (state.wsRetry >= 2) startRESTFallback();
    setTimeout(connectWS, delay);
  };

  state.ws.onerror = () => {
    clearTimeout(wsTimeout);
    try { state.ws.close(); } catch(e) {}
  };
}

function handleTicker(t) {
  const sym = t.s;
  const price = parseFloat(t.c);
  const change = parseFloat(t.P);
  const high = parseFloat(t.h);
  const low = parseFloat(t.l);
  const vol = parseFloat(t.v) * price;

  state.prices[sym] = { price, change, high, low, vol };

  // Throttle ranking updates to every 2s
  if (!state._rankThrottle) {
    state._rankThrottle = setTimeout(() => {
      state._rankThrottle = null;
      updateDashboardRankings();
      // If markets panel is active, re-filter live
      if (document.getElementById('panel-markets')?.classList.contains('active')) {
        filterMarkets();
      }
    }, 2000);
  }

  // Check price alerts
  checkAlerts(sym, price, change);
  // Update chart price badge
  if (sym === state.activePair) updateChartPriceBadge(sym);

  // Update topbar for active pair
  if (sym === state.activePair) {
    const up = change >= 0;
    const setIfEl = (id, v, cls) => {
      const e = document.getElementById(id);
      if (e) { e.textContent = v; if (cls) e.className = cls; }
    };
    setIfEl('tb-price',  fmtUSD(price),                     'topbar-price '  + (up?'up':'dn'));
    setIfEl('tb-change', (up?'+':'') + change.toFixed(2)+'%','topbar-change '+ (up?'up':'dn'));
    setIfEl('tb-high',   fmtUSD(high));
    setIfEl('tb-low',    fmtUSD(low));
    setIfEl('tb-vol',    vol >= 1e9 ? fmtUSD(vol/1e9,2)+'B' : fmtUSD(vol/1e6,1)+'M');
  }

  updateTickerCard(sym, { price, change, high, low, vol });
}

function updateTickerCard(sym, d) {
  const up = d.change >= 0;
  // Market grid (top 4)
  const mgp = el('mgp-' + sym);
  const mgc = el('mgc-' + sym);
  if (mgp) { mgp.textContent = fmtUSD(d.price); mgp.className = 'ticker-price ' + (up?'up':'dn'); }
  if (mgc) { mgc.textContent = (up?'+':'') + d.change.toFixed(2)+'%'; mgc.className = 'ticker-chg ' + (up?'up':'dn'); }

  // Dashboard ticker rows
  const dtp = document.getElementById('dtp-' + sym);
  const dtc = document.getElementById('dtc-' + sym);
  if (dtp) { dtp.textContent = fmtUSD(d.price); dtp.className = 'ticker-price ' + (up?'up':'dn'); }
  if (dtc) { dtc.textContent = (up?'+':'') + d.change.toFixed(2)+'%'; dtc.className = 'ticker-chg ' + (up?'up':'dn'); }
  // Markets table row (only updates if row exists — filterMarkets creates them dynamically)
  updateMarketRow(sym, d);
  // Market grid cards
  const mgCard = el('mg-' + sym);
  if (mgCard) {
    mgCard.querySelector('.ticker-price').textContent = fmtUSD(d.price);
    mgCard.querySelector('.ticker-price').className = 'ticker-price ' + (up ? 'up' : 'dn');
    mgCard.querySelector('.ticker-chg').textContent = (up ? '+' : '') + d.change.toFixed(2) + '%';
    mgCard.querySelector('.ticker-chg').className = 'ticker-chg ' + (up ? 'up' : 'dn');
  }
}

// ─── Build static UI on load ──────────────────────────────────────────────────
// ─── Load Chart.js dynamically ──────────────────────────────────────────────
(function() {
  if (window.Chart) return;
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
  s.onerror = function() {
    // Fallback CDN
    const s2 = document.createElement('script');
    s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js';
    document.head.appendChild(s2);
  };
  document.head.appendChild(s);
})();

// ─── Chart pair selector ───────────────────────────────────────────────────
function buildChartPairSelector() {
  const sel = document.getElementById('dash-chart-pair');
  if (!sel) return;
  sel.innerHTML = PAIRS.map(p =>
    `<option value="${p.sym}">${p.base}/USDT</option>`
  ).join('');
  sel.value = 'BTCUSDT';
}

function switchChartPair(sym) {
  const s  = sym || document.getElementById('dash-chart-pair')?.value || 'BTCUSDT';
  const tf = document.getElementById('dash-chart-tf')?.value || '15';
  state.activePair = s;
  const p = PAIRS.find(x => x.sym === s);
  const topPair = document.getElementById('tb-pair');
  if (topPair) topPair.textContent = (p ? p.base : s.replace('USDT','')) + '/USDT';
  // Update pair selector
  const sel = document.getElementById('dash-chart-pair');
  if (sel && sel.value !== s) sel.value = s;
  // Update TradingView
  if (state.tvWidget && typeof state.tvWidget.setSymbol === 'function') {
    try { state.tvWidget.setSymbol('BINANCE:' + s, tf); return; } catch(e) {}
  }
  // If no widget yet, init it
  initTradingView();
}

// ─── Gainers / Losers / Promising ───────────────────────────────────────────
function updateDashboardRankings() {
  const all = PAIRS
    .filter((p, i, arr) => arr.findIndex(x => x.sym === p.sym) === i)
    .map(p => {
      const d = state.prices[p.sym];
      if (!d || !d.price) return null;
      return { sym: p.sym, base: p.base, name: p.name, ...d };
    })
    .filter(Boolean);

  if (!all.length) return;

  const sorted   = [...all].sort((a,b) => b.change - a.change);
  const gainers  = sorted.slice(0, 8);
  const losers   = [...all].sort((a,b) => a.change - b.change).slice(0, 8);
  // Promising: positive change 0.5-20%, sorted by volume
  const promising = [...all]
    .filter(x => x.change >= 0.5 && x.change <= 20 && x.vol > 0)
    .sort((a,b) => b.vol - a.vol)
    .slice(0, 8);

  function renderList(id, items) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '';
    items.forEach(item => {
      const up    = item.change >= 0;
      const color = up ? 'var(--green)' : 'var(--red)';
      const vol   = item.vol >= 1e9 ? fmtUSD(item.vol/1e9,1)+'B'
                  : item.vol >= 1e6 ? fmtUSD(item.vol/1e6,1)+'M'
                  : fmtUSD(item.vol/1e3,0)+'K';
      const row = document.createElement('div');
      row.className = 'mini-tick';
      row.style.cursor = 'pointer';
      row.onclick = () => selectPairFromDash(item.sym);
      row.innerHTML =
        '<span class="mini-tick-sym">' + item.base + '</span>' +
        '<span class="mini-tick-name">' + vol + '</span>' +
        '<span class="mini-tick-price" style="color:' + color + '">' + fmtUSD(item.price) + '</span>' +
        '<span class="mini-tick-chg"   style="color:' + color + '">' + (up?'+':'') + item.change.toFixed(2) + '%</span>';
      el.appendChild(row);
    });
  }

  renderList('d-gainers',   gainers);
  renderList('d-losers',    losers);
  renderList('d-promising', promising);
}

function selectPairFromDash(sym) {
  const sel = document.getElementById('dash-chart-pair');
  if (sel) sel.value = sym;
  switchChartPair(sym);
  setActivePair(sym);
}

// ─── Market search/filter/sort ──────────────────────────────────────────────
let _searchDebounce = null;
const filterMarketsDebounced = () => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(filterMarkets, 80);
};
// Called directly from oninput — also called after prices load
let _marketFilter = 'all';
let _marketSort   = 'vol_desc';

function setMarketFilter(f, btn) {
  _marketFilter = f;
  document.querySelectorAll('.mkt-filter-btn').forEach(b => b.classList.remove('active-filter'));
  if (btn) btn.classList.add('active-filter');
  filterMarkets();
}

function filterMarkets() {
  const q     = (document.getElementById('mkt-search')?.value || '').trim().toUpperCase();
  const sortV = document.getElementById('mkt-sort')?.value || 'vol_desc';
  _marketSort = sortV;

  // Build items from PAIRS + state.prices
  const hasPrices = Object.keys(state.prices).length > 0;
  let items = PAIRS
    .filter((p, i, arr) => arr.findIndex(x => x.sym === p.sym) === i) // deduplicate
    .map(p => {
      const d = state.prices[p.sym] || {};
      return {
        sym:    p.sym,
        base:   p.base,
        name:   p.name,
        price:  d.price  || 0,
        change: d.change || 0,
        high:   d.high   || 0,
        low:    d.low    || 0,
        vol:    d.vol    || 0,
        hasData: !!d.price
      };
    });

  // If searching by name, show all (even without price data yet)
  // Otherwise only show pairs with live prices
  if (!q || !hasPrices) {
    items = items.filter(x => x.hasData);
    if (!hasPrices && q) items = PAIRS.filter((p,i,arr) => arr.findIndex(x=>x.sym===p.sym)===i)
      .map(p => ({ sym:p.sym, base:p.base, name:p.name, price:0, change:0, high:0, low:0, vol:0, hasData:false }));
  }

  // Text search — match base symbol OR full name
  if (q) {
    items = items.filter(x =>
      x.base.toUpperCase().includes(q) ||
      x.name.toUpperCase().includes(q) ||
      x.sym.toUpperCase().includes(q)
    );
  }

  // Direction filter
  if (_marketFilter === 'up')   items = items.filter(x => x.change >= 0);
  if (_marketFilter === 'down') items = items.filter(x => x.change <  0);

  // Sort
  const sortFns = {
    vol_desc:   (a,b) => b.vol    - a.vol,
    chg_desc:   (a,b) => b.change - a.change,
    chg_asc:    (a,b) => a.change - b.change,
    price_desc: (a,b) => b.price  - a.price,
    name_asc:   (a,b) => a.base.localeCompare(b.base),
  };
  items.sort(sortFns[sortV] || sortFns.vol_desc);

  // Update counts
  const cnt = document.getElementById('mkt-count');
  if (cnt) cnt.textContent = items.length + ' moedas';
  const tc = document.getElementById('mkt-table-count');
  if (tc) tc.textContent = items.length;

  const tbody = document.getElementById('market-table');
  if (!tbody) return;

  if (!items.length) {
    const msg = q ? 'Nenhuma moeda encontrada para "' + q + '"' : 'Aguardando dados de mercado...';
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:24px;font-family:var(--mono);font-size:11px">' + msg + '</td></tr>';
    return;
  }

  // Build rows using DOM (avoids quote conflicts)
  tbody.innerHTML = '';
  items.forEach((item, i) => {
    const up  = item.change >= 0;
    const col = up ? 'var(--green)' : 'var(--red)';
    const vol = item.vol >= 1e9 ? fmtUSD(item.vol/1e9,2)+'B'
              : item.vol >= 1e6 ? fmtUSD(item.vol/1e6,1)+'M'
              : fmtUSD(item.vol/1e3,0)+'K';
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.addEventListener('click', function() { selectPairFromMarket(item.sym); });
    const numTd   = document.createElement('td'); numTd.className = 'muted'; numTd.textContent = i+1;
    const nameTd  = document.createElement('td');
    const starred = watchlist.has(item.sym);
    nameTd.innerHTML = '<span style="font-weight:600">' + item.base + '</span><span style="color:var(--t3)">/USDT</span>' +
      '<button class="star-btn' + (starred?' active':'') + '" data-sym="' + item.sym + '" onclick="event.stopPropagation();toggleWatchlist(\'' + item.sym + '\')" title="Favoritar">' + (starred?'★':'☆') + '</button>' +
      '<div style="font-size:9px;color:var(--t3)">' + item.name + '</div>';
    const priceTd = document.createElement('td'); priceTd.style.fontFamily = 'var(--mono)'; priceTd.style.color = col; priceTd.textContent = fmtUSD(item.price);
    const chgTd   = document.createElement('td'); chgTd.style.fontFamily = 'var(--mono)'; chgTd.style.color = col; chgTd.textContent = (up?'+':'')+item.change.toFixed(2)+'%';
    const highTd  = document.createElement('td'); highTd.className = 'muted'; highTd.textContent = item.high ? fmtUSD(item.high) : '—';
    const lowTd   = document.createElement('td'); lowTd.className = 'muted'; lowTd.textContent = item.low  ? fmtUSD(item.low)  : '—';
    const volTd   = document.createElement('td'); volTd.className = 'muted'; volTd.textContent = vol;
    const trendTd = document.createElement('td'); trendTd.id = 'mtr-t-' + item.sym;
    const badge   = document.createElement('span'); badge.className = 'badge ' + (up?'badge-green':'badge-red'); badge.textContent = up?'Alta':'Baixa';
    trendTd.appendChild(badge);
    const actTd   = document.createElement('td');
    const btn     = document.createElement('button'); btn.className = 'btn btn-outline'; btn.style.fontSize = '9px'; btn.style.padding = '3px 8px'; btn.textContent = 'Ver gráfico';
    btn.addEventListener('click', function(e) { e.stopPropagation(); selectPairFromMarket(item.sym); });
    actTd.appendChild(btn);
    [numTd, nameTd, priceTd, chgTd, highTd, lowTd, volTd, trendTd, actTd].forEach(td => tr.appendChild(td));
    tbody.appendChild(tr);
  });

  // badges already rendered above
  // Render badges (must happen after innerHTML)
  items.forEach(item => {
    const up = item.change >= 0;
    const td = document.getElementById('mtr-t-' + item.sym);
    if (!td) return;
    td.innerHTML = '';
    const b = document.createElement('span');
    b.className = 'badge ' + (up ? 'badge-green' : 'badge-red');
    b.textContent = up ? 'Alta' : 'Baixa';
    td.appendChild(b);
  });
}

function selectPairFromMarket(sym) {
  // Switch to dashboard + update chart
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const dashNav = document.querySelector('[data-panel="dashboard"]');
  if (dashNav) dashNav.classList.add('active');
  const dashPanel = document.getElementById('panel-dashboard');
  if (dashPanel) dashPanel.classList.add('active');
  selectPairFromDash(sym);
}

function sortMarket(key) {
  const map = { rank:'vol_desc', name:'name_asc', price:'price_desc', change:'chg_desc', vol:'vol_desc' };
  const sel = document.getElementById('mkt-sort');
  if (sel && map[key]) { sel.value = map[key]; filterMarkets(); }
}

function buildDashTickers() {
  const wrap = document.getElementById('dash-tickers');
  if (!wrap) return;
  wrap.innerHTML = PAIRS.slice(0, 6).map(p =>
    '<div id="dash-tick-' + p.sym + '" style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid var(--border)">' +
      '<div>' +
        '<div style="font-family:var(--mono);font-size:12px;font-weight:600">' + p.base + '<span style="color:var(--t3)">/USDT</span></div>' +
        '<div style="font-size:10px;color:var(--t3)">' + p.name + '</div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<div class="tp ticker-price" id="dtp-' + p.sym + '">—</div>' +
        '<div class="tc ticker-chg"  id="dtc-' + p.sym + '">—</div>' +
      '</div>' +
    '</div>'
  ).join('');
}

function buildMarketGrid() {
  // Shows dynamically — populated by updateTopGainerCards()
  const grid = document.getElementById('market-grid');
  if (grid) grid.innerHTML = PAIRS.slice(0, 4).map(p => `
    <div id="mg-${p.sym}" class="ticker-card" onclick="selectPairFromDash('${p.sym}')">
      <div><div class="ticker-sym">${p.base}/USDT</div><div class="ticker-name">${p.name}</div></div>
      <div><div class="ticker-price" id="mgp-${p.sym}">—</div><div class="ticker-chg" id="mgc-${p.sym}">—</div></div>
    </div>`).join('');
}

function buildMarketTable() {
  // Table is now rendered dynamically by filterMarkets()
  // This just initialises the row IDs for handleTicker to update
  const tbody = document.getElementById('market-table');
  if (!tbody) return;
  tbody.innerHTML = PAIRS.map((p, i) => {
    const row = document.createElement('tr');
    row.id = 'mtr-' + p.sym;
    row.style.cursor = 'pointer';
    row.onclick = function() { setActivePair(p.sym); };
    row.innerHTML =
      '<td class="muted">' + (i+1) + '</td>' +
      '<td><span style="font-weight:600">' + p.base + '</span><span style="color:var(--t3)">/USDT</span></td>' +
      '<td id="mtr-p-' + p.sym + '">—</td>' +
      '<td id="mtr-c-' + p.sym + '">—</td>' +
      '<td id="mtr-h-' + p.sym + '" class="muted">—</td>' +
      '<td id="mtr-l-' + p.sym + '" class="muted">—</td>' +
      '<td id="mtr-v-' + p.sym + '" class="muted">—</td>' +
      '<td id="mtr-t-' + p.sym + '"></td>';
    return row.outerHTML;
  }).join('');
}

function updateMarketRow(sym, d) {
  const up = d.change >= 0;
  function setCell(id, val, cls) {
    const e = document.getElementById(id);
    if (!e) return;
    e.textContent = val;
    if (cls) e.className = cls;
  }
  setCell('mtr-p-' + sym, fmtUSD(d.price),                           up ? 'green' : 'red');
  setCell('mtr-c-' + sym, (up ? '+' : '') + d.change.toFixed(2) + '%', up ? 'green' : 'red');
  setCell('mtr-h-' + sym, fmtUSD(d.high), 'muted');
  setCell('mtr-l-' + sym, fmtUSD(d.low),  'muted');
  const vol = d.vol >= 1e9 ? fmtUSD(d.vol/1e9,2)+'B' : fmtUSD(d.vol/1e6,1)+'M';
  setCell('mtr-v-' + sym, vol, 'muted');
  const td = document.getElementById('mtr-t-' + sym);
  if (td) {
    td.innerHTML = '';
    const b = document.createElement('span');
    b.className = 'badge ' + (up ? 'badge-green' : 'badge-red');
    b.textContent = up ? 'Alta' : 'Baixa';
    td.appendChild(b);
  }
}

function setActivePair(sym) {
  state.activePair = sym;
  const p = PAIRS.find(x => x.sym === sym);
  el('tb-pair').textContent = p ? p.base+'/USDT' : sym;
  if (state.tvWidget) {
    try { state.tvWidget.setSymbol('BINANCE:'+sym, '15'); } catch {}
  }
}

// ─── TradingView ──────────────────────────────────────────────────────────────
function initTradingView() {
  window._tvInit = initTradingView;
  if (typeof TradingView === 'undefined') {
    return;
  }
  const container = document.getElementById('tradingview-widget');
  if (!container) return;
  container.innerHTML = '';
  // Hide loading spinner
  const loader = document.getElementById('tv-loading');
  if (loader) loader.style.display = 'none';
  const sym = (state.activePair || 'BTCUSDT');
  const tf  = document.getElementById('dash-chart-tf')?.value || '15';
  try {
    state.tvWidget = new TradingView.widget({
      container_id:      'tradingview-widget',
      symbol:            'BINANCE:' + sym,
      interval:          tf,
      theme:             'dark',
      style:             '1',
      locale:            'br',
      toolbar_bg:        '#0D1117',
      enable_publishing: false,
      hide_top_toolbar:  false,
      save_image:        false,
      allow_symbol_change: true,
      withdateranges:    true,
      width:             '100%',
      height:            320,
      backgroundColor:   'rgba(13,17,23,1)',
      overrides: {
        'paneProperties.background':     '#0D1117',
        'paneProperties.backgroundType': 'solid',
      },
      studies: ['RSI@tv-basicstudies', 'MACD@tv-basicstudies'],
      disabled_features: ['header_symbol_search'],
    });
  } catch(e) {
    console.error('TradingView init error:', e);
    if (container) container.innerHTML = '<div style="height:320px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:12px">Gráfico indisponível — verifique sua conexão</div>';
  }
}

// ─── Fear & Greed ─────────────────────────────────────────────────────────────
async function loadFearGreed() {
  let val = 50;
  try {
    const r = await fetch('/api/feargreed');
    const d = await r.json();
    val = parseInt(d.data[0].value) || 50;
  } catch(e) {
    try {
      const r2 = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) });
      const d2 = await r2.json();
      val = parseInt(d2.data[0].value) || 50;
    } catch(e2) {}
  }
  const label = getFNGLabel(val);
  const color = val <= 25 ? 'var(--red)' : val <= 45 ? 'var(--orange)' : val <= 55 ? 'var(--t2)' : val <= 75 ? 'var(--gold)' : 'var(--green)';
  if (el('d-fng-val'))   { el('d-fng-val').textContent = val; el('d-fng-val').style.color = color; }
  if (el('d-fng-label'))   el('d-fng-label').textContent = label;
}

function getFNGLabel(v) {
  if (v <= 25) return 'Medo Extremo';
  if (v <= 45) return 'Medo';
  if (v <= 55) return 'Neutro';
  if (v <= 75) return 'Ganância';
  return 'Ganância Extrema';
}

// ─── Journal / Trades ─────────────────────────────────────────────────────────
async function addTrade() {
  const entry = parseFloat(el('j-entry').value);
  const exit  = parseFloat(el('j-exit').value);
  const size  = parseFloat(el('j-size').value);
  if (!entry || !exit || !size) { alert('Preencha entrada, saída e tamanho.'); return; }

  const dir    = el('j-dir').value;
  const pnlRaw = dir === 'Long' ? (exit - entry) / entry * size : (entry - exit) / entry * size;
  const pnl    = parseFloat(pnlRaw.toFixed(2));
  const pnlPct = parseFloat((pnlRaw / size * 100).toFixed(2));

  const body = {
    pair: el('j-pair').value,
    direction: dir,
    entry, exit, size,
    leverage: el('j-lev').value,
    reason: el('j-reason').value || '—',
    result: el('j-result').value,
    pnl, pnl_pct: pnlPct
  };

  await fetch('/api/trades', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-auth-token': auth.token }, body: JSON.stringify(body) });
  loadTrades();
  loadStats();
  el('j-entry').value = '';
  el('j-exit').value = '';
  el('j-size').value = '';
  el('j-reason').value = '';
}

async function loadTrades() {
  try {
    const res    = await fetch('/api/trades?limit=30', { headers: auth.headers() });
    if (!res.ok) return;
    const trades = await res.json();
    if (!Array.isArray(trades)) return;
    renderTradeList(trades);
    renderDashTrades(trades.slice(0, 8));
  } catch {}
}

async function loadStats() {
  try {
    const res = await fetch('/api/trades/stats', { headers: auth.headers() });
    if (!res.ok) return;
    const s = await res.json();
    if (s.error) return;

    // Safe number parsing — prevents NaN/undefined in UI
    const total   = parseInt(s.total)   || 0;
    const wins    = parseInt(s.wins)    || 0;
    const losses  = parseInt(s.losses)  || 0;
    const winRate = isNaN(parseFloat(s.winRate))  ? 0 : parseFloat(s.winRate);
    const pnl     = isNaN(parseFloat(s.totalPnl)) ? 0 : parseFloat(s.totalPnl);

    // Journal stats
    if (el('st-total')) el('st-total').textContent = total;
    if (el('st-wr')) {
      el('st-wr').textContent = winRate.toFixed(1) + '%';
      el('st-wr').style.color = winRate >= 50 ? 'var(--green)' : 'var(--red)';
    }
    if (el('st-pnl')) {
      el('st-pnl').textContent = fmtUSD(pnl);
      el('st-pnl').className = 'val ' + (pnl >= 0 ? 'green' : 'red');
    }
    if (el('st-wl')) el('st-wl').textContent = wins + ' / ' + losses;

    // Dashboard stats
    if (el('d-pnl')) {
      el('d-pnl').textContent = (pnl >= 0 ? '+' : '') + fmtUSD(Math.abs(pnl));
      el('d-pnl').className = 'val ' + (pnl >= 0 ? 'green' : 'red');
    }
    if (el('d-winrate')) el('d-winrate').textContent = total > 0 ? winRate.toFixed(1) + '%' : '—';
    if (el('d-trades-sub')) el('d-trades-sub').textContent = total + ' trade' + (total !== 1 ? 's' : '') + ' registrado' + (total !== 1 ? 's' : '');
    if (el('d-wl')) el('d-wl').textContent = wins + 'W / ' + losses + 'L';
  } catch {}
}

function renderTradeList(trades) {
  const wrap = document.getElementById('journal-list');
  if (!wrap) return;
  if (!trades.length) {
    wrap.innerHTML = '<div style="color:var(--t3);text-align:center;padding:20px;font-size:13px">Nenhuma operação registrada ainda.</div>';
    return;
  }
  wrap.innerHTML = '';
  trades.forEach(t => {
    const pnl  = parseFloat(t.pnl || 0);
    const up   = pnl >= 0;
    const pct  = parseFloat(t.pnl_pct || 0);
    const div  = document.createElement('div');
    div.className = 'trade-entry';

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'trade-entry-header';

    const left = document.createElement('div');
    const pairSpan = document.createElement('span');
    pairSpan.style.cssText = 'font-family:var(--mono);font-size:14px;font-weight:600';
    pairSpan.textContent = t.pair || '—';

    const dirBadge = document.createElement('span');
    dirBadge.className = 'badge ' + (t.direction==='Long'?'badge-green':'badge-red');
    dirBadge.style.marginLeft = '8px';
    dirBadge.textContent = t.direction || '—';

    const levBadge = document.createElement('span');
    levBadge.className = 'badge badge-gray';
    levBadge.style.marginLeft = '6px';
    levBadge.textContent = t.leverage || '1x';

    left.appendChild(pairSpan);
    left.appendChild(dirBadge);
    left.appendChild(levBadge);

    const right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:10px';

    const pnlDiv = document.createElement('div');
    pnlDiv.className = 'trade-pnl ' + (up ? 'green' : 'red');
    pnlDiv.textContent = (up ? '+' : '') + fmtUSD(pnl);
    const pctSpan = document.createElement('span');
    pctSpan.style.fontSize = '12px';
    pctSpan.textContent = ' (' + (up?'+':'') + pct.toFixed(2) + '%)';
    pnlDiv.appendChild(pctSpan);

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';
    delBtn.onclick = () => deleteTrade(t._id);
    right.appendChild(pnlDiv);
    right.appendChild(delBtn);
    hdr.appendChild(left);
    hdr.appendChild(right);

    // Details
    const details = document.createElement('div');
    details.style.cssText = 'font-size:12px;font-family:var(--mono);color:var(--t2);margin-top:6px';
    details.innerHTML = 'Entrada: <strong style="color:var(--t1)">' + fmtUSD(t.entry||0) +
      '</strong> → Saída: <strong style="color:var(--t1)">' + (t.exit ? fmtUSD(t.exit) : '—') +
      '</strong> | Tamanho: <strong style="color:var(--t1)">' + fmtUSD(t.size||0) + '</strong>';

    // Tags
    const tags = document.createElement('div');
    tags.className = 'trade-entry-meta';
    tags.style.marginTop = '8px';

    const resBadge = document.createElement('span');
    resBadge.className = 'badge ' + (t.result==='win'?'badge-green':t.result==='loss'?'badge-red':'badge-gray');
    resBadge.textContent = (t.result||'pending').toUpperCase();

    const reasonTag = document.createElement('span');
    reasonTag.className = 'badge badge-gray';
    reasonTag.style.maxWidth = '220px';
    reasonTag.style.overflow = 'hidden';
    reasonTag.style.textOverflow = 'ellipsis';
    const reason = t.reason || '—';
    reasonTag.textContent = reason.length > 35 ? reason.substring(0,35)+'...' : reason;

    const dateSpan = document.createElement('span');
    dateSpan.style.cssText = 'font-size:10px;color:var(--t3);margin-left:auto';
    dateSpan.textContent = t.createdAt || '';

    tags.appendChild(resBadge);
    tags.appendChild(reasonTag);
    tags.appendChild(dateSpan);

    div.appendChild(hdr);
    div.appendChild(details);
    div.appendChild(tags);
    wrap.appendChild(div);
  });
}

function renderDashTrades(trades) {
  const tbody = document.getElementById('d-recent-trades');
  if (!tbody) return;
  if (!trades.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="color:var(--t3);text-align:center;padding:20px">Nenhum trade registrado</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();
  trades.slice(0, 8).forEach(t => {
    const pnl = parseFloat(t.pnl || 0);
    const pct = parseFloat(t.pnl_pct || 0);
    const up  = pnl >= 0;
    const tr  = document.createElement('tr');
    const dirColor = t.direction === 'Long' ? 'badge-green' : 'badge-red';
    const resColor = t.result === 'win' ? 'badge-green' : t.result === 'loss' ? 'badge-red' : 'badge-gray';
    tr.innerHTML =
      '<td style="font-weight:600;color:var(--gold)">' + (t.pair||'—') + '</td>' +
      '<td><span class="badge ' + dirColor + '">' + (t.direction||'—') + '</span></td>' +
      '<td>' + (t.entry  ? fmtUSD(t.entry)  : '—') + '</td>' +
      '<td>' + (t.exit   ? fmtUSD(t.exit)   : '—') + '</td>' +
      '<td class="muted">' + (t.leverage||'1x') + '</td>' +
      '<td class="' + (up?'green':'red') + '">' + (up?'+':'') + fmtUSD(Math.abs(pnl)) + '</td>' +
      '<td class="' + (up?'green':'red') + '">' + (up?'+':'') + Math.abs(pct).toFixed(2) + '%</td>' +
      '<td><span class="badge ' + resColor + '">' + (t.result||'—').toUpperCase() + '</span></td>';
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

async function deleteTrade(id) {
  const ok = await showConfirm('Remover Trade', 'Confirma remover este trade do histórico? Esta ação não pode ser desfeita.');
  if (!ok) return;
  await fetch('/api/trades/'+id, { method: 'DELETE', headers: auth.headers() });
  loadTrades(); loadStats();
}

// ─── Leverage Calculator ──────────────────────────────────────────────────────
function calcLev() {
  const cap   = parseFloat(el('cl-cap')?.value) || 500;
  const entry = parseFloat(el('cl-entry')?.value) || 83000;
  const lev   = parseFloat(el('cl-lev')?.value) || 10;
  const slPct = parseFloat(el('cl-sl')?.value) || 2;
  const tpPct = parseFloat(el('cl-tp')?.value) || 4;
  const dir   = el('cl-dir')?.value || 'long';

  const pos   = cap * lev;
  const liqPct = 100 / lev;
  const liqPrice = dir === 'long' ? entry * (1 - liqPct/100) : entry * (1 + liqPct/100);
  const slPrice  = dir === 'long' ? entry * (1 - slPct/100)  : entry * (1 + slPct/100);
  const tpPrice  = dir === 'long' ? entry * (1 + tpPct/100)  : entry * (1 - tpPct/100);
  const loss  = (slPct/100) * pos;
  const gain  = (tpPct/100) * pos;
  const rr    = (gain/loss).toFixed(1);
  const distToLiq = Math.abs((entry - liqPrice) / entry * 100).toFixed(1);

  const setVal = (id, v) => { const e = el(id); if(e) e.textContent = v; };
  setVal('cl-pos',      fmtUSD(pos));
  setVal('cl-liq',      fmtUSD(liqPrice));
  setVal('cl-liq-dist', distToLiq + '%');
  setVal('cl-slp',      fmtUSD(slPrice));
  setVal('cl-tpp',      fmtUSD(tpPrice));
  setVal('cl-loss',     '-' + fmtUSD(loss));
  setVal('cl-gain',     '+' + fmtUSD(gain));
  setVal('cl-rr',       '1:' + rr);
  setVal('cl-fund',     fmtUSD(pos * 0.0001));

  const fundDay  = pos * 0.0001 * 3;
  const fundWeek = fundDay * 7;
  const fundMon  = fundDay * 30;
  setVal('fund-day',   fmtUSD(fundDay));
  setVal('fund-week',  fmtUSD(fundWeek));
  setVal('fund-month', fmtUSD(fundMon));
  setVal('fund-pct',   (fundMon / cap * 100).toFixed(1) + '%');

  // Alert
  const alertEl = el('cl-alert');
  if (!alertEl) return;
  const slDistAbs = Math.abs(entry - slPrice);
  const liqDistAbs = Math.abs(entry - liqPrice);
  if (liqDistAbs < slDistAbs * 1.5) {
    alertEl.style.display = 'flex';
    alertEl.className = 'alert alert-danger';
    el('cl-alert-msg').textContent = `⚠ PERIGO! Liquidação em ${distToLiq}% — muito próxima do seu Stop Loss! Reduza a alavancagem.`;
  } else if (lev > 20) {
    alertEl.style.display = 'flex';
    alertEl.className = 'alert alert-warn';
    el('cl-alert-msg').textContent = `Alavancagem alta (${lev}x). Certifique-se de ter gestão de risco rigorosa.`;
  } else {
    alertEl.style.display = 'none';
  }

  buildLevTable(cap, entry);
}

function buildLevTable(cap, entry) {
  const tbody = el('lev-table');
  if (!tbody) return;
  const levs = [1, 2, 3, 5, 10, 20, 50, 100, 125];
  tbody.innerHTML = levs.map(l => {
    const pos = cap * l;
    const liqL = entry * (1 - 100/l/100);
    const liqS = entry * (1 + 100/l/100);
    const level = l <= 5 ? '<span class="badge badge-green">Baixo</span>' : l <= 20 ? '<span class="badge badge-gold">Médio</span>' : '<span class="badge badge-red">Alto</span>';
    return `<tr><td class="gold">${l}x</td><td>${fmtUSD(pos,0)}</td><td class="red">${fmtUSD(liqL,0)}</td><td class="green">${fmtUSD(liqS,0)}</td><td>${level}</td></tr>`;
  }).join('');
}

// ─── Risk Calculator ──────────────────────────────────────────────────────────
function calcRisk() {
  const cap    = parseFloat(el('rs-cap')?.value) || 500;
  const riskPct= parseFloat(el('rs-risk')?.value) || 2;
  const lev    = parseFloat(el('rs-lev')?.value) || 5;
  const entry  = parseFloat(el('rs-entry')?.value) || 83000;
  const stop   = parseFloat(el('rs-stop')?.value) || 81340;

  const rval   = cap * riskPct / 100;
  const stopDist = Math.abs(entry - stop) / entry;
  const posSize  = stopDist > 0 ? rval / stopDist : 0;
  const margin   = posSize / lev;
  const margPct  = (margin / cap * 100).toFixed(1);
  const qty      = (posSize / entry).toFixed(6);

  const setVal = (id, v) => { const e = el(id); if(e) e.textContent = v; };
  setVal('rs-rval',  fmtUSD(rval));
  setVal('rs-pos',   fmtUSD(posSize, 0));
  setVal('rs-margin',fmtUSD(margin));
  setVal('rs-mpct',  margPct + '%');
  setVal('rs-qty',   qty + ' BTC');

  // Risk bars
  const setBar = (bid, val, maxVal, c) => {
    const b = el(bid);
    if (!b) return;
    const pct = Math.min(val / maxVal * 100, 100);
    b.style.width = pct + '%';
    b.style.background = c;
  };
  const rc = riskPct <= 2 ? 'var(--green)' : riskPct <= 5 ? 'var(--gold)' : 'var(--red)';
  const lc = lev <= 5 ? 'var(--green)' : lev <= 20 ? 'var(--gold)' : 'var(--red)';
  const mc = parseFloat(margPct) <= 30 ? 'var(--green)' : parseFloat(margPct) <= 60 ? 'var(--gold)' : 'var(--red)';
  setBar('rm-b1', riskPct, 10, rc);
  setBar('rm-b2', lev, 50, lc);
  setBar('rm-b3', parseFloat(margPct), 100, mc);
  setVal('rm-r', riskPct + '%');
  setVal('rm-l', lev + 'x');
  setVal('rm-m', margPct + '%');

  // Verdict
  const verd = el('rs-verdict');
  if (verd) {
    const safe = riskPct <= 2 && lev <= 20 && parseFloat(margPct) <= 50;
    verd.className = 'alert ' + (safe ? 'alert-success' : 'alert-danger');
    verd.innerHTML = '<span class="alert-icon">' + (safe ? '✓' : '⚠') + '</span><span>' + (safe ? 'Configuração segura. Prossiga com disciplina.' : 'Risco elevado! Reduza alavancagem ou % de risco por operação.') + '</span>';
  }

  // Kelly simulation
  let k = cap;
  for (let i = 0; i < 3; i++) k *= (1 - riskPct/100);
  setVal('kl-cap', fmtUSD(cap));
  setVal('kl-3',   fmtUSD(k));
  let k5 = cap;
  for (let i = 0; i < 5; i++) k5 *= (1 - riskPct/100);
  setVal('kl-5', fmtUSD(k5));
  let k10 = cap;
  for (let i = 0; i < 10; i++) k10 *= (1 - riskPct/100);
  setVal('kl-10', fmtUSD(k10));
  setVal('kl-pct', (k10/cap*100).toFixed(1) + '%');
}

// ─── Grid Bot ─────────────────────────────────────────────────────────────────
function calcGrid() {
  const min = parseFloat(el('gb-min')?.value) || 80000;
  const max = parseFloat(el('gb-max')?.value) || 90000;
  const n   = parseInt(el('gb-n')?.value) || 10;
  const cap = parseFloat(el('gb-cap')?.value) || 300;
  const sl  = parseFloat(el('gb-sl')?.value) || 8;

  const interval = (max - min) / n;
  const cpg      = cap / n;
  const profPct  = (interval / min * 100).toFixed(2);
  const profUSD  = (cpg * parseFloat(profPct) / 100).toFixed(2);
  const daily    = (parseFloat(profUSD) * n * 0.3).toFixed(2);
  const roi      = (parseFloat(daily) * 30 / cap * 100).toFixed(1);
  const stopPrice = min * (1 - sl/100);

  const setVal = (id, v) => { const e = el(id); if(e) e.textContent = v; };
  setVal('gb-interval',  fmtUSD(interval, 0));
  setVal('gb-cpg',       fmtUSD(cpg));
  setVal('gb-profit',    profPct + '%');
  setVal('gb-orders',    (n * 2).toString());
  setVal('gb-daily',     '~' + fmtUSD(daily));
  setVal('gb-roi',       '~' + roi + '%');
  setVal('gb-stopprice', fmtUSD(stopPrice, 0));

  drawGridViz(min, max, n, stopPrice);
}

function drawGridViz(min, max, n, stopPrice) {
  const wrap = el('grid-viz');
  if (!wrap) return;
  const W = wrap.offsetWidth || 400;
  const H = 300;
  const PAD = { t:10, r:80, b:30, l:10 };
  const mid = (min + max) / 2;
  const range = max * 1.02 - stopPrice * 0.98;
  const toY = p => PAD.t + (H - PAD.t - PAD.b) * (1 - (p - stopPrice * 0.98) / range);

  let svg = `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">`;

  // Stop loss line
  const sy = toY(stopPrice);
  svg += `<line x1="0" y1="${sy}" x2="${W-PAD.r}" y2="${sy}" stroke="#F85149" stroke-width="1" stroke-dasharray="4,3" opacity="0.6"/>`;
  svg += `<text x="${W-PAD.r+4}" y="${sy+4}" fill="#F85149" font-size="9" font-family="JetBrains Mono,monospace">SL</text>`;

  // Grid lines
  for (let i = 0; i <= n; i++) {
    const price = min + i * (max - min) / n;
    const y = toY(price);
    const isBuy = price < mid;
    const col = isBuy ? '#3FB950' : '#F85149';
    svg += `<line x1="0" y1="${y}" x2="${W-PAD.r}" y2="${y}" stroke="${col}" stroke-width="1" stroke-dasharray="3,4" opacity="0.5"/>`;
    svg += `<circle cx="${W-PAD.r-4}" cy="${y}" r="3" fill="${col}" opacity="0.8"/>`;
    svg += `<text x="${W-PAD.r+4}" y="${y+4}" fill="${col}" font-size="8" font-family="JetBrains Mono,monospace">${(price/1000).toFixed(0)}k</text>`;
  }

  // Current price band
  const y1 = toY(max), y2 = toY(min);
  svg += `<rect x="0" y="${y1}" width="${W-PAD.r}" height="${y2-y1}" fill="rgba(240,185,11,0.04)" stroke="none"/>`;

  // Current price line (mid)
  const cy = toY(mid);
  svg += `<line x1="0" y1="${cy}" x2="${W-PAD.r}" y2="${cy}" stroke="#F0B90B" stroke-width="1.5"/>`;
  svg += `<text x="4" y="${cy-4}" fill="#F0B90B" font-size="9" font-family="JetBrains Mono,monospace">Preço atual</text>`;

  // Labels on sides
  const tY = toY(max * 1.01);
  svg += `<text x="4" y="${tY}" fill="#8B949E" font-size="8" font-family="JetBrains Mono,monospace">VENDA ▲</text>`;
  const bY = toY(min * 0.99);
  svg += `<text x="4" y="${bY}" fill="#8B949E" font-size="8" font-family="JetBrains Mono,monospace">COMPRA ▼</text>`;

  svg += '</svg>';
  wrap.innerHTML = svg;
}

function genGridCode() {
  const pair = el('gb-pair').value.replace('/', '');
  const min  = el('gb-min').value;
  const max  = el('gb-max').value;
  const n    = el('gb-n').value;
  const cap  = el('gb-cap').value;
  const sl   = el('gb-sl').value;
  const mode = el('gb-mode').value;
  const stopPrice = (parseFloat(min) * (1 - parseFloat(sl)/100)).toFixed(0);

  const code = `#!/usr/bin/env python3
"""
CryptoEdge Pro — Grid Bot v1.0
Par: ${pair} | Grades: ${n} | Capital: $${cap}
"""

import os, time, logging
from decimal import Decimal
from binance.client import Client
from binance.enums import *
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('GridBot')

# ── Configurações ──────────────────────────────────────
API_KEY    = os.environ['BINANCE_API_KEY']
SECRET_KEY = os.environ['BINANCE_SECRET_KEY']

SYMBOL     = '${pair}'
CAPITAL    = ${cap}          # USDT total alocado
PRICE_MIN  = ${min}          # Preço mínimo da grade
PRICE_MAX  = ${max}          # Preço máximo da grade
NUM_GRIDS  = ${n}            # Número de grades
STOP_LOSS  = ${stopPrice}    # Preço de stop loss absoluto
TESTNET    = False           # True para testar sem dinheiro real

# ── Cliente Binance ────────────────────────────────────
client = Client(API_KEY, SECRET_KEY, testnet=TESTNET)

def get_symbol_info():
    info = client.get_symbol_info(SYMBOL)
    lot_filter = next(f for f in info['filters'] if f['filterType'] == 'LOT_SIZE')
    price_filter = next(f for f in info['filters'] if f['filterType'] == 'PRICE_FILTER')
    return {
        'min_qty':  float(lot_filter['minQty']),
        'step_qty': float(lot_filter['stepSize']),
        'tick':     float(price_filter['tickSize']),
    }

def round_qty(qty, step):
    precision = len(str(step).rstrip('0').split('.')[-1]) if '.' in str(step) else 0
    return round(float(Decimal(str(qty)) // Decimal(str(step)) * Decimal(str(step))), precision)

def create_grid():
    log.info(f"Iniciando Grid — {SYMBOL} | {PRICE_MIN}–{PRICE_MAX} | {NUM_GRIDS} grades | ${CAPITAL}")
    info   = get_symbol_info()
    mid    = (PRICE_MIN + PRICE_MAX) / 2
    step   = (PRICE_MAX - PRICE_MIN) / NUM_GRIDS
    cap_pg = CAPITAL / NUM_GRIDS
    orders = []

    for i in range(NUM_GRIDS + 1):
        price = round(PRICE_MIN + i * step, 2)
        qty   = round_qty(cap_pg / price, info['step_qty'])
        if qty < info['min_qty']:
            log.warning(f"Grade {i}: quantidade {qty} abaixo do mínimo. Pulando.")
            continue
        side = SIDE_BUY if price < mid else SIDE_SELL
        try:
            order = client.create_order(
                symbol=SYMBOL,
                side=side,
                type=ORDER_TYPE_LIMIT,
                timeInForce=TIME_IN_FORCE_GTC,
                quantity=qty,
                price=f'{price:.2f}'
            )
            orders.append(order)
            log.info(f"  {'BUY' if side==SIDE_BUY else 'SELL'} {qty} @ {price:.2f}")
        except Exception as e:
            log.error(f"Erro na ordem: {e}")

    log.info(f"{len(orders)} ordens criadas com sucesso.")
    return orders

def monitor(check_interval=30):
    log.info("Monitorando posições...")
    consecutive_errors = 0

    while True:
        try:
            ticker = client.get_symbol_ticker(symbol=SYMBOL)
            current = float(ticker['price'])
            log.info(f"Preço atual: ${'$'}{current:.2f}")

            if current <= STOP_LOSS:
                log.warning(f"STOP LOSS atingido em ${'$'}{current:.2f}! Cancelando todas as ordens...")
                client.cancel_open_orders(symbol=SYMBOL)
                log.info("Ordens canceladas. Bot encerrado.")
                break

            consecutive_errors = 0
        except Exception as e:
            consecutive_errors += 1
            log.error(f"Erro no monitoramento: {e} ({consecutive_errors}/5)")
            if consecutive_errors >= 5:
                log.critical("Muitos erros consecutivos. Encerrando por segurança.")
                break

        time.sleep(check_interval)

if __name__ == '__main__':
    log.info("=== CryptoEdge Pro — Grid Bot ===")
    create_grid()
    monitor()
`;

  const el2 = el('gb-code');
  if (el2) el2.textContent = code;
  const wrap = el('gb-code-wrap');
  if (wrap) wrap.style.display = 'block';
}

function copyCode(id) {
  const code = el(id)?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = 'Copiado!';
    setTimeout(() => btn.textContent = orig, 2000);
  });
}

// ─── Checklist ─────────────────────────────────────────────────────────────
function updateRing() {
  const all = document.querySelectorAll('.chk');
  const checked = [...all].filter(c => c.checked).length;
  const pct = Math.round(checked / all.length * 100);
  const circ = 2 * Math.PI * 28;
  const ring = el('ring-c');
  if (ring) {
    ring.style.strokeDashoffset = (circ * (1 - pct/100)).toFixed(1);
    ring.style.stroke = pct < 50 ? 'var(--red)' : pct < 100 ? 'var(--gold)' : 'var(--green)';
  }
  if (el('ring-pct')) el('ring-pct').textContent = pct + '%';
  if (el('ring-label')) el('ring-label').textContent = pct === 100 ? '✓ Pronto para operar!' : 'Checklist Diário';
  if (el('ring-sub')) el('ring-sub').textContent = pct === 100 ? 'Todos os itens verificados' : checked + '/' + all.length + ' itens completos';
  // Toggle done class
  document.querySelectorAll('.check-item').forEach(item => {
    item.classList.toggle('done', item.querySelector('.chk').checked);
  });
}

function resetChecklist() {
  document.querySelectorAll('.chk').forEach(c => c.checked = false);
  updateRing();
}

// ─── AI Chat ──────────────────────────────────────────────────────────────────
async function sendAI() {
  const input = el('ai-input');
  const q = input.value.trim();
  if (!q) return;
  input.value = '';
  await askAI(q);
}

async function askAI(q) {
  const sugs = el('ai-sugs');
  if (sugs) sugs.style.display = 'none';

  const msgs = el('ai-msgs');
  if (!msgs) return;

  msgs.innerHTML += `<div class="msg user">${escHtml(q)}</div>`;
  msgs.innerHTML += `<div class="msg thinking" id="ai-thinking">Analisando...</div>`;
  msgs.scrollTop = msgs.scrollHeight;

  state.aiHistory.push({ role: 'user', content: q });

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: state.aiHistory })
    });
    const data = await res.json();
    const answer = data.content?.find(c => c.type === 'text')?.text || data.error || 'Erro ao obter resposta.';

    state.aiHistory.push({ role: 'assistant', content: answer });

    const thinking = el('ai-thinking');
    if (thinking) thinking.remove();
    msgs.innerHTML += `<div class="msg bot">${escHtml(answer).replace(/\n/g, '<br>')}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  } catch (e) {
    const thinking = el('ai-thinking');
    if (thinking) thinking.textContent = 'Erro de conexão. Verifique se LAOZHANG_API_KEY está configurada no .env';
  }
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Init ────────────────────────────────────────────────────────────────────

// ─── Strategy Selector ───────────────────────────────────────────────────────
const STRAT_INFO = {
  pattern:  { entry:'Mercado', on:'Vela fechada', ideal:'Qualquer mercado', risk:'Adaptativo' },
  grid:     { entry:'Ordem Limitada', on:'Vela a vela', ideal:'Mercado lateral', risk:'Baixo' },
  dca:      { entry:'Mercado', on:'Vela a vela', ideal:'Tendência de queda', risk:'Médio' },
  scalping: { entry:'Mercado', on:'Tick a tick', ideal:'Alta volatilidade', risk:'Alto' },
  trend:    { entry:'Mercado', on:'Vela fechada', ideal:'Tendência forte', risk:'Médio' },
  breakout: { entry:'Mercado', on:'Vela fechada', ideal:'Rompimentos', risk:'Médio-Alto' },
  macd:     { entry:'Mercado', on:'Vela fechada', ideal:'Reversões de tendência', risk:'Médio' }
};
const STRAT_DESC = {
  pattern: 'Motor de padrões completo: detecta 20+ padrões de velas japonesas (Hammer, Engolfamento, Morning Star, Doji...) e padrões de gráfico (Double Top/Bottom, Head & Shoulders, Triângulo, Flag, Wedge). Combina todos os sinais com volume e momentum para prever o próximo movimento e entrar automaticamente.',
  grid: 'Cria ordens de compra e venda em níveis fixos. Quando uma ordem é executada, o bot recria a ordem inversa (ping-pong). Funciona muito bem em mercados laterais com boa volatilidade dentro da faixa.',
  dca: 'Compra uma parte do capital a cada queda de X%. Reduz o preço médio automaticamente. Vende tudo quando o preço sobe X% acima do preço médio. Estratégia conservadora para acúmulo.',
  scalping: 'Opera no mais curto prazo possível — tick a tick. Entra Long quando RSI está sobrevendido e Short quando sobrecomprado. Saída automática por Take Profit ou Stop Loss fixo.',
  trend: 'Identifica a tendência pelo cruzamento de EMA9 e EMA21. Entra na direção da tendência no fechamento de cada vela. Stop Loss baseado no ATR (volatilidade real do mercado).',
  breakout: 'Calcula o suporte e resistência das últimas N velas. Entra Long quando o preço rompe a resistência com volume acima da média. Entra Short quando rompe o suporte. Confirmação evita falsos rompimentos.',
  macd: 'Usa o histograma MACD para detectar reversões de momentum. Entra Long quando o histograma cruza de negativo para positivo. Combina com filtro de RSI para evitar entradas em extremos.'
};

function selectStrat(el) {
  document.querySelectorAll('.strat-card').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const s = el.dataset.strat;
  // Hide all param panels
  ['pattern','grid','dca','scalping','trend','breakout','macd'].forEach(x => {
    const p = document.getElementById('sp-' + x);
    if (p) p.style.display = 'none';
  });
  const sp = document.getElementById('sp-' + s);
  if (sp) sp.style.display = 'block';
  // Result panels
  const rp = document.getElementById('gb-result-pattern');
  if (rp) rp.style.display = 'none';
  const rg = document.getElementById('gb-result-grid');
  const rd = document.getElementById('gb-result-dca');
  const ro = document.getElementById('gb-result-other');
  if (rg) rg.style.display = s === 'grid' ? 'block' : 'none';
  if (rp) rp.style.display = s === 'pattern' ? 'block' : 'none';
  if (rd) rd.style.display = s === 'dca'  ? 'block' : 'none';
  if (ro) ro.style.display = !['grid','dca','pattern'].includes(s) ? 'block' : 'none';
  // Fill info
  const info = STRAT_INFO[s] || {};
  const desc = STRAT_DESC[s] || '';
  const setT = (id, v) => { const e = el2(id); if(e) e.textContent = v; };
  const el2 = id => document.getElementById(id);
  setT('strat-result-title', 'Resultado — ' + {grid:'Grid Bot',dca:'DCA',scalping:'Scalping',trend:'Trend',breakout:'Breakout',macd:'MACD'}[s]);
  setT('strat-entry-type',  info.entry  || '—');
  setT('strat-operates-on', info.on     || '—');
  setT('strat-ideal',       info.ideal  || '—');
  setT('strat-risk-level',  info.risk   || '—');
  if (el2('strat-desc')) el2('strat-desc').textContent = desc;
  if (s === 'grid') calcGrid();
  if (s === 'dca')  calcDca();
}

function getActiveStrat() {
  const a = document.querySelector('.strat-card.active');
  return a ? a.dataset.strat : 'grid';
}

function calcDca() {
  const cap  = parseFloat(el('gb-cap')?.value) || 300;
  const max  = parseInt(el('dca-max')?.value)  || 5;
  const drop = parseFloat(el('dca-drop')?.value) || 2;
  const cpord = (cap / max).toFixed(2);
  const setV = (id, v) => { const e = el(id); if(e) e.textContent = v; };
  setV('dca-cporder', fmtUSD(cap / max));
  setV('dca-total',   fmtUSD(cap));
  setV('dca-target',  drop + '% acima do preço médio');
  setV('dca-drop-disp',  drop);
  setV('dca-drop-disp2', drop);
  setV('dca-drop-disp3', drop);
  // Simula preço médio após 3 quedas
  const p0 = 83000;
  const p1 = p0 * (1 - drop/100);
  const p2 = p0 * (1 - drop*2/100);
  const qpr = cap / max;
  const avg = (qpr / p0 + qpr / p1 + qpr / p2) > 0
    ? (qpr * 3) / (qpr / p0 + qpr / p1 + qpr / p2) : 0;
  setV('dca-avg', fmtUSD(avg, 0) + ' (simulação 3 ordens)');
}

function genBotCode() {
  const s    = getActiveStrat();
  const pair = el('gb-pair')?.value.replace('/','') || 'BTCUSDT';
  const cap  = el('gb-cap')?.value || '300';
  const tf   = el('gb-tf')?.value  || '15m';
  const sg   = el('gb-stopglobal')?.value || '0';
  let extra  = '';

  if (s === 'pattern') {
    extra = `BOT_MIN_CONF=${el('pat-conf')?.value || '0.65'}
BOT_TP_RR=${el('pat-rr')?.value || '2.0'}
BOT_SL_ATR=${el('pat-sl-atr')?.value || '1.5'}
BOT_REQUIRE_VOL=${el('pat-vol')?.value || 'true'}
`;
  } else if (s === 'grid') {
    extra = `BOT_PRICE_MIN=${el('gb-min')?.value || '80000'}
BOT_PRICE_MAX=${el('gb-max')?.value || '90000'}
BOT_NUM_GRIDS=${el('gb-n')?.value  || '10'}
`;
  } else if (s === 'dca') {
    extra = `BOT_DCA_DROP=${el('dca-drop')?.value || '2'}
BOT_DCA_MAX=${el('dca-max')?.value || '5'}
`;
  } else if (s === 'scalping') {
    extra = `BOT_SCALP_RSI_BUY=${el('scalp-rsi-buy')?.value || '30'}
BOT_SCALP_RSI_SELL=${el('scalp-rsi-sell')?.value || '70'}
BOT_SCALP_TP=${el('scalp-tp')?.value || '1.5'}
BOT_SCALP_SL=${el('scalp-sl')?.value || '1.0'}
`;
  } else if (s === 'trend') {
    extra = `BOT_TREND_FAST=${el('trend-fast')?.value || '9'}
BOT_TREND_SLOW=${el('trend-slow')?.value || '21'}
BOT_TREND_SL=${el('trend-sl')?.value || '2'}
BOT_TREND_TP=${el('trend-tp')?.value || '2'}
`;
  } else if (s === 'breakout') {
    extra = `BOT_BREAK_LOOKBACK=${el('break-lookback')?.value || '20'}
BOT_BREAK_CONFIRM=${el('break-confirm')?.value || '0.3'}
BOT_BREAK_SL=${el('break-sl')?.value || '1.5'}
`;
  } else if (s === 'macd') {
    extra = `BOT_MACD_FAST=${el('macd-fast')?.value || '12'}
BOT_MACD_SLOW=${el('macd-slow')?.value || '26'}
BOT_MACD_SIG=${el('macd-sig')?.value  || '9'}
BOT_MACD_SL=${el('macd-sl')?.value    || '1.5'}
`;
  }

  const code = `# ─── CryptoEdge Pro Bot — cole no seu .env ────────────────────
BINANCE_API_KEY=SUA_API_KEY_AQUI
BINANCE_SECRET_KEY=SUA_SECRET_KEY_AQUI

BOT_SYMBOL=${pair}
BOT_CAPITAL=${cap}
BOT_STOP_LOSS=${sg}
BOT_TIMEFRAME=${tf}
BOT_STRATEGY=${s}
BOT_TESTNET=true   # mude para false quando estiver pronto

# Parâmetros da estratégia: ${s.toUpperCase()}
${extra}
# Para iniciar:
# python3 bot/gridbot.py
#
# Com PM2:
# pm2 start bot/gridbot.py --name cryptoedge-bot --interpreter python3
`;

  const gbCode = el('gb-code');
  const gbWrap = el('gb-code-wrap');
  if (gbCode) gbCode.textContent = code;
  if (gbWrap) gbWrap.style.display = 'block';
  calcGrid();

  // Auto-save to server
  const cfgObj = {};
  code.split('\n').forEach(line => {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m && !m[1].startsWith('#')) cfgObj[m[1]] = m[2].trim();
  });
  if (Object.keys(cfgObj).length > 0) {
    fetch('/api/bot/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfgObj })
    }).then(r => r.json()).then(d => {
      if (d.ok) showToast('✅ Configuração salva automaticamente em ' + d.path);
    }).catch(() => {});
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM MODAL — replaces window.confirm()
// ─────────────────────────────────────────────────────────────────────────────
function showConfirm(title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false) {
  return new Promise(resolve => {
    // Remove existing
    const existing = document.getElementById('ce-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ce-modal';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99999;
      background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;
      animation:fadeIn 0.15s ease;
    `;

    overlay.innerHTML = `
      <div style="
        background:var(--bg1);border:1px solid var(--border2);border-radius:14px;
        padding:2rem;min-width:340px;max-width:440px;width:90%;
        box-shadow:0 20px 60px rgba(0,0,0,0.6);
        animation:fadeIn 0.15s ease;
      ">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:1rem">
          <div style="
            width:36px;height:36px;border-radius:50%;flex-shrink:0;
            background:${danger ? 'var(--reddim)' : 'var(--golddim)'};
            border:1px solid ${danger ? 'var(--red)' : 'var(--gold)'};
            display:flex;align-items:center;justify-content:center;font-size:16px;
          ">${danger ? '⚠' : '?'}</div>
          <div>
            <div style="font-size:16px;font-weight:600;color:var(--t1)">${title}</div>
            <div style="font-size:13px;color:var(--t2);margin-top:3px;line-height:1.5">${message}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="modal-cancel" style="
            padding:9px 18px;border:1px solid var(--border);border-radius:8px;
            background:transparent;color:var(--t2);font-family:var(--sans);font-size:14px;
            cursor:pointer;transition:all 0.15s;font-weight:500;
          ">${cancelLabel}</button>
          <button id="modal-confirm" style="
            padding:9px 18px;border:none;border-radius:8px;
            background:${danger ? 'var(--red)' : 'var(--gold)'};
            color:${danger ? '#fff' : '#000'};font-family:var(--sans);font-size:14px;
            cursor:pointer;font-weight:600;transition:opacity 0.15s;
          ">${confirmLabel}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('#modal-confirm').onclick = () => close(true);
    overlay.querySelector('#modal-cancel').onclick  = () => close(false);
    overlay.onclick = (e) => { if (e.target === overlay) close(false); };
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(false); document.removeEventListener('keydown', esc); }
    });
  });
}

// Also a simple info/alert modal
function showAlert(title, message) {
  return showConfirm(title, message, 'OK', '', false).then(() => {});
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT CONTROL
// ─────────────────────────────────────────────────────────────────────────────
let _botAutoRefresh = null;
let _botLogScroll   = true;

async function loadBotStatus() {
  try {
    const r = await fetch('/api/bot/status');
    const d = await r.json();
    const dot  = document.getElementById('bc-dot');
    const txt  = document.getElementById('bc-status-text');
    const badge = document.getElementById('bot-status-badge');
    const running  = d.running;
    const mode     = d.mode || 'pm2';  // 'pm2' | 'native'
    let statusText;
    if (running) {
      const uptime = d.uptime ? ` · ${d.uptime}` : '';
      statusText = mode === 'native'
        ? `🟢 Rodando (modo nativo${uptime})`
        : `🟢 Rodando via PM2${uptime}`;
    } else if (d.status === 'errored') {
      statusText = '⚠️ Erro no processo — verifique os logs';
    } else {
      statusText = mode === 'native'
        ? '🔴 Parado (pronto para iniciar)'
        : (d.pm2_found ? '🔴 Parado' : '🔴 Parado (PM2 não encontrado — modo nativo disponível)');
    }
    if (dot)  {
      dot.className = 'status-dot ' + (running ? 'live' : 'idle');
      dot.style.background = running ? '' : (d.status === 'errored' ? 'var(--red)' : '');
    }
    if (txt)  { txt.textContent = statusText; }
    if (badge){ badge.textContent = running ? 'ON' : 'OFF'; badge.style.background = running ? 'var(--green)' : ''; badge.style.fontWeight = '700'; }
    const pid = document.getElementById('bc-pid');
    const rst = document.getElementById('bc-restarts');
    if (pid) pid.textContent = d.pid || '—';
    if (rst) rst.textContent = d.restarts !== undefined ? d.restarts : '—';
    // Show mode badge
    const modeEl = document.getElementById('bc-mode');
    if (modeEl) { modeEl.textContent = mode === 'pm2' ? 'PM2' : 'Nativo'; modeEl.style.color = mode === 'pm2' ? 'var(--green)' : 'var(--blue)'; }
  } catch(e) {}
}

async function loadBotLogs() {
  try {
    const r = await fetch('/api/bot/logs');
    const d = await r.json();
    const box = document.getElementById('bc-logs');
    if (!box) return;
    if (!d.lines || !d.lines.length) {
      box.innerHTML = '<span style="color:var(--t3);font-size:11px;font-family:var(--mono)">Sem logs disponíveis. O bot já foi iniciado?</span>';
      return;
    }
    box.innerHTML = d.lines.map(line => {
      let color = 'var(--t2)';
      if (line.includes('ERROR') || line.includes('ERRO') || line.includes('STOP LOSS') || line.includes('Erro'))
        color = 'var(--red)';
      else if (line.includes('LONG') || line.includes('BUY') || line.includes('STRONG_BUY') || line.includes('✅'))
        color = 'var(--green)';
      else if (line.includes('SHORT') || line.includes('SELL') || line.includes('STRONG_SELL') || line.includes('🔴'))
        color = 'var(--red)';
      else if (line.includes('WARNING') || line.includes('⚠') || line.includes('🟡'))
        color = 'var(--gold)';
      else if (line.includes('Vela #') || line.includes('🕯') || line.includes('═'))
        color = 'var(--t1)';
      return `<div style="font-family:var(--mono);font-size:10px;color:${color};padding:1px 0;line-height:1.6;white-space:pre-wrap">${escHtml(line)}</div>`;
    }).join('');
    if (_botLogScroll) box.scrollTop = box.scrollHeight;
  // Sync to mini dashboard monitor
  const miniBox = document.getElementById('bm-logs');
  if (miniBox) {
    miniBox.innerHTML = box.innerHTML;
    miniBox.scrollTop = miniBox.scrollHeight;
  }
  } catch(e) {}
}

function toggleAutoRefresh() {
  const btn = document.getElementById('bc-auto-btn');
  if (_botAutoRefresh) {
    clearInterval(_botAutoRefresh);
    _botAutoRefresh = null;
    if (btn) btn.textContent = 'Auto OFF';
  } else {
    _botAutoRefresh = setInterval(() => { loadBotLogs(); loadBotStatus(); }, 10000);
    if (btn) btn.textContent = 'Auto ON ⚡';
    loadBotLogs();
  }
}

function getBotConfig() {
  const strat = document.getElementById('bc-strategy')?.value || 'pattern';
  const cfg = {
    BOT_SYMBOL:   (document.getElementById('bc-symbol-custom')?.value.trim() || document.getElementById('bc-symbol')?.value || 'BTCUSDT').toUpperCase().replace('/','').replace('-',''),
    SYMBOL:       (document.getElementById('bc-symbol-custom')?.value.trim() || document.getElementById('bc-symbol')?.value || 'BTCUSDT').toUpperCase().replace('/','').replace('-',''),
    BOT_STRATEGY: strat,
    BOT_CAPITAL:  document.getElementById('bc-capital')?.value   || '300',
    BOT_TIMEFRAME:document.getElementById('bc-timeframe')?.value || '15m',
    BOT_STOP_LOSS:document.getElementById('bc-stopglobal')?.value || '0',
    BOT_TESTNET:  document.getElementById('bc-testnet')?.value   || 'true',
  };
  if (strat === 'grid') {
    cfg.BOT_PRICE_MIN  = document.getElementById('bc-grid-min')?.value || '80000';
    cfg.BOT_PRICE_MAX  = document.getElementById('bc-grid-max')?.value || '90000';
    cfg.BOT_NUM_GRIDS  = document.getElementById('bc-grid-n')?.value   || '10';
  } else if (strat === 'pattern') {
    cfg.BOT_MIN_CONF    = document.getElementById('bc-pat-conf')?.value || '0.65';
    cfg.BOT_TP_RR       = document.getElementById('bc-pat-rr')?.value   || '2.0';
    cfg.BOT_SL_ATR      = document.getElementById('bc-pat-atr')?.value  || '1.5';
    cfg.BOT_REQUIRE_VOL = document.getElementById('bc-pat-vol')?.value  || 'true';
  }
  return cfg;
}

async function botSaveAndApply() {
  const btn = document.querySelector('[onclick="botSaveAndApply()"]');
  if (btn) { btn.textContent = '⏳ Salvando...'; btn.disabled = true; }
  try {
    const cfg = getBotConfig();
    const r   = await fetch('/api/bot/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: cfg })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ Config salva! (' + d.saved + ' variáveis em ' + d.path + ')');
      document.getElementById('bc-env-path').textContent = d.path;
      // Reload current config display
      loadBotConfig();
    } else {
      showToast('❌ Erro: ' + d.error, true);
    }
  } catch(e) {
    showToast('❌ Erro ao salvar: ' + e.message, true);
  } finally {
    if (btn) { btn.textContent = '💾 Salvar config e aplicar ao bot'; btn.disabled = false; }
  }
}

async function loadBotConfig() {
  try {
    const r = await fetch('/api/bot/config');
    const d = await r.json();
    if (!d.ok) return;
    const cfg = d.config;
    // Populate form fields
    const setV = (id, key) => { const e = document.getElementById(id); if (e && cfg[key]) e.value = cfg[key]; };
    setV('bc-symbol',    'BOT_SYMBOL');
    setV('bc-strategy',  'BOT_STRATEGY');
    setV('bc-capital',   'BOT_CAPITAL');
    setV('bc-timeframe', 'BOT_TIMEFRAME');
    setV('bc-stopglobal','BOT_STOP_LOSS');
    setV('bc-testnet',   'BOT_TESTNET');
    setV('bc-grid-min',  'BOT_PRICE_MIN');
    setV('bc-grid-max',  'BOT_PRICE_MAX');
    setV('bc-grid-n',    'BOT_NUM_GRIDS');
    setV('bc-pat-conf',  'BOT_MIN_CONF');
    setV('bc-pat-rr',    'BOT_TP_RR');
    setV('bc-pat-atr',   'BOT_SL_ATR');
    setV('bc-pat-vol',   'BOT_REQUIRE_VOL');
    // Show/hide strategy params
    bcStrategyChange();
    // Testnet warning
    const warn = document.getElementById('bc-testnet-warn');
    if (warn) warn.style.display = cfg.BOT_TESTNET === 'false' ? 'flex' : 'none';
  } catch(e) {}
}

async function botStart() {
  const btn = document.getElementById('bc-btn-start');
  if (btn) { btn.textContent = '⏳ Iniciando...'; btn.disabled = true; }
  try {
    // Save config first
    await botSaveAndApply();
    const r = await fetch('/api/bot/start', { method: 'POST' });
    const d = await r.json();
    if (!d.ok) {
      if (d.error && (d.error.includes('Binance') || d.error.includes('chaves'))) {
        showToast('⚙️ ' + d.error + ' → Vá em Meu Perfil → Chaves de API', true);
      } else {
        showToast('❌ ' + (d.error || 'Erro desconhecido'), true);
      }
    } else {
      showToast('✅ ' + d.message);
      // Atualiza badge sidebar imediatamente
      const badge = document.getElementById('bot-status-badge');
      if (badge) { badge.textContent = 'ON'; badge.style.background = 'var(--green)'; badge.style.color = '#000'; }
    }
    setTimeout(loadBotStatus, 1500);
    setTimeout(loadBotLogs,   2000);
    setTimeout(loadBotLogs,   5000);
    // Notifica live state
    try { fetch('/api/live/event', { method:'POST', headers: auth.headers(), body: JSON.stringify({ type:'bot_started', data:{ pair: document.getElementById('bc-symbol')?.value||'BTCUSDT', strategy: document.getElementById('bc-strategy')?.value||'pattern' } }) }); } catch {}
  } catch(e) {
    showToast('❌ Erro: ' + e.message, true);
  } finally {
    if (btn) { btn.textContent = '▶ Iniciar Bot'; btn.disabled = false; }
  }
}

async function botStop() {
  const ok = await showConfirm('Parar o Bot', 'Confirma parar o bot agora? Ordens abertas NÃO serão canceladas automaticamente.');
  if (!ok) return;
  const btn = document.getElementById('bc-btn-stop');
  if (btn) { btn.textContent = '⏳ Parando...'; btn.disabled = true; }
  try {
    const r = await fetch('/api/bot/stop', { method: 'POST' });
    const d = await r.json();
    showToast(d.ok ? '✅ ' + d.message : '❌ ' + d.error, !d.ok);
    if (d.ok) {
      const badge = document.getElementById('bot-status-badge');
      if (badge) { badge.textContent = 'OFF'; badge.style.background = ''; badge.style.color = ''; }
      try { fetch('/api/live/event', { method:'POST', headers: auth.headers(), body: JSON.stringify({ type:'bot_stopped', data:{} }) }); } catch {}
    }
    setTimeout(loadBotStatus, 1500);
  } catch(e) {
    showToast('❌ Erro: ' + e.message, true);
  } finally {
    if (btn) { btn.textContent = '■ Parar Bot'; btn.disabled = false; }
  }
}

function bcStrategyChange() {
  const strat = document.getElementById('bc-strategy')?.value || 'grid';
  ['grid','pattern'].forEach(s => {
    const p = document.getElementById('bc-sp-' + s);
    if (p) p.style.display = strat === s ? 'block' : 'none';
  });
  const warn = document.getElementById('bc-testnet-warn');
  const tn   = document.getElementById('bc-testnet')?.value;
  if (warn) warn.style.display = tn === 'false' ? 'flex' : 'none';
}

// ─── Toast notifications ─────────────────────────────────────────────────────
function showToast(msg, isError = false) {
  const existing = document.getElementById('ce-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'ce-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:${isError ? 'var(--reddim)' : 'var(--greendim)'};
    border:1px solid ${isError ? 'var(--red)' : 'var(--green)'};
    color:${isError ? 'var(--red)' : 'var(--green)'};
    padding:12px 18px;border-radius:8px;font-family:var(--mono);font-size:12px;
    box-shadow:0 4px 20px rgba(0,0,0,0.4);max-width:400px;
    animation:fadeIn 0.2s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

// ─── Wire up strategy change listener ────────────────────────────────────────
document.addEventListener('change', (e) => {
  if (e.target.id === 'bc-strategy' || e.target.id === 'bc-testnet') bcStrategyChange();
});



// ─────────────────────────────────────────────────────────────────────────────
// BACKTESTING
// ─────────────────────────────────────────────────────────────────────────────
let _btEquityChart = null;

function btStratChange() {
  const s = document.getElementById('bt-strategy')?.value || 'trend';
  ['trend','scalping','pattern','breakout','macd'].forEach(x => {
    const p = document.getElementById('bt-sp-' + x);
    if (p) p.style.display = s === x ? 'block' : 'none';
  });
}

async function runBacktest() {
  const btn = document.getElementById('bt-run-btn');
  const prog = document.getElementById('bt-progress');
  const bar  = document.getElementById('bt-progress-bar');
  const ptxt = document.getElementById('bt-progress-text');

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Executando...'; }
  if (prog) prog.style.display = 'block';

  // Animate progress bar
  let pct = 0;
  const progInterval = setInterval(() => {
    pct = Math.min(pct + 3, 90);
    if (bar)  bar.style.width = pct + '%';
    if (ptxt) ptxt.textContent = pct < 30 ? 'Buscando dados da Binance...' :
                                  pct < 60 ? 'Rodando estratégia nas velas...' :
                                             'Calculando métricas...';
  }, 400);

  const strat   = document.getElementById('bt-strategy')?.value || 'trend';
  const config  = {
    capital:    document.getElementById('bt-capital')?.value   || '300',
    rr:         document.getElementById('bt-rr')?.value        || '2.0',
    ema_fast:   document.getElementById('bt-ema-fast')?.value  || '9',
    ema_slow:   document.getElementById('bt-ema-slow')?.value  || '21',
    rsi_buy:    document.getElementById('bt-rsi-buy')?.value   || '30',
    rsi_sell:   document.getElementById('bt-rsi-sell')?.value  || '70',
    min_conf:   document.getElementById('bt-min-conf')?.value  || '0.65',
    lookback:   document.getElementById('bt-lookback')?.value  || '20',
  };

  try {
    const r = await fetch('/api/backtest', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        symbol:   document.getElementById('bt-symbol')?.value   || 'BTCUSDT',
        timeframe:document.getElementById('bt-tf')?.value       || '15m',
        limit:    parseInt(document.getElementById('bt-limit')?.value || '500'),
        strategy: strat,
        config
      })
    });
    const data = await r.json();

    clearInterval(progInterval);
    if (bar)  bar.style.width = '100%';
    if (ptxt) ptxt.textContent = 'Concluído!';
    setTimeout(() => { if (prog) prog.style.display = 'none'; if (bar) bar.style.width = '0%'; }, 1500);

    if (data.error) { showToast('❌ Backtest falhou: ' + data.error, true); return; }
    renderBacktestResults(data);
  } catch(e) {
    clearInterval(progInterval);
    showToast('❌ Erro: ' + e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '▶ Executar Backtest'; }
  }
}

function renderBacktestResults(d) {
  const empty = document.getElementById('bt-results-empty');
  const res   = document.getElementById('bt-results');
  if (empty) empty.style.display = 'none';
  if (res)   res.style.display   = 'block';

  const roiColor  = d.roi >= 0 ? 'var(--green)' : 'var(--red)';
  const pnlColor  = d.total_pnl >= 0 ? 'var(--green)' : 'var(--red)';
  // Save for equity canvas (features.js)
  window._lastBacktestData = d;
  document.dispatchEvent(new CustomEvent('backtestResult', { detail: d }));
  const metrics = document.getElementById('bt-metrics');
  if (metrics) {
    metrics.innerHTML = [
      { label:'Trades', val: d.trades, cls:'' },
      { label:'Win Rate', val: d.win_rate + '%', cls: d.win_rate >= 50 ? 'green' : 'red' },
      { label:'PnL Total', val: (d.total_pnl >= 0 ? '+' : '') + fmtUSD(d.total_pnl), cls: d.total_pnl >= 0 ? 'green' : 'red' },
      { label:'ROI', val: (d.roi >= 0 ? '+' : '') + d.roi + '%', cls: d.roi >= 0 ? 'green' : 'red' },
      { label:'Max Drawdown', val: d.max_drawdown + '%', cls: d.max_drawdown > 20 ? 'red' : 'gold' },
      { label:'Sharpe', val: d.sharpe, cls: d.sharpe >= 1 ? 'green' : d.sharpe >= 0 ? 'gold' : 'red' },
      { label:'Avg Win', val: '+' + fmtUSD(d.avg_win), cls:'green' },
      { label:'Avg Loss', val: fmtUSD(d.avg_loss), cls:'red' },
      { label:'Profit Factor', val: d.profit_factor === 999 ? '∞' : d.profit_factor, cls: d.profit_factor >= 1.5 ? 'green' : 'gold' },
    ].map(m => `<div class="metric"><label>${m.label}</label><div class="val ${m.cls}" style="font-size:16px">${m.val}</div></div>`).join('');
  }

  // Equity curve chart
  const ctx = document.getElementById('bt-equity-chart')?.getContext('2d');
  if (ctx) {
    if (_btEquityChart) _btEquityChart.destroy();
    const eq = d.equity_daily || [];
    _btEquityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   eq.map(e => e.date),
        datasets: [{
          label: 'Capital',
          data:  eq.map(e => e.capital),
          borderColor: d.roi >= 0 ? '#3FB950' : '#F85149',
          backgroundColor: d.roi >= 0 ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
          borderWidth: 1.5, fill: true, tension: 0.3, pointRadius: 0
        }]
      },
      options: { responsive:true, plugins:{ legend:{ display:false } },
        scales:{ x:{ ticks:{font:{size:9},color:'#484F58'}, grid:{color:'#21262D'} },
                 y:{ ticks:{font:{size:9},color:'#484F58', callback: v => '$'+v.toLocaleString()}, grid:{color:'#21262D'} } } }
    });
  }

  // Trade list
  const tbody = document.getElementById('bt-trade-list');
  if (tbody) {
    tbody.innerHTML = (d.trade_list || []).map(t => {
      const up = t.pnl >= 0;
      return `<tr>
        <td class="muted">${t.date}</td>
        <td><span class="badge ${t.side==='BUY'?'badge-green':'badge-red'}">${t.side==='BUY'?'Long':'Short'}</span></td>
        <td>${fmtUSD(t.entry)}</td><td>${fmtUSD(t.exit)}</td>
        <td class="${up?'green':'red'}">${up?'+':''}${fmtUSD(t.pnl)}</td>
        <td class="muted" style="font-size:10px">${t.reason}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3)">Sem trades</td></tr>';
  }

  showToast(`✅ Backtest: ${d.trades} trades | ROI ${d.roi >= 0 ? '+' : ''}${d.roi}% | WR ${d.win_rate}%`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PNL CHART
// ─────────────────────────────────────────────────────────────────────────────
let _pnlCumChart  = null;
let _pnlDayChart  = null;

async function loadPnLChart(range = 'week', btn = null) {
  if (btn) {
    document.querySelectorAll('.pnl-range-btn').forEach(b => b.classList.remove('active-filter'));
    btn.classList.add('active-filter');
  }

  // Wait for Chart.js to load
  if (typeof Chart === 'undefined') {
    await new Promise(resolve => {
      const check = setInterval(() => {
        if (typeof Chart !== 'undefined') { clearInterval(check); resolve(); }
      }, 200);
      setTimeout(() => { clearInterval(check); resolve(); }, 10000);
    });
  }

  try {
    const r = await fetch('/api/pnl/chart?range=' + range);
    const d = await r.json();

    // Metrics
    const pnlSum = d.data.reduce((s, v) => s + v, 0);
    const wins   = d.days?.filter(x => x.pnl > 0).length || 0;
    const total  = d.days?.length || 1;
    const best   = d.data.length ? Math.max(...d.data) : 0;
    const worst  = d.data.length ? Math.min(...d.data) : 0;
    const metrics = document.getElementById('pnl-metrics');
    if (metrics) {
      const items = [
        { label:'PnL Total', val: (pnlSum>=0?'+':'') + fmtUSD(pnlSum), cls: pnlSum>=0?'green':'red' },
        { label:'Dias Positivos', val: wins + '/' + (total||1), cls: wins > 0 ? 'green' : '' },
        { label:'Melhor Dia', val: best ? '+' + fmtUSD(best) : '$0.00', cls:'green' },
        { label:'Pior Dia', val: worst ? fmtUSD(worst) : '$0.00', cls: worst < 0 ? 'red' : '' },
      ];
      metrics.innerHTML = items.map(m =>
        '<div class="metric"><label>' + m.label + '</label><div class="val ' + m.cls + '">' + m.val + '</div></div>'
      ).join('');
    }
    
    if (!d.labels || !d.labels.length) {
      const c1 = document.getElementById('pnl-cumulative-chart');
      const c2 = document.getElementById('pnl-daily-chart');
      if (c1) { const p = c1.parentElement; p.innerHTML = '<div style="height:180px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:13px">Nenhum trade registrado ainda. Use o Diário para registrar trades.</div>' + '<canvas id="pnl-cumulative-chart" height="100"></canvas>'; }
      return;
    }

    const chartDefaults = {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { font:{size:9}, color:'#484F58', maxTicksLimit:8 }, grid: { color:'#21262D' } },
        y: { ticks: { font:{size:9}, color:'#484F58', callback: v => '$'+v }, grid: { color:'#21262D' } }
      }
    };

    // Cumulative chart
    const ctx1 = document.getElementById('pnl-cumulative-chart')?.getContext('2d');
    if (ctx1) {
      if (_pnlCumChart) _pnlCumChart.destroy();
      const lastVal = d.cumulative[d.cumulative.length-1] || 0;
      _pnlCumChart = new Chart(ctx1, {
        type: 'line',
        data: {
          labels: d.labels,
          datasets: [{
            data: d.cumulative,
            borderColor: lastVal >= 0 ? '#3FB950' : '#F85149',
            backgroundColor: lastVal >= 0 ? 'rgba(63,185,80,0.08)' : 'rgba(248,81,73,0.08)',
            borderWidth: 2, fill: true, tension: 0.3, pointRadius: 2,
            pointBackgroundColor: lastVal >= 0 ? '#3FB950' : '#F85149'
          }]
        },
        options: chartDefaults
      });
    }

    // Daily bar chart
    const ctx2 = document.getElementById('pnl-daily-chart')?.getContext('2d');
    if (ctx2) {
      if (_pnlDayChart) _pnlDayChart.destroy();
      _pnlDayChart = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: d.labels,
          datasets: [{
            data: d.data,
            backgroundColor: d.data.map(v => v >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)'),
            borderColor:     d.data.map(v => v >= 0 ? '#3FB950' : '#F85149'),
            borderWidth: 1, borderRadius: 3
          }]
        },
        options: { ...chartDefaults, scales: { ...chartDefaults.scales,
          y: { ...chartDefaults.scales.y,
            ticks: { ...chartDefaults.scales.y.ticks,
              callback: v => (v>=0?'+':'') + '$' + v }
          }
        }}
      });
    }
  } catch(e) {
    console.error('PnL chart error:', e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM
// ─────────────────────────────────────────────────────────────────────────────
async function telegramTest() {
  // Save tokens to server config first
  const token  = document.getElementById('bc-tg-token')?.value.trim();
  const chatId = document.getElementById('bc-tg-chatid')?.value.trim();
  if (!token || !chatId) { showToast('⚠ Preencha o Token e o Chat ID', true); return; }

  // Save to bot config
  const cfg = getBotConfig();
  cfg.TELEGRAM_TOKEN   = token;
  cfg.TELEGRAM_CHAT_ID = chatId;
  await fetch('/api/bot/config', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ config: cfg })
  });

  // Send test
  try {
    showToast('⏳ Enviando mensagem teste...');
    const r = await fetch('/api/telegram/test', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token, chatId })
    });
    const d = await r.json();
    if (d.ok) showToast('✅ Telegram conectado! Verifique seu chat.');
    else      showToast('❌ Erro: ' + (d.error || 'falhou'), true);
  } catch(e) {
    showToast('❌ Erro: ' + e.message, true);
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// ORDER PANEL
// ─────────────────────────────────────────────────────────────────────────────
function toggleOrderPanel() {
  const p = document.getElementById('order-panel');
  if (!p) return;
  const visible = p.style.display !== 'none';
  p.style.display = visible ? 'none' : 'block';
  if (!visible) updateOrderPreview();
}

function updateOrderPreview() {
  const sym    = state.activePair || 'BTCUSDT';
  const d      = state.prices[sym] || {};
  const price  = parseFloat(document.getElementById('op-entry')?.value) || d.price || 0;
  const size   = parseFloat(document.getElementById('op-size')?.value)  || 100;
  const slPct  = parseFloat(document.getElementById('op-sl')?.value)    || 2;
  const tpPct  = parseFloat(document.getElementById('op-tp')?.value)    || 4;

  const p = PAIRS.find(x => x.sym === sym);
  const setT = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  setT('op-pair', (p ? p.base : sym.replace('USDT','')) + '/USDT');
  setT('op-current-price', d.price ? fmtUSD(d.price) : '—');

  if (price > 0) {
    setT('op-sl-price',  fmtUSD(price * (1 - slPct/100)) + ' / ' + fmtUSD(price * (1 + slPct/100)));
    setT('op-tp-price',  fmtUSD(price * (1 + tpPct/100)) + ' / ' + fmtUSD(price * (1 - tpPct/100)));
    setT('op-max-loss',  '-' + fmtUSD(size * slPct/100));
    setT('op-max-gain',  '+' + fmtUSD(size * tpPct/100));
  }
  // Pre-fill entry with current price
  const entryEl = document.getElementById('op-entry');
  if (entryEl && !entryEl.value && d.price) entryEl.value = d.price.toFixed(2);
}

function openManualOrder(side) {
  const sym   = state.activePair || 'BTCUSDT';
  const d     = state.prices[sym] || {};
  const entry = parseFloat(document.getElementById('op-entry')?.value) || d.price || 0;
  const size  = parseFloat(document.getElementById('op-size')?.value)  || 100;
  const slPct = parseFloat(document.getElementById('op-sl')?.value)    || 2;
  const tpPct = parseFloat(document.getElementById('op-tp')?.value)    || 4;
  if (!entry || entry <= 0) { showToast('⚠ Defina o preço de entrada', true); return; }

  const sl   = side === 'BUY' ? entry*(1-slPct/100) : entry*(1+slPct/100);
  const tp   = side === 'BUY' ? entry*(1+tpPct/100) : entry*(1-tpPct/100);
  const pair = PAIRS.find(x => x.sym === sym);
  const pairLabel = (pair ? pair.base : sym.replace('USDT','')) + '/USDT';

  // Simulated exit at TP for demo purposes (user can edit in journal)
  const exitPrice = tp;
  const rawPnl    = side === 'BUY'
    ? (exitPrice - entry) / entry * size
    : (entry - exitPrice) / entry * size;
  const pnl    = parseFloat(rawPnl.toFixed(2));
  const pnlPct = parseFloat((rawPnl / size * 100).toFixed(2));

  const trade = {
    pair:      pairLabel,
    direction: side === 'BUY' ? 'Long' : 'Short',
    entry:     parseFloat(entry.toFixed(2)),
    exit:      parseFloat(exitPrice.toFixed(2)),
    size:      parseFloat(size.toFixed(2)),
    leverage:  '1x',
    reason:    'Ordem manual — SL ' + fmtUSD(sl) + ' | TP ' + fmtUSD(tp),
    result:    'win',
    pnl,
    pnl_pct: pnlPct
  };

  fetch('/api/trades', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-auth-token': auth.token },
    body: JSON.stringify(trade)
  })
  .then(r => r.json())
  .then(() => {
    loadTrades();
    loadStats();
    showToast((side==='BUY'?'🟢 Long':'🔴 Short') + ' registrado: ' + pairLabel + ' @ ' + fmtUSD(entry));
    // Also update entry field with current price for next order
    const entryEl = document.getElementById('op-entry');
    if (entryEl && d.price) entryEl.value = d.price.toFixed(2);
  })
  .catch(e => showToast('❌ Erro ao registrar: ' + e.message, true));
}

// Listen to order form changes
document.addEventListener('input', (e) => {
  if (['op-entry','op-sl','op-tp','op-size'].includes(e.target.id)) updateOrderPreview();
});

// ─── Bot Monitor on Dashboard ─────────────────────────────────────────────────
let _bmInterval = null;

function toggleBotMonitor() {
  const p = document.getElementById('bot-monitor-panel');
  const btn = document.getElementById('monitor-btn');
  if (!p) return;
  const visible = p.style.display !== 'none';
  p.style.display = visible ? 'none' : 'block';
  if (btn) btn.textContent = visible ? '👁 Monitor Bot' : '✕ Fechar Monitor';
  if (!visible) {
    loadBotStatus();
    loadBotLogs();
    if (!_bmInterval) _bmInterval = setInterval(() => {
      loadBotStatus();
      if (document.getElementById('bot-monitor-panel')?.style.display !== 'none') loadBotLogs();
    }, 3000);
  } else {
    if (_bmInterval) { clearInterval(_bmInterval); _bmInterval = null; }
  }
}

function syncBotMonitorLogs() {
  // Sync from full log panel to mini dashboard monitor
  const fullLogs = document.getElementById('bc-logs');
  const miniLogs = document.getElementById('bm-logs');
  if (fullLogs && miniLogs) miniLogs.innerHTML = fullLogs.innerHTML;
  // Sync status
  const dot    = document.getElementById('bc-dot');
  const bmDot  = document.getElementById('bm-dot');
  const bmTxt  = document.getElementById('bm-status');
  const bcTxt  = document.getElementById('bc-status-text');
  if (dot && bmDot) bmDot.className = dot.className;
  if (bcTxt && bmTxt) bmTxt.textContent = bcTxt.textContent;
  const miniBox = document.getElementById('bm-logs');
  if (miniBox) miniBox.scrollTop = miniBox.scrollHeight;
}

// Patch loadBotLogs to also sync mini monitor
const _origLoadBotLogs = typeof loadBotLogs !== 'undefined' ? loadBotLogs : null;

// ─── Update topbar price when pair changes ────────────────────────────────────
function updateChartPriceBadge(sym) {
  const d = state.prices[sym];
  if (!d) return;
  const up = d.change >= 0;
  const badge  = document.getElementById('chart-price-badge');
  const change = document.getElementById('chart-change-badge');
  if (badge)  { badge.textContent = fmtUSD(d.price); badge.style.color = up ? 'var(--green)' : 'var(--red)'; }
  if (change) {
    change.textContent = (up?'+':'') + d.change.toFixed(2) + '%';
    change.style.background  = up ? 'var(--greendim)' : 'var(--reddim)';
    change.style.color       = up ? 'var(--green)'    : 'var(--red)';
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// AUTH — Login / Setup
// ─────────────────────────────────────────────────────────────────────────────
const auth = {
  token: localStorage.getItem('ce_token') || '',
  user:  localStorage.getItem('ce_user')  || '',
  save(token, user) {
    this.token = token; this.user = user;
    localStorage.setItem('ce_token', token);
    localStorage.setItem('ce_user',  user);
  },
  clear() {
    this.token = ''; this.user = '';
    localStorage.removeItem('ce_token');
    localStorage.removeItem('ce_user');
  },
  headers() { return { 'Content-Type': 'application/json', 'x-auth-token': this.token }; }
};

function showLoginError(msg) {
  const e = document.getElementById('login-error');
  if (!e) return;
  e.innerHTML = '⚠️ ' + msg;
  e.style.display = 'block';
  // Shake animation restart
  e.style.animation = 'none';
  e.offsetHeight; // reflow
  e.style.animation = '';
}

function togglePass(id) {
  const inp = document.getElementById(id);
  if (!inp) return;
  const isPass = inp.type === 'password';
  inp.type = isPass ? 'text' : 'password';
  // Find the toggle button
  const btn = inp.parentElement?.querySelector('button[onclick*="' + id + '"]');
  if (btn) btn.textContent = isPass ? '🙈' : '👁';
}

function checkPasswordStrength(pass) {
  const wrap = document.getElementById('pass-strength-wrap');
  const bar  = document.getElementById('pass-strength-bar');
  const lbl  = document.getElementById('pass-strength-label');
  if (!wrap || !bar || !lbl) return;
  if (!pass) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  let score = 0;
  if (pass.length >= 6)                     score++;
  if (pass.length >= 10)                    score++;
  if (/[A-Z]/.test(pass))                   score++;
  if (/[0-9]/.test(pass))                   score++;
  if (/[^A-Za-z0-9]/.test(pass))            score++;
  const levels = [
    { pct:'20%', color:'#F85149', text:'Muito fraca' },
    { pct:'40%', color:'#D29922', text:'Fraca' },
    { pct:'60%', color:'#F0B90B', text:'Moderada' },
    { pct:'80%', color:'#3FB950', text:'Forte' },
    { pct:'100%',color:'#3FB950', text:'Muito forte ✅' },
  ];
  const lvl = levels[Math.min(score-1, 4)] || levels[0];
  bar.style.width = lvl.pct;
  bar.style.background = lvl.color;
  lbl.textContent = lvl.text;
  lbl.style.color = lvl.color;
}

function loginBtnLoading(loading, btnId = 'login-btn') {
  const btn = document.getElementById(btnId);
  const txt = document.getElementById(btnId + '-text') || btn;
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    if (txt.id) txt.textContent = 'Entrando...';
    btn.style.opacity = '0.8';
  } else {
    btn.disabled = false;
    if (txt.id) txt.textContent = 'Entrar na plataforma';
    btn.style.opacity = '1';
  }
}

// Ripple effect on login button
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#login-btn, #setup-btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = btn.querySelector('#login-ripple') || document.createElement('div');
  const size = Math.max(btn.clientWidth, btn.clientHeight) * 2;
  ripple.style.cssText = 'position:absolute;border-radius:50%;background:rgba(255,255,255,0.25);pointer-events:none;' +
    'left:' + (e.clientX - rect.left) + 'px;top:' + (e.clientY - rect.top) + 'px;' +
    'width:0;height:0;transform:translate(-50%,-50%);transition:width 0.4s ease,height 0.4s ease,opacity 0.4s ease;';
  btn.appendChild(ripple);
  requestAnimationFrame(() => {
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.opacity = '0';
  });
  setTimeout(() => ripple.remove(), 500);
});

async function checkSetup() {
  try {
    const r = await fetch('/api/auth/setup-required');
    const d = await r.json();
    if (d.required) {
      showForm('setup');
    } else {
      showForm('login');
      // Forgot password form should be accessible
      // Show register link based on regMode
      const regLink = document.getElementById('register-link');
      const inviteField = document.getElementById('invite-code-field');
      if (regLink && d.regMode !== 'closed') regLink.style.display = 'block';
      if (inviteField) inviteField.style.display = d.regMode === 'invite' ? 'block' : 'none';
      // Auto-fill remembered credentials
      const savedUser = localStorage.getItem('ce_user');
      const savedPass = localStorage.getItem('ce_pass');
      const remember  = localStorage.getItem('ce_remember') === '1';
      if (savedUser) { const e=document.getElementById('login-user'); if(e) e.value=savedUser; }
      if (savedPass && remember) {
        const e=document.getElementById('login-pass'); if(e) e.value=savedPass;
        const cb=document.getElementById('remember-me'); if(cb) cb.checked=true;
      }
    }
  } catch(e) {
    showForm('login');
  }
}

async function doSetup() {
  const user  = document.getElementById('setup-user')?.value.trim();
  const pass  = document.getElementById('setup-pass')?.value;
  const pass2 = document.getElementById('setup-pass2')?.value;
  if (!user || !pass) { showLoginError('Preencha todos os campos'); return; }
  if (pass !== pass2) { showLoginError('As senhas não conferem'); return; }
  if (pass.length < 6) { showLoginError('Senha deve ter ao menos 6 caracteres'); return; }
  try {
    const r = await fetch('/api/auth/setup', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username:user,password:pass}) });
    const d = await r.json();
    if (!d.ok) { showLoginError(d.error || 'Erro ao criar conta'); return; }
    auth.save(d.token, d.username);
    enterApp();
  } catch(e) { showLoginError('Erro de conexão: ' + e.message); }
}

async function doLogin() {
  const user      = document.getElementById('login-user')?.value.trim();
  const pass      = document.getElementById('login-pass')?.value;
  const remember  = document.getElementById('remember-me')?.checked;
  if (!user || !pass) { showLoginError('Preencha usuário e senha'); return; }
  loginBtnLoading(true);
  const errEl = document.getElementById('login-error');
  if (errEl) errEl.style.display = 'none';
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username: user, password: pass })
    });
    const d = await r.json();
    if (!d.ok) { showLoginError(d.error || 'Usuário ou senha incorretos'); loginBtnLoading(false); return; }
    auth.save(d.token, d.username);
    if (d.role) localStorage.setItem('ce_role', d.role);
    if (d.plan) localStorage.setItem('ce_plan', d.plan);
    if (remember) {
      localStorage.setItem('ce_pass', pass);
      localStorage.setItem('ce_remember', '1');
    } else {
      localStorage.removeItem('ce_pass');
      localStorage.removeItem('ce_remember');
    }
    // Apply admin mode immediately
    if (d.role === 'admin') {
      localStorage.setItem('ce_role', 'admin');
      document.body.classList.add('admin-mode');
      const _adminNav = document.getElementById('nav-admin');
      if (_adminNav) _adminNav.style.display = 'flex';
    }
    // Success animation
    const btn = document.getElementById('login-btn');
    if (btn) {
      btn.style.background = 'linear-gradient(135deg,#3FB950,#2ea043)';
      btn.innerHTML = '<span>✅ Autenticado!</span>';
    }
    setTimeout(() => enterApp(), 400);
  } catch(e) {
    showLoginError('Erro de conexão com o servidor');
    loginBtnLoading(false);
  }
}


// Verify admin status immediately on app load
async function verifyAdminStatus() {
  try {
    const r = await fetch('/api/auth/me', { headers: auth.headers() });
    if (!r.ok) return;
    const d = await r.json();
    if (!d.ok) return;
    const role = d.user?.role;
    if (role) {
      localStorage.setItem('ce_role', role);
      if (role === 'admin') {
        document.body.classList.add('admin-mode');
        const nav = document.getElementById('nav-admin');
        if (nav) nav.style.display = 'flex';
        const gearBtn = document.getElementById('topbar-admin-btn');
        if (gearBtn) gearBtn.style.display = 'flex';
        // Update user display
        const nameEl = document.getElementById('user-name');
        if (nameEl && !nameEl.innerHTML.includes('ADMIN')) {
          nameEl.innerHTML = (d.user.username||'admin') + ' <span style="background:#F0B90B;color:#000;font-size:9px;padding:1px 5px;border-radius:3px;font-weight:700">ADMIN</span>';
        }
      }
    }
  } catch(e) {}
}


function goToAdmin() {
  // Navigate to admin panel
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const nav = document.querySelector('[data-panel="admin"]');
  const pan = document.getElementById('panel-admin');
  if (nav) nav.classList.add('active');
  if (pan) pan.classList.add('active');
  loadAdminPanel();
  switchAdminTab('users');
}

function enterApp() {
  const loginScreen = document.getElementById('login-screen');
  const app = document.getElementById('app');
  if (loginScreen) loginScreen.style.display = 'none';
  if (app) {
    app.style.display = '';
    app.classList.add('shown');
  }
  if (window._stopParticles) window._stopParticles();
  const av = document.getElementById('user-avatar');
  const nm = document.getElementById('user-name');
  if (av) av.textContent = auth.user.charAt(0).toUpperCase();
  if (nm) nm.textContent = auth.user;
  initApp();
}

async function logout() {
  const ok = await showConfirm('Sair', 'Confirma sair da conta?');
  if (!ok) return;
  await fetch('/api/auth/logout', { method: 'POST', headers: auth.headers() }).catch(()=>{});
  auth.clear();
  location.reload();
}

// ─────────────────────────────────────────────────────────────────────────────
// THEME
// ─────────────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next    = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ce_theme', next);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = next === 'dark' ? '🌙' : '☀️';
}

function loadTheme() {
  const saved = localStorage.getItem('ce_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = saved === 'dark' ? '🌙' : '☀️';
}

// ─────────────────────────────────────────────────────────────────────────────
// MODE BADGE — Real vs Simulation
// ─────────────────────────────────────────────────────────────────────────────
async function updateModeBadge() {
  try {
    const r = await fetch('/api/bot/config');
    const d = await r.json();
    const isReal = d.config?.BOT_TESTNET === 'false';
    const badge  = document.getElementById('mode-badge');
    const text   = document.getElementById('mode-text');
    if (badge) { badge.className = 'mode-badge ' + (isReal ? 'real' : 'sim'); }
    if (text)  { text.textContent = isReal ? '⚠ DINHEIRO REAL' : 'SIMULAÇÃO'; }
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// WATCHLIST
// ─────────────────────────────────────────────────────────────────────────────
let watchlist = new Set();

async function loadWatchlist() {
  try {
    const r = await fetch('/api/watchlist', { headers: auth.headers() });
    const d = await r.json();
    watchlist = new Set(d.pairs || []);
    renderWatchlistSidebar();
  } catch(e) {}
}

async function saveWatchlist() {
  try {
    await fetch('/api/watchlist', {
      method: 'POST', headers: auth.headers(),
      body: JSON.stringify({ pairs: [...watchlist] })
    });
  } catch(e) {}
}

function toggleWatchlist(sym) {
  if (watchlist.has(sym)) watchlist.delete(sym);
  else                    watchlist.add(sym);
  saveWatchlist();
  renderWatchlistSidebar();
  // Update all star buttons
  document.querySelectorAll('.star-btn').forEach(b => {
    if (b.dataset.sym === sym) b.classList.toggle('active', watchlist.has(sym));
  });
}

function renderWatchlistSidebar() {
  const wrap = document.getElementById('sidebar-watchlist');
  if (!wrap) return;
  if (!watchlist.size) {
    wrap.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:4px 8px">Nenhuma favoritada</div>';
    return;
  }
  wrap.innerHTML = '';
  [...watchlist].forEach(sym => {
    const p = PAIRS.find(x => x.sym === sym);
    const d = state.prices[sym] || {};
    const up = (d.change || 0) >= 0;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;padding:4px 8px;border-radius:4px;cursor:pointer;transition:background 0.1s';
    row.onclick = () => selectPairFromDash(sym);
    row.onmouseover = () => row.style.background = 'var(--bg3)';
    row.onmouseout  = () => row.style.background = '';
    row.innerHTML =
      '<span style="font-family:var(--mono);font-size:11px;font-weight:600;flex:1">' + (p ? p.base : sym.replace('USDT','')) + '</span>' +
      '<span style="font-family:var(--mono);font-size:11px;color:' + (up?'var(--green)':'var(--red)') + '">' +
        (d.price ? fmtUSD(d.price) : '—') + '</span>' +
      '<span style="font-family:var(--mono);font-size:10px;color:' + (up?'var(--green)':'var(--red)') + ';margin-left:4px">' +
        (d.change ? (up?'+':'') + d.change.toFixed(1)+'%' : '') + '</span>';
    wrap.appendChild(row);
  });
}



// ─────────────────────────────────────────────────────────────────────────────
// PRICE ALERTS
// ─────────────────────────────────────────────────────────────────────────────
let _alertsList = [];
let _triggeredAlerts = [];

function buildAlertSymbolSelector() {
  const sel = document.getElementById('al-symbol');
  if (!sel) return;
  sel.innerHTML = PAIRS.filter((p,i,a)=>a.findIndex(x=>x.sym===p.sym)===i)
    .map(p => '<option value="' + p.sym + '">' + p.base + '/USDT</option>').join('');
}

async function loadAlerts() {
  try {
    const r = await fetch('/api/alerts', { headers: auth.headers() });
    _alertsList = await r.json();
    renderAlertsList();
    const badge = document.getElementById('alerts-badge');
    const active = _alertsList.filter(a => !a.triggered).length;
    if (badge) {
      badge.textContent = active;
      badge.style.display = active > 0 ? 'inline-block' : 'none';
    }
  } catch(e) {}
}

function renderAlertsList() {
  const wrap = document.getElementById('alerts-list');
  if (!wrap) return;
  if (!_alertsList.length) {
    wrap.innerHTML = '<div style="color:var(--t3);font-size:13px;text-align:center;padding:20px">Nenhum alerta criado</div>';
    return;
  }
  wrap.innerHTML = '';
  _alertsList.forEach(al => {
    const d  = state.prices[al.symbol] || {};
    const condLabel = { above: 'acima de', below: 'abaixo de', change_up: 'alta % acima de', change_down: 'queda % abaixo de' }[al.condition] || al.condition;
    const p  = PAIRS.find(x => x.sym === al.symbol);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)';
    row.innerHTML =
      '<div style="flex:1">' +
        '<div style="font-family:var(--mono);font-size:13px;font-weight:600">' + (p ? p.base : al.symbol.replace('USDT','')) + '</div>' +
        '<div style="font-size:11px;color:var(--t2)">' + condLabel + ' <span style="color:var(--gold)">' + fmtUSD(al.price) + '</span></div>' +
        (al.note ? '<div style="font-size:10px;color:var(--t3)">' + al.note + '</div>' : '') +
      '</div>' +
      '<div style="text-align:right;min-width:90px">' +
        '<div style="font-family:var(--mono);font-size:12px;color:var(--t2)">' + (d.price ? 'Atual: ' + fmtUSD(d.price) : '—') + '</div>' +
        '<span class="badge ' + (al.triggered ? 'badge-green' : 'badge-gold') + '">' + (al.triggered ? '✅ Disparado' : '⏳ Ativo') + '</span>' +
      '</div>' +
      '<button class="delete-btn" data-id="' + al._id + '" title="Remover" onclick="deleteAlert(this.dataset.id)">✕</button>';
    wrap.appendChild(row);
  });
}

async function createAlert() {
  const symbol    = document.getElementById('al-symbol')?.value;
  const condition = document.getElementById('al-condition')?.value;
  const price     = parseFloat(document.getElementById('al-price')?.value);
  const note      = document.getElementById('al-note')?.value || '';
  if (!symbol || !condition || !price) { showToast('⚠ Preencha todos os campos', true); return; }
  try {
    const r = await fetch('/api/alerts', {
      method: 'POST', headers: auth.headers(),
      body: JSON.stringify({ symbol, condition, price, note })
    });
    const d = await r.json();
    if (d.error) { showToast('❌ ' + d.error, true); return; }
    showToast('🔔 Alerta criado!');
    document.getElementById('al-price').value = '';
    document.getElementById('al-note').value  = '';
    loadAlerts();
  } catch(e) { showToast('❌ Erro: ' + e.message, true); }
}

async function deleteAlert(id) {
  await fetch('/api/alerts/' + id, { method: 'DELETE', headers: auth.headers() });
  loadAlerts();
}

// Check alerts on every price update
function checkAlerts(sym, price, changePct) {
  _alertsList.forEach(al => {
    if (al.triggered || al.symbol !== sym) return;
    let triggered = false;
    if      (al.condition === 'above'       && price     >= al.price) triggered = true;
    else if (al.condition === 'below'       && price     <= al.price) triggered = true;
    else if (al.condition === 'change_up'   && changePct >= al.price) triggered = true;
    else if (al.condition === 'change_down' && changePct <= -al.price) triggered = true;

    if (triggered) {
      al.triggered = true;
      const p = PAIRS.find(x => x.sym === sym);
      const name = p ? p.base + '/USDT' : sym;
      showToast('🔔 ALERTA: ' + name + ' ' + (al.condition.includes('above')||al.condition.includes('up')?'subiu acima de':'caiu abaixo de') + ' ' + fmtUSD(al.price));
      renderAlertsList();
      renderTriggeredAlerts(al);
      // Mark triggered on server
      fetch('/api/alerts/' + al._id, { method: 'DELETE', headers: auth.headers() }).then(() => {
        // Re-create as triggered record
        fetch('/api/alerts', { method:'POST', headers: auth.headers(),
          body: JSON.stringify({...al, triggered: true, triggeredAt: new Date().toISOString()})
        });
      });
    }
  });
}

function renderTriggeredAlerts(newAlert = null) {
  if (newAlert) _triggeredAlerts.unshift(newAlert);
  const wrap = document.getElementById('alerts-triggered');
  if (!wrap) return;
  if (!_triggeredAlerts.length) {
    wrap.innerHTML = '<div style="color:var(--t3);font-size:13px;text-align:center;padding:20px">Nenhum alerta disparado</div>';
    return;
  }
  wrap.innerHTML = _triggeredAlerts.slice(0, 10).map(al => {
    const p = PAIRS.find(x => x.sym === al.symbol);
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">' +
      '<div><span style="font-family:var(--mono);font-weight:600">' + (p ? p.base : al.symbol.replace('USDT','')) + '</span>' +
      '<span style="font-size:11px;color:var(--t2);margin-left:8px">' + al.condition + ' ' + fmtUSD(al.price) + '</span></div>' +
      '<span class="badge badge-green">✅</span>' +
    '</div>';
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN SCANNER
// ─────────────────────────────────────────────────────────────────────────────
const SCANNER_PRESETS = {
  top10:     ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','TRXUSDT'],
  top20:     ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','TRXUSDT','LTCUSDT','LINKUSDT','BCHUSDT','XLMUSDT','NEARUSDT','APTUSDT','SUIUSDT','INJUSDT','FTMUSDT','ATOMUSDT'],
  defi:      ['UNIUSDT','AAVEUSDT','MKRUSDT','CRVUSDT','SNXUSDT','GRTUSDT','COMPUSDT','SUSHIUSDT','DYDXUSDT','1INCHUSDT'],
  meme:      ['DOGEUSDT','SHIBUSDT','PEPEUSDT','WIFUSDT','FLOKIUSDT','BONKUSDT','MEMEUSDT'],
  watchlist: [],
  all:       PAIRS.filter((p,i,a)=>a.findIndex(x=>x.sym===p.sym)===i).map(p=>p.sym).slice(0,30),
};

async function runScanner() {
  const btn    = document.getElementById('sc-btn');
  const status = document.getElementById('sc-status');
  const tf     = document.getElementById('sc-timeframe')?.value || '15m';
  const preset = document.getElementById('sc-preset')?.value   || 'top10';

  let symbols = SCANNER_PRESETS[preset] || SCANNER_PRESETS.top10;
  if (preset === 'watchlist') {
    symbols = [...watchlist];
    if (!symbols.length) { showToast('⚠ Sua Watchlist está vazia', true); return; }
  }

  if (btn)    { btn.disabled = true; btn.textContent = '⏳ Escaneando...'; }
  if (status) status.textContent = 'Buscando ' + symbols.length + ' pares...';

  const empty = document.getElementById('sc-empty');
  const grid  = document.getElementById('sc-grid');
  if (empty) empty.style.display = 'none';
  if (grid)  grid.style.display  = 'none';

  try {
    // Run scanner client-side (browser calls Binance directly)
    if (status) status.textContent = 'Analisando ' + symbols.length + ' pares...';
    const results = await Promise.allSettled(
      symbols.map(async sym => {
        const klines = await fetchKlines(sym, tf, 80);
        const d = runAnalysisEngine(klines);
        const p = PAIRS.find(x => x.sym === sym);
        return {
          symbol: sym, price: d.price, change_pct: d.change_pct,
          trend: d.smc?.bias === 'ALTISTA' ? 'up' : d.smc?.bias === 'BAIXISTA' ? 'down' : 'neutral',
          patterns: d.patterns, prediction: d.prediction,
          pattern_count: d.patterns.length,
          top_pattern: d.patterns[0]?.name || null,
          tech_score: d.tech_summary?.score || 0,
        };
      })
    );
    const data = results.map((r, i) => r.status === 'fulfilled' ? r.value : { symbol: symbols[i], error: r.reason?.message });
    data.sort((a, b) => (b.pattern_count || 0) - (a.pattern_count || 0));

    renderScannerResults(data, tf);
    if (status) status.textContent = 'Concluído — ' + data.filter(x=>x.pattern_count>0).length + ' padrões encontrados';
  } catch(e) {
    showToast('❌ Erro no scanner: ' + e.message, true);
    if (empty) { empty.style.display = 'block'; empty.textContent = '❌ ' + e.message; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Escanear'; }
  }
}

function renderScannerResults(data, tf) {
  const grid  = document.getElementById('sc-grid');
  const empty = document.getElementById('sc-empty');
  if (!data || !data.length) {
    if (empty) { empty.style.display = 'block'; empty.textContent = 'Nenhum resultado retornado.'; }
    return;
  }

  if (grid)  grid.style.display  = 'block';
  if (empty) empty.style.display = 'none';

  // Summary cards
  const withPatterns  = data.filter(x => x.pattern_count > 0);
  const bullish       = data.filter(x => x.prediction?.direction === 'up');
  const bearish       = data.filter(x => x.prediction?.direction === 'down');
  const highConf      = data.filter(x => (x.prediction?.confidence || 0) >= 0.7);
  const sumEl = document.getElementById('sc-summary');
  if (sumEl) {
    sumEl.innerHTML = [
      { label:'Pares escaneados', val: data.length, cls: '' },
      { label:'Com padrões', val: withPatterns.length, cls: 'gold' },
      { label:'Sinal de Alta', val: bullish.length,  cls: 'green' },
      { label:'Sinal de Baixa', val: bearish.length, cls: 'red' },
    ].map(m => '<div class="metric"><label>' + m.label + '</label><div class="val ' + m.cls + '" style="font-size:20px">' + m.val + '</div></div>').join('');
  }

  // Table
  const tbody = document.getElementById('sc-table');
  if (!tbody) return;
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  data.forEach((item, i) => {
    if (item.error) return;
    const up      = (item.change_pct || 0) >= 0;
    const dir     = item.prediction?.direction || 'neutral';
    const conf    = ((item.prediction?.confidence || 0) * 100).toFixed(0);
    const tgt     = item.prediction?.target_pct || 0;
    const sigColor= dir === 'up' ? 'var(--green)' : dir === 'down' ? 'var(--red)' : 'var(--t3)';
    const sigLabel= dir === 'up' ? '🟢 ALTA' : dir === 'down' ? '🔴 BAIXA' : '⚪ NEUTRO';
    const p       = PAIRS.find(x => x.sym === item.symbol);

    const tr = document.createElement('tr');
    if (item.pattern_count > 0) tr.style.background = dir==='up' ? 'rgba(63,185,80,0.04)' : dir==='down' ? 'rgba(248,81,73,0.04)' : '';
    tr.style.cursor = 'pointer';
    tr.onclick = () => selectPairFromDash(item.symbol);
    tr.innerHTML =
      '<td class="muted">' + (i+1) + '</td>' +
      '<td><span style="font-weight:600">' + (p ? p.base : item.symbol.replace('USDT','')) + '</span><span style="color:var(--t3)">/USDT</span></td>' +
      '<td style="font-family:var(--mono)">' + fmtUSD(item.price || 0) + '</td>' +
      '<td style="color:' + (up?'var(--green)':'var(--red)') + ';font-family:var(--mono)">' + (up?'+':'') + (item.change_pct||0).toFixed(2) + '%</td>' +
      '<td><span class="badge ' + (item.trend==='up'?'badge-green':item.trend==='down'?'badge-red':'badge-gray') + '">' + (item.trend||'—') + '</span></td>' +
      '<td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis">' + (item.top_pattern || (item.pattern_count===0?'<span style="color:var(--t3)">Nenhum</span>':'—')) + '</td>' +
      '<td><span style="font-weight:600;color:' + sigColor + '">' + sigLabel + '</span></td>' +
      '<td><div style="display:flex;align-items:center;gap:6px"><div style="flex:1;background:var(--bg3);border-radius:2px;height:4px;overflow:hidden"><div style="height:100%;background:' + sigColor + ';width:' + conf + '%"></div></div><span style="font-family:var(--mono);font-size:11px">' + conf + '%</span></div></td>' +
      '<td style="font-family:var(--mono);color:' + (tgt>0?'var(--green)':tgt<0?'var(--red)':'var(--t3)') + '">' + (tgt?((tgt>0?'+':'')+tgt+'%'):'—') + '</td>' +
      '<td><button class="btn btn-outline" style="font-size:10px;padding:3px 8px" onclick="event.stopPropagation();selectPairFromDash(\'' + item.symbol + '\')">Ver</button></td>';
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERFORMANCE REPORT — Export
// ─────────────────────────────────────────────────────────────────────────────
async function exportReport(format = 'csv') {
  try {
    const r = await fetch('/api/report/json', { headers: auth.headers() });
    const data = await r.json();
    if (data.error) { showToast('❌ ' + data.error, true); return; }
    const s = data.summary || {};
    const trades = data.trades || [];
    const today  = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      // UTF-8 BOM so Excel opens correctly with accents
      const BOM  = '\uFEFF';
      const rows = [['Par','Direção','Entrada','Saída','Tamanho','Alavancagem','Resultado','PnL (USDT)','PnL (%)','Motivo','Data']];
      trades.forEach(t => rows.push([
        t.pair||'', t.direction||'', t.entry||'', t.exit||'',
        t.size||'', t.leverage||'1x', t.result||'',
        t.pnl||'0', t.pnl_pct||'0',
        '"'+(t.reason||'')+'"', t.createdAt||''
      ]));
      const csv  = BOM + rows.map(r => r.join(',')).join('\n');
      downloadBlob(csv, 'text/csv', 'cryptoedge-trades-' + today + '.csv');
      showToast('✅ CSV exportado! Abra no Excel.');

    } else if (format === 'excel') {
      // Build XLSX manually (simple format)
      loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', () => {
        const wb = XLSX.utils.book_new();
        // Summary sheet
        const sumData = [
          ['CryptoEdge Pro — Relatório de Performance'],
          ['Gerado em', new Date().toLocaleString('pt-BR')],
          [],
          ['RESUMO'],
          ['Total de Trades', s.total || 0],
          ['Wins', s.wins || 0],
          ['Losses', s.losses || 0],
          ['Win Rate', (s.winRate || '0') + '%'],
          ['PnL Total (USDT)', parseFloat(s.totalPnl || 0)],
          ['PnL Médio por Trade', parseFloat(s.avgPnl || 0)],
        ];
        const ws1 = XLSX.utils.aoa_to_sheet(sumData);
        ws1['!cols'] = [{wch:30},{wch:20}];
        XLSX.utils.book_append_sheet(wb, ws1, 'Resumo');
        // Trades sheet
        const header = ['Par','Direção','Entrada','Saída','Tamanho','Alavancagem','Resultado','PnL','PnL%','Motivo','Data'];
        const rows2  = trades.map(t => [
          t.pair||'', t.direction||'',
          parseFloat(t.entry||0), parseFloat(t.exit||0),
          parseFloat(t.size||0), t.leverage||'1x',
          (t.result||'').toUpperCase(),
          parseFloat(t.pnl||0), parseFloat(t.pnl_pct||0),
          t.reason||'', t.createdAt||''
        ]);
        const ws2 = XLSX.utils.aoa_to_sheet([header, ...rows2]);
        ws2['!cols'] = [{wch:14},{wch:8},{wch:12},{wch:12},{wch:10},{wch:10},{wch:8},{wch:10},{wch:8},{wch:30},{wch:18}];
        XLSX.utils.book_append_sheet(wb, ws2, 'Trades');
        XLSX.writeFile(wb, 'cryptoedge-report-' + today + '.xlsx');
        showToast('✅ Excel exportado com ' + trades.length + ' trades!');
      });

    } else if (format === 'pdf') {
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const gold = [240, 185, 11];
        const dark = [13, 17, 23];
        const W = doc.internal.pageSize.getWidth();

        // Header bar
        doc.setFillColor(...dark); doc.rect(0, 0, W, 22, 'F');
        doc.setFillColor(...gold); doc.rect(0, 0, 3, 22, 'F');
        doc.setTextColor(...gold); doc.setFontSize(16); doc.setFont('helvetica','bold');
        doc.text('CryptoEdge Pro', 10, 14);
        doc.setTextColor(180,180,180); doc.setFontSize(9); doc.setFont('helvetica','normal');
        doc.text('Relatório de Performance — ' + new Date().toLocaleDateString('pt-BR'), 10, 19);
        doc.text('Gerado: ' + new Date().toLocaleString('pt-BR'), W - 10, 14, {align:'right'});

        // Summary cards
        const cards = [
          { label:'Total de Trades', val: s.total || 0,  color:[88,166,255] },
          { label:'Win Rate',        val: (s.winRate||'0')+'%', color:[63,185,80] },
          { label:'PnL Total',       val: '$'+(parseFloat(s.totalPnl||0)>=0?'+':'')+parseFloat(s.totalPnl||0).toFixed(2), color: parseFloat(s.totalPnl||0)>=0?[63,185,80]:[248,81,73] },
          { label:'PnL Médio',       val: '$'+(parseFloat(s.avgPnl||0)>=0?'+':'')+parseFloat(s.avgPnl||0).toFixed(2), color:[240,185,11] },
          { label:'Wins',            val: s.wins||0,  color:[63,185,80] },
          { label:'Losses',          val: s.losses||0,color:[248,81,73] },
        ];
        cards.forEach((c, i) => {
          const x = 10 + (i % 3) * 87; const y = 28 + Math.floor(i/3) * 22;
          doc.setFillColor(30,36,46); doc.roundedRect(x, y, 83, 18, 2, 2, 'F');
          doc.setTextColor(150,160,175); doc.setFontSize(7); doc.text(c.label.toUpperCase(), x+4, y+6);
          doc.setTextColor(...c.color); doc.setFontSize(13); doc.setFont('helvetica','bold');
          doc.text(String(c.val), x+4, y+14);
          doc.setFont('helvetica','normal');
        });

        // Table
        let y = 75;
        const cols = ['Par','Dir.','Entrada','Saída','Tam.','Alav.','Result.','PnL','Data'];
        const cw   = [22,10,20,20,16,12,14,18,28];
        doc.setFillColor(30,36,46); doc.rect(10, y-5, W-20, 8, 'F');
        doc.setTextColor(120,130,145); doc.setFontSize(7);
        let cx = 10;
        cols.forEach((c,i) => { doc.text(c, cx+1, y); cx += cw[i]; });
        y += 5;
        doc.setFontSize(7);
        trades.slice(0,30).forEach((t, idx) => {
          if (y > 185) { doc.addPage(); y = 20; }
          if (idx % 2 === 0) { doc.setFillColor(18,22,30); doc.rect(10, y-4, W-20, 7, 'F'); }
          const pnl = parseFloat(t.pnl || 0);
          cx = 10;
          const row = [
            (t.pair||'—').replace('/USDT',''),
            t.direction==='Long'?'L':'S',
            t.entry ? '$'+parseFloat(t.entry).toFixed(2) : '—',
            t.exit  ? '$'+parseFloat(t.exit).toFixed(2)  : '—',
            t.size  ? '$'+parseFloat(t.size).toFixed(0)  : '—',
            t.leverage||'1x',
            (t.result||'—').toUpperCase().slice(0,3),
            (pnl>=0?'+':'') + '$'+pnl.toFixed(2),
            (t.createdAt||'').split(',')[0] || '—',
          ];
          row.forEach((val, i) => {
            let col = [200,210,220];
            if (i===6) col = t.result==='win'?[63,185,80]:[248,81,73];
            if (i===7) col = pnl>=0?[63,185,80]:[248,81,73];
            doc.setTextColor(...col);
            doc.text(String(val).slice(0,18), cx+1, y);
            cx += cw[i];
          });
          y += 7;
        });
        if (trades.length > 30) {
          doc.setTextColor(120,130,145); doc.setFontSize(7);
          doc.text('... e mais ' + (trades.length-30) + ' trades. Exporte em Excel para ver todos.', 10, y+5);
        }
        doc.save('cryptoedge-report-' + today + '.pdf');
        showToast('✅ PDF exportado!');
      });
    } else if (format === 'json') {
      downloadBlob(JSON.stringify(data, null, 2), 'application/json', 'cryptoedge-report-' + today + '.json');
      showToast('✅ JSON exportado!');
    }
  } catch(e) { showToast('❌ Erro ao exportar: ' + e.message, true); }
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function loadScript(src, cb) {
  const existing = document.querySelector('script[src="' + src + '"]');
  if (existing) { cb(); return; }
  const s = document.createElement('script');
  s.src = src;
  s.onload = cb;
  s.onerror = () => showToast('❌ Falha ao carregar biblioteca de exportação', true);
  document.head.appendChild(s);
}




// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS ENGINE — runs entirely in browser (calls Binance API directly)
// ─────────────────────────────────────────────────────────────────────────────
const _ema = (v,p) => { let e=v[0]; const k=2/(p+1); for(let i=1;i<v.length;i++) e=v[i]*k+e*(1-k); return e; };
const _sma = (v,p) => v.slice(-p).reduce((a,b)=>a+b,0)/Math.min(p,v.length);
const _rsi = (cl,p=14) => { const v=cl.slice(-(p+1)); if(v.length<2) return 50; const g=[],l=[]; for(let i=1;i<v.length;i++){g.push(Math.max(v[i]-v[i-1],0));l.push(Math.max(v[i-1]-v[i],0));} const ag=g.reduce((a,b)=>a+b,0)/(p||1), al=l.reduce((a,b)=>a+b,0)/(p||1); return al===0?100:100-(100/(1+ag/al)); };
const _macd = (cl,f=12,s=26,sig=9) => { if(cl.length<s+sig) return [0,0,0]; const ef=_ema(cl.slice(-f),f),es=_ema(cl.slice(-s),s),ml=ef-es; const ms=[]; for(let i=cl.length-s;i<cl.length;i++) ms.push(_ema(cl.slice(Math.max(0,i-f),i+1),f)-_ema(cl.slice(Math.max(0,i-s),i+1),s)); return [ml,_ema(ms.slice(-sig),sig),ml-_ema(ms.slice(-sig),sig)]; };
const _atr  = (h,l,c,p=14) => { const trs=[]; for(let i=1;i<=Math.min(p,c.length-1);i++) trs.push(Math.max(h[c.length-i]-l[c.length-i],Math.abs(h[c.length-i]-c[c.length-i-1]),Math.abs(l[c.length-i]-c[c.length-i-1]))); return trs.reduce((a,b)=>a+b,0)/(trs.length||1); };
const _boll = (cl,p=20,m=2) => { const v=cl.slice(-p),mn=v.reduce((a,b)=>a+b,0)/p,sd=Math.sqrt(v.reduce((a,b)=>a+(b-mn)**2,0)/p); return [mn+m*sd,mn,mn-m*sd]; };
const _adx  = (h,l,c,p=14) => { const dm=[],dn=[],tr=[]; for(let i=1;i<c.length;i++){const u=h[i]-h[i-1],d=l[i-1]-l[i];dm.push(u>d&&u>0?u:0);dn.push(d>u&&d>0?d:0);tr.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));} const atrV=tr.slice(-p).reduce((a,b)=>a+b,0)/(p||1)||1,pdi=100*dm.slice(-p).reduce((a,b)=>a+b,0)/(p*atrV),ndi=100*dn.slice(-p).reduce((a,b)=>a+b,0)/(p*atrV); return Math.round(100*Math.abs(pdi-ndi)/((pdi+ndi)||1)*10)/10; };
const _vwap = (h,l,c,v) => { const n=Math.min(20,c.length),tv=c.slice(-n).map((_,i)=>((h[h.length-n+i]+l[l.length-n+i]+c[c.length-n+i])/3)*v[v.length-n+i]),sv=v.slice(-n).reduce((a,b)=>a+b,0); return sv?Math.round(tv.reduce((a,b)=>a+b,0)/sv*100)/100:c.at(-1); };

async function fetchKlines(symbol, tf, limit=200) {
  // Try server proxy first (avoids CORS), fallback to direct Binance
  const proxyUrl  = `/api/binance/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(tf)}&limit=${limit}`;
  const directUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`;
  
  try {
    const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
    if (r.ok) { const d = await r.json(); if (Array.isArray(d) && d.length) return d; }
  } catch {}
  
  // Fallback: direct Binance (works when browser has access)
  const r2 = await fetch(directUrl, { signal: AbortSignal.timeout(15000) });
  if (!r2.ok) throw new Error('Binance indisponível (' + r2.status + ')');
  return r2.json();
}

function runAnalysisEngine(data) {
  const opens=data.map(k=>parseFloat(k[1])),highs=data.map(k=>parseFloat(k[2])),lows=data.map(k=>parseFloat(k[3])),closes=data.map(k=>parseFloat(k[4])),volumes=data.map(k=>parseFloat(k[5]));
  const cur=closes.at(-1),prev=closes.at(-2)||cur;

  const rsiV=_rsi(closes),rsi9=_rsi(closes,9),[ml,sl,mh]=_macd(closes),atrV=_atr(highs,lows,closes),[buB,bbM,bbL]=_boll(closes),adxV=_adx(highs,lows,closes),vwapV=_vwap(highs,lows,closes,volumes);

  const signals=[];
  const sig=(name,val,buy,sell,vs='')=>signals.push([buy?'BUY':sell?'SELL':'NEUTRAL',name,vs||String(Math.round(val*100)/100)]);
  sig('RSI(14)',rsiV,rsiV<30,rsiV>70); sig('RSI(9)',rsi9,rsi9<30,rsi9>70);
  sig('MACD',mh,mh>0&&ml>0,mh<0&&ml<0);
  sig('BB Upper',buB,false,cur>=buB,'$'+buB.toFixed(2)); sig('BB Lower',bbL,cur<=bbL,false,'$'+bbL.toFixed(2)); sig('BB Mid',bbM,cur>bbM,cur<bbM,'$'+bbM.toFixed(2));
  sig('ADX',adxV,adxV>25&&cur>closes.at(-5),adxV>25&&cur<closes.at(-5));
  sig('VWAP',vwapV,cur>vwapV,cur<vwapV,'$'+vwapV.toFixed(2));
  [9,21,50,100,200].forEach(p=>{const s=_sma(closes,p);sig('SMA('+p+')',s,cur>s,cur<s,'$'+s.toFixed(2));});
  [9,21,50,100,200].forEach(p=>{const e=_ema(closes.slice(-p),p);sig('EMA('+p+')',e,cur>e,cur<e,'$'+e.toFixed(2));});

  const buys=signals.filter(s=>s[0]==='BUY').length,sells=signals.filter(s=>s[0]==='SELL').length,neuts=signals.filter(s=>s[0]==='NEUTRAL').length;
  const score=Math.round((buys-sells)/signals.length*100);
  const summary=score>40?'Forte Alta':score>15?'Alta':score<-40?'Forte Baixa':score<-15?'Baixa':'Neutro';
  const color=score>15?'green':score<-15?'red':'neutral';

  // Order Blocks
  const obs=[];
  for(let i=2;i<data.length-1;i++){
    const [o2,h2,l2,c2]=[opens[i],highs[i],lows[i],closes[i]],[o3,h3,l3,c3]=[opens[i+1],highs[i+1],lows[i+1],closes[i+1]];
    const b=Math.abs(c2-o2),b2=Math.abs(c3-o3);
    if(c2>o2&&c3<o3&&b2>b*1.5){const mp=Math.abs(c3-o3)/o3*100;obs.push({type:'bearish',price:Math.round((h2+l2)/2*100)/100,high:h2,low:l2,strength:Math.round(mp*100)/100,label:'Bearish OB'});}
    if(c2<o2&&c3>o3&&b2>b*1.5){const mp=Math.abs(c3-o3)/o3*100;obs.push({type:'bullish',price:Math.round((h2+l2)/2*100)/100,high:h2,low:l2,strength:Math.round(mp*100)/100,label:'Bullish OB'});}
  }

  // FVG
  const fvgs=[];
  for(let i=1;i<data.length-1;i++){
    if(lows[i+1]>highs[i-1]){const s=(lows[i+1]-highs[i-1])/highs[i-1]*100;if(s>0.1)fvgs.push({type:'bullish',top:Math.round(lows[i+1]*100)/100,bottom:Math.round(highs[i-1]*100)/100,size_pct:Math.round(s*100)/100,label:'Bullish FVG'});}
    else if(highs[i+1]<lows[i-1]){const s=(lows[i-1]-highs[i+1])/lows[i-1]*100;if(s>0.1)fvgs.push({type:'bearish',top:Math.round(lows[i-1]*100)/100,bottom:Math.round(highs[i+1]*100)/100,size_pct:Math.round(s*100)/100,label:'Bearish FVG'});}
  }

  // SMC
  const hh=highs.at(-1)>highs.at(-7),hl=lows.at(-1)>lows.at(-7),lh=highs.at(-1)<highs.at(-7),ll=lows.at(-1)<lows.at(-7);
  const avol=volumes.slice(-20).reduce((a,b)=>a+b,0)/20||1,volR=Math.round(volumes.at(-1)/avol*100)/100;
  const smc={structure:hh&&hl?'Bullish (HH/HL)':lh&&ll?'Bearish (LH/LL)':'Ranging/Consolidação',bias:hh&&hl?'ALTISTA':lh&&ll?'BAIXISTA':'NEUTRO',vol_ratio:volR,hh,hl,lh,ll,high_vol:volR>1.3};

  // Candle patterns
  const patterns=[];
  const last=closes.length-1;
  const avgBody=Math.abs(closes.at(-1)-opens.at(-1));
  const body=Math.abs(closes[last]-opens[last]),lw=Math.min(closes[last],opens[last])-lows[last],uw=highs[last]-Math.max(closes[last],opens[last]);
  if(body>avgBody*0.3&&lw>body*2&&uw<body*0.5) patterns.push({name:'Hammer',signal:'BUY',confidence:0.72,target:1.8});
  if(body>avgBody*0.3&&uw>body*2&&lw<body*0.5) patterns.push({name:'Shooting Star',signal:'SELL',confidence:0.72,target:-1.8});
  if(body>avgBody*2&&(lw+uw)/body<0.15) patterns.push({name:closes[last]>opens[last]?'Marubozu Altista':'Marubozu Baixista',signal:closes[last]>opens[last]?'STRONG_BUY':'STRONG_SELL',confidence:0.82,target:closes[last]>opens[last]?2.5:-2.5});
  if(last>0&&opens[last-1]>closes[last-1]&&closes[last]>opens[last]&&closes[last]>opens[last-1]&&opens[last]<closes[last-1]&&body>Math.abs(closes[last-1]-opens[last-1])) patterns.push({name:'Engolfamento Altista',signal:'STRONG_BUY',confidence:0.80,target:2.5});
  if(last>0&&opens[last-1]<closes[last-1]&&closes[last]<opens[last]&&opens[last]>closes[last-1]&&closes[last]<opens[last-1]&&body>Math.abs(closes[last-1]-opens[last-1])) patterns.push({name:'Engolfamento Baixista',signal:'STRONG_SELL',confidence:0.80,target:-2.5});
  if(Math.abs(body)<avgBody*0.3&&(lw+uw)>body*3) patterns.push({name:'Doji',signal:'NEUTRAL',confidence:0.65,target:0});

  const pred={direction:score>15?'up':score<-15?'down':'neutral',confidence:Math.min(Math.abs(score)/100,1),target_pct:score>15?2.0:score<-15?-2.0:0};

  return {price:cur,change_pct:Math.round((cur-prev)/prev*10000)/100,
    tech_summary:{summary,color,score,buys,sells,neutrals:neuts,total:signals.length,signals:signals.slice(0,20)},
    order_blocks:obs.sort((a,b)=>b.strength-a.strength).slice(0,6),
    fvg:fvgs.slice(-4), smc, patterns, prediction:pred,
    indicators:{rsi:Math.round(rsiV*10)/10,macd_hist:Math.round(mh*10000)/10000,adx:adxV,atr:Math.round(atrV*100)/100,bb:[buB,bbM,bbL],vwap:vwapV}};
}



// ─── Generate Trading Suggestion based on all analysis data ──────────────────
function generateTradingSuggestion(data) {
  const ts   = data.tech_summary || {};
  const smc  = data.smc          || {};
  const ind  = data.indicators   || {};
  const obs  = data.order_blocks || [];
  const fvgs = data.fvg          || [];
  const pats = data.patterns     || [];
  const score = ts.score || 0;
  const rsi   = ind.rsi  || 50;
  const adx   = ind.adx  || 0;
  const macdH = ind.macd_hist || 0;
  const price = data.price || 0;
  const vwap  = ind.vwap  || price;
  const bb    = ind.bb    || [price*1.02, price, price*0.98];

  // ── Score each factor ──────────────────────────────────────────────────────
  let bullPoints = 0, bearPoints = 0;
  const reasons = { bull: [], bear: [], neutral: [] };

  // 1. Tech gauge
  if (score > 40)       { bullPoints += 3; reasons.bull.push('Gauge Forte Alta (score '+score+')'); }
  else if (score > 15)  { bullPoints += 2; reasons.bull.push('Gauge Alta (score '+score+')'); }
  else if (score < -40) { bearPoints += 3; reasons.bear.push('Gauge Forte Baixa (score '+score+')'); }
  else if (score < -15) { bearPoints += 2; reasons.bear.push('Gauge Baixa (score '+score+')'); }
  else                  { reasons.neutral.push('Gauge neutro — mercado indeciso'); }

  // 2. SMC structure
  if (smc.bias === 'ALTISTA')  { bullPoints += 2; reasons.bull.push('SMC: estrutura HH/HL altista'); }
  if (smc.bias === 'BAIXISTA') { bearPoints += 2; reasons.bear.push('SMC: estrutura LH/LL baixista'); }
  if (smc.high_vol)            { if(bullPoints>bearPoints) bullPoints+=1; else bearPoints+=1; reasons.neutral.push('Volume acima da média ('+smc.vol_ratio+'x) — confirmação de movimento'); }

  // 3. RSI
  if (rsi < 30)        { bullPoints += 2; reasons.bull.push('RSI sobrevenda ('+rsi.toFixed(1)+') — reversão possível'); }
  else if (rsi > 70)   { bearPoints += 2; reasons.bear.push('RSI sobrecompra ('+rsi.toFixed(1)+') — atenção para reversão'); }
  else if (rsi > 50 && rsi < 65) { bullPoints += 1; reasons.bull.push('RSI em zona saudável ('+rsi.toFixed(1)+')'); }
  else if (rsi < 50 && rsi > 35) { bearPoints += 1; reasons.bear.push('RSI abaixo de 50 ('+rsi.toFixed(1)+')'); }

  // 4. MACD
  if (macdH > 0)  { bullPoints += 1; reasons.bull.push('MACD histograma positivo — momentum de alta'); }
  if (macdH < 0)  { bearPoints += 1; reasons.bear.push('MACD histograma negativo — momentum de baixa'); }

  // 5. VWAP
  if (price > vwap) { bullPoints += 1; reasons.bull.push('Preço acima do VWAP ('+fmtUSD(vwap)+')'); }
  else              { bearPoints += 1; reasons.bear.push('Preço abaixo do VWAP ('+fmtUSD(vwap)+')'); }

  // 6. ADX
  if (adx > 25) reasons.neutral.push('ADX '+adx+' — tendência forte ativa');

  // 7. Bollinger Bands
  const bbPct = bb[0] > bb[2] ? (price - bb[2]) / (bb[0] - bb[2]) * 100 : 50;
  if (bbPct < 15)      { bullPoints += 1; reasons.bull.push('Preço próximo à Banda Inferior (suporte)'); }
  else if (bbPct > 85) { bearPoints += 1; reasons.bear.push('Preço próximo à Banda Superior (resistência)'); }

  // 8. Order Blocks
  const nearBull = obs.filter(o => o.type === 'bullish' && Math.abs(price - o.price) / price < 0.015);
  const nearBear = obs.filter(o => o.type === 'bearish' && Math.abs(price - o.price) / price < 0.015);
  if (nearBull.length) { bullPoints += 2; reasons.bull.push('Próximo a Bullish Order Block ($'+nearBull[0].price.toLocaleString()+')'); }
  if (nearBear.length) { bearPoints += 2; reasons.bear.push('Próximo a Bearish Order Block ($'+nearBear[0].price.toLocaleString()+')'); }

  // 9. Patterns
  const strongBuy  = pats.filter(p => p.signal === 'STRONG_BUY'  || p.signal === 'BUY');
  const strongSell = pats.filter(p => p.signal === 'STRONG_SELL' || p.signal === 'SELL');
  if (strongBuy.length)  { bullPoints += 2; reasons.bull.push('Padrão altista: ' + strongBuy[0].name); }
  if (strongSell.length) { bearPoints += 2; reasons.bear.push('Padrão baixista: ' + strongSell[0].name); }

  // ── Decision ───────────────────────────────────────────────────────────────
  const total  = bullPoints + bearPoints || 1;
  const conf   = Math.round(Math.max(bullPoints, bearPoints) / total * 100);
  const diff   = bullPoints - bearPoints;

  let action, actionColor, actionIcon, risk;
  if      (diff >= 6)  { action='FORTE COMPRA';    actionColor='var(--green)'; actionIcon='🚀'; risk='Moderado'; }
  else if (diff >= 3)  { action='COMPRA';           actionColor='var(--green)'; actionIcon='📈'; risk='Moderado'; }
  else if (diff >= 1)  { action='VIÉS COMPRADOR';   actionColor='#7ec8a0';      actionIcon='↗';  risk='Alto'; }
  else if (diff <= -6) { action='FORTE VENDA';      actionColor='var(--red)';   actionIcon='📉'; risk='Moderado'; }
  else if (diff <= -3) { action='VENDA';             actionColor='var(--red)';   actionIcon='🔻'; risk='Moderado'; }
  else if (diff <= -1) { action='VIÉS VENDEDOR';    actionColor='#e08080';      actionIcon='↘';  risk='Alto'; }
  else                 { action='AGUARDAR';          actionColor='var(--t2)';    actionIcon='⏸';  risk='Baixo — evite entrar agora'; }

  // ── Price targets ──────────────────────────────────────────────────────────
  const atrV    = data.indicators?.atr || price * 0.01;
  const isBull  = diff > 0;
  const slPrice = isBull ? price - atrV * 1.5 : price + atrV * 1.5;
  const tp1     = isBull ? price + atrV * 2    : price - atrV * 2;
  const tp2     = isBull ? price + atrV * 3.5  : price - atrV * 3.5;
  const tp3     = isBull ? price + atrV * 5    : price - atrV * 5;
  const rrRatio = atrV > 0 ? Math.abs(tp1 - price) / Math.abs(slPrice - price) : 2;

  return { action, actionColor, actionIcon, conf, risk, bullPoints, bearPoints,
    reasons, slPrice, tp1, tp2, tp3, rrRatio: Math.round(rrRatio*10)/10,
    direction: diff > 0 ? 'long' : diff < 0 ? 'short' : 'flat' };
}


// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS AI ↔ BOT INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

function buildBotConfigFromAnalysis(data, sg) {
  const sym      = data.symbol    || 'BTCUSDT';
  const tf       = data.timeframe || '1h';
  const score    = data.tech_summary?.score || 0;
  const rsi      = data.indicators?.rsi    || 50;
  const macdH    = data.indicators?.macd_hist || 0;
  const smc      = data.smc || {};
  const atr      = data.indicators?.atr || 0;

  // Choose strategy based on analysis
  let strategy = 'pattern';
  if (Math.abs(score) > 40 && Math.abs(macdH) > 0) strategy = 'trend';
  else if (rsi < 30 || rsi > 70) strategy = 'scalping';
  else if (data.patterns?.length) strategy = 'pattern';
  else strategy = 'macd';

  // Map timeframe for bot
  const tfMap = { '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m','1h':'1h','4h':'4h','1d':'1d' };
  const botTf = tfMap[tf] || '15m';

  return {
    BOT_SYMBOL:       sym,
    BOT_STRATEGY:     strategy,
    BOT_TIMEFRAME:    botTf,
    BOT_CAPITAL:      '300',
    BOT_STOP_LOSS:    '0',
    BOT_TESTNET:      'true',
    BOT_MIN_CONF:     score > 30 ? '0.65' : score > 15 ? '0.70' : '0.75',
    BOT_TP_RR:        sg.rrRatio >= 2 ? String(sg.rrRatio) : '2.0',
    BOT_SL_ATR:       '1.5',
    BOT_REQUIRE_VOL:  smc.high_vol ? 'true' : 'false',
    // Analysis metadata
    _ANALYSIS_SCORE:  String(score),
    _ANALYSIS_ACTION: sg.action,
    _ANALYSIS_CONF:   String(sg.conf) + '%',
  };
}

async function sendAnalysisToBotConfig(data, sg) {
  const cfg    = buildBotConfigFromAnalysis(data, sg);
  const clean  = Object.fromEntries(Object.entries(cfg).filter(([k])=>!k.startsWith('_')));
  const sym    = data.symbol || 'BTCUSDT';
  const p      = PAIRS.find(x => x.sym === sym);
  const pairName = p ? p.base + '/USDT' : sym;

  const ok = await showConfirm(
    '🤖 Enviar para o Bot',
    'Configurar o bot com os dados da análise de ' + pairName + '?\n\n' +
    '• Par: ' + sym + '\n' +
    '• Estratégia: ' + clean.BOT_STRATEGY.toUpperCase() + '\n' +
    '• Timeframe: ' + clean.BOT_TIMEFRAME + '\n' +
    '• Confiança mín.: ' + clean.BOT_MIN_CONF + '\n' +
    '• R:R: 1:' + clean.BOT_TP_RR + '\n\n' +
    '⚠️ O bot estará em TESTNET (simulação). Mude para real no Bot Control.',
    'Configurar Bot',
    'Cancelar'
  );
  if (!ok) return;

  try {
    // Save config to server
    const r = await fetch('/api/bot/config', {
      method: 'POST',
      headers: auth.headers(),
      body: JSON.stringify({ config: clean })
    });
    const d = await r.json();

    if (d.ok) {
      showToast('✅ Bot configurado com análise de ' + pairName + '!');

      // Pre-fill Bot Control form
      const setV = (id, val) => { const e = document.getElementById(id); if(e) e.value = val; };
      setV('bc-symbol',    clean.BOT_SYMBOL);
      setV('bc-strategy',  clean.BOT_STRATEGY);
      setV('bc-timeframe', clean.BOT_TIMEFRAME);
      setV('bc-pat-conf',  clean.BOT_MIN_CONF);
      setV('bc-pat-rr',    clean.BOT_TP_RR);
      bcStrategyChange();

      // Ask if wants to navigate to Bot Control
      setTimeout(async () => {
        const goBot = await showConfirm(
          '✅ Config salva!',
          'Quer ir para o Bot Control para revisar e iniciar o bot?',
          'Ir para Bot Control',
          'Ficar aqui'
        );
        if (goBot) {
          document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
          document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
          const nav = document.querySelector('[data-panel="botcontrol"]');
          const pan = document.getElementById('panel-botcontrol');
          if (nav) nav.classList.add('active');
          if (pan) pan.classList.add('active');
          loadBotStatus(); loadBotLogs(); loadBotConfig();
        }
      }, 500);
    } else {
      showToast('❌ Erro ao salvar config: ' + (d.error || 'falhou'), true);
    }
  } catch(e) {
    showToast('❌ Erro: ' + e.message, true);
  }
}

// Auto-Analysis: run analysis on current pair and auto-configure bot
async function autoAnalyzeAndConfigBot(sym, tf) {
  if (!sym) sym = state.activePair || 'BTCUSDT';
  if (!tf)  tf  = '1h';
  showToast('⏳ Analisando ' + sym + ' para configurar bot...', false);

  try {
    const klines = await fetchKlines(sym, tf, 200);
    const data   = runAnalysisEngine(klines);
    data.symbol    = sym;
    data.timeframe = tf;
    const sg = generateTradingSuggestion(data);

    if (sg.direction === 'flat' || sg.conf < 55) {
      showToast('⚠ Análise inconclusiva (' + sg.action + ', ' + sg.conf + '% conf). Bot não configurado.', true);
      return;
    }

    await sendAnalysisToBotConfig(data, sg);
  } catch(e) {
    showToast('❌ Auto-análise falhou: ' + e.message, true);
  }
}



async function openAutoAnalysis() {
  const sym = document.getElementById('bc-symbol')?.value || 'BTCUSDT';
  const tf  = document.getElementById('bc-timeframe')?.value || '15m';
  const p   = PAIRS.find(x => x.sym === sym);
  const pairName = p ? p.base + '/USDT' : sym;

  const ok = await showConfirm(
    '⚡ Auto-Análise',
    'Rodar Analysis AI para ' + pairName + ' no timeframe ' + tf + ' e configurar automaticamente o bot com os parâmetros ideais?',
    'Analisar e Configurar',
    'Cancelar'
  );
  if (!ok) return;

  const btn = document.querySelector('[onclick="openAutoAnalysis()"]');
  if (btn) { btn.textContent = '⏳ Analisando...'; btn.disabled = true; }

  try {
    const klines = await fetchKlines(sym, tf, 200);
    const data   = runAnalysisEngine(klines);
    data.symbol    = sym;
    data.timeframe = tf;
    const sg = generateTradingSuggestion(data);

    const lastEl = document.getElementById('bc-last-analysis');
    if (lastEl) {
      const color = sg.direction === 'long' ? 'var(--green)' : sg.direction === 'short' ? 'var(--red)' : 'var(--t3)';
      lastEl.style.color = color;
      lastEl.textContent = sg.action + ' (' + sg.conf + '%) — ' + new Date().toLocaleTimeString('pt-BR');
    }

    if (sg.direction === 'flat' || sg.conf < 50) {
      showToast('⚠ Sinal inconclusivo: ' + sg.action + ' (' + sg.conf + '%). Configure manualmente.', true);
      return;
    }

    // Auto-fill form with analysis results
    const cfg = buildBotConfigFromAnalysis(data, sg);
    const setV = (id, val) => { const e = document.getElementById(id); if(e) e.value = val; };
    setV('bc-strategy',  cfg.BOT_STRATEGY);
    setV('bc-pat-conf',  cfg.BOT_MIN_CONF);
    setV('bc-pat-rr',    cfg.BOT_TP_RR);
    setV('bc-pat-vol',   cfg.BOT_REQUIRE_VOL);
    bcStrategyChange();

    showToast('✅ Bot configurado com análise: ' + sg.action + ' (' + sg.conf + '% confiança)');

    // Show analysis summary in a modal
    await showConfirm(
      sg.actionIcon + ' Análise Concluída — ' + pairName,
      'Sinal: ' + sg.action + ' (confiança ' + sg.conf + '%)\n\n' +
      'Estratégia selecionada: ' + cfg.BOT_STRATEGY.toUpperCase() + '\n' +
      'Confluências: ' + sg.bullPoints + ' alta vs ' + sg.bearPoints + ' baixa\n\n' +
      'Motivos principais:\n' +
      sg.reasons.bull.slice(0,3).map(r => '✅ ' + r).join('\n') + '\n' +
      sg.reasons.bear.slice(0,2).map(r => '🔴 ' + r).join('\n') + '\n\n' +
      'A configuração foi aplicada ao formulário. Revise e clique em Salvar.',
      'Entendido',
      ''
    );
  } catch(e) {
    showToast('❌ Análise falhou: ' + e.message, true);
  } finally {
    if (btn) { btn.textContent = '⚡ Auto-Analisar e Configurar'; btn.disabled = false; }
  }
}
// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS AI ENGINE
// ─────────────────────────────────────────────────────────────────────────────
function buildAnalysisSymbolSelector() {
  const sel = document.getElementById('ai-symbol');
  if (!sel) return;
  sel.innerHTML = PAIRS.filter((p,i,a)=>a.findIndex(x=>x.sym===p.sym)===i)
    .map(p => '<option value="' + p.sym + '">' + p.base + '/USDT</option>').join('');
}

const AI_STEPS = ['data','tech','harmonic','smc','ob','strategy'];
const AI_STEP_LABELS = {
  data:     '🔄 Coletando Dados da Binance...',
  tech:     '📊 Calculando 40+ Indicadores...',
  harmonic: '🔮 Detectando Padrões Harmônicos...',
  smc:      '🧠 Analisando Smart Money...',
  ob:       '📦 Identificando Order Blocks & FVG...',
  strategy: '⚡ Gerando Estratégia Final...',
};

async function runAnalysisAI() {
  const btn    = document.getElementById('ai-run-btn');
  const status = document.getElementById('ai-status');
  const loading= document.getElementById('ai-loading');
  const results= document.getElementById('ai-results');
  const sym    = document.getElementById('ai-symbol')?.value || 'BTCUSDT';
  const tf     = document.getElementById('ai-tf')?.value     || '1h';

  if (btn)     { btn.disabled = true; btn.textContent = '⏳ Analisando...'; }
  if (loading) loading.style.display = 'block';
  if (results) results.style.display = 'none';
  if (status)  status.textContent    = '';

  // Animate steps
  let stepIdx = 0;
  const stepInterval = setInterval(() => {
    document.querySelectorAll('.ai-step-item').forEach((el, i) => {
      el.style.color = i < stepIdx ? 'var(--green)' : i === stepIdx ? 'var(--gold)' : 'var(--t3)';
    });
    const stepEl = document.getElementById('ai-step');
    if (stepEl) stepEl.textContent = AI_STEP_LABELS[AI_STEPS[stepIdx]] || '';
    stepIdx = (stepIdx + 1) % AI_STEPS.length;
  }, 700);

  try {
    // Fetch directly from Binance (browser has access)
    const klines = await fetchKlines(sym, tf, 200);
    const data   = runAnalysisEngine(klines);
    data.symbol    = sym;
    data.timeframe = tf;

    clearInterval(stepInterval);
    document.querySelectorAll('.ai-step-item').forEach(el => el.style.color = 'var(--green)');
    await new Promise(r => setTimeout(r, 300));

    if (loading) loading.style.display = 'none';
    if (results) results.style.display = 'block';
    const p = PAIRS.find(x => x.sym === sym);
    if (status) status.textContent = (p ? p.base : sym.replace('USDT','')) + '/USDT ' + tf + ' — análise concluída ✅';

    renderAnalysisResults(data);
    // Build automatic setup score checklist
    buildSetupScore(data);
    // Realtime chart with markers
    const sym2 = document.getElementById('ai-symbol')?.value || 'BTCUSDT';
    const tf2  = document.getElementById('ai-tf')?.value     || '1h';
    loadAIRealtimeChart(sym2, tf2, data);
    // Save to history
    const sgForSave = generateTradingSuggestion(data);
    saveAnalysisToHistory(data, sgForSave);
  } catch(e) {
    clearInterval(stepInterval);
    if (loading) loading.style.display = 'none';
    showToast('❌ Análise falhou: ' + e.message, true);
    if (status) status.textContent = '❌ ' + e.message.slice(0,80);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Analisar'; }
  }
}

function renderTradingSuggestion(data) {
  const sg    = generateTradingSuggestion(data);
  const wrap  = document.getElementById('ai-suggestion');
  if (!wrap) return;
  const price = data.price || 0;
  const isBull = sg.direction === 'long';
  const isSell = sg.direction === 'short';
  const confBar = Math.min(sg.conf, 100);

  wrap.innerHTML = '';
  wrap.style.display = 'block';

  // Main action card
  const main = document.createElement('div');
  main.style.cssText = 'display:flex;align-items:stretch;gap:12px;margin-bottom:12px;flex-wrap:wrap';

  // Action box
  const actionBox = document.createElement('div');
  actionBox.style.cssText = 'flex:0 0 auto;min-width:200px;background:'+sg.actionColor+'18;border:2px solid '+sg.actionColor+';border-radius:12px;padding:18px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center';
  actionBox.innerHTML =
    '<div style="font-size:32px;margin-bottom:4px">'+sg.actionIcon+'</div>' +
    '<div style="font-size:18px;font-weight:800;color:'+sg.actionColor+';letter-spacing:1px">'+sg.action+'</div>' +
    '<div style="font-size:12px;color:var(--t3);margin-top:4px;font-family:var(--mono)">'+sg.bullPoints+' bull vs '+sg.bearPoints+' bear</div>' +
    '<div style="margin-top:8px;width:100%;background:var(--bg3);border-radius:4px;height:6px;overflow:hidden">' +
      '<div style="height:100%;width:'+confBar+'%;background:'+sg.actionColor+';border-radius:4px;transition:width 0.5s"></div>' +
    '</div>' +
    '<div style="font-size:11px;color:var(--t3);margin-top:4px;font-family:var(--mono)">Confiança: '+confBar+'%</div>';

  // Price targets
  const targetsBox = document.createElement('div');
  targetsBox.style.cssText = 'flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px';
  let tgHtml = '<div style="font-size:12px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">Alvos & Gestão de Risco</div>';
  tgHtml += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px">';

  const rows = [
    { label:'Entrada sugerida', val:fmtUSD(price), color:'var(--gold)', icon:'→' },
    { label:'Stop Loss (1.5×ATR)', val:fmtUSD(sg.slPrice), color:'var(--red)', icon:'🛑' },
    { label:'Alvo 1 (2×ATR) TP1', val:fmtUSD(sg.tp1), color:'var(--green)', icon:'🎯' },
    { label:'Alvo 2 (3.5×ATR) TP2', val:fmtUSD(sg.tp2), color:'var(--green)', icon:'🎯' },
    { label:'Alvo 3 (5×ATR) TP3', val:fmtUSD(sg.tp3), color:'var(--green)', icon:'🚀' },
    { label:'Risco/Retorno', val:'1:'+sg.rrRatio, color: sg.rrRatio>=2?'var(--green)':'var(--gold)', icon:'⚖️' },
  ];
  rows.forEach(r => {
    tgHtml += '<div style="background:var(--bg1);border-radius:8px;padding:10px">' +
      '<div style="font-size:10px;color:var(--t3);text-transform:uppercase;letter-spacing:0.5px">'+r.icon+' '+r.label+'</div>' +
      '<div style="font-family:var(--mono);font-size:15px;font-weight:700;color:'+r.color+';margin-top:3px">'+r.val+'</div>' +
    '</div>';
  });
  tgHtml += '</div>';
  tgHtml += '<div style="margin-top:10px;padding:8px;background:var(--bg1);border-radius:6px;font-size:11px;color:var(--t3)">' +
    '⚠️ <strong style="color:var(--t2)">Risco por operação:</strong> '+sg.risk+' — ' +
    'Mínimo de '+Math.max(sg.bullPoints, sg.bearPoints)+' confluências detectadas. Sempre use Stop Loss.</div>';
  targetsBox.innerHTML = tgHtml;

  // Reasons
  const reasonsBox = document.createElement('div');
  reasonsBox.style.cssText = 'flex:0 0 240px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:16px;overflow-y:auto;max-height:220px';
  let rHtml = '<div style="font-size:12px;font-weight:600;color:var(--t2);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Confluências detectadas</div>';
  sg.reasons.bull.forEach(r => { rHtml += '<div style="font-size:11px;color:var(--green);padding:3px 0;display:flex;gap:6px"><span>✅</span><span>'+r+'</span></div>'; });
  sg.reasons.bear.forEach(r => { rHtml += '<div style="font-size:11px;color:var(--red);padding:3px 0;display:flex;gap:6px"><span>🔴</span><span>'+r+'</span></div>'; });
  sg.reasons.neutral.forEach(r => { rHtml += '<div style="font-size:11px;color:var(--t3);padding:3px 0;display:flex;gap:6px"><span>ℹ️</span><span>'+r+'</span></div>'; });
  reasonsBox.innerHTML = rHtml;

  main.appendChild(actionBox);
  main.appendChild(targetsBox);
  main.appendChild(reasonsBox);
  wrap.appendChild(main);

  // Action buttons row
  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap';

  if (sg.direction !== 'flat') {
    // Send to Bot button
    const sendBtn = document.createElement('button');
    sendBtn.style.cssText = 'flex:1;min-width:160px;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans);border:none;transition:opacity 0.2s;background:var(--gold);color:#000;display:flex;align-items:center;justify-content:center;gap:8px';
    sendBtn.innerHTML = '🤖 Enviar para o Bot';
    sendBtn.title = 'Configura o bot com estes parâmetros automaticamente';
    sendBtn.onclick = () => sendAnalysisToBotConfig(data, sg);
    btns.appendChild(sendBtn);

    // Quick order button
    const orderBtn = document.createElement('button');
    orderBtn.style.cssText = 'flex:1;min-width:160px;padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;font-family:var(--sans);border:2px solid '+(sg.direction==='long'?'var(--green)':'var(--red)')+';background:transparent;color:'+(sg.direction==='long'?'var(--green)':'var(--red)')+';display:flex;align-items:center;justify-content:center;gap:8px';
    orderBtn.innerHTML = sg.direction === 'long' ? '🟢 Abrir Long Agora' : '🔴 Abrir Short Agora';
    orderBtn.onclick = () => {
      // Navigate to dashboard and open order panel with pre-filled values
      document.querySelectorAll('.nav-item').forEach(i=>i.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
      const nav = document.querySelector('[data-panel="dashboard"]');
      const pan = document.getElementById('panel-dashboard');
      if (nav) nav.classList.add('active');
      if (pan) pan.classList.add('active');
      // Pre-fill order form
      const sym = data.symbol || state.activePair || 'BTCUSDT';
      const pairSel = document.getElementById('dash-chart-pair');
      if (pairSel) { pairSel.value = sym; switchChartPair(sym); }
      // Show order panel
      const op = document.getElementById('order-panel');
      if (op) op.style.display = 'block';
      // Fill fields
      setTimeout(() => {
        const ep = document.getElementById('op-entry');
        const sl = document.getElementById('op-sl');
        const tp = document.getElementById('op-tp');
        const sz = document.getElementById('op-size');
        if (ep) ep.value = (data.price || '').toString();
        if (sl) sl.value = '1.5';
        if (tp) tp.value = '3.0';
        if (sz) sz.value = '100';
        updateOrderPreview();
        showToast('✅ Formulário de ordem preenchido com dados da análise!');
      }, 500);
    };
    btns.appendChild(orderBtn);

    // Copy config button
    const copyBtn = document.createElement('button');
    copyBtn.style.cssText = 'padding:10px 16px;border-radius:8px;font-size:13px;cursor:pointer;font-family:var(--sans);border:1px solid var(--border);background:transparent;color:var(--t2)';
    copyBtn.innerHTML = '📋 Copiar Config';
    copyBtn.onclick = () => {
      const config = buildBotConfigFromAnalysis(data, sg);
      const text = Object.entries(config).map(([k,v])=>k+'='+v).join('\n');
      navigator.clipboard.writeText(text).then(() => showToast('✅ Config copiada!'));
    };
    btns.appendChild(copyBtn);
  }
  wrap.appendChild(btns);

  // Disclaimer
  const disc = document.createElement('div');
  disc.style.cssText = 'font-size:11px;color:var(--t3);padding:8px 12px;background:var(--bg2);border-radius:6px;border-left:3px solid var(--border2)';
  disc.innerHTML = '⚠️ <strong>Aviso:</strong> Sugestão indicativa baseada em análise técnica. Não é recomendação de investimento. Sempre use Stop Loss. Nunca arrisque mais de 2% do capital por trade.';
  wrap.appendChild(disc);
}

function renderAnalysisResults(data) {
  const ts = data.tech_summary || {};

  // ── Trading Suggestion ─────────────────────────────────────────────────────
  renderTradingSuggestion(data);

  // ── Gauge ──────────────────────────────────────────────────────────────────
  const score  = ts.score || 0;  // -100 to +100
  const angle  = (score + 100) / 200 * 180 - 90; // -90° to +90°
  const needle = document.getElementById('gauge-needle');
  if (needle) needle.setAttribute('transform', 'rotate(' + angle + ',100,100)');
  const colorMap = { green:'var(--green)', red:'var(--red)', neutral:'var(--t2)' };
  const lbl = document.getElementById('gauge-label');
  const scr = document.getElementById('gauge-score');
  if (lbl) { lbl.textContent = ts.summary || '—'; lbl.style.color = colorMap[ts.color] || 'var(--t2)'; }
  if (scr) scr.textContent = 'Score: ' + (score >= 0 ? '+' : '') + score + ' | ' + ts.total + ' indicadores';
  const setT = (id, v) => { const e = document.getElementById(id); if(e) e.textContent = v; };
  setT('ts-buys',  ts.buys  || 0);
  setT('ts-neuts', ts.neutrals || 0);
  setT('ts-sells', ts.sells || 0);

  // ── Signal list ─────────────────────────────────────────────────────────────
  const sigWrap = document.getElementById('ts-signals');
  if (sigWrap) {
    sigWrap.innerHTML = '';
    (ts.signals || []).forEach(([sig, name, val]) => {
      const color = sig==='BUY'?'var(--green)':sig==='SELL'?'var(--red)':'var(--t3)';
      const icon  = sig==='BUY'?'▲':sig==='SELL'?'▼':'—';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:0.5px solid var(--border);font-size:11px';
      row.innerHTML = '<span style="color:var(--t2)">' + name + '</span>' +
        '<span style="font-family:var(--mono);color:' + color + '">' + icon + ' ' + val + '</span>';
      sigWrap.appendChild(row);
    });
  }

  // ── Harmonics ───────────────────────────────────────────────────────────────
  const harmWrap = document.getElementById('harmonics-list');
  if (harmWrap) {
    harmWrap.innerHTML = '';
    const harms = data.harmonics || [];
    if (!harms.length) {
      harmWrap.innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:12px">Nenhum padrão harmônico detectado</div>';
    } else {
      harms.forEach(h => {
        const color = h.bullish ? 'var(--green)' : 'var(--red)';
        const card  = document.createElement('div');
        card.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px';
        card.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div style="display:flex;align-items:center;gap:8px">' +
              '<span style="font-size:16px">' + (h.bullish?'🦋':'🦅') + '</span>' +
              '<div>' +
                '<div style="font-weight:600;font-size:13px">' + h.name + '</div>' +
                '<div style="font-size:11px;color:' + color + '">' + h.bias + '</div>' +
              '</div>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div style="font-size:12px;color:var(--t3)">Confiança</div>' +
              '<div style="font-family:var(--mono);font-weight:600;color:' + color + '">' + (h.confidence*100).toFixed(0) + '%</div>' +
            '</div>' +
          '</div>' +
          '<div style="height:4px;background:var(--bg3);border-radius:2px;overflow:hidden;margin-bottom:8px">' +
            '<div style="height:100%;width:' + h.formation + '%;background:' + color + ';border-radius:2px"></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10px">' +
            '<div class="card-sm" style="padding:6px;text-align:center"><div style="color:var(--t3)">PRZ</div><div style="font-family:var(--mono)">' + fmtUSD(h.prz) + '</div></div>' +
            '<div class="card-sm" style="padding:6px;text-align:center"><div style="color:var(--green)">Alvo 1</div><div style="font-family:var(--mono);color:var(--green)">' + fmtUSD(h.targets[0]||0) + '</div></div>' +
            '<div class="card-sm" style="padding:6px;text-align:center"><div style="color:var(--red)">Stop</div><div style="font-family:var(--mono);color:var(--red)">' + fmtUSD(h.stop||0) + '</div></div>' +
          '</div>';
        harmWrap.appendChild(card);
      });
    }
  }

  // ── Candle patterns ─────────────────────────────────────────────────────────
  const cpWrap = document.getElementById('candle-patterns-list');
  if (cpWrap) {
    cpWrap.innerHTML = '';
    (data.patterns || []).forEach(p => {
      const up = p.signal === 'STRONG_BUY' || p.signal === 'BUY';
      const dn = p.signal === 'STRONG_SELL' || p.signal === 'SELL';
      const color = up ? 'var(--green)' : dn ? 'var(--red)' : 'var(--t3)';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:0.5px solid var(--border);font-size:11px';
      row.innerHTML = '<span>' + p.name + '</span>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="color:' + color + ';font-size:10px">' + p.signal + '</span>' +
          '<div style="width:40px;height:4px;background:var(--bg3);border-radius:2px"><div style="height:100%;width:' + (p.confidence*100).toFixed(0) + '%;background:' + color + ';border-radius:2px"></div></div>' +
        '</div>';
      cpWrap.appendChild(row);
    });
    if (!data.patterns?.length) cpWrap.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px 0">Nenhum padrão de vela detectado</div>';
  }

  // ── SMC ─────────────────────────────────────────────────────────────────────
  const smcWrap = document.getElementById('smc-content');
  if (smcWrap && data.smc) {
    const s = data.smc;
    const biasColor = s.bias==='ALTISTA'?'var(--green)':s.bias==='BAIXISTA'?'var(--red)':'var(--t2)';
    smcWrap.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg2);border-radius:8px;padding:12px;margin-bottom:8px">' +
        '<div><div style="font-size:11px;color:var(--t3)">Estrutura</div><div style="font-size:12px;font-weight:500">' + s.structure + '</div></div>' +
        '<div style="background:' + biasColor + '20;border:1px solid ' + biasColor + ';border-radius:6px;padding:6px 12px;font-size:13px;font-weight:700;color:' + biasColor + '">' + (s.bias==='ALTISTA'?'↗':'s.bias==="BAIXISTA"'?'↘':'—') + ' VIÉS ' + s.bias + '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px">' +
        '<div class="card-sm" style="padding:8px"><div style="color:var(--t3)">HH (Topo maior)</div><div style="color:' + (s.hh?'var(--green)':'var(--t3)') + '">' + (s.hh?'✅ Sim':'❌ Não') + '</div></div>' +
        '<div class="card-sm" style="padding:8px"><div style="color:var(--t3)">HL (Fundo maior)</div><div style="color:' + (s.hl?'var(--green)':'var(--t3)') + '">' + (s.hl?'✅ Sim':'❌ Não') + '</div></div>' +
        '<div class="card-sm" style="padding:8px"><div style="color:var(--t3)">LH (Topo menor)</div><div style="color:' + (s.lh?'var(--red)':'var(--t3)') + '">' + (s.lh?'⚠ Sim':'— Não') + '</div></div>' +
        '<div class="card-sm" style="padding:8px"><div style="color:var(--t3)">LL (Fundo menor)</div><div style="color:' + (s.ll?'var(--red)':'var(--t3)') + '">' + (s.ll?'⚠ Sim':'— Não') + '</div></div>' +
        '<div class="card-sm" style="padding:8px;grid-column:span 2"><div style="color:var(--t3)">Volume</div><div style="color:' + (s.high_vol?'var(--gold)':'var(--t2)') + '">' + s.vol_ratio + 'x médio ' + (s.high_vol?'⚡ Acima':'→ Normal') + '</div></div>' +
      '</div>';
  }

  // ── Order Blocks ─────────────────────────────────────────────────────────────
  const obWrap = document.getElementById('ob-list');
  if (obWrap) {
    obWrap.innerHTML = '';
    (data.order_blocks || []).forEach(ob => {
      const color = ob.type==='bullish'?'var(--green)':'var(--red)';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:7px 10px;border-radius:6px;margin-bottom:4px;background:' + (ob.type==='bullish'?'rgba(63,185,80,0.06)':'rgba(248,81,73,0.06)') + ';border:0.5px solid ' + (ob.type==='bullish'?'rgba(63,185,80,0.3)':'rgba(248,81,73,0.3)');
      row.innerHTML =
        '<div><div style="font-size:10px;font-weight:600;color:' + color + '">' + (ob.type==='bullish'?'🟢 Bullish OB':'🔴 Bearish OB') + '</div>' +
        '<div style="font-family:var(--mono);font-size:12px">' + fmtUSD(ob.price) + '</div></div>' +
        '<div style="text-align:right"><div style="font-size:10px;color:var(--t3)">Força</div><div style="font-family:var(--mono);font-size:11px">' + ob.strength + '%</div></div>';
      obWrap.appendChild(row);
    });
    if (!data.order_blocks?.length) obWrap.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px 0">Nenhum Order Block relevante</div>';
  }

  // ── FVG ───────────────────────────────────────────────────────────────────────
  const fvgWrap = document.getElementById('fvg-list');
  if (fvgWrap) {
    fvgWrap.innerHTML = '';
    const fvgs = data.fvg || [];
    if (!fvgs.length) {
      fvgWrap.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:8px 0">Nenhum FVG identificado</div>';
    } else {
      fvgs.forEach(g => {
        const color = g.type==='bullish'?'var(--green)':'var(--red)';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:6px 8px;border-radius:5px;margin-bottom:3px;background:var(--bg2);font-size:11px';
        row.innerHTML = '<span style="color:' + color + '">' + g.label + '</span>' +
          '<span style="font-family:var(--mono)">' + fmtUSD(g.bottom) + ' – ' + fmtUSD(g.top) + '</span>' +
          '<span style="color:var(--t3)">' + g.size_pct + '%</span>';
        fvgWrap.appendChild(row);
      });
    }
  }

  // ── Indicators strip ─────────────────────────────────────────────────────────
  const indWrap = document.getElementById('indicators-strip');
  const ind = data.indicators || {};
  const items = [
    { label:'RSI(14)', val: ind.rsi, color: ind.rsi<30?'green':ind.rsi>70?'red':'', fmt: v=>v.toFixed(1) },
    { label:'MACD Hist', val: ind.macd_hist, color: (ind.macd_hist||0)>0?'green':'red', fmt: v=>v.toFixed(4) },
    { label:'ADX', val: ind.adx, color: (ind.adx||0)>25?'gold':'', fmt: v=>v },
    { label:'ATR', val: ind.atr, color: '', fmt: v=>'$'+v.toLocaleString() },
    { label:'VWAP', val: ind.vwap, color: (data.price||0)>=(ind.vwap||0)?'green':'red', fmt: v=>'$'+v.toLocaleString() },
    { label:'BB %', val: ind.bb ? ((data.price-ind.bb[2])/(ind.bb[0]-ind.bb[2])*100) : 50, color:'', fmt: v=>v.toFixed(1)+'%' },
  ];
  if (indWrap) {
    indWrap.innerHTML = '';
    items.forEach(item => {
      if (item.val === undefined || item.val === null) return;
      const d2 = document.createElement('div');
      d2.className = 'metric';
      d2.innerHTML = '<label>' + item.label + '</label><div class="val ' + (item.color||'') + '" style="font-size:16px">' + item.fmt(item.val) + '</div>';
      indWrap.appendChild(d2);
    });
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS AI — HISTORY & STATS
// ─────────────────────────────────────────────────────────────────────────────
let _lastAnalysisId = null;  // ID of last saved analysis for outcome tracking
let _lastAnalysisData = null;

function switchAITab(tab) {
  const analyzeTab = document.getElementById('ai-tab-analyze');
  const historyTab = document.getElementById('ai-tab-history');
  const loading    = document.getElementById('ai-loading');
  const results    = document.getElementById('ai-results');
  const histPanel  = document.getElementById('ai-history-panel');
  const sym        = document.getElementById('ai-symbol');
  const tf         = document.getElementById('ai-tf');
  const runBtn     = document.getElementById('ai-run-btn');
  const status     = document.getElementById('ai-status');

  if (tab === 'analyze') {
    if (analyzeTab) { analyzeTab.style.background='var(--gold)'; analyzeTab.style.color='#000'; }
    if (historyTab) { historyTab.style.background='transparent'; historyTab.style.color='var(--t2)'; }
    if (histPanel)  histPanel.style.display = 'none';
    if (results && _lastAnalysisData) results.style.display = 'block';
    if (sym)  sym.style.display  = '';
    if (tf)   tf.style.display   = '';
    if (runBtn) runBtn.style.display = '';
    if (status) status.style.display = '';
  } else {
    if (historyTab) { historyTab.style.background='var(--gold)'; historyTab.style.color='#000'; }
    if (analyzeTab) { analyzeTab.style.background='transparent'; analyzeTab.style.color='var(--t2)'; }
    if (histPanel)  histPanel.style.display = 'block';
    if (loading)    loading.style.display   = 'none';
    if (results)    results.style.display   = 'none';
    if (sym)  sym.style.display  = 'none';
    if (tf)   tf.style.display   = 'none';
    if (runBtn) runBtn.style.display = 'none';
    if (status) status.style.display = 'none';
    loadAnalysisPeriods();
    loadAnalysisHistory();
    loadAIPnLStats(document.getElementById('ai-pnl-period')?.value || 'month');
    // Auto-track pending signals on tab open
    setTimeout(() => autoTrackAI(), 1000);
  }
}

async function saveAnalysisToHistory(data, sg) {
  try {
    const r = await fetch('/api/analysis/save', {
      method: 'POST',
      headers: auth.headers(),
      body: JSON.stringify({
        symbol:     data.symbol,
        timeframe:  data.timeframe,
        price:      data.price,
        suggestion: { action: sg.action, direction: sg.direction, conf: sg.conf,
                      bullPoints: sg.bullPoints, bearPoints: sg.bearPoints },
        techScore:  data.tech_summary?.score,
        smc:        data.smc?.bias,
        patterns:   data.patterns?.map(p => p.name) || [],
      })
    });
    const d = await r.json();
    if (d.ok) {
      _lastAnalysisId   = d.id;
      _lastAnalysisData = data;
    }
  } catch(e) {}
}

async function markAnalysisOutcome(outcome, pnlPct) {
  if (!_lastAnalysisId) return;
  try {
    const currentPrice = state.prices[_lastAnalysisData?.symbol]?.price;
    await fetch('/api/analysis/' + _lastAnalysisId + '/outcome', {
      method: 'PATCH',
      headers: auth.headers(),
      body: JSON.stringify({ outcome, outcomePrice: currentPrice, pnlPct })
    });
  } catch(e) {}
}

async function loadAnalysisPeriods() {
  try {
    const r = await fetch('/api/analysis/periods', { headers: auth.headers() });
    const d = await r.json();
    const sel = document.getElementById('ai-period-sel');
    if (!sel || !d.ok) return;
    sel.innerHTML = '<option value="all">Todo o histórico</option>';
    (d.years || []).forEach(y => {
      sel.innerHTML += '<option value="' + y + '">' + y + ' (anual)</option>';
    });
    (d.months || []).forEach(m => {
      const [yr, mo] = m.split('-');
      const label = new Date(yr, parseInt(mo)-1).toLocaleDateString('pt-BR', {month:'long',year:'numeric'});
      sel.innerHTML += '<option value="' + m + '">' + label + '</option>';
    });
  } catch(e) {}
}

async function loadAnalysisHistory() {
  const period = document.getElementById('ai-period-sel')?.value || 'all';
  const status = document.getElementById('ai-hist-status');
  if (status) status.textContent = 'Carregando...';

  try {
    const url = '/api/analysis/history' + (period !== 'all' ? '?period=' + period : '');
    const r   = await fetch(url, { headers: auth.headers() });
    const d   = await r.json();
    if (!d.ok) { if(status) status.textContent = 'Erro ao carregar'; return; }
    if (status) status.textContent = d.stats.total + ' análises';

    renderAnalysisStats(d.stats);
    renderMonthlyBreakdown(d.monthlyBreakdown);
    renderSymbolStats(d.symbolStats);
    renderAnalysisHistoryTable(d.history);
  } catch(e) {
    if (status) status.textContent = 'Erro: ' + e.message;
  }
}

function renderAnalysisStats(stats) {
  const wrap = document.getElementById('ai-hist-stats');
  if (!wrap) return;
  const acc = stats.accuracy;
  const accColor = acc === null ? 'var(--t3)' : acc >= 65 ? 'var(--green)' : acc >= 50 ? 'var(--gold)' : 'var(--red)';
  const items = [
    { label:'Total de Análises', val: stats.total,     cls: '' },
    { label:'✅ Wins',           val: stats.wins,      cls: 'green' },
    { label:'❌ Losses',         val: stats.losses,    cls: 'red' },
    { label:'⏳ Pendentes',      val: stats.pending,   cls: 'gold' },
    { label:'Taxa de Acerto',    val: acc !== null ? acc + '%' : '—', cls: acc >= 65 ? 'green' : acc >= 50 ? 'gold' : 'red' },
    { label:'PnL Médio',         val: stats.avgPnl ? (stats.avgPnl >= 0 ? '+' : '') + stats.avgPnl + '%' : '—', cls: (stats.avgPnl||0) >= 0 ? 'green' : 'red' },
  ];
  wrap.innerHTML = items.map(m =>
    '<div class="metric"><label>' + m.label + '</label><div class="val ' + m.cls + '" style="font-size:20px">' + m.val + '</div></div>'
  ).join('');

  // Accuracy circle
  const circle = document.getElementById('accuracy-circle');
  const pctEl  = document.getElementById('accuracy-pct');
  if (circle && acc !== null) {
    const offset = 314 - (314 * acc / 100);
    circle.style.strokeDashoffset = offset;
    circle.style.stroke = accColor;
  }
  if (pctEl) { pctEl.textContent = acc !== null ? acc + '%' : '—'; pctEl.style.color = accColor; }

  const details = document.getElementById('ai-accuracy-details');
  if (details) {
    details.innerHTML = [
      { label:'Análises com resultado', val: stats.withOutcome },
      { label:'Sem resultado ainda',    val: stats.pending },
      { label:'Wins confirmados',        val: stats.wins, color:'var(--green)' },
      { label:'Losses confirmados',     val: stats.losses, color:'var(--red)' },
    ].map(item =>
      '<div class="metric" style="padding:10px"><label>' + item.label + '</label>' +
      '<div class="val" style="font-size:20px' + (item.color?';color:'+item.color:'') + '">' + item.val + '</div></div>'
    ).join('');
  }
}

function renderMonthlyBreakdown(months) {
  const tbody = document.getElementById('ai-monthly-table');
  if (!tbody) return;
  if (!months.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--t3);padding:16px">Nenhuma análise registrada</td></tr>'; return; }
  tbody.innerHTML = '';
  months.forEach(m => {
    const acc    = m.accuracy;
    const accClr = acc === null ? 'var(--t3)' : acc >= 65 ? 'var(--green)' : acc >= 50 ? 'var(--gold)' : 'var(--red)';
    const [yr, mo] = m.month.split('-');
    const label = new Date(yr, parseInt(mo)-1).toLocaleDateString('pt-BR', {month:'short',year:'numeric'});
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td style="font-weight:600">' + label + '</td>' +
      '<td style="font-family:var(--mono)">' + m.total + '</td>' +
      '<td class="green">' + m.wins + '</td>' +
      '<td class="red">' + m.losses + '</td>' +
      '<td class="muted">' + m.pending + '</td>' +
      '<td style="font-family:var(--mono);font-weight:600;color:' + accClr + '">' + (acc !== null ? acc + '%' : '—') + '</td>' +
      '<td style="font-family:var(--mono);color:' + ((m.pnlSum||0)>=0?'var(--green)':'var(--red)') + '">' + ((m.pnlSum||0)>=0?'+':'') + (m.pnlSum||0) + '%</td>';
    tbody.appendChild(tr);
  });
}

function renderSymbolStats(syms) {
  const tbody = document.getElementById('ai-symbol-table');
  if (!tbody) return;
  if (!syms.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:16px">Sem dados</td></tr>'; return; }
  tbody.innerHTML = '';
  syms.forEach(s => {
    const acc = s.accuracy;
    const clr = acc >= 65 ? 'var(--green)' : acc >= 50 ? 'var(--gold)' : 'var(--red)';
    const p   = PAIRS.find(x => x.sym === s.symbol);
    const tr  = document.createElement('tr');
    tr.innerHTML =
      '<td style="font-weight:600;color:var(--gold)">' + (p ? p.base : s.symbol.replace('USDT','')) + '/USDT</td>' +
      '<td style="font-family:var(--mono)">' + s.total + '</td>' +
      '<td class="green">' + s.wins + '</td>' +
      '<td class="red">' + s.losses + '</td>' +
      '<td>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<div style="flex:1;background:var(--bg3);border-radius:2px;height:5px;overflow:hidden">' +
            '<div style="height:100%;width:' + (acc||0) + '%;background:' + clr + ';border-radius:2px"></div>' +
          '</div>' +
          '<span style="font-family:var(--mono);font-size:11px;color:' + clr + '">' + (acc !== null ? acc + '%' : '—') + '</span>' +
        '</div>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

function renderAnalysisHistoryTable(history) {
  const tbody = document.getElementById('ai-history-table');
  if (!tbody) return;
  if (!history.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:16px">Nenhuma análise salva. Clique em Analisar para começar.</td></tr>'; return; }
  tbody.innerHTML = '';
  history.forEach(h => {
    const sg  = h.suggestion || {};
    const dir = sg.direction === 'long' ? '🟢 LONG' : sg.direction === 'short' ? '🔴 SHORT' : '⏸ FLAT';
    const out = h.outcome;
    const outBadge = !out || out === 'pending'
      ? '<span class="badge badge-gray">Pendente</span>'
      : out === 'win'
        ? '<span class="badge badge-green">WIN ✅</span>'
        : '<span class="badge badge-red">LOSS ❌</span>';
    const date = h.createdAt ? new Date(h.createdAt).toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
    const p    = PAIRS.find(x => x.sym === h.symbol);
    const tr   = document.createElement('tr');
    tr.innerHTML =
      '<td class="muted" style="font-size:11px">' + date + '</td>' +
      '<td style="font-weight:600;color:var(--gold)">' + (p ? p.base : (h.symbol||'').replace('USDT','')) + '</td>' +
      '<td class="muted">' + (h.timeframe||'—') + '</td>' +
      '<td style="font-size:11px">' + dir + '</td>' +
      '<td style="font-family:var(--mono)">' + (sg.conf||0) + '%</td>' +
      '<td>' + outBadge + '</td>' +
      '<td style="font-family:var(--mono);color:' + ((h.pnlPct||0)>=0?'var(--green)':'var(--red)') + '">' +
        (out && out !== 'pending' ? ((h.pnlPct||0)>=0?'+':'') + (h.pnlPct||0) + '%' : '—') +
      '</td>' +
      '<td>' +
        ((!out || out === 'pending') ? 
          '<div style="display:flex;gap:4px">' +
            '<button class="btn btn-outline" style="font-size:9px;padding:3px 6px;color:var(--green)" onclick="updateOutcome(\'' + h._id + '\',\'win\')">WIN</button>' +
            '<button class="btn btn-outline" style="font-size:9px;padding:3px 6px;color:var(--red)" onclick="updateOutcome(\'' + h._id + '\',\'loss\')">LOSS</button>' +
          '</div>' 
          : ''
        ) +
      '</td>';
    tbody.appendChild(tr);
  });
}

async function updateOutcome(id, outcome) {
  const pnlPct = outcome === 'win' ? 2.5 : -2.5; // approximate — user can refine later
  try {
    await fetch('/api/analysis/' + id + '/outcome', {
      method: 'PATCH', headers: auth.headers(),
      body: JSON.stringify({ outcome, pnlPct })
    });
    showToast(outcome === 'win' ? '✅ Marcado como WIN!' : '🔴 Marcado como LOSS');
    loadAnalysisHistory();
  } catch(e) { showToast('❌ Erro: ' + e.message, true); }
}

// ─── Settings persistence ─────────────────────────────────────────────────────
async function saveAppSettings(key, value) {
  try {
    const r = await fetch('/api/settings', { headers: auth.headers() });
    const d = await r.json();
    const current = d.settings || {};
    current[key]  = value;
    await fetch('/api/settings', {
      method: 'POST', headers: auth.headers(),
      body: JSON.stringify({ settings: current })
    });
  } catch(e) {}
}

async function loadAppSettings() {
  try {
    const r = await fetch('/api/settings', { headers: auth.headers() });
    const d = await r.json();
    const s = d.settings || {};
    // Apply saved settings
    if (s.theme)       { localStorage.setItem('ce_theme', s.theme); loadTheme(); }
    if (s.activePair)  { state.activePair = s.activePair; }
    if (s.chartTf)     { const e=document.getElementById('dash-chart-tf'); if(e) e.value = s.chartTf; }
    if (s.botCapital)  { const e=document.getElementById('bc-capital'); if(e) e.value = s.botCapital; }
  } catch(e) {}
}



// ─────────────────────────────────────────────────────────────────────────────
// PROFILE PAGE
// ─────────────────────────────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const r = await fetch('/api/auth/me', { headers: auth.headers() });
    const d = await r.json();
    if (!d.ok) return;
    const u = d.user;
    // Show admin bar if admin
    const adminBar = document.getElementById('prof-admin-bar');
    if (adminBar) adminBar.style.display = u.role === 'admin' ? 'flex' : 'none';
    const setEl = (id, v) => { const e=document.getElementById(id); if(e) e.textContent=v||'—'; };
    setEl('prof-username', u.username);
    setEl('prof-email',    u.email || 'não informado');
    setEl('prof-plan',     u.plan?.toUpperCase() || '—');
    setEl('prof-role',     u.role === 'admin' ? '👑 Administrador' : '👤 Usuário');
    setEl('prof-created',  u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—');
    setEl('prof-lastlogin',u.last_login ? new Date(u.last_login).toLocaleDateString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '—');
    const emailInput = document.getElementById('prof-email-input');
    if (emailInput && u.email) emailInput.value = u.email;
    // Integration status
    const setInt = (id, ok, label) => {
      const e = document.getElementById(id);
      if (e) { e.textContent = ok ? '✅ Configurada' : '❌ Não configurada'; e.style.color = ok?'var(--green)':'var(--t3)'; }
    };
    setInt('int-binance',  u.has_binance_key,  'Binance');
    setInt('int-telegram', u.has_telegram,     'Telegram');
    // Show webhook token directly
    const wt = document.getElementById('profile-webhook-token');
    if (wt) wt.textContent = u.webhook_token || 'Sem token — faça login novamente';
    // Fire event for any listeners
    document.dispatchEvent(new Event('profileLoaded'));
  } catch(e) {}
}

async function saveProfileEmail() {
  const email = document.getElementById('prof-email-input')?.value.trim();
  if (!email) return;
  try {
    const r = await fetch('/api/auth/keys', {
      method:'POST', headers: auth.headers(),
      body: JSON.stringify({ email })
    });
    const d = await r.json();
    if (d.ok) { showToast('✅ E-mail atualizado!'); loadProfile(); }
    else showToast('❌ '+d.error, true);
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function changePassword() {
  const curr    = document.getElementById('prof-curr-pass')?.value;
  const newPass = document.getElementById('prof-new-pass')?.value;
  if (!curr || !newPass) return showToast('Preencha os campos de senha', true);
  if (newPass.length < 6) return showToast('Nova senha deve ter mínimo 6 caracteres', true);
  try {
    const r = await fetch('/api/auth/change-password', {
      method:'POST', headers: auth.headers(),
      body: JSON.stringify({ current: curr, newPass })
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ Senha alterada!');
      localStorage.setItem('ce_pass', newPass);
      document.getElementById('prof-curr-pass').value = '';
      document.getElementById('prof-new-pass').value  = '';
    } else showToast('❌ '+d.error, true);
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function saveApiKeys() {
  const binKey    = document.getElementById('key-binance-key')?.value.trim();
  const binSecret = document.getElementById('key-binance-secret')?.value.trim();
  const tgToken   = document.getElementById('key-tg-token')?.value.trim();
  const tgChatId  = document.getElementById('key-tg-chatid')?.value.trim();
  const status    = document.getElementById('prof-keys-status');
  if (status) status.textContent = 'Salvando...';
  try {
    const body = {};
    if (binKey)    body.binance_key     = binKey;
    if (binSecret) body.binance_secret  = binSecret;
    if (tgToken)   body.telegram_token  = tgToken;
    if (tgChatId)  body.telegram_chatid = tgChatId;
    const r = await fetch('/api/auth/keys', {
      method:'POST', headers: auth.headers(), body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ Chaves salvas com segurança!');
      if (status) status.textContent = '✅ Salvo';
      loadProfile();
      // Clear secret inputs after save
      const bs = document.getElementById('key-binance-secret');
      if (bs) bs.value = '';
    } else {
      showToast('❌ '+d.error, true);
      if (status) status.textContent = '❌ Erro ao salvar';
    }
  } catch(e) { showToast('❌ '+e.message, true); }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN PANEL
// ─────────────────────────────────────────────────────────────────────────────
function switchAdminTab(tab) {
  ['users','invites','platform'].forEach(t => {
    const btn = document.getElementById('adm-tab-'+t);
    const pnl = document.getElementById('adm-panel-'+t);
    if (btn) {
      if (t === tab) {
        btn.style.background = 'var(--gold)';
        btn.style.color = '#000';
        btn.style.fontWeight = '700';
      } else {
        btn.style.background = 'transparent';
        btn.style.color = 'var(--t2)';
        btn.style.fontWeight = '400';
      }
    }
    if (pnl) pnl.style.display = t === tab ? 'block' : 'none';
  });
  if (tab === 'users')    loadAdminPanel();
  if (tab === 'invites')  loadAdminInvites();
  if (tab === 'platform') loadPlatformSettings();
}

async function loadAdminPanel() {
  try {
    const r = await fetch('/api/admin/stats', { headers: auth.headers() });
    const d = await r.json();
    if (!d.ok) return;
    // Update individual stat elements
    const setS = (id, v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    setS('adm-s-users',  d.users);
    setS('adm-s-active', d.active);
    setS('adm-s-admins', d.admins);
    setS('adm-s-trades', d.trades);
    // Platform stats card
    const platStats = document.getElementById('adm-plat-stats');
    if (platStats) {
      platStats.innerHTML = [
        ['Total usuários', d.users],
        ['Ativos', d.active],
        ['Total de trades', d.trades],
        ['Análises realizadas', d.analyses],
      ].map(([k,v]) =>
        '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:0.5px solid var(--border)">' +
        '<span style="color:var(--t3)">'+k+'</span><span style="font-weight:600">'+v+'</span></div>'
      ).join('');
    }
  } catch(e) {}
  loadAdminUsers();
}

async function loadAdminUsers() {
  try {
    const r = await fetch('/api/admin/users', { headers: auth.headers() });
    const d = await r.json();
    if (!d.ok) return;
    const tbody = document.getElementById('adm-users-table');
    if (!tbody) return;
    tbody.innerHTML = '';
    d.users.forEach(u => {
      const tr = document.createElement('tr');
      const statusColor = u.status === 'active' ? 'var(--green)' : 'var(--red)';
      const roleColor   = u.role === 'admin' ? 'var(--gold)' : 'var(--t2)';
      tr.innerHTML =
        '<td style="font-weight:600">' + u.username + '</td>' +
        '<td class="muted" style="font-size:11px">' + (u.email||'—') + '</td>' +
        '<td><span class="badge badge-gray">' + (u.plan||'basic').toUpperCase() + '</span></td>' +
        '<td style="color:' + roleColor + ';font-size:11px;font-weight:600">' + (u.role==='admin'?'👑 Admin':'👤 User') + '</td>' +
        '<td style="color:' + statusColor + ';font-size:11px">' + (u.status==='active'?'✅ Ativo':'🔴 Bloqueado') + '</td>' +
        '<td class="muted" style="font-size:11px">' + (u.created_at?new Date(u.created_at).toLocaleDateString('pt-BR'):'—') + '</td>' +
        '<td class="muted" style="font-size:11px">' + (u.last_login?new Date(u.last_login).toLocaleDateString('pt-BR'):'Nunca') + '</td>' +
        '<td>' +
          (u.role !== 'admin' ? '<div style="display:flex;gap:4px">' +
            '<button data-u="' + u.username + '" data-s="' + (u.status==='active'?'blocked':'active') + '" onclick="adminToggleUser(this.dataset.u,this.dataset.s)" style="font-size:9px;padding:3px 6px;background:transparent;border:1px solid var(--border);border-radius:4px;color:var(--t2);cursor:pointer">' + (u.status==='active'?'Bloquear':'Ativar') + '</button>' +
            '<button data-u="' + u.username + '" onclick="adminDeleteUser(this.dataset.u)" style="font-size:9px;padding:3px 6px;background:transparent;border:1px solid rgba(248,81,73,0.5);border-radius:4px;color:var(--red);cursor:pointer">Excluir</button>' +
          '</div>' : '<span style="font-size:10px;color:var(--t3)">—</span>') +
        '</td>';
      tbody.appendChild(tr);
    });
  } catch(e) {}
}

async function adminToggleUser(username, newStatus) {
  try {
    await fetch('/api/admin/users/'+username, {
      method:'PATCH', headers: auth.headers(),
      body: JSON.stringify({ status: newStatus })
    });
    showToast(newStatus==='active'?'✅ Usuário ativado':'🔴 Usuário bloqueado');
    loadAdminUsers();
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function adminDeleteUser(username) {
  const ok = await showConfirm('Excluir usuário', 'Excluir @'+username+' permanentemente? Todos os dados serão perdidos.', 'Excluir', 'Cancelar');
  if (!ok) return;
  try {
    await fetch('/api/admin/users/'+username, { method:'DELETE', headers: auth.headers() });
    showToast('✅ Usuário excluído');
    loadAdminUsers();
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function generateInvite() {
  const plan     = document.getElementById('inv-plan')?.value || 'basic';
  const maxUses  = parseInt(document.getElementById('inv-max-uses')?.value) || 1;
  const expires  = parseInt(document.getElementById('inv-expires')?.value) || 30;
  try {
    const r = await fetch('/api/admin/invite', {
      method:'POST', headers: auth.headers(),
      body: JSON.stringify({ plan, maxUses, expiresInDays: expires })
    });
    const d = await r.json();
    if (!d.ok) return showToast('❌ '+d.error, true);
    const resDiv = document.getElementById('inv-result');
    const codeEl = document.getElementById('inv-code-display');
    if (resDiv) resDiv.style.display = 'block';
    if (codeEl) codeEl.textContent = d.code;
    window._lastInviteCode = d.code;
    loadAdminInvites();
  } catch(e) { showToast('❌ '+e.message, true); }
}

function copyInviteCode() {
  const code = window._lastInviteCode || document.getElementById('inv-code-display')?.textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => showToast('📋 Código copiado: ' + code));
}

async function loadAdminInvites() {
  try {
    const r = await fetch('/api/admin/invites', { headers: auth.headers() });
    const d = await r.json();
    if (!d.ok) return;
    const tbody = document.getElementById('adm-invites-table');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!d.codes.length) {
      tbody.innerHTML = '<tr><td colspan="8" style="color:var(--t3);text-align:center;padding:20px">Nenhum código gerado</td></tr>';
      return;
    }
    d.codes.forEach(c => {
      const expired = c.expires_at && new Date(c.expires_at) < new Date();
      const used    = c.uses >= c.max_uses;
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td style="font-family:var(--mono);font-weight:600;letter-spacing:1px;color:' + (used||expired?'var(--t3)':'var(--gold)') + '">' + c.code + '</td>' +
        '<td><span class="badge badge-gray">' + (c.plan||'basic').toUpperCase() + '</span></td>' +
        '<td style="font-family:var(--mono)">' + c.uses + '</td>' +
        '<td style="font-family:var(--mono)">' + c.max_uses + '</td>' +
        '<td style="font-size:11px">' + (c.used_by||'—') + '</td>' +
        '<td class="muted" style="font-size:11px;color:' + (expired?'var(--red)':'var(--t3)') + '">' +
          (c.expires_at ? new Date(c.expires_at).toLocaleDateString('pt-BR') : '—') + (expired?' ⚠':'') +
        '</td>' +
        '<td class="muted" style="font-size:11px">' + (c.created_at?new Date(c.created_at).toLocaleDateString('pt-BR'):'—') + '</td>' +
        '<td><button data-c="' + c.code + '" onclick="deleteInvite(this.dataset.c)" style="font-size:9px;padding:3px 6px;background:transparent;border:1px solid rgba(248,81,73,0.4);border-radius:4px;color:var(--red);cursor:pointer">Excluir</button></td>';
      tbody.appendChild(tr);
    });
  } catch(e) {}
}

async function deleteInvite(code) {
  try {
    await fetch('/api/admin/invites/'+code, { method:'DELETE', headers: auth.headers() });
    showToast('✅ Código excluído');
    loadAdminInvites();
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function loadPlatformSettings() {
  try {
    const r = await fetch('/api/admin/settings', { headers: auth.headers() });
    const d = await r.json();
    if (!d.ok) return;
    const s = d.settings;
    const setVal = (id, v) => { const e=document.getElementById(id); if(e) e.value=v||''; };
    setVal('plat-name',      s.platform_name);
    setVal('plat-reg-mode',  s.registration_mode);
    setVal('plat-max-users', s.max_users);
  } catch(e) {}
}

async function savePlatformSettings() {
  const name    = document.getElementById('plat-name')?.value.trim();
  const regMode = document.getElementById('plat-reg-mode')?.value;
  const maxUsers= document.getElementById('plat-max-users')?.value;
  try {
    const r = await fetch('/api/admin/settings', {
      method:'POST', headers: auth.headers(),
      body: JSON.stringify({ settings: { platform_name:name, registration_mode:regMode, max_users:maxUsers } })
    });
    const d = await r.json();
    if (d.ok) showToast('✅ Configurações salvas!');
    else showToast('❌ '+d.error, true);
  } catch(e) { showToast('❌ '+e.message, true); }
}

async function savePlatformKeys() {
  const key = document.getElementById('plat-laozhang')?.value.trim();
  if (!key) return showToast('Informe a chave da IA', true);
  try {
    // Store in platform settings (for server env fallback awareness — actual key goes in .env)
    showToast('ℹ️ Configure LAOZHANG_API_KEY no .env do servidor para uso global.');
  } catch(e) {}
}



// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
async function doForgotPassword() {
  const email = document.getElementById('forgot-email')?.value.trim();
  if (!email) return showLoginError('Informe seu e-mail');
  const btn = document.getElementById('forgot-btn');
  const txt = document.getElementById('forgot-btn-text');
  if (btn) { btn.disabled=true; if(txt) txt.textContent='Enviando...'; }
  try {
    const r = await fetch('/api/auth/forgot-password', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ email })
    });
    const d = await r.json();
    const successMsg = document.getElementById('forgot-success-msg');
    if (successMsg) successMsg.style.display = 'block';
    if (btn) { btn.style.display='none'; }
    showLoginError('');
    const errEl = document.getElementById('login-error');
    if (errEl) errEl.style.display = 'none';
  } catch(e) {
    showLoginError('Erro ao enviar: ' + e.message);
  } finally {
    if (btn) { btn.disabled=false; if(txt) txt.textContent='Enviar link de redefinição'; }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AI ENGINE — REALTIME CHART WITH ENTRY/EXIT MARKERS
// ─────────────────────────────────────────────────────────────────────────────

let _aiChartInstance = null;
let _aiChartWS       = null;
let _aiChartExpanded = false;

// Lightweight canvas-based candlestick chart
function drawAIChart(candles, markers) {
  const container = document.getElementById('ai-realtime-chart');
  const placeholder= document.getElementById('ai-chart-placeholder');
  const legend    = document.getElementById('ai-chart-legend');
  if (!container) return;
  if (placeholder) placeholder.style.display = 'none';
  if (legend) legend.style.display = 'flex';

  // Remove previous canvas
  const prev = container.querySelector('canvas.ai-chart-canvas');
  if (prev) prev.remove();

  const canvas = document.createElement('canvas');
  canvas.className = 'ai-chart-canvas';
  canvas.style.cssText = 'width:100%;height:100%;display:block';
  container.appendChild(canvas);

  function render() {
    const W = container.clientWidth, H = container.clientHeight;
    canvas.width  = W * devicePixelRatio;
    canvas.height = H * devicePixelRatio;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const bg     = isDark ? '#0d1117' : '#ffffff';
    const gridC  = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const textC  = isDark ? '#7d8590' : '#666';
    const upC    = '#3FB950', dnC = '#F85149';

    ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);

    if (!candles || candles.length < 2) {
      ctx.fillStyle = textC; ctx.font = '13px monospace';
      ctx.textAlign = 'center'; ctx.fillText('Aguardando dados...', W/2, H/2);
      return;
    }

    const pad = { top:20, right:80, bottom:40, left:60 };
    const chartW = W - pad.left - pad.right;
    const chartH = H - pad.top  - pad.bottom;

    // Price range
    const prices = candles.flatMap(c => [c.high, c.low]);
    if (markers) markers.forEach(m => { if(m.price) prices.push(m.price); });
    let minP = Math.min(...prices) * 0.9995;
    let maxP = Math.max(...prices) * 1.0005;
    const priceRange = maxP - minP || 1;

    const toX = i => pad.left + (i / (candles.length - 1)) * chartW;
    const toY = p => pad.top + chartH - ((p - minP) / priceRange) * chartH;

    // Grid lines
    ctx.strokeStyle = gridC; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      const price = maxP - (priceRange / 4) * i;
      ctx.fillStyle = textC; ctx.font = '10px monospace'; ctx.textAlign = 'right';
      ctx.fillText('$' + price.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}), pad.left - 4, y + 4);
    }

    // Candlesticks
    const cw = Math.max(2, Math.min(12, chartW / candles.length - 1));
    candles.forEach((c, i) => {
      const x = toX(i), open=toY(c.open), close=toY(c.close), high=toY(c.high), low=toY(c.low);
      const up = c.close >= c.open;
      ctx.strokeStyle = up ? upC : dnC;
      ctx.fillStyle   = up ? upC : dnC;
      ctx.lineWidth = 1;
      // Wick
      ctx.beginPath(); ctx.moveTo(x, high); ctx.lineTo(x, low); ctx.stroke();
      // Body
      const bodyTop = Math.min(open, close), bodyH = Math.max(1, Math.abs(close - open));
      ctx.fillRect(x - cw/2, bodyTop, cw, bodyH);
    });

    // ── Enhanced Marker Lines ─────────────────────────────────────────────────
    if (markers && markers.length > 0) {
      const style = {
        entry: { color:'#3FB950', dash:[],    label:'Entrada', lw:2.5, bg:'rgba(63,185,80,0.08)' },
        sl:    { color:'#F85149', dash:[5,4], label:'SL',      lw:2,   bg:'rgba(248,81,73,0.08)' },
        tp1:   { color:'#58A6FF', dash:[4,3], label:'TP1',     lw:1.5, bg:'rgba(88,166,255,0.05)' },
        tp2:   { color:'#F0B90B', dash:[4,3], label:'TP2',     lw:1.5, bg:'rgba(240,185,11,0.05)' },
        tp3:   { color:'#a371f7', dash:[4,3], label:'TP3',     lw:1,   bg:'rgba(163,113,247,0.05)' },
        ob:    { color:'rgba(240,185,11,0.5)', dash:[2,4], label:'', lw:1, bg:'' },
      };

      // Draw zone fills between entry and targets
      const entry = markers.find(m => m.type === 'entry');
      const sl    = markers.find(m => m.type === 'sl');
      const tp1   = markers.find(m => m.type === 'tp1');
      const tp2   = markers.find(m => m.type === 'tp2');
      const tp3   = markers.find(m => m.type === 'tp3');

      if (entry && sl) {
        const y1 = Math.min(toY(entry.price), toY(sl.price));
        const y2 = Math.max(toY(entry.price), toY(sl.price));
        ctx.fillStyle = 'rgba(248,81,73,0.07)';
        ctx.fillRect(pad.left, y1, W - pad.right - pad.left, y2 - y1);
      }
      if (entry && tp1) {
        const y1 = Math.min(toY(entry.price), toY(tp1.price));
        const y2 = Math.max(toY(entry.price), toY(tp1.price));
        ctx.fillStyle = 'rgba(63,185,80,0.06)';
        ctx.fillRect(pad.left, y1, W - pad.right - pad.left, y2 - y1);
      }
      if (tp1 && tp2) {
        const y1 = Math.min(toY(tp1.price), toY(tp2.price));
        const y2 = Math.max(toY(tp1.price), toY(tp2.price));
        ctx.fillStyle = 'rgba(88,166,255,0.05)';
        ctx.fillRect(pad.left, y1, W - pad.right - pad.left, y2 - y1);
      }
      if (tp2 && tp3) {
        const y1 = Math.min(toY(tp2.price), toY(tp3.price));
        const y2 = Math.max(toY(tp2.price), toY(tp3.price));
        ctx.fillStyle = 'rgba(240,185,11,0.04)';
        ctx.fillRect(pad.left, y1, W - pad.right - pad.left, y2 - y1);
      }

      // Draw marker lines with improved labels
      const rightLabelX = W - pad.right + 4;
      const labelBgW    = pad.right - 5;
      
      markers.forEach(m => {
        if (!m.price || m.price < minP || m.price > maxP) return;
        const st = style[m.type] || style.tp1;
        const y  = toY(m.price);
        const isFmt = m.price > 1000;
        const priceStr = isFmt ? '$' + m.price.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
                                : '$' + m.price.toFixed(4);
        ctx.save();

        // Line
        ctx.strokeStyle = st.color;
        ctx.lineWidth   = st.lw;
        ctx.setLineDash(st.dash);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Right label badge
        if (st.label) {
          const labelH = 18, labelPad = 5;
          // Badge background
          ctx.fillStyle = st.color;
          ctx.beginPath();
          ctx.roundRect(rightLabelX, y - labelH/2, labelBgW, labelH, 3);
          ctx.fill();
          // Badge text
          ctx.fillStyle = m.type === 'ob' ? '#000' : '#000';
          ctx.font = 'bold 9px monospace';
          ctx.textAlign = 'left';
          const shortLabel = st.label;
          ctx.fillText(shortLabel, rightLabelX + labelPad, y + 3.5);
          // Price on separate line
          ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
          ctx.font = '8px monospace';
          ctx.fillText(priceStr, rightLabelX + labelPad + 22, y + 3.5);
        }

        // Entry dot + arrow indicator
        if (m.type === 'entry') {
          const lastX = toX(candles.length - 1);
          // Pulsing circle
          ctx.beginPath();
          ctx.arc(lastX, y, 7, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(63,185,80,0.2)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(lastX, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = st.color;
          ctx.fill();
          // Arrow pointing to entry
          ctx.fillStyle = st.color;
          ctx.font = 'bold 14px monospace';
          ctx.textAlign = 'center';
          const isBull = tp1 && tp1.price > m.price;
          ctx.fillText(isBull ? '▲' : '▼', lastX, y + (isBull ? 22 : -14));
        }

        ctx.restore();
      });

      // Left side: vertical "zone" indicator
      if (entry) {
        const isBull = tp1 && tp1.price > entry.price;
        // Direction arrow on left edge
        ctx.save();
        ctx.fillStyle = isBull ? '#3FB950' : '#F85149';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(isBull ? '📈' : '📉', pad.left + 10, toY(entry.price));
        ctx.restore();
      }
    }

    // X-axis time labels
    const step = Math.max(1, Math.floor(candles.length / 6));
    ctx.fillStyle = textC; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    for (let i = 0; i < candles.length; i += step) {
      const c = candles[i];
      if (!c.time) continue;
      const d = new Date(c.time);
      const label = d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
      ctx.fillText(label, toX(i), H - pad.bottom + 14);
    }

    // Current price badge
    const last = candles[candles.length-1];
    const cy   = toY(last.close);
    ctx.fillStyle = last.close >= last.open ? upC : dnC;
    ctx.beginPath(); ctx.roundRect(W - pad.right + 1, cy - 9, 75, 18, 3); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
    ctx.fillText('$' + last.close.toLocaleString('pt-BR',{minimumFractionDigits:2}), W-pad.right+4, cy+4);
  }

  render();
  window._aiChartRender = render;
  window.addEventListener('resize', render);
}

let _aiLiveCandles = [];
let _aiLiveWsActive = false;

async function loadAIRealtimeChart(symbol, tf, analysisData) {
  // Fetch recent candles
  try {
    const klines = await fetchKlines(symbol, tf, 120);
    _aiLiveCandles = klines.map(k => ({
      time:   parseInt(k[0]),
      open:   parseFloat(k[1]),
      high:   parseFloat(k[2]),
      low:    parseFloat(k[3]),
      close:  parseFloat(k[4]),
    }));

    // Build markers from analysis suggestion
    const sg  = analysisData ? generateTradingSuggestion(analysisData) : null;
    const ind = analysisData?.indicators || {};
    const markers = [];

    if (sg && sg.direction !== 'flat') {
      markers.push({ type:'entry', price: analysisData.price,         label:'Entrada' });
      markers.push({ type:'sl',    price: sg.slPrice,                 label:'Stop Loss' });
      markers.push({ type:'tp1',   price: sg.tp1,                     label:'TP1' });
      markers.push({ type:'tp2',   price: sg.tp2,                     label:'TP2' });
      markers.push({ type:'tp3',   price: sg.tp3,                     label:'TP3' });
    }
    // VWAP line
    if (ind.vwap) markers.push({ type:'ob', price: ind.vwap, label:'VWAP' });
    // Order blocks
    (analysisData?.order_blocks || []).slice(0,2).forEach(ob => {
      markers.push({ type:'ob', price: ob.price, label: ob.type==='bullish'?'Bull OB':'Bear OB' });
    });

    drawAIChart(_aiLiveCandles, markers);

    // Start live WebSocket for current candle updates
    startAILiveWS(symbol, tf, markers);
  } catch(e) {
    console.warn('[AIChart] Error:', e.message);
  }
}

function startAILiveWS(symbol, tf, markers) {
  if (_aiChartWS) { try { _aiChartWS.close(); } catch {} }
  const wsUrl = 'wss://stream.binance.com:9443/ws/' + symbol.toLowerCase() + '@kline_' + tf;
  try {
    _aiChartWS = new WebSocket(wsUrl);
    _aiChartWS.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (!d.k) return;
        const k = d.k;
        const candle = { time: k.t, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c) };
        if (_aiLiveCandles.length > 0) {
          if (_aiLiveCandles[_aiLiveCandles.length-1].time === candle.time) {
            _aiLiveCandles[_aiLiveCandles.length-1] = candle;
          } else if (k.x) { // Candle closed
            _aiLiveCandles.push(candle);
            if (_aiLiveCandles.length > 200) _aiLiveCandles.shift();
          }
        }
        if (window._aiChartRender) window._aiChartRender();
      } catch {}
    };
    _aiChartWS.onerror = () => {};
  } catch(e) {}
}

function toggleAIChart() {
  const container = document.getElementById('ai-realtime-chart');
  const btn       = document.getElementById('ai-chart-toggle');
  if (!container) return;
  _aiChartExpanded = !_aiChartExpanded;
  container.style.height = _aiChartExpanded ? '550px' : '320px';
  if (btn) btn.textContent = _aiChartExpanded ? 'Recolher' : 'Expandir';
  setTimeout(() => { if (window._aiChartRender) window._aiChartRender(); }, 50);
}



// ─────────────────────────────────────────────────────────────────────────────
// AI SIGNAL AUTO-TRACK P&L
// ─────────────────────────────────────────────────────────────────────────────
let _aiPnLChart = null;

async function autoTrackAI() {
  const btn = document.getElementById('auto-track-btn');
  if (btn) { btn.textContent = '⏳ Atualizando...'; btn.disabled = true; }
  try {
    const r = await fetch('/api/analysis/auto-track', { method:'POST', headers: auth.headers() });
    const d = await r.json();
    if (d.ok) {
      showToast('✅ ' + d.updated + ' sinais atualizados!');
      loadAnalysisHistory();
      loadAIPnLStats(document.getElementById('ai-pnl-period')?.value || 'month');
    }
  } catch(e) { showToast('❌ ' + e.message, true); }
  finally { if (btn) { btn.textContent = '⚡ Auto-Trackear'; btn.disabled = false; } }
}

async function loadAIPnLStats(period = 'month') {
  try {
    const r = await fetch('/api/analysis/pnl-stats?period=' + period, { headers: auth.headers() });
    const d = await r.json();
    if (!d.ok) return;
    const s = d.summary;

    // Update stat cards
    const setEl = (id, v, cls) => {
      const e = document.getElementById(id);
      if (!e) return;
      e.textContent = v;
      if (cls) e.className = 'val ' + cls;
    };
    setEl('pnl-closed',   s.closed || '0');
    const accColor = s.accuracy >= 65 ? 'green' : s.accuracy >= 50 ? 'gold' : 'red';
    setEl('pnl-accuracy', s.accuracy !== null ? s.accuracy + '%' : '—', accColor);
    const pnlColor = (s.pnlSum||0) >= 0 ? 'green' : 'red';
    setEl('pnl-total', ((s.pnlSum||0) >= 0 ? '+' : '') + (s.pnlSum||0) + '%', pnlColor);
    setEl('pnl-best', s.bestWin > 0 ? '+' + s.bestWin + '%' : '—', 'green');

    // Symbol table
    const tbody = document.getElementById('ai-symbol-pnl-table');
    if (tbody) {
      tbody.innerHTML = '';
      (d.bySymbol || []).forEach(sym => {
        const accC = sym.accuracy >= 65 ? 'var(--green)' : sym.accuracy >= 50 ? 'var(--gold)' : 'var(--red)';
        const pnlC = sym.pnl >= 0 ? 'var(--green)' : 'var(--red)';
        const p = PAIRS.find(x => x.sym === sym.symbol || sym.symbol.includes(x.base));
        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td style="font-weight:600;color:var(--gold)">' + (p ? p.base : sym.symbol.replace('/USDT','')) + '</td>' +
          '<td style="font-family:var(--mono)">' + sym.trades + '</td>' +
          '<td class="green">' + sym.wins + '</td>' +
          '<td class="red">' + sym.losses + '</td>' +
          '<td style="color:' + accC + ';font-family:var(--mono)">' + sym.accuracy + '%</td>' +
          '<td style="color:' + pnlC + ';font-family:var(--mono)">' + (sym.pnl>=0?'+':'') + sym.pnl + '%</td>';
        tbody.appendChild(tr);
      });
      if (!d.bySymbol?.length) tbody.innerHTML = '<tr><td colspan="6" style="color:var(--t3);text-align:center;padding:16px">Sem dados — rode análises e clique em Auto-Trackear</td></tr>';
    }

    // Daily P&L chart
    const canvas = document.getElementById('ai-pnl-chart');
    if (canvas && d.dailyPnl?.length > 0) {
      if (_aiPnLChart) { _aiPnLChart.destroy(); _aiPnLChart = null; }
      const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      const labels = d.dailyPnl.map(x => x.day.slice(5));
      const data   = d.dailyPnl.map(x => x.pnl);
      _aiPnLChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label: 'P&L %',
            data,
            backgroundColor: data.map(v => v >= 0 ? 'rgba(63,185,80,0.7)' : 'rgba(248,81,73,0.7)'),
            borderColor:     data.map(v => v >= 0 ? '#3FB950' : '#F85149'),
            borderWidth: 1, borderRadius: 3,
          }]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ display:false } },
          scales:{
            x:{ grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#7d8590', font:{ size:10 } } },
            y:{ grid:{ color:'rgba(255,255,255,0.05)' }, ticks:{ color:'#7d8590', font:{ size:10 }, callback:v=>v+'%' } }
          }
        }
      });
      const noteEl = document.getElementById('pnl-chart-note');
      if (noteEl) noteEl.textContent = d.dailyPnl.length + ' dias com sinais';
    }
  } catch(e) { console.warn('[PnL Stats]', e.message); }
}



// ─── Real Binance Balance ──────────────────────────────────────────────────────
async function loadRealBalance() {
  const balEl = document.getElementById('d-bal');
  const subEl = document.getElementById('d-bal-sub');
  const lblEl = document.getElementById('d-bal-label');
  if (balEl) balEl.textContent = '...';
  if (subEl) subEl.textContent = 'Buscando saldo...';
  try {
    const r = await fetch('/api/binance/balance', { headers: auth.headers() });
    const d = await r.json();
    if (d.ok) {
      if (balEl) { balEl.textContent = '$' + parseFloat(d.totalUSDT).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); balEl.className = 'val green'; }
      if (subEl) subEl.textContent = (d.source === 'futures' ? '🔄 Futures USD-M' : '💰 Spot') + ' · ' + d.balances.length + ' ativo(s)';
      if (lblEl) lblEl.textContent = 'Saldo Binance Real';
    } else {
      if (balEl) { balEl.textContent = '$—'; balEl.className = 'val'; }
      const errMsg = d.error || 'Erro desconhecido';
      if (subEl) {
        if (errMsg.includes('API-key') || errMsg.includes('Invalid')) subEl.textContent = '❌ API Key inválida';
        else if (errMsg.includes('IP') || errMsg.includes('ip')) subEl.textContent = '❌ IP não autorizado na Binance';
        else if (errMsg.includes('não configurada') || errMsg.includes('not configured')) subEl.textContent = '⚙️ Configure a API Key em Meu Perfil';
        else subEl.textContent = '❌ ' + errMsg.slice(0,40);
      }
      if (lblEl) lblEl.textContent = 'Saldo Binance';
      console.warn('[Balance] Error:', errMsg);
    }
  } catch(e) {
    if (balEl) balEl.textContent = '$—';
    if (subEl) subEl.textContent = '❌ Erro de conexão';
    console.error('[Balance]', e.message);
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// FIND BEST OPPORTUNITIES — scan top pairs and rank by probability
// ─────────────────────────────────────────────────────────────────────────────
async function findBestOpportunities() {
  const status = document.getElementById('sc-status');
  const btn    = document.querySelector('[onclick="findBestOpportunities()"]');
  if (btn) { btn.textContent = '⏳ Analisando...'; btn.disabled = true; }
  if (status) status.textContent = 'Analisando os top 20 pares...';

  // Switch to scanner panel if not already there
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const nav = document.querySelector('[data-panel="scanner"]');
  const pan = document.getElementById('panel-scanner');
  if (nav) nav.classList.add('active');
  if (pan) pan.classList.add('active');
  document.querySelector('.content')?.scrollTo(0,0);

  const TOP_PAIRS = [
    'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
    'ADAUSDT','AVAXUSDT','DOGEUSDT','DOTUSDT','LINKUSDT',
    'MATICUSDT','UNIUSDT','ARBUSDT','OPUSDT','FETUSDT',
    'LDOUSDT','INJUSDT','SUIUSDT','TIAUSDT','SEIUSDT'
  ];

  const tf = document.getElementById('sc-timeframe')?.value || '1h';
  const results = [];
  let done = 0;

  await Promise.allSettled(TOP_PAIRS.map(async sym => {
    try {
      const klines = await fetchKlines(sym, tf, 100);
      const analysisData = runAnalysisEngine(klines);
      const pred   = analysisData.prediction || {};
      const ind    = analysisData.indicators || {};
      const ts     = analysisData.tech_summary || {};
      const smcObj = analysisData.smc || {};
      const sg     = generateTradingSuggestion(analysisData);
      const price  = analysisData.price || 0;
      const chgPct = analysisData.change_pct || 0;

      // Score formula
      const conf    = (pred?.confidence || 0) * 100;
      const rsi     = ind.rsi  || 50;
      const rsiOk   = rsi >= 35 && rsi <= 65;
      const dir     = sg?.direction || pred?.direction;
      const smcBias = smcObj.bias || '';
      const smcUp   = smcBias.toLowerCase().includes('alta') || smcBias.toLowerCase().includes('bull');
      const smcDn   = smcBias.toLowerCase().includes('baixa') || smcBias.toLowerCase().includes('bear');

      // Only score non-neutral signals
      if (!dir || dir === 'neutral') { done++; return; }

      // R:R estimation
      const atr  = ind.atr || price * 0.01;
      const sl   = atr * 1.5;
      const tp1  = atr * 2;
      const rr   = tp1 / Math.max(sl, 0.001);

      // Composite score (0-100)
      let score = conf * 0.4;                    // 40% from confidence
      if (rsiOk)  score += 20;                   // 20% RSI in healthy zone
      if (rr >= 2) score += 20;                  // 20% good R:R
      if ((dir === 'up' || dir === 'long') && smcUp) score += 20;
      if ((dir === 'down' || dir === 'short') && smcDn) score += 20;

      const isLng = dir==='up'||dir==='long';
      results.push({
        sym, price, chgPct, conf, rsi, rr: rr.toFixed(1),
        dir, score: Math.round(score), atr,
        sl:  isLng ? price-sl : price+sl,
        tp1: isLng ? price+tp1 : price-tp1,
        indicators: ind, prediction: pred
      });
    } catch(e) {}
    done++;
    if (status) status.textContent = 'Analisando... ' + done + '/' + TOP_PAIRS.length;
  }));

  // Sort by score DESC
  results.sort((a,b) => b.score - a.score);

  if (btn) { btn.textContent = '⚡ Melhores Oportunidades'; btn.disabled = false; }
  if (status) status.textContent = results.length + ' oportunidades encontradas';

  // Display in scanner table
  const emptyEl = document.getElementById('sc-empty');
  const gridEl  = document.getElementById('sc-grid');
  if (emptyEl) emptyEl.style.display = 'none';
  if (gridEl)  gridEl.style.display  = 'block';

  // Summary cards
  const longs  = results.filter(r => r.dir === 'up').length;
  const shorts = results.filter(r => r.dir === 'down').length;
  const best   = results[0];
  const sumEl  = document.getElementById('sc-summary');
  if (sumEl) sumEl.innerHTML =
    '<div class="metric"><label>Oportunidades</label><div class="val">' + results.length + '</div></div>' +
    '<div class="metric"><label>🟢 Long</label><div class="val green">' + longs + '</div></div>' +
    '<div class="metric"><label>🔴 Short</label><div class="val red">' + shorts + '</div></div>' +
    '<div class="metric"><label>⭐ Melhor</label><div class="val gold">' + (best?.sym.replace('USDT','') || '—') + '</div></div>';

  // Table
  const tbody = document.getElementById('sc-table');
  if (!tbody) return;
  tbody.innerHTML = '';
  results.slice(0,15).forEach((r, i) => {
    const dirLabel = r.dir === 'up' ? '🟢 LONG' : '🔴 SHORT';
    const dirColor = r.dir === 'up' ? 'var(--green)' : 'var(--red)';
    const scoreColor = r.score >= 70 ? 'var(--green)' : r.score >= 50 ? 'var(--gold)' : 'var(--t3)';
    const rsiColor   = r.rsi >= 35 && r.rsi <= 65 ? 'var(--green)' : r.rsi > 70 || r.rsi < 30 ? 'var(--red)' : 'var(--gold)';
    const tr = document.createElement('tr');
    if (i === 0) tr.style.background = 'rgba(240,185,11,0.05)';
    tr.innerHTML =
      '<td style="font-weight:700;color:var(--gold)">' + (i+1) + '</td>' +
      '<td style="font-weight:700;font-family:var(--mono)">' + r.sym.replace('USDT','') + '/USDT</td>' +
      '<td style="font-family:var(--mono);color:var(--green)">$' + r.price.toLocaleString('pt-BR',{minimumFractionDigits:2}) + '</td>' +
      '<td style="color:' + (r.chgPct>=0?'var(--green)':'var(--red)') + ';font-family:var(--mono)">' + (r.chgPct>=0?'+':'') + r.chgPct.toFixed(2) + '%</td>' +
      '<td style="color:' + dirColor + ';font-weight:700">' + dirLabel + '</td>' +
      '<td style="font-family:var(--mono)">' + r.conf.toFixed(0) + '%</td>' +
      '<td style="color:' + scoreColor + ';font-weight:700;font-family:var(--mono)">' + r.score + '/100</td>' +
      '<td style="color:' + rsiColor + ';font-family:var(--mono)">' + r.rsi.toFixed(0) + '</td>' +
      '<td style="font-family:var(--mono)">1:' + r.rr + '</td>' +
      '<td>' +
        '<button data-sym="' + r.sym + '" onclick="switchToAnalysis(this.dataset.sym)" style="font-size:10px;padding:4px 8px;background:var(--gold);border:none;border-radius:4px;color:#000;cursor:pointer;font-weight:700">⚡ Analisar</button>' +
      '</td>';
    tbody.appendChild(tr);
  });
}

function switchToAnalysis(sym) {
  // Navigate to Analysis AI with this symbol
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const nav = document.querySelector('[data-panel="analysisai"]');
  const pan = document.getElementById('panel-analysisai');
  if (nav) nav.classList.add('active');
  if (pan) pan.classList.add('active');
  document.querySelector('.content')?.scrollTo(0,0);
  const symSel = document.getElementById('ai-symbol');
  if (symSel) symSel.value = sym;
  buildAnalysisSymbolSelector();
  // Auto-run analysis
  setTimeout(() => {
    const runBtn = document.getElementById('ai-run-btn');
    if (runBtn) runBtn.click();
  }, 300);
}



// ─────────────────────────────────────────────────────────────────────────────
// SETUP SCORE — Automatic checklist after every analysis
// ─────────────────────────────────────────────────────────────────────────────
function buildSetupScore(data) {
  const card    = document.getElementById('ai-setup-score');
  const checks  = document.getElementById('setup-checks');
  const verdict = document.getElementById('setup-verdict');
  const rec     = document.getElementById('setup-recommendation');
  if (!card || !checks) return;

  const ind     = data.indicators   || {};
  const ts      = data.tech_summary || {};
  const smcObj  = data.smc          || {};
  const sg      = generateTradingSuggestion(data);
  const dir     = sg?.direction || 'flat';
  const isLong  = dir === 'long';
  const isShort = dir === 'short';
  const rsi     = ind.rsi       || 50;
  const macdH   = ind.macd_hist || 0;
  const adx     = ind.adx       || 0;
  const vwap    = ind.vwap      || 0;
  const price   = data.price    || 0;
  const smcBias = smcObj.bias   || '';
  const techScore = ts.score    || 0;
  const conf    = sg?.conf      || 0;
  const rr      = sg && sg.slPrice && sg.tp1 ? Math.abs(sg.tp1 - price) / Math.max(0.01, Math.abs(price - sg.slPrice)) : 0;

  // Define checks
  const checkList = [
    {
      label: 'Gauge técnico forte',
      ok:    Math.abs(techScore) >= 30,
      detail: `Score: ${techScore > 0 ? '+' : ''}${techScore}${Math.abs(techScore)>=30?' ✓':' (min. ±30)'}`,
      weight: 15
    },
    {
      label: 'RSI em zona saudável',
      ok:    rsi >= 35 && rsi <= 68,
      detail: `RSI: ${rsi.toFixed(1)}${rsi>=35&&rsi<=68?' ✓':rsi>70?' (sobrecomprado ⚠️)':' (sobrevendido ⚠️)'}`,
      weight: 15
    },
    {
      label: 'MACD confirma direção',
      ok:    (isLong && macdH > 0) || (isShort && macdH < 0) || (!isLong && !isShort),
      detail: `Histograma: ${macdH > 0 ? '+' : ''}${macdH.toFixed(2)}`,
      weight: 10
    },
    {
      label: 'ADX — tendência forte',
      ok:    adx >= 20,
      detail: `ADX: ${adx.toFixed(1)}${adx>=25?' (forte ✓)':adx>=20?' (moderado)':' (fraco ⚠️)'}`,
      weight: 10
    },
    {
      label: 'VWAP confirma posição',
      ok:    (isLong && price > vwap) || (isShort && price < vwap) || !vwap,
      detail: `Preço ${price > vwap ? 'acima' : 'abaixo'} do VWAP (${vwap > 0 ? '$'+vwap.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—'})`,
      weight: 10
    },
    {
      label: 'SMC estrutura alinhada',
      ok:    (isLong && smcBias?.toLowerCase().includes('alta')) ||
             (isShort && smcBias?.toLowerCase().includes('baixa')) ||
             smcBias?.toLowerCase().includes('altista') ||
             smcBias?.toLowerCase().includes('baixista') && isShort,
      detail: `Viés SMC: ${smcBias || '—'}`,
      weight: 15
    },
    {
      label: 'Confiança do sinal ≥65%',
      ok:    conf >= 65,
      detail: `Confiança: ${conf}%${conf>=65?' ✓':' (min. 65%)'}`,
      weight: 10
    },
    {
      label: 'R:R mínimo 1:2',
      ok:    sg && Math.abs(rr) >= 2,
      detail: `R:R: 1:${Math.abs(rr).toFixed(1)}${Math.abs(rr)>=2?' ✓':' (min. 1:2)'}`,
      weight: 15
    },
  ];

  // Calculate score
  let totalScore = 0;
  let passCount  = 0;
  checkList.forEach(c => { if (c.ok) { totalScore += c.weight; passCount++; } });

  // Render checks
  checks.innerHTML = '';
  checkList.forEach(c => {
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:7px 10px;border-radius:6px;background:' +
      (c.ok ? 'rgba(63,185,80,0.07)' : 'rgba(248,81,73,0.07)') + ';border:1px solid ' +
      (c.ok ? 'rgba(63,185,80,0.2)' : 'rgba(248,81,73,0.15)');
    div.innerHTML =
      '<span style="font-size:16px;flex-shrink:0;margin-top:-1px">' + (c.ok ? '✅' : '❌') + '</span>' +
      '<div>' +
        '<div style="font-size:12px;font-weight:600;color:' + (c.ok ? 'var(--green)' : 'var(--red)') + '">' + c.label + '</div>' +
        '<div style="font-size:10px;color:var(--t3);margin-top:1px">' + c.detail + '</div>' +
      '</div>';
    checks.appendChild(div);
  });

  // Verdict badge
  const verdictConfig =
    totalScore >= 80 ? { txt:'⚡ SETUP IDEAL — ENTRAR!',   bg:'#3FB950', color:'#000' } :
    totalScore >= 60 ? { txt:'⚠️ SETUP MODERADO — CUIDADO', bg:'#F0B90B', color:'#000' } :
    totalScore >= 40 ? { txt:'🟡 SETUP FRACO — AGUARDAR',   bg:'rgba(240,185,11,0.2)', color:'#F0B90B' } :
                       { txt:'🔴 NÃO ENTRAR — SETUP RUIM',  bg:'rgba(248,81,73,0.15)', color:'#F85149' };

  verdict.textContent   = verdictConfig.txt + '  (' + totalScore + '/100)';
  verdict.style.background = verdictConfig.bg;
  verdict.style.color       = verdictConfig.color;
  verdict.style.border      = '1px solid ' + verdictConfig.bg;

  // Recommendation box
  if (rec) {
    rec.style.display = 'block';
    const missing = checkList.filter(c => !c.ok).map(c => c.label);
    if (totalScore >= 80) {
      rec.style.background = 'rgba(63,185,80,0.08)';
      rec.style.border     = '1px solid rgba(63,185,80,0.3)';
      rec.style.color      = 'var(--green)';
      rec.innerHTML = '✅ <strong>' + passCount + '/8 critérios atendidos.</strong> Setup com alta probabilidade. Use o Stop Loss de $' +
        (sg?.slPrice ? sg.slPrice.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '—') + ' e realize parcial no TP1.';
    } else {
      rec.style.background = 'rgba(248,81,73,0.06)';
      rec.style.border     = '1px solid rgba(248,81,73,0.2)';
      rec.style.color      = 'var(--t2)';
      rec.innerHTML = '⏳ <strong>' + passCount + '/8 critérios atendidos.</strong> Aguarde: ' +
        missing.slice(0,2).map(m => '<em>' + m + '</em>').join(', ') +
        (missing.length > 2 ? ' +' + (missing.length-2) + ' outros.' : '.');
    }
  }

  card.style.display = 'block';
  
  // Scroll to setup score
  setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 200);
}


document.addEventListener('DOMContentLoaded', () => {
  loadTheme();
  initLoginParticles();
  updateLoginSubtitle();
  initCookieConsent();
  const style = document.createElement('style');
  style.textContent = '@keyframes fadeIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }';
  document.head.appendChild(style);
  if (auth.token) {
    // Check token validity AND get role in one call
    fetch('/api/auth/me', { headers: auth.headers() })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d && d.ok) {
          // Store role fresh from server
          if (d.user?.role) localStorage.setItem('ce_role', d.user.role);
          if (d.user?.plan) localStorage.setItem('ce_plan', d.user.plan);
          enterApp();
        } else {
          // Token invalid
          auth.clear();
          checkSetup();
        }
      })
      .catch(() => {
        // Network error — try to enter anyway (offline mode)
        enterApp();
      });
  } else {
    checkSetup();
  }
});

// ── initApp — called after successful login ──────────────────────────────────
function initApp() {
  buildDashTickers();
  buildMarketGrid();
  buildMarketTable();
  buildChartPairSelector();

  function tryInitTV(attempt) {
    if (typeof TradingView !== 'undefined') { initTradingView(); }
    else if (attempt < 20) setTimeout(() => tryInitTV(attempt+1), 500);
    else {
      const loader = document.getElementById('tv-loading');
      if (loader) { loader.style.display = 'none'; }
      const c = document.getElementById('tradingview-widget');
      if(c) c.innerHTML = '<div style="height:420px;display:flex;align-items:center;justify-content:center;color:var(--t3);font-size:12px;flex-direction:column;gap:8px"><div>⚠ TradingView indisponível</div><div style=\'font-size:10px\'>Verifique sua conexão com internet</div></div>';
    }
  }
  tryInitTV(0);

  fetchPricesREST().then(() => {
    updateDashboardRankings();
    filterMarkets();
    // Force topbar update for active pair after prices load
    const d = state.prices[state.activePair];
    if (d) {
      const up = d.change >= 0;
      const e = document.getElementById.bind(document);
      const setEl = (id, v, cls) => { const el = e(id); if(el){el.textContent=v;if(cls)el.className=cls;} };
      setEl('tb-price',  fmtUSD(d.price),  'topbar-price '  + (up?'up':'dn'));
      setEl('tb-change', (up?'+':'')+d.change.toFixed(2)+'%', 'topbar-change '+(up?'up':'dn'));
      setEl('tb-high',   fmtUSD(d.high));
      setEl('tb-low',    fmtUSD(d.low));
      setEl('tb-vol',    d.vol>=1e9?fmtUSD(d.vol/1e9,2)+'B':fmtUSD(d.vol/1e6,1)+'M');
      const pb = document.getElementById('tb-pair');
      if (pb) { const p=PAIRS.find(x=>x.sym===state.activePair); pb.textContent=(p?p.base:'BTC')+'/USDT'; }
    }
    setInterval(() => {
      updateDashboardRankings();
      renderWatchlistSidebar();
      // Re-apply topbar if still empty
      const d2 = state.prices[state.activePair];
      if (d2 && document.getElementById('tb-price')?.textContent === '—') {
        const up2 = d2.change >= 0;
        const setEl2 = (id, v, cls) => { const el = document.getElementById(id); if(el){el.textContent=v;if(cls)el.className=cls;} };
        setEl2('tb-price', fmtUSD(d2.price), 'topbar-price '+(up2?'up':'dn'));
        setEl2('tb-change', (up2?'+':'')+d2.change.toFixed(2)+'%', 'topbar-change '+(up2?'up':'dn'));
      }
      if (document.getElementById('panel-markets')?.classList.contains('active')) filterMarkets();
    }, 5000);
  });
  connectWS();
  loadFearGreed();
  loadTrades();
  loadStats();
  // ── Polling global do badge do bot no sidebar (a cada 15s, leve) ──────────
  async function _updateBotSidebarBadge() {
    try {
      const r = await fetch('/api/bot/status');
      const d = await r.json();
      const badge = document.getElementById('bot-status-badge');
      if (!badge) return;
      const running = d.running;
      badge.textContent = running ? 'ON' : 'OFF';
      badge.style.background   = running ? 'var(--green)' : '';
      badge.style.color        = running ? '#000' : '';
      badge.style.borderRadius = running ? '3px' : '';
    } catch {}
  }
  _updateBotSidebarBadge();
  setInterval(_updateBotSidebarBadge, 15000);
  loadWatchlist();
  buildAnalysisSymbolSelector();
  buildAlertSymbolSelector();
  loadAlerts();
  updateModeBadge();
  setInterval(updateModeBadge, 30000);
  setInterval(loadAlerts, 30000);
  calcLev();
  calcRisk();
  calcGrid();
}

// ─── Webhook Token UI ─────────────────────────────────────────────────────────
function copyWebhookToken() {
  const el = document.getElementById('profile-webhook-token');
  if (!el) return;
  const text = el.textContent.trim();
  if (!text || text === 'Carregando...') return;
  navigator.clipboard.writeText(text).then(() => showToast('Token copiado!')).catch(() => {
    const inp = document.createElement('textarea');
    inp.value = text; document.body.appendChild(inp); inp.select();
    document.execCommand('copy'); document.body.removeChild(inp);
    showToast('Token copiado!');
  });
}

// Show webhook token in profile — uses event instead of redeclaring loadProfile
document.addEventListener('profileLoaded', async () => {
  try {
    const r = await fetch('/api/auth/me', { headers: auth.headers() });
    const d = await r.json();
    const el = document.getElementById('profile-webhook-token');
    if (el && d.user && d.user.webhook_token) el.textContent = d.user.webhook_token;
  } catch {}
});

// ─── Export CSV helper ────────────────────────────────────────────────────────
function downloadTradesCSV() {
  const a = document.createElement('a');
  a.href = '/api/trades/export/csv';
  a.download = 'trades_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// ─── Bot Keys Warning ─────────────────────────────────────────────────────────
async function checkBotKeysWarning() {
  const warn = document.getElementById('bc-no-keys-warn');
  if (!warn) return;
  try {
    const r = await fetch('/api/auth/me', { headers: auth.headers() });
    const d = await r.json();
    const hasKeys = d.ok && d.user?.has_binance_key;
    warn.style.display = hasKeys ? 'none' : 'block';
    // Also disable start button if no keys
    const startBtn = document.getElementById('bc-btn-start');
    if (startBtn) {
      startBtn.disabled = !hasKeys;
      startBtn.style.opacity = hasKeys ? '1' : '0.5';
      startBtn.title = hasKeys ? '' : 'Configure as chaves Binance em Meu Perfil';
    }
  } catch {}
}

// ─── showPanel helper (used in bot warning link) ──────────────────────────────
function showPanel(panelName) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const nav = document.querySelector(`[data-panel="${panelName}"]`);
  const pan = document.getElementById('panel-' + panelName);
  if (nav) nav.classList.add('active');
  if (pan) pan.classList.add('active');
  if (panelName === 'profile') loadProfile();
}
