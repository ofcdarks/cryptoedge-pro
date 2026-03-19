/**
 * CryptoEdge Pro — Sistema de Onboarding
 * Tutorial interativo para iniciantes, intermediários e profissionais.
 * Inclui: wizard de boas-vindas, tour guiado, tooltips, glossário e centro de ajuda.
 */

// ─── Estado global ─────────────────────────────────────────────────────────────
const _OB = {
  active:      false,
  step:        0,
  path:        null,   // 'beginner' | 'intermediate' | 'professional'
  tourSteps:   [],
  tooltips:    [],
  completed:   new Set(JSON.parse(localStorage.getItem('ce_ob_done') || '[]')),
};

function _obSave() {
  localStorage.setItem('ce_ob_done', JSON.stringify([..._OB.completed]));
}

// ─── CSS ───────────────────────────────────────────────────────────────────────
(function() {
  if (document.getElementById('ob-css')) return;
  const s = document.createElement('style');
  s.id = 'ob-css';
  s.textContent = `
    @keyframes obIn   { from{opacity:0;transform:translateY(16px) scale(.97)} to{opacity:1;transform:none} }
    @keyframes obOut  { from{opacity:1;transform:none} to{opacity:0;transform:translateY(8px) scale(.98)} }
    @keyframes obPulse{ 0%,100%{box-shadow:0 0 0 0 rgba(240,185,11,.5)} 50%{box-shadow:0 0 0 8px rgba(240,185,11,0)} }
    @keyframes obBounce{ 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
    @keyframes obSpot { 0%,100%{box-shadow:0 0 0 0 rgba(240,185,11,.6),0 0 0 4px rgba(240,185,11,.3)} 50%{box-shadow:0 0 0 6px rgba(240,185,11,.0),0 0 0 12px rgba(240,185,11,0)} }

    .ob-overlay    { position:fixed;inset:0;z-index:199998;background:rgba(0,0,0,.75);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px; }
    .ob-card       { background:var(--bg1);border:1px solid var(--border2);border-radius:18px;width:100%;animation:obIn .28s cubic-bezier(.34,1.56,.64,1);box-shadow:0 32px 80px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.04);overflow:hidden;display:flex;flex-direction:column; }
    .ob-card-sm    { max-width:440px; }
    .ob-card-lg    { max-width:640px; }
    .ob-card-xl    { max-width:780px; }
    .ob-header     { padding:28px 28px 0; }
    .ob-icon-wrap  { width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;border:1px solid; }
    .ob-title      { font-size:20px;font-weight:700;color:var(--t1);font-family:var(--sans);line-height:1.25; }
    .ob-sub        { font-size:14px;color:var(--t2);line-height:1.6;margin-top:6px; }
    .ob-body       { padding:20px 28px; }
    .ob-div        { height:1px;background:var(--border);margin:0 28px; }
    .ob-footer     { padding:16px 28px 22px;display:flex;gap:10px;align-items:center; }
    .ob-btn        { padding:11px 24px;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer;border:none;font-family:var(--sans);transition:opacity .15s,transform .1s; }
    .ob-btn:active { transform:scale(.97); }
    .ob-btn-skip   { background:transparent;border:1px solid var(--border2);color:var(--t3);padding:11px 16px;font-size:13px; }
    .ob-btn-back   { background:var(--bg3);border:1px solid var(--border2);color:var(--t2); }
    .ob-btn-next   { background:var(--gold);color:#000; }
    .ob-btn-green  { background:var(--green);color:#000; }
    .ob-btn-blue   { background:var(--blue);color:#000; }
    .ob-progress   { display:flex;gap:6px;align-items:center;margin-right:auto; }
    .ob-dot        { width:8px;height:8px;border-radius:50%;background:var(--border2);transition:all .2s; }
    .ob-dot.active { background:var(--gold);width:20px;border-radius:4px; }
    .ob-dot.done   { background:var(--green); }

    /* Path cards */
    .ob-path       { padding:16px;border-radius:12px;border:1.5px solid var(--border);cursor:pointer;transition:all .2s;background:var(--bg2); }
    .ob-path:hover { border-color:var(--gold);background:var(--golddim);transform:translateY(-2px); }
    .ob-path.sel   { border-color:var(--gold);background:var(--golddim); }
    .ob-path-icon  { font-size:28px;margin-bottom:8px; }
    .ob-path-title { font-size:14px;font-weight:700;color:var(--t1); }
    .ob-path-sub   { font-size:12px;color:var(--t3);margin-top:4px;line-height:1.5; }
    .ob-path-tags  { display:flex;flex-wrap:wrap;gap:4px;margin-top:10px; }
    .ob-tag        { font-size:10px;padding:2px 8px;border-radius:4px;background:var(--bg3);color:var(--t3);font-family:var(--mono); }
    .ob-tag.g      { background:var(--greendim);color:var(--green); }

    /* Tour tooltip */
    .ob-tooltip    { position:fixed;z-index:299999;background:var(--bg1);border:1px solid var(--border2);border-radius:12px;padding:0;max-width:320px;min-width:260px;box-shadow:0 16px 48px rgba(0,0,0,.6);animation:obIn .2s cubic-bezier(.34,1.56,.64,1); }
    .ob-tooltip-h  { padding:14px 16px 0;display:flex;gap:10px;align-items:flex-start; }
    .ob-tooltip-ic { font-size:20px;flex-shrink:0; }
    .ob-tooltip-ti { font-size:13px;font-weight:700;color:var(--t1); }
    .ob-tooltip-tx { font-size:12px;color:var(--t2);line-height:1.6;margin-top:3px; }
    .ob-tooltip-f  { padding:10px 16px 14px;display:flex;gap:8px;align-items:center; }
    .ob-tooltip-b  { padding:7px 14px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:none;font-family:var(--sans); }
    .ob-tooltip-arr{ position:absolute;width:10px;height:10px;background:var(--bg1);border:1px solid var(--border2);transform:rotate(45deg); }

    /* Spotlight */
    .ob-spotlight  { position:fixed;z-index:199997;border-radius:10px;border:2px solid var(--gold);animation:obSpot 1.5s infinite;pointer-events:none;transition:all .3s ease; }

    /* Mini help button (sempre visível) */
    .ob-help-fab   { position:fixed;bottom:24px;right:24px;z-index:99990;width:46px;height:46px;border-radius:50%;background:var(--gold);color:#000;font-size:20px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 16px rgba(240,185,11,.4);border:none;transition:all .2s;animation:obBounce 2s ease infinite; }
    .ob-help-fab:hover{ transform:scale(1.1);animation:none; }

    /* Help center panel */
    .ob-help-panel { position:fixed;bottom:80px;right:24px;z-index:99991;width:340px;background:var(--bg1);border:1px solid var(--border2);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.6);animation:obIn .2s ease;overflow:hidden; }
    .ob-help-search{ width:100%;padding:10px 14px;background:var(--bg2);border:none;border-bottom:1px solid var(--border);color:var(--t1);font-size:13px;font-family:var(--sans);outline:none; }
    .ob-help-search::placeholder{ color:var(--t3); }
    .ob-help-item  { padding:10px 16px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;gap:10px;align-items:flex-start;transition:background .15s; }
    .ob-help-item:hover{ background:var(--bg2); }
    .ob-help-item:last-child{ border-bottom:none; }
    .ob-help-emoji { font-size:18px;flex-shrink:0;margin-top:1px; }
    .ob-help-q     { font-size:12px;font-weight:600;color:var(--t1); }
    .ob-help-a     { font-size:11px;color:var(--t3);line-height:1.5;margin-top:2px; }

    /* Checklist */
    .ob-check-item { display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border); }
    .ob-check-item:last-child{ border:none; }
    .ob-check-box  { width:20px;height:20px;border-radius:5px;border:1.5px solid var(--border2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:11px;cursor:pointer;transition:all .2s;margin-top:1px; }
    .ob-check-box.done{ background:var(--green);border-color:var(--green);color:#000; }
    .ob-check-label{ font-size:13px;color:var(--t1);line-height:1.5; }
    .ob-check-sub  { font-size:11px;color:var(--t3);margin-top:2px; }
  `;
  document.head.appendChild(s);
})();

