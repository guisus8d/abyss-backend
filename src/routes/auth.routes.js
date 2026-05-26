const router        = require('express').Router();
const jwt           = require('jsonwebtoken');
const crypto        = require('crypto');
const bcrypt        = require('bcryptjs');
const { Resend }    = require('resend');
const { OAuth2Client } = require('google-auth-library');
const User          = require('../models/User');
const PasswordResetToken = require('../models/PasswordResetToken');
const { validate }  = require('../middlewares/validate');
const { registerRules, loginRules } = require('../middlewares/rules');
const { uploadAvatar } = require('../config/cloudinary');

const { authMiddleware } = require('../middlewares/auth');
const { register, login } = require('../controllers/auth.controller');
const getResend = () => new Resend(process.env.RESEND_API_KEY);
function getIO() { try { return require('../sockets').getIO(); } catch { return null; } }

async function checkRateLimit(userId, purpose, maxPerHour) {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const count = await PasswordResetToken.countDocuments({ userId, purpose, createdAt: { $gte: since } });
  return count >= maxPerHour;
}

// ── Email / password ──────────────────────────────────────────────────────────
router.post('/register', uploadAvatar.single('avatar'), registerRules, validate, register);
router.post('/login',    loginRules, validate, login);

// ── Google OAuth ──────────────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = '841197288611-3uhrf7lv42jdae4703unshffp0rfralj.apps.googleusercontent.com';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken requerido' });

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    let user = await User.findOne({ email });

    if (!user) {
      // Crear usuario nuevo con username único
      const base     = (name || 'user').replace(/\s+/g, '').toLowerCase().slice(0, 16);
      const username = base + Math.floor(Math.random() * 9999);
      user = new User({
        username,
        email,
        avatarUrl:    picture,
        googleId,
        passwordHash: googleId, // placeholder — no se usa para login con Google
      });
      await user.save();
    }

    user.lastActive = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({ token, user });
  } catch (err) {
    console.error('Google auth error:', err.message);
    res.status(401).json({ error: 'Token de Google inválido', detail: err.message });
  }
});

// ── Forgot password ───────────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email requerido' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.json({ ok: true });

    if (await checkRateLimit(user._id, 'password_reset', 3))
      return res.status(429).json({ error: 'Demasiados intentos. Espera 1 hora.' });

    await PasswordResetToken.updateMany(
      { userId: user._id, used: false, purpose: 'password_reset' },
      { used: true }
    );

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    await PasswordResetToken.create({ userId: user._id, token, expiresAt, purpose: 'password_reset' });

    const resetUrl = `https://abyss.social/reset-password.html?token=${token}`;

    await getResend().emails.send({
      from: 'Abyss <no-reply@abyss.social>',
      to:   user.email,
      subject: 'Restablecer contraseña — Abyss',
      html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Restablecer contraseña</title></head>
<body style="margin:0;padding:0;background:#020509;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020509;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#0b1521;border-radius:16px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#003d38,#005a52);padding:32px 32px 24px;text-align:center;">
          <p style="margin:0 0 8px;color:rgba(0,229,204,0.6);font-size:11px;letter-spacing:4px;font-weight:700;">ABYSS</p>
          <h1 style="margin:0;color:#e8f4f8;font-size:22px;font-weight:700;">Restablecer contraseña</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:rgba(232,244,248,0.65);font-size:14px;">Hola, <strong style="color:#e8f4f8;">@${user.username}</strong></p>
          <p style="margin:0 0 24px;color:rgba(232,244,248,0.5);font-size:14px;line-height:1.6;">
            Recibimos una solicitud para restablecer tu contraseña. El enlace expira en <strong style="color:#e8f4f8;">1 hora</strong>.
          </p>
          <div style="text-align:center;margin-bottom:28px;">
            <a href="${resetUrl}" style="display:inline-block;background:linear-gradient(90deg,#006b63,#00e5cc);color:#001a18;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;letter-spacing:0.5px;">
              Restablecer contraseña
            </a>
          </div>
          <p style="margin:0 0 8px;color:rgba(232,244,248,0.35);font-size:12px;line-height:1.6;">
            Si no solicitaste esto, puedes ignorar este mensaje. Tu contraseña no cambiará.
          </p>
          <div style="margin-top:20px;padding:12px 16px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0 0 4px;color:rgba(232,244,248,0.3);font-size:11px;">O copia este enlace en tu navegador:</p>
            <p style="margin:0;color:rgba(0,229,204,0.6);font-size:11px;word-break:break-all;">${resetUrl}</p>
          </div>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
          <p style="margin:0;color:rgba(232,244,248,0.2);font-size:11px;">© 2025 Abyss · abyss.social</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('forgot-password error:', err.message);
    res.status(500).json({ error: 'No se pudo enviar el correo' });
  }
});

