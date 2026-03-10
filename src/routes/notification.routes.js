const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const Notification = require('../models/Notification');

// Listar notificaciones por tipo con paginación
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const filter = { to: req.user._id };
    if (type && type !== 'all') filter.type = type;

    const [notifs, total, unread] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit))
        .populate('from', 'username avatarUrl xp')
        .populate('post', 'imageUrl'),
      Notification.countDocuments(filter),
      Notification.countDocuments({ to: req.user._id, read: false }),
    ]);

    res.json({ notifs, total, unread, page: parseInt(page), pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Marcar todas como leídas
router.patch('/read', authMiddleware, async (req, res) => {
  try {
    const { type } = req.body;
    const filter = { to: req.user._id, read: false };
    if (type && type !== 'all') filter.type = type;
    await Notification.updateMany(filter, { read: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Total no leídas (para badge)
router.get('/unread', authMiddleware, async (req, res) => {
  try {
    const unread = await Notification.countDocuments({ to: req.user._id, read: false });
    res.json({ unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