// ─── DADOS DO TUTORIAL ────────────────────────────────────────────────────────
const OB_PATHS = {
  beginner: {
    label: 'Iniciante',
    emoji: '🌱',
    color: 'var(--green)',
    desc: 'Nunca operei cripto ou acabei de chegar',
    tags: ['Conceitos básicos', 'Passo a passo', 'Sem risco'],
    steps: [
      {
        title: 'Bem-vindo ao CryptoEdge Pro! 🚀',
        icon: '🎉',
        color: 'var(--gold)',
        content: `
          <p style="color:var(--t2);font-size:14px;line-height:1.7;margin-bottom:14px">Esta plataforma foi criada para te ajudar a operar criptomoedas de forma inteligente — do básico ao automático.</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[['🤖','Bot de trading automático','Opera 24h no seu lugar'],['📊','Análise de mercado com IA','Detecta padrões e tendências'],['🎯','Gestão de risco integrada','Protege seu capital'],['📱','Funciona no celular','Alertas em tempo real']].map(([e,t,d])=>`
              <div style="display:flex;gap:12px;align-items:center;padding:10px;border-radius:8px;background:var(--bg2)">
                <span style="font-size:20px">${e}</span>
                <div><div style="font-size:13px;font-weight:600;color:var(--t1)">${t}</div><div style="font-size:11px;color:var(--t3)">${d}</div></div>
              </div>`).join('')}
          </div>`,
        btnNext: 'Vamos começar →',
      },
      {
        title: 'O que é cripto trading?',
        icon: '📚',
        color: 'var(--blue)',
        content: `
          <div style="display:flex;flex-direction:column;gap:10px">
            ${[
              ['💰','O que é USDT?','É uma moeda digital estável ligada ao Dólar. 1 USDT = ~R$5,70. Você opera com USDT para comprar e vender criptos como Bitcoin.'],
              ['📈','O que é uma ordem LONG?','Você compra acreditando que o preço vai subir. Se comprou a $70.000 e vendeu a $75.000 → ganhou $5.000.'],
              ['📉','O que é uma ordem SHORT?','Você vende acreditando que o preço vai cair. Funciona ao contrário — você lucra quando o preço cai.'],
              ['🛡','O que é Stop Loss?','É um limite automático de perda. Se você define SL em $68.000, o sistema vende automaticamente quando o preço cai até lá — protegendo seu capital.'],
              ['🎯','O que é Take Profit?','É seu alvo de lucro. Quando o preço sobe até seu TP, o sistema vende automaticamente e realiza o lucro.'],
            ].map(([e,t,d])=>`
              <div style="padding:10px 12px;border-radius:8px;background:var(--bg2);border-left:3px solid var(--blue)">
                <div style="font-size:12px;font-weight:700;color:var(--t1)">${e} ${t}</div>
                <div style="font-size:11px;color:var(--t3);margin-top:3px;line-height:1.5">${d}</div>
              </div>`).join('')}
          </div>`,
        btnNext: 'Entendido! →',
      },
      {
        title: 'Modo Simulação — sem risco real',
        icon: '🧪',
        color: 'var(--green)',
        content: `
          <div style="padding:14px;background:var(--greendim);border:1px solid var(--green);border-radius:10px;margin-bottom:16px">
            <div style="font-size:14px;font-weight:700;color:var(--green);margin-bottom:6px">✅ Recomendação para iniciantes</div>
            <div style="font-size:13px;color:var(--t2);line-height:1.6">Comece sempre em <b>Testnet</b> ou <b>Paper Trading</b>. Você opera com dinheiro fictício, mas vê os resultados em tempo real — sem arriscar nada.</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[
              ['🧪','Testnet','Opera na rede de teste da Binance. Idêntico ao real, sem dinheiro real.','Configurar agora','botcontrol'],
              ['📋','Paper Trading','Simula operações com capital fictício ($1000). Perfeito para testar estratégias.','Experimentar','botcontrol'],
              ['⏪','Replay Histórico','Reveja operações passadas e veja como o bot teria performado.','Ver replay','replay'],
            ].map(([e,t,d,btn,panel])=>`
              <div style="display:flex;gap:12px;align-items:center;padding:10px;border-radius:8px;background:var(--bg2);cursor:pointer" onclick="obGoPanel('${panel}')">
                <span style="font-size:22px">${e}</span>
                <div style="flex:1"><div style="font-size:13px;font-weight:600;color:var(--t1)">${t}</div><div style="font-size:11px;color:var(--t3)">${d}</div></div>
                <span style="font-size:11px;color:var(--gold)">→</span>
              </div>`).join('')}
          </div>`,
        btnNext: 'Próximo →',
      },
      {
        title: 'Configure suas chaves Binance',
        icon: '🔑',
        color: 'var(--gold)',
        content: `
          <div style="display:flex;flex-direction:column;gap:12px">
            <div style="font-size:13px;color:var(--t2);line-height:1.6">Para o bot operar, ele precisa de acesso à sua conta Binance através de uma chave de API. <b style="color:var(--t1)">Você mantém controle total</b> — o bot só pode operar, nunca sacar.</div>
            ${[
              ['1','Crie uma conta na Binance','binance.com (grátis)'],
              ['2','Acesse: Perfil → Gerenciamento de API','Crie uma chave nova'],
              ['3','Ative apenas: Leitura + Operações à vista','NÃO ative saque'],
              ['4','Cole a API Key e Secret no CryptoEdge','Meu Perfil → Chaves de API'],
            ].map(([n,t,d])=>`
              <div style="display:flex;gap:12px;align-items:center;padding:10px;border-radius:8px;background:var(--bg2)">
                <div style="width:28px;height:28px;border-radius:50%;background:var(--golddim);border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:var(--gold);flex-shrink:0">${n}</div>
                <div><div style="font-size:13px;font-weight:600;color:var(--t1)">${t}</div><div style="font-size:11px;color:var(--t3)">${d}</div></div>
              </div>`).join('')}
          </div>`,
        btnNext: 'Ir para Meu Perfil →',
        action: () => obGoPanel('profile'),
      },
      {
        title: 'Seu primeiro bot!',
        icon: '🤖',
        color: 'var(--gold)',
        content: `
          <div style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:14px">Vamos configurar seu primeiro bot em 3 cliques:</div>
          ${[
            ['1','Acesse Bot Control','Menu lateral → Bot Control'],
            ['2','Escolha a estratégia Pattern AI','Detecta padrões automáticos — ideal para iniciantes'],
            ['3','Defina capital e timeframe','Comece com pouco: $50–100, timeframe 15m'],
            ['4','Mantenha Testnet ativado','Opere em simulação por pelo menos 1 semana'],
            ['5','Clique em Iniciar Bot','O bot começa a monitorar o mercado'],
          ].map(([n,t,d])=>`
            <div style="display:flex;gap:12px;align-items:center;padding:8px;border-radius:8px;background:var(--bg2);margin-bottom:6px">
              <div style="width:24px;height:24px;border-radius:50%;background:var(--golddim);border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--gold);flex-shrink:0">${n}</div>
              <div><div style="font-size:12px;font-weight:600;color:var(--t1)">${t}</div><div style="font-size:10px;color:var(--t3)">${d}</div></div>
            </div>`).join('')}
          <div style="margin-top:12px;padding:10px;background:var(--reddim);border:1px solid var(--red);border-radius:8px;font-size:12px;color:var(--t2)">⚠️ <b>Regra de ouro:</b> Nunca invista mais do que pode perder. Cripto é volátil.</div>`,
        btnNext: 'Abrir Bot Control →',
        action: () => obGoPanel('botcontrol'),
        btnFinish: true,
      },
    ],
  },

  intermediate: {
    label: 'Intermediário',
    emoji: '⚡',
    color: 'var(--gold)',
    desc: 'Já opero, quero automatizar e melhorar resultados',
    tags: ['Copy trading', 'Backtesting', 'Gestão de risco', 'Multi-par'],
    steps: [
      {
        title: 'Boas-vindas ao nível intermediário',
        icon: '⚡',
        color: 'var(--gold)',
        content: `
          <p style="color:var(--t2);font-size:14px;line-height:1.7;margin-bottom:16px">Você já conhece o básico. Vamos focar em ferramentas que multiplicam seus resultados:</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${[
              ['🔄','Walk-Forward','Teste se sua estratégia não é overfitting'],
              ['👥','Copy Trading','Copie traders com histórico comprovado'],
              ['🎯','Session Manager','Pare ao atingir gain ou loss da sessão'],
              ['📡','Multi-par Scanner','Monitore 15 pares simultaneamente'],
              ['📺','TradingView','Integre seus alertas Pine Script'],
              ['📊','Equity Curve','Acompanhe seu desempenho real'],
            ].map(([e,t,d])=>`
              <div style="padding:10px;border-radius:8px;background:var(--bg2)">
                <div style="font-size:18px;margin-bottom:4px">${e}</div>
                <div style="font-size:12px;font-weight:600;color:var(--t1)">${t}</div>
                <div style="font-size:11px;color:var(--t3);margin-top:2px">${d}</div>
              </div>`).join('')}
          </div>`,
        btnNext: 'Continuar →',
      },
      {
        title: 'Gestão de Risco — o que separa os lucrativos',
        icon: '🛡',
        color: 'var(--blue)',
        content: `
          <div style="margin-bottom:14px;padding:12px;background:var(--bluedim);border:1px solid var(--blue);border-radius:8px;font-size:13px;color:var(--t2);line-height:1.6">
            <b style="color:var(--blue)">Regra dos 3 perfis:</b> O CryptoEdge já vem com perfis pré-configurados. Escolha o que corresponde ao seu momento.
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[
              ['🛡️ Conservador','Risco 1% · Alavancagem 1× · Confiança 75%','Para mercados voláteis ou quando estiver em dúvida','var(--green)'],
              ['⚡ Audacioso','Risco 2% · Alavancagem 3× · Confiança 65%','Equilíbrio risco-retorno para quem já tem experiência','var(--gold)'],
              ['🔥 Expert','Risco 3% · Alavancagem 5× · Confiança 60%','Alto risco — somente se você tem consistência comprovada','var(--red)'],
            ].map(([t,p,d,c])=>`
              <div style="padding:10px 12px;border-radius:8px;background:var(--bg2);border-left:3px solid ${c}">
                <div style="font-size:13px;font-weight:700;color:var(--t1)">${t}</div>
                <div style="font-size:11px;color:${c};font-family:var(--mono);margin-top:2px">${p}</div>
                <div style="font-size:11px;color:var(--t3);margin-top:3px">${d}</div>
              </div>`).join('')}
          </div>
          <div style="margin-top:12px;font-size:12px;color:var(--t3)">💡 Acesse <b style="color:var(--t2)">Gestão de Risco</b> e clique no perfil desejado para auto-configurar tudo.</div>`,
        btnNext: 'Ir para Gestão de Risco →',
        action: () => obGoPanel('risk'),
      },
      {
        title: 'Backtesting + Walk-Forward',
        icon: '🔬',
        color: 'var(--blue)',
        content: `
          <div style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:14px">Antes de usar qualquer estratégia com dinheiro real, teste-a historicamente:</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[
              ['📊','Backtest padrão','Testa a estratégia em dados históricos (até 500 velas). Mostra WR, Sharpe, Drawdown.'],
              ['🔄','Walk-Forward','Divide os dados em 4 períodos e testa cada um. Se a estratégia só funciona no total mas não em cada período → está sobreajustada.'],
              ['⚙️','Otimização','Testa combinações de parâmetros (EMA 9×21, 14×34...) e mostra o Top 5 por Sharpe Ratio.'],
            ].map(([e,t,d])=>`
              <div style="padding:10px 12px;border-radius:8px;background:var(--bg2);margin-bottom:4px">
                <div style="font-size:13px;font-weight:700;color:var(--t1)">${e} ${t}</div>
                <div style="font-size:11px;color:var(--t3);margin-top:3px;line-height:1.5">${d}</div>
              </div>`).join('')}
          </div>
          <div style="margin-top:12px;padding:10px;background:var(--golddim);border:1px solid var(--gold);border-radius:8px;font-size:12px;color:var(--t2)">
            ⚠️ <b>Importante:</b> Resultados passados não garantem resultados futuros. O walk-forward reduz (mas não elimina) esse risco.
          </div>`,
        btnNext: 'Ver Backtesting →',
        action: () => obGoPanel('backtest'),
        btnFinish: true,
      },
    ],
  },

  professional: {
    label: 'Profissional',
    emoji: '🔥',
    color: 'var(--red)',
    desc: 'Trader ativo, quero as ferramentas avançadas',
    tags: ['API', 'SMC', 'Copy leader', 'Multi-exchange', 'IR Fiscal'],
    steps: [
      {
        title: 'Ferramentas pro-level',
        icon: '🔥',
        color: 'var(--red)',
        content: `
          <p style="color:var(--t2);font-size:14px;line-height:1.7;margin-bottom:14px">Visão geral rápida dos recursos avançados exclusivos desta plataforma:</p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${[
              ['🧠','SMC Analysis','Order Blocks, FVG, harmônicos — análise institucional'],
              ['📺','Pine Script','Alertas do TradingView executam ordens automaticamente'],
              ['👑','Copy Leader','Publique sua estratégia e ganhe taxa sobre os lucros dos seguidores'],
              ['🔗','Multi-Exchange','Saldo unificado Binance + Bybit + OKX'],
              ['🧾','IR Fiscal','Cálculo DARF 6015 mensal automático para declaração de IR'],
              ['⏪','Replay + Bot IA','Analise estratégias com comentário da IA em tempo real'],
            ].map(([e,t,d])=>`
              <div style="padding:10px;border-radius:8px;background:var(--bg2)">
                <div style="font-size:18px;margin-bottom:4px">${e}</div>
                <div style="font-size:12px;font-weight:600;color:var(--t1)">${t}</div>
                <div style="font-size:11px;color:var(--t3);margin-top:2px">${d}</div>
              </div>`).join('')}
          </div>`,
        btnNext: 'Continuar →',
      },
      {
        title: 'Copy Trading — ganhe como líder',
        icon: '👑',
        color: 'var(--gold)',
        content: `
          <div style="font-size:13px;color:var(--t2);line-height:1.6;margin-bottom:14px">Você pode ganhar uma taxa automática sobre o lucro de quem te copia:</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[
              ['1','Publique seu perfil de líder','Copy Trading → Meu Perfil de Líder → preencha nome, bio e % de taxa'],
              ['2','Defina sua taxa (0-20%)','Recomendado: 10-15%. Quando seguidores têm lucro, você recebe automaticamente.'],
              ['3','Suas operações são copiadas','Cada trade que você faz é replicado nos seguidores proporcionalmente ao capital deles.'],
              ['4','Acompanhe no dashboard','Veja seguidores, trades copiados e taxas recebidas em tempo real.'],
            ].map(([n,t,d])=>`
              <div style="display:flex;gap:10px;padding:8px;border-radius:8px;background:var(--bg2);margin-bottom:4px">
                <div style="width:22px;height:22px;border-radius:50%;background:var(--golddim);border:1px solid var(--gold);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--gold);flex-shrink:0">${n}</div>
                <div><div style="font-size:12px;font-weight:600;color:var(--t1)">${t}</div><div style="font-size:11px;color:var(--t3);margin-top:1px;line-height:1.4">${d}</div></div>
              </div>`).join('')}
          </div>`,
        btnNext: 'Ver Copy Trading →',
        action: () => obGoPanel('copy'),
      },
      {
        title: 'IR Fiscal — obrigação legal no Brasil',
        icon: '🧾',
        color: 'var(--red)',
        content: `
          <div style="padding:12px;background:var(--reddim);border:1px solid var(--red);border-radius:8px;margin-bottom:14px;font-size:13px;color:var(--t2);line-height:1.6">
            ⚠️ <b style="color:var(--red)">Atenção:</b> Vendas mensais acima de R$35.000 em cripto são tributáveis no Brasil — mesmo que você não tenha sacado.
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${[
              ['📊','Acompanhamento automático','A plataforma calcula seu PnL mensal e indica se você precisa pagar DARF.'],
              ['💸','Alíquota 15%','Sobre o lucro líquido quando vendas mensais ultrapassam R$35.000.'],
              ['📋','Código DARF 6015','Prazo: último dia útil do mês seguinte ao ganho.'],
              ['📄','Relatório HTML','Gere o relatório anual para apresentar ao contador.'],
            ].map(([e,t,d])=>`
              <div style="display:flex;gap:10px;align-items:flex-start;padding:8px;border-radius:8px;background:var(--bg2)">
                <span style="font-size:18px">${e}</span>
                <div><div style="font-size:12px;font-weight:600;color:var(--t1)">${t}</div><div style="font-size:11px;color:var(--t3);margin-top:2px;line-height:1.4">${d}</div></div>
              </div>`).join('')}
          </div>`,
        btnNext: 'Ver IR Fiscal →',
        action: () => obGoPanel('fiscal'),
        btnFinish: true,
      },
    ],
  },
};

