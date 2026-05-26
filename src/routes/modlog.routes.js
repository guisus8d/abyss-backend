const router   = require('express').Router();
const ModLog   = require('../models/ModLog');
const User     = require('../models/User');
const { authMiddleware } = require('../middlewares/auth');

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo admins' });
  next();
};

// ── Listar historial (admin) ───────────────────────────────────────────────────
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const logs = await ModLog.find()
      .populate('mod',        'username avatarUrl')
      .populate('target',     'username avatarUrl')
      .populate('revertedBy', 'username')
      .sort({ createdAt: -1 })
      .skip((page - 1) * 40)
      .limit(40);

    const total = await ModLog.countDocuments();
    res.json({ logs, total, page });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Revertir acción (admin) ────────────────────────────────────────────────────
router.post('/:id/revert', authMiddleware, adminOnly, async (req, res) => {
  try {
    const log = await ModLog.findById(req.params.id).populate('target', 'username role banned bannedReason');
    if (!log) return res.status(404).json({ error: 'Entrada no encontrada' });
    if (log.reverted) return res.status(409).json({ error: 'Ya fue revertida' });
    if (!['ban', 'change_role'].includes(log.action))
      return res.status(400).json({ error: 'Esta acción no es revertible' });

    const target = await User.findById(log.target);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (log.action === 'ban') {
      target.banned       = false;
      target.bannedReason = '';
      await target.save();
    } else if (log.action === 'change_role') {
      const oldRole = log.details?.oldRole;
      if (!oldRole) return res.status(400).json({ error: 'No hay rol anterior registrado' });
      target.role = oldRole;
      await target.save();
    }

    log.reverted   = true;
    log.revertedBy = req.user._id;
    log.revertedAt = new Date();
    await log.save();

    res.json({ ok: true, action: log.action, target: target.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