// ── Reset password ────────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const record = await PasswordResetToken.findOne({ token });
    if (!record)          return res.status(400).json({ error: 'Token inválido' });
    if (record.used)      return res.status(400).json({ error: 'Token ya utilizado' });
    if (record.expiresAt < new Date()) return res.status(400).json({ error: 'Token expirado' });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(record.userId, { passwordHash });

    record.used = true;
    await record.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('reset-password error:', err.message);
    res.status(500).json({ error: 'Error al restablecer la contraseña' });
  }
});

// ── Send email verification ───────────────────────────────────────────────────
router.post('/send-verification', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email requerido' });

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return res.json({ ok: true });
    if (user.emailVerified) return res.status(400).json({ error: 'Correo ya verificado' });

    if (await checkRateLimit(user._id, 'email_verification', 3))
      return res.status(429).json({ error: 'Demasiados intentos. Espera 1 hora.' });

    await PasswordResetToken.updateMany(
      { userId: user._id, used: false, purpose: 'email_verification' },
      { used: true }
    );

    const token     = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 horas
    await PasswordResetToken.create({ userId: user._id, token, expiresAt, purpose: 'email_verification' });

    const verifyUrl = `https://abyss.social/verify-email.html?token=${token}`;

    await getResend().emails.send({
      from: 'Abyss <no-reply@abyss.social>',
      to:   user.email,
      subject: 'Verifica tu cuenta — Abyss',
      html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Verificar cuenta</title></head>
<body style="margin:0;padding:0;background:#020509;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020509;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#0b1521;border-radius:16px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#003d38,#005a52);padding:32px 32px 24px;text-align:center;">
          <p style="margin:0 0 8px;color:rgba(0,229,204,0.6);font-size:11px;letter-spacing:4px;font-weight:700;">ABYSS</p>
          <h1 style="margin:0;color:#e8f4f8;font-size:22px;font-weight:700;">Verifica tu cuenta</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:rgba(232,244,248,0.65);font-size:14px;">Hola, <strong style="color:#e8f4f8;">@${user.username}</strong></p>
          <p style="margin:0 0 24px;color:rgba(232,244,248,0.5);font-size:14px;line-height:1.6;">
            Toca el botón para verificar tu correo. El enlace expira en <strong style="color:#e8f4f8;">24 horas</strong>.
          </p>
          <div style="text-align:center;margin-bottom:28px;">
            <a href="${verifyUrl}" style="display:inline-block;background:linear-gradient(90deg,#006b63,#00e5cc);color:#001a18;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;letter-spacing:0.5px;">
              Verificar mi correo
            </a>
          </div>
          <p style="margin:0 0 8px;color:rgba(232,244,248,0.35);font-size:12px;line-height:1.6;">
            Si no solicitaste esto puedes ignorar este mensaje.
          </p>
          <div style="margin-top:20px;padding:12px 16px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0 0 4px;color:rgba(232,244,248,0.3);font-size:11px;">O copia este enlace:</p>
            <p style="margin:0;color:rgba(0,229,204,0.6);font-size:11px;word-break:break-all;">${verifyUrl}</p>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
          <p style="margin:0;color:rgba(232,244,248,0.2);font-size:11px;">© 2025 Abyss · abyss.social</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('send-verification error:', err.message);
    res.status(500).json({ error: 'No se pudo enviar el correo' });
  }
});

// ── Verify email ──────────────────────────────────────────────────────────────
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const record = await PasswordResetToken.findOne({ token, purpose: 'email_verification' });
    if (!record)          return res.status(400).json({ error: 'Token inválido' });
    if (record.used)      return res.status(400).json({ error: 'Token ya utilizado' });
    if (record.expiresAt < new Date()) return res.status(400).json({ error: 'Token expirado' });

    const userBefore = await User.findById(record.userId);
    const alreadyVerified = userBefore?.emailVerified;

    await User.findByIdAndUpdate(record.userId, {
      emailVerified: true,
      ...(!alreadyVerified && { $inc: { xp: 100 } }),
    });

    record.used = true;
    await record.save();

    if (!alreadyVerified) {
      getIO()?.to(`user:${record.userId}`).emit('notification:new');
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('verify-email error:', err.message);
    res.status(500).json({ error: 'Error al verificar el correo' });
  }
});