// ─── CHECKLIST DE PRIMEIROS PASSOS ────────────────────────────────────────────
const OB_CHECKLIST = [
  { id:'binance_key',  label:'Configurar chaves Binance',      sub:'Meu Perfil → Chaves de API',         panel:'profile' },
  { id:'telegram',     label:'Ativar notificações Telegram',   sub:'Meu Perfil → Notificações',           panel:'profile' },
  { id:'first_bot',    label:'Iniciar bot em Testnet',         sub:'Bot Control → Iniciar Bot',           panel:'botcontrol' },
  { id:'risk_profile', label:'Escolher perfil de risco',       sub:'Gestão de Risco → Selecionar perfil', panel:'risk' },
  { id:'backtest',     label:'Rodar um backtest',              sub:'Backtesting → Executar',              panel:'backtest' },
  { id:'replay',       label:'Explorar o replay histórico',    sub:'Replay → Carregar dados',             panel:'replay' },
  { id:'copy',         label:'Ver traders para copiar',        sub:'Copy Trading → Explorar líderes',     panel:'copy' },
];

// ─── BASE DO FAQ ──────────────────────────────────────────────────────────────
const OB_FAQ = [
  { q:'Como funciona o modo Testnet?',          a:'Testnet usa a rede de teste da Binance. Você opera com dinheiro fictício mas em condições idênticas ao mercado real. Ideal para validar estratégias sem risco.' },
  { q:'O bot pode sacar meu dinheiro?',         a:'Não. Configure a API key com permissão apenas de "Leitura" + "Operações à vista". Nunca ative permissão de saque.' },
  { q:'Qual estratégia é melhor para iniciante?',a:'Pattern AI com Testnet. Detecta padrões de candlestick automaticamente e tem bom histórico em mercados com tendência.' },
  { q:'Como o copy trading funciona?',          a:'Você escolhe um líder, define quanto capital alocar, e cada operação do líder é replicada automaticamente na sua conta Binance.' },
  { q:'Preciso declarar cripto no IR?',         a:'Se suas vendas mensais ultrapassam R$35.000, sim. Use o painel IR Fiscal para calcular e gerar o relatório. Código DARF: 6015.' },
  { q:'O que é Sharpe Ratio?',                  a:'Mede retorno ajustado ao risco. Sharpe > 1 é bom, > 2 é excelente. Disponível no backtesting da plataforma.' },
  { q:'Como ativar notificações no celular?',   a:'Meu Perfil → Telegram: configure o bot token e chat ID. Para push nativo, instale o app via "Adicionar à tela inicial" no seu navegador.' },
  { q:'O que é Walk-Forward?',                  a:'Técnica para evitar overfitting: divide os dados em períodos e testa a estratégia em cada um separadamente. Se funciona em todos, a estratégia é robusta.' },
  { q:'Qual capital mínimo para começar?',      a:'Tecnicamente $10 (mínimo da Binance), mas recomendamos $100–300 para ter diversificação mínima e cubrir taxas.' },
  { q:'O Session Manager para o bot por quê?',  a:'Ele encerra o bot quando você atinge o gain alvo (ex: +$20) ou o loss máximo (ex: -$10) da sessão, evitando operar em sequência de perdas.' },
];

