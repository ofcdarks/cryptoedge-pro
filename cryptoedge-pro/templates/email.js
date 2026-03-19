/**
 * CryptoEdge Pro — Email Templates
 */
'use strict';

const brandColor = '#F0B90B';
const bgDark     = '#0d1117';
const bgCard     = '#161b22';
const borderColor= '#30363d';
const textMain   = '#e6edf3';
const textMuted  = '#7d8590';

function baseTemplate(content) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CryptoEdge Pro</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:${bgDark};color:${textMain};padding:20px}
  .wrapper{max-width:580px;margin:0 auto}
  .header{background:${bgCard};border:1px solid ${borderColor};border-radius:12px 12px 0 0;padding:24px;text-align:center;border-bottom:none}
  .logo{width:48px;height:48px;background:${brandColor};border-radius:12px;display:inline-flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;color:#000;margin-bottom:12px}
  .brand{font-size:22px;font-weight:800;color:${textMain}}.brand span{color:${brandColor}}
  .tagline{font-size:12px;color:${textMuted};margin-top:4px}
  .body{background:${bgCard};border:1px solid ${borderColor};border-radius:0;padding:32px;border-top:none;border-bottom:none}
  .footer{background:${bgCard};border:1px solid ${borderColor};border-radius:0 0 12px 12px;padding:20px;text-align:center;border-top:1px solid ${borderColor}}
  h2{font-size:20px;font-weight:700;margin-bottom:8px}
  p{color:#9ba4ae;font-size:14px;line-height:1.7;margin-bottom:14px}
  .btn{display:inline-block;padding:14px 32px;background:${brandColor};color:#000;font-size:15px;font-weight:700;text-decoration:none;border-radius:8px;margin:16px 0}
  .code-box{background:#0d1117;border:1px solid ${borderColor};border-radius:8px;padding:20px;text-align:center;margin:16px 0}
  .code{font-family:monospace;font-size:28px;font-weight:700;color:${brandColor};letter-spacing:6px}
  .divider{height:1px;background:${borderColor};margin:20px 0}
  .alert{background:rgba(248,81,73,0.1);border:1px solid rgba(248,81,73,0.3);border-radius:8px;padding:12px 16px;font-size:13px;color:#f85149;margin:14px 0}
  .success{background:rgba(63,185,80,0.1);border:1px solid rgba(63,185,80,0.3);border-radius:8px;padding:12px 16px;font-size:13px;color:#3fb950;margin:14px 0}
  .info-row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid ${borderColor};font-size:13px}
  .info-row:last-child{border-bottom:none}
  .info-label{color:${textMuted}} .info-val{color:${textMain};font-weight:600}
  small{color:${textMuted};font-size:12px}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <div class="logo">C</div><br>
    <div class="brand">CryptoEdge <span>Pro</span></div>
    <div class="tagline">Plataforma Profissional de Day Trade</div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    <small>© 2025 CryptoEdge Pro &nbsp;·&nbsp; <a href="/privacy" style="color:${brandColor}">Privacidade</a> &nbsp;·&nbsp; <a href="/terms" style="color:${brandColor}">Termos</a></small><br>
    <small style="color:#484f58">Este e-mail foi enviado automaticamente. Não responda.</small>
  </div>
</div>
</body>
</html>`;
}

module.exports = {
  // Welcome email after registration
  welcome: (username, platform = 'CryptoEdge Pro') => baseTemplate(`
    <h2>🎉 Bem-vindo ao ${platform}!</h2>
    <p>Olá <strong style="color:#e6edf3">${username}</strong>, sua conta foi criada com sucesso.</p>
    <div class="success">✅ Conta ativa e pronta para uso!</div>
    <p>Você agora tem acesso à plataforma completa de day trade com Analysis AI, Grid Bot, e muito mais.</p>
    <div class="divider"></div>
    <p style="font-size:13px;color:#7d8590"><strong style="color:#e6edf3">Próximos passos:</strong></p>
    <p>1. Acesse sua conta e faça login<br>
    2. Vá em <strong>Meu Perfil → Chaves de API</strong> e configure sua Binance API<br>
    3. Configure sua chave de IA para usar o Analysis AI Expert<br>
    4. Explore o Dashboard e o Analysis AI Engine</p>
    <div class="alert">⚠️ <strong>Aviso de risco:</strong> Day trade envolve alto risco de perda. Opere somente com o que pode perder.</div>
  `),

  // Password reset email
  resetPassword: (username, resetLink, expiresIn = '30 minutos') => baseTemplate(`
    <h2>🔐 Redefinir Senha</h2>
    <p>Olá <strong style="color:#e6edf3">${username}</strong>, recebemos uma solicitação de redefinição de senha para sua conta.</p>
    <p>Clique no botão abaixo para criar uma nova senha:</p>
    <div style="text-align:center">
      <a href="${resetLink}" class="btn">🔑 Redefinir minha senha</a>
    </div>
    <p style="text-align:center;font-size:12px;color:#7d8590">Link válido por <strong>${expiresIn}</strong></p>
    <div class="divider"></div>
    <p style="font-size:12px;color:#7d8590">Se você não solicitou a redefinição de senha, ignore este e-mail. Sua senha permanecerá a mesma.</p>
    <div class="alert">🛡️ Nunca compartilhe este link com ninguém. Nossa equipe jamais pedirá sua senha.</div>
    <p style="font-size:12px;color:#7d8590">Se o botão não funcionar, copie e cole este link:<br><code style="color:#F0B90B;font-size:11px;word-break:break-all">${resetLink}</code></p>
  `),

  // Invite code email
  invite: (invitedBy, code, platform, plan, expiresDate) => baseTemplate(`
    <h2>🎟️ Você foi convidado!</h2>
    <p><strong style="color:#e6edf3">${invitedBy}</strong> te convidou para acessar o <strong>${platform}</strong>, a plataforma profissional de day trade de criptomoedas.</p>
    <div class="code-box">
      <div style="font-size:12px;color:#7d8590;margin-bottom:8px">SEU CÓDIGO DE CONVITE</div>
      <div class="code">${code}</div>
      <div style="font-size:12px;color:#7d8590;margin-top:8px">Plano: <strong style="color:#F0B90B">${(plan||'basic').toUpperCase()}</strong></div>
    </div>
    <div class="info-row"><span class="info-label">Código</span><span class="info-val" style="font-family:monospace">${code}</span></div>
    <div class="info-row"><span class="info-label">Plano</span><span class="info-val">${(plan||'Basic').toUpperCase()}</span></div>
    <div class="info-row"><span class="info-label">Expira em</span><span class="info-val">${expiresDate}</span></div>
    <div class="divider"></div>
    <p>Para criar sua conta, acesse a plataforma e clique em <strong>"Criar conta"</strong> na tela de login. Informe o código acima quando solicitado.</p>
    <div class="alert">⏰ Este código expira em <strong>${expiresDate}</strong>. Use antes do prazo!</div>
  `),

  // Password changed confirmation
  passwordChanged: (username) => baseTemplate(`
    <h2>🔒 Senha alterada com sucesso</h2>
    <p>Olá <strong style="color:#e6edf3">${username}</strong>, sua senha foi alterada com sucesso.</p>
    <div class="success">✅ Senha atualizada com segurança</div>
    <p>Se você realizou esta alteração, nenhuma ação é necessária.</p>
    <div class="alert">⚠️ Se você <strong>não</strong> realizou esta alteração, entre em contato imediatamente com o administrador da plataforma.</div>
  `),

  // New login alert
  loginAlert: (username, ip, device, time) => baseTemplate(`
    <h2>🔔 Novo acesso detectado</h2>
    <p>Olá <strong style="color:#e6edf3">${username}</strong>, detectamos um novo acesso à sua conta.</p>
    <div class="info-row"><span class="info-label">Data/Hora</span><span class="info-val">${time}</span></div>
    <div class="info-row"><span class="info-label">IP</span><span class="info-val">${ip}</span></div>
    <div class="info-row"><span class="info-label">Dispositivo</span><span class="info-val">${device}</span></div>
    <p style="margin-top:14px">Se foi você, ignore este e-mail. Se não reconhece este acesso, altere sua senha imediatamente.</p>
  `),
};
