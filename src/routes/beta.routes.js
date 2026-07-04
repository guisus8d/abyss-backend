const router          = require('express').Router();
const rateLimit        = require('express-rate-limit');
const BetaRegistration = require('../models/BetaRegistration');

const betaRegisterLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes desde esta IP. Intenta de nuevo en 1 hora.' },
});

// ── POST /beta/register ─────────────────────────────────────────────────────
router.post('/register', betaRegisterLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email?.trim()) return res.status(400).json({ error: 'Email requerido' });

    const normalized = email.toLowerCase().trim();
    const emailRegex  = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalized))
      return res.status(400).json({ error: 'Formato de email invalido' });

    const existing = await BetaRegistration.findOne({ email: normalized });
    if (existing) return res.status(409).json({ error: 'already_registered' });

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

    res.json({ ok: true });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'already_registered' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