// ─── FUNÇÕES AUXILIARES ────────────────────────────────────────────────────────
function obGoPanel(panel) {
  const nav = document.querySelector(`[data-panel="${panel}"]`);
  if (nav) { nav.click(); }
  obClose();
}

function obClose() {
  const el = document.getElementById('ob-main');
  if (el) {
    const box = el.querySelector('.ob-card');
    if (box) box.style.animation = 'obOut .15s ease forwards';
    setTimeout(() => el.remove(), 140);
  }
  _OB.active = false;
}

function obMarkDone(id) {
  _OB.completed.add(id);
  _obSave();
}

// ─── WIZARD DE BOAS-VINDAS ────────────────────────────────────────────────────
function obShowWelcome() {
  if (_OB.active) return;
  _OB.active = true;
  const el = document.createElement('div');
  el.id = 'ob-main';
  el.className = 'ob-overlay';
  el.innerHTML = `
    <div class="ob-card ob-card-xl">
      <div class="ob-header" style="text-align:center;padding-bottom:20px">
        <div style="font-size:42px;margin-bottom:12px;animation:obBounce 2s ease infinite">🚀</div>
        <div class="ob-title" style="font-size:22px">Bem-vindo ao CryptoEdge Pro!</div>
        <div class="ob-sub" style="max-width:480px;margin:8px auto 0">Qual é o seu nível com trading de criptomoedas? Vamos personalizar a experiência para você.</div>
      </div>
      <div class="ob-div"></div>
      <div class="ob-body">
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px" id="ob-paths">
          ${Object.entries(OB_PATHS).map(([key, p]) => `
            <div class="ob-path" data-path="${key}" onclick="obSelectPath('${key}')">
              <div class="ob-path-icon">${p.emoji}</div>
              <div class="ob-path-title">${p.label}</div>
              <div class="ob-path-sub">${p.desc}</div>
              <div class="ob-path-tags">${p.tags.map(t=>`<span class="ob-tag">${t}</span>`).join('')}</div>
            </div>`).join('')}
        </div>
      </div>
      <div class="ob-div"></div>
      <div class="ob-footer">
        <button class="ob-btn ob-btn-skip" onclick="obSkip()">Pular tutorial</button>
        <div style="flex:1"></div>
        <button class="ob-btn ob-btn-next" id="ob-start-btn" style="opacity:.4;cursor:not-allowed" disabled onclick="obStartTutorial()">Iniciar tutorial →</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}

function obSelectPath(path) {
  _OB.path = path;
  document.querySelectorAll('.ob-path').forEach(el => el.classList.remove('sel'));
  document.querySelector(`[data-path="${path}"]`)?.classList.add('sel');
  const btn = document.getElementById('ob-start-btn');
  if (btn) { btn.style.opacity = '1'; btn.style.cursor = 'pointer'; btn.disabled = false; }
}

function obStartTutorial() {
  if (!_OB.path) return;
  _OB.step = 0;
  obClose();
  setTimeout(() => obShowStep(_OB.path, 0), 180);
}

function obSkip() {
  localStorage.setItem('ce_ob_skipped', '1');
  obClose();
}

// ─── STEPS DO TUTORIAL ────────────────────────────────────────────────────────
function obShowStep(pathKey, stepIdx) {
  _OB.active = true;
  const path  = OB_PATHS[pathKey];
  const steps = path.steps;
  const step  = steps[stepIdx];
  const total = steps.length;
  const isLast = stepIdx === total - 1;

  const el = document.createElement('div');
  el.id = 'ob-main';
  el.className = 'ob-overlay';

  const dots = steps.map((_, i) => `<div class="ob-dot ${i < stepIdx ? 'done' : i === stepIdx ? 'active' : ''}"></div>`).join('');

  el.innerHTML = `
    <div class="ob-card ob-card-lg" style="max-height:90vh;overflow:hidden;display:flex;flex-direction:column">
      <div class="ob-header">
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div class="ob-icon-wrap" style="background:rgba(var(--gold-r,240),185,11,.12);border-color:${step.color || 'var(--gold)'}">
            ${step.icon}
          </div>
          <div>
            <div style="font-size:11px;font-weight:600;color:var(--t3);letter-spacing:1px;text-transform:uppercase;margin-bottom:4px">${path.emoji} ${path.label} · Passo ${stepIdx+1} de ${total}</div>
            <div class="ob-title" style="font-size:17px">${step.title}</div>
          </div>
        </div>
      </div>
      <div class="ob-body" style="overflow-y:auto;flex:1;padding-top:14px">${step.content}</div>
      <div class="ob-div"></div>
      <div class="ob-footer" style="flex-shrink:0">
        <div class="ob-progress">${dots}</div>
        ${stepIdx > 0 ? `<button class="ob-btn ob-btn-back" onclick="obShowStep('${pathKey}', ${stepIdx-1})">← Voltar</button>` : ''}
        <button class="ob-btn ob-btn-skip" onclick="obClose()">Fechar</button>
        ${isLast
          ? `<button class="ob-btn ob-btn-green" onclick="obFinish('${pathKey}')">✅ Concluir!</button>`
          : `<button class="ob-btn ob-btn-next" onclick="${step.action ? `OB_PATHS['${pathKey}'].steps[${stepIdx}].action();` : `obShowStep('${pathKey}', ${stepIdx+1})`}">${step.btnNext || 'Próximo →'}</button>`
        }
      </div>
    </div>`;

  document.body.appendChild(el);
}

function obFinish(pathKey) {
  obMarkDone('tutorial_' + pathKey);
  obClose();
  setTimeout(() => {
    const path = OB_PATHS[pathKey];
    // Execute last step action if any
    const lastStep = path.steps[path.steps.length - 1];
    if (lastStep.action) lastStep.action();
    obShowChecklist();
  }, 200);
}

// ─── CHECKLIST PÓS-TUTORIAL ──────────────────────────────────────────────────
function obShowChecklist() {
  _OB.active = true;
  const el = document.createElement('div');
  el.id = 'ob-main';
  el.className = 'ob-overlay';

  const items = OB_CHECKLIST.map(item => {
    const done = _OB.completed.has(item.id);
    return `
      <div class="ob-check-item">
        <div class="ob-check-box ${done ? 'done' : ''}" id="ck-${item.id}" onclick="obCheckItem('${item.id}')">
          ${done ? '✓' : ''}
        </div>
        <div style="flex:1;cursor:pointer" onclick="obGoPanel('${item.panel}')">
          <div class="ob-check-label" style="${done ? 'text-decoration:line-through;opacity:.5' : ''}">${item.label}</div>
          <div class="ob-check-sub">${item.sub} <span style="color:var(--gold)">→ ir</span></div>
        </div>
      </div>`;
  }).join('');

  const done = OB_CHECKLIST.filter(i => _OB.completed.has(i.id)).length;
  const pct  = Math.round(done / OB_CHECKLIST.length * 100);

  el.innerHTML = `
    <div class="ob-card ob-card-sm">
      <div class="ob-header">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
          <div class="ob-icon-wrap" style="background:var(--golddim);border-color:var(--gold)">🗒️</div>
          <div>
            <div class="ob-title" style="font-size:16px">Próximos passos</div>
            <div style="font-size:12px;color:var(--t3);margin-top:2px">${done}/${OB_CHECKLIST.length} concluídos</div>
          </div>
        </div>
        <div style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-bottom:4px">
          <div style="height:100%;width:${pct}%;background:var(--green);border-radius:3px;transition:width .5s ease"></div>
        </div>
      </div>
      <div class="ob-body" style="max-height:340px;overflow-y:auto">${items}</div>
      <div class="ob-div"></div>
      <div class="ob-footer">
        <span style="font-size:12px;color:var(--t3)">${pct === 100 ? '🎉 Tudo pronto!' : 'Clique em qualquer item para ir direto'}</span>
        <div style="flex:1"></div>
        <button class="ob-btn ob-btn-next" onclick="obClose()">Fechar</button>
      </div>
    </div>`;

  document.body.appendChild(el);
}

function obCheckItem(id) {
  if (_OB.completed.has(id)) {
    _OB.completed.delete(id);
  } else {
    obMarkDone(id);
  }
  _obSave();
  obShowChecklist(); // re-render
  const prev = document.getElementById('ob-main');
  if (prev) prev.remove();
  obShowChecklist();
}

// ─── CENTRO DE AJUDA (FAB) ────────────────────────────────────────────────────
let _obHelpOpen = false;

function obToggleHelp() {
  _obHelpOpen ? obCloseHelp() : obOpenHelp();
}

function obOpenHelp() {
  _obHelpOpen = true;
  const existing = document.getElementById('ob-help-panel');
  if (existing) { existing.remove(); return; }

  const panel = document.createElement('div');
  panel.id = 'ob-help-panel';
  panel.className = 'ob-help-panel';

  const items = OB_FAQ.map((f, i) => `
    <div class="ob-help-item" onclick="obToggleFaq(${i})">
      <div class="ob-help-emoji">❓</div>
      <div>
        <div class="ob-help-q">${f.q}</div>
        <div class="ob-help-a" id="faq-a-${i}" style="display:none">${f.a}</div>
      </div>
    </div>`).join('');

  panel.innerHTML = `
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:13px;font-weight:700;color:var(--t1)">Centro de Ajuda</div>
      <div style="display:flex;gap:8px">
        <span onclick="obShowWelcome()" style="font-size:11px;color:var(--gold);cursor:pointer;padding:3px 8px;border:1px solid var(--gold);border-radius:4px">Tutorial</span>
        <span onclick="obShowChecklist()" style="font-size:11px;color:var(--blue);cursor:pointer;padding:3px 8px;border:1px solid var(--blue);border-radius:4px">Checklist</span>
        <span onclick="obCloseHelp()" style="font-size:16px;cursor:pointer;color:var(--t3)">✕</span>
      </div>
    </div>
    <input class="ob-help-search" placeholder="Buscar pergunta..." oninput="obFilterFaq(this.value)" id="ob-faq-search">
    <div style="max-height:360px;overflow-y:auto" id="ob-faq-list">${items}</div>
    <div style="padding:10px 16px;border-top:1px solid var(--border);display:flex;gap:8px">
      <button onclick="obShowWelcome()" style="flex:1;padding:8px;background:var(--golddim);border:1px solid var(--gold);color:var(--gold);border-radius:6px;cursor:pointer;font-size:12px;font-weight:600">🔄 Reiniciar Tutorial</button>
      <button onclick="obShowGlossary()" style="flex:1;padding:8px;background:var(--bg3);border:1px solid var(--border);color:var(--t2);border-radius:6px;cursor:pointer;font-size:12px">📖 Glossário</button>
    </div>`;

  document.body.appendChild(panel);
}

function obCloseHelp() {
  _obHelpOpen = false;
  const p = document.getElementById('ob-help-panel');
  if (p) p.remove();
}

function obToggleFaq(i) {
  const el = document.getElementById(`faq-a-${i}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function obFilterFaq(q) {
  const items = document.querySelectorAll('.ob-help-item');
  q = q.toLowerCase();
  items.forEach((el, i) => {
    const matches = OB_FAQ[i] && (OB_FAQ[i].q.toLowerCase().includes(q) || OB_FAQ[i].a.toLowerCase().includes(q));
    el.style.display = !q || matches ? 'flex' : 'none';
  });
}

// ─── GLOSSÁRIO ────────────────────────────────────────────────────────────────
const OB_GLOSSARY = [
  ['USDT','Tether — moeda estável lastreada no Dólar. Base de quase todas as operações.'],
  ['BTC','Bitcoin — a criptomoeda mais famosa e de maior capitalização.'],
  ['Long / BUY','Comprar na expectativa de alta. Lucro quando preço sobe.'],
  ['Short / SELL','Vender na expectativa de queda. Lucro quando preço cai.'],
  ['Stop Loss (SL)','Ordem automática de proteção que limita perda máxima.'],
  ['Take Profit (TP)','Ordem automática que realiza lucro ao atingir alvo.'],
  ['R:R Ratio','Relação Risco:Retorno. 1:2 significa arriscar $1 para ganhar $2.'],
  ['Sharpe Ratio','Retorno ajustado ao risco. > 1 bom, > 2 excelente.'],
  ['Drawdown','Queda máxima do capital do pico ao vale. Mede risco real.'],
  ['EMA','Média Móvel Exponencial. Usada para identificar tendência.'],
  ['RSI','Índice de Força Relativa. < 30 = sobrevendido, > 70 = sobrecomprado.'],
  ['MACD','Indicador de momentum baseado em duas EMAs.'],
  ['ATR','Average True Range. Mede volatilidade — base para calcular SL dinâmico.'],
  ['Order Block (OB)','Zona de preço onde grandes instituições entraram. Forte suporte/resistência.'],
  ['FVG','Fair Value Gap — lacuna de preço criada por movimento forte. Tende a ser preenchida.'],
  ['SMC','Smart Money Concepts — análise baseada em comportamento institucional.'],
  ['Testnet','Rede de teste da Binance. Opera sem dinheiro real.'],
  ['Paper Trading','Simulação local com capital fictício. Sem conexão com exchange.'],
  ['Walk-Forward','Técnica para validar que a estratégia não está sobreajustada aos dados históricos.'],
  ['Overfitting','Estratégia que funciona muito bem no backtest mas mal ao vivo — ajustada demais ao passado.'],
  ['DARF 6015','Documento de Arrecadação da Receita Federal para ganhos em renda variável (cripto).'],
  ['Copy Trading','Replicar automaticamente as operações de outro trader.'],
  ['Session Manager','Ferramenta que para o bot ao atingir gain ou loss definido na sessão.'],
];

function obShowGlossary() {
  obCloseHelp();
  _OB.active = true;
  const el = document.createElement('div');
  el.id = 'ob-main';
  el.className = 'ob-overlay';

  const rows = OB_GLOSSARY.map(([t, d]) => `
    <div style="padding:9px 0;border-bottom:1px solid var(--border);display:flex;gap:12px">
      <div style="font-family:var(--mono);font-size:12px;font-weight:600;color:var(--gold);min-width:100px;flex-shrink:0">${t}</div>
      <div style="font-size:12px;color:var(--t2);line-height:1.5">${d}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="ob-card ob-card-lg" style="max-height:85vh">
      <div class="ob-header">
        <div style="display:flex;gap:12px;align-items:center">
          <div class="ob-icon-wrap" style="background:var(--bluedim);border-color:var(--blue)">📖</div>
          <div>
            <div class="ob-title" style="font-size:17px">Glossário de Trading</div>
            <div style="font-size:12px;color:var(--t3);margin-top:2px">${OB_GLOSSARY.length} termos essenciais</div>
          </div>
        </div>
      </div>
      <div class="ob-body" style="overflow-y:auto;flex:1;padding-top:10px">${rows}</div>
      <div class="ob-div"></div>
      <div class="ob-footer">
        <button class="ob-btn ob-btn-skip" onclick="obClose()">Fechar</button>
      </div>
    </div>`;
  document.body.appendChild(el);
}


// ─── Update sidebar tutorial progress badge ────────────────────────────────────
function obUpdateBadge() {
  const done  = OB_CHECKLIST.filter(i => _OB.completed.has(i.id)).length;
  const total = OB_CHECKLIST.length;
  const badge = document.getElementById('ob-progress-badge');
  if (!badge) return;
  if (done === total) {
    badge.style.display = 'inline';
    badge.textContent = '✓';
    badge.style.background = 'var(--green)';
  } else if (done > 0) {
    badge.style.display = 'inline';
    badge.textContent = done + '/' + total;
    badge.style.background = 'var(--gold)';
    badge.style.color = '#000';
  } else {
    badge.style.display = 'none';
  }
}

// Auto-mark checklist items when user visits relevant panels
function obWatchPanels() {
  const panelMap = {
    botcontrol: 'first_bot',
    risk:       'risk_profile',
    backtest:   'backtest',
    replay:     'replay',
    copy:       'copy',
    profile:    null,  // marked separately after saving keys
  };
  document.querySelectorAll('.nav-item[data-panel]').forEach(nav => {
    const panel = nav.dataset.panel;
    if (panelMap[panel]) {
      nav.addEventListener('click', () => {
        setTimeout(() => {
          obMarkDone(panelMap[panel]);
          obUpdateBadge();
        }, 2000); // mark after 2s on panel
      });
    }
  });
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
function obInit() {
  // FAB de ajuda — sempre visível
  if (!document.getElementById('ob-fab')) {
    const fab = document.createElement('button');
    fab.id = 'ob-fab';
    fab.className = 'ob-help-fab';
    fab.innerHTML = '?';
    fab.title = 'Ajuda & Tutorial';
    fab.onclick = obToggleHelp;
    document.body.appendChild(fab);
  }

  // Update progress badge
  obUpdateBadge();

  // Watch panels for auto-marking checklist
  setTimeout(obWatchPanels, 500);

  // Mostrar welcome na primeira visita (só após login)
  const skipped  = localStorage.getItem('ce_ob_skipped');
  const anyDone  = [..._OB.completed].some(k => k.startsWith('tutorial_'));
  if (!skipped && !anyDone) {
    setTimeout(obShowWelcome, 1200);
  }
}

// Expor globalmente
window.obShowWelcome  = obShowWelcome;
window.obShowChecklist= obShowChecklist;
window.obShowGlossary = obShowGlossary;
window.obToggleHelp   = obToggleHelp;
window.obGoPanel      = obGoPanel;
window.obSelectPath   = obSelectPath;
window.obStartTutorial= obStartTutorial;
window.obSkip         = obSkip;
window.obClose        = obClose;
window.obFinish       = obFinish;
window.obCheckItem    = obCheckItem;
window.obToggleFaq    = obToggleFaq;
window.obFilterFaq    = obFilterFaq;
window.obMarkDone     = obMarkDone;
window.obCloseHelp    = obCloseHelp;
window.obShowStep     = obShowStep;
window.obInit         = obInit;
window.obUpdateBadge  = obUpdateBadge;

// Auto-init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', obInit);
} else {
  obInit();
}
