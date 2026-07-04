const router          = require('express').Router();
const rateLimit        = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const { authMiddleware } = require('../middlewares/auth');
const BetaRegistration = require('../models/BetaRegistration');

// Mismo Client ID ya usado en LoginScreen.js / auth.routes.js (POST /auth/google)
const GOOGLE_CLIENT_ID = '841197288611-3uhrf7lv42jdae4703unshffp0rfralj.apps.googleusercontent.com';
const googleClient     = new OAuth2Client(GOOGLE_CLIENT_ID);

const betaRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes desde esta IP. Intenta de nuevo en 1 hora.' },
});

// ── POST /beta/register ─────────────────────────────────────────────────────
// Acepta { email } (registro manual) o { googleToken } (Google Sign-In).
router.post('/register', betaRegisterLimiter, async (req, res) => {
  let normalized;
  let viaGoogle = false;
  try {
    const { email, googleToken } = req.body;

    if (googleToken) {
      viaGoogle = true;
      let payload;
      try {
        const ticket = await googleClient.verifyIdToken({
          idToken:  googleToken,
          audience: GOOGLE_CLIENT_ID,
        });
        payload = ticket.getPayload();
      } catch (e) {
        return res.status(401).json({ error: 'Token de Google invalido' });
      }
      if (!payload?.email) return res.status(401).json({ error: 'Token de Google invalido' });
      normalized = payload.email.toLowerCase().trim();
    } else {
      if (!email?.trim()) return res.status(400).json({ error: 'Email requerido' });

      normalized = email.toLowerCase().trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalized))
        return res.status(400).json({ error: 'Formato de email invalido' });
    }

    const existing = await BetaRegistration.findOne({ email: normalized });
    if (existing) {
      // Vía Google ya "inició sesión" con éxito — mostrar acceso, no un error.
      if (viaGoogle) return res.json({ ok: true, email: normalized, alreadyRegistered: true });
      return res.status(409).json({ error: 'already_registered' });
    }

    // TODO: aprovisionar acceso real de tester en Google Play.
    // La API de Android Publisher (androidpublisher.edits.testers) NO soporta
    // agregar emails individuales — su Schema$Testers solo acepta `googleGroups`
    // (confirmado en node_modules/googleapis .../apis/androidpublisher/v3.d.ts).
    // Opciones para resolver esto más adelante:
    //   a) Google Group + Admin SDK Directory API para sumar el email como
    //      miembro del grupo (requiere Google Workspace con domain-wide
    //      delegation; credenciales distintas a las de Play Developer API).
    //   b) Gestión manual de la "email list" de testers desde Play Console,
    //      exportando periódicamente los registros de BetaRegistration.
    // Variables de entorno ya previstas para cuando se resuelva:
    //   PLAY_SERVICE_ACCOUNT_EMAIL, PLAY_PRIVATE_KEY, PLAY_PACKAGE_NAME

    await BetaRegistration.create({ email: normalized, ip: req.ip });

    res.json({ ok: true, email: normalized });
  } catch (err) {
    if (err.code === 11000) {
      if (viaGoogle) return res.json({ ok: true, email: normalized, alreadyRegistered: true });
      return res.status(409).json({ error: 'already_registered' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── GET /beta/export-csv ─────────────────────────────────────────────────────
router.get('/export-csv', authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'No autorizado' });

    const registrations = await BetaRegistration.find().select('email').lean();
    const csv = registrations.map(r => r.email).join('\n');

    res.set('Content-Type', 'text/csv');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