// ── Change email ──────────────────────────────────────────────────────────────
router.post('/change-email', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newEmail } = req.body;
    if (!currentPassword || !newEmail?.trim())
      return res.status(400).json({ error: 'Contraseña actual y nuevo email requeridos' });

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail.trim()))
      return res.status(400).json({ error: 'Email inválido' });

    const user = await User.findById(req.user._id);
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Contraseña incorrecta' });

    const normalizedNew = newEmail.toLowerCase().trim();
    if (normalizedNew === user.email)
      return res.status(400).json({ error: 'El nuevo email es igual al actual' });

    const existing = await User.findOne({ email: normalizedNew, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ error: 'Ese email ya está en uso' });

    // Si el email está verificado, enviar confirmación al correo actual
    if (user.emailVerified) {
      await PasswordResetToken.updateMany(
        { userId: user._id, used: false, purpose: 'email_change' },
        { used: true }
      );

      const token     = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
      await PasswordResetToken.create({ userId: user._id, token, expiresAt, purpose: 'email_change' });

      user.pendingEmail = normalizedNew;
      await user.save();

      const confirmUrl = `https://abyss.social/confirm-email-change.html?token=${token}`;

      await getResend().emails.send({
        from: 'Abyss <no-reply@abyss.social>',
        to:   user.email,
        subject: 'Confirma el cambio de correo — Abyss',
        html: `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Confirmar cambio de correo</title></head>
<body style="margin:0;padding:0;background:#020509;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#020509;padding:40px 20px;">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#0b1521;border-radius:16px;border:1px solid rgba(255,255,255,0.07);overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#003d38,#005a52);padding:32px 32px 24px;text-align:center;">
          <p style="margin:0 0 8px;color:rgba(0,229,204,0.6);font-size:11px;letter-spacing:4px;font-weight:700;">ABYSS</p>
          <h1 style="margin:0;color:#e8f4f8;font-size:22px;font-weight:700;">Cambio de correo</h1>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 8px;color:rgba(232,244,248,0.65);font-size:14px;">Hola, <strong style="color:#e8f4f8;">@${user.username}</strong></p>
          <p style="margin:0 0 16px;color:rgba(232,244,248,0.5);font-size:14px;line-height:1.6;">
            Alguien solicitó cambiar el correo de tu cuenta a:
          </p>
          <div style="background:rgba(0,229,204,0.06);border:1px solid rgba(0,229,204,0.2);border-radius:10px;padding:12px 16px;margin-bottom:24px;text-align:center;">
            <p style="margin:0;color:#00e5cc;font-size:15px;font-weight:700;">${normalizedNew}</p>
          </div>
          <p style="margin:0 0 24px;color:rgba(232,244,248,0.5);font-size:14px;line-height:1.6;">
            Si fuiste tú, confirma el cambio. El enlace expira en <strong style="color:#e8f4f8;">1 hora</strong>.
          </p>
          <div style="text-align:center;margin-bottom:24px;">
            <a href="${confirmUrl}" style="display:inline-block;background:linear-gradient(90deg,#006b63,#00e5cc);color:#001a18;font-weight:800;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none;letter-spacing:0.5px;">
              Confirmar cambio
            </a>
          </div>
          <p style="margin:0;color:rgba(232,244,248,0.35);font-size:12px;line-height:1.6;">
            Si no fuiste tú, ignora este mensaje. Tu correo no cambiará.
          </p>
          <div style="margin-top:20px;padding:12px 16px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0 0 4px;color:rgba(232,244,248,0.3);font-size:11px;">O copia este enlace:</p>
            <p style="margin:0;color:rgba(0,229,204,0.6);font-size:11px;word-break:break-all;">${confirmUrl}</p>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
          <p style="margin:0;color:rgba(232,244,248,0.2);font-size:11px;">© 2025 Abyss · abyss.social</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
      });

      return res.json({ ok: true, pendingConfirmation: true });
    }

    // Email no verificado — cambio directo
    user.email         = normalizedNew;
    user.emailVerified = false;
    await user.save();

    res.json({ ok: true, user });
  } catch (err) {
    console.error('change-email error:', err.message);
    res.status(500).json({ error: 'No se pudo cambiar el email' });
  }
});

// ── Confirm email change ──────────────────────────────────────────────────────
router.post('/confirm-email-change', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    const record = await PasswordResetToken.findOne({ token, purpose: 'email_change' });
    if (!record)               return res.status(400).json({ error: 'Token inválido' });
    if (record.used)           return res.status(400).json({ error: 'Token ya utilizado' });
    if (record.expiresAt < new Date()) return res.status(400).json({ error: 'Token expirado' });

    const user = await User.findById(record.userId);
    if (!user?.pendingEmail) return res.status(400).json({ error: 'No hay cambio de email pendiente' });

    const existing = await User.findOne({ email: user.pendingEmail, _id: { $ne: user._id } });
    if (existing) return res.status(400).json({ error: 'Ese email ya está en uso' });

    user.email        = user.pendingEmail;
    user.pendingEmail = null;
    user.emailVerified = false;
    record.used = true;

    await Promise.all([user.save(), record.save()]);

    res.json({ ok: true });
  } catch (err) {
    console.error('confirm-email-change error:', err.message);
    res.status(500).json({ error: 'No se pudo confirmar el cambio' });
  }
});

module.exports = router;
