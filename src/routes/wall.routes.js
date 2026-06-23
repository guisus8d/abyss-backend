const router       = require('express').Router();
const WallMessage  = require('../models/WallMessage');
const User         = require('../models/User');
const { authMiddleware } = require('../middlewares/auth');
const { optionalAuth }   = require('../middlewares/optionalAuth');

// ── GET /api/wall/:username  — mensajes del muro (paginados) ──────────────────
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const owner = await User.findOne({ username: req.params.username }).select('_id');
    if (!owner) return res.status(404).json({ error: 'Usuario no encontrado' });

    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 15);
    const skip  = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      WallMessage.find({ targetUser: owner._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('author', 'username avatarUrl profileFrame profileFrameUrl'),
      WallMessage.countDocuments({ targetUser: owner._id }),
    ]);

    res.json({ messages, total, hasMore: skip + messages.length < total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/wall/:username  — escribir en el muro ───────────────────────────
router.post('/:username', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim())             return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
    if (text.trim().length > 500)  return res.status(400).json({ error: 'Máximo 500 caracteres' });

    const target = await User.findOne({ username: req.params.username })
      .select('_id wallPermission followers following');
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    if (target._id.toString() === req.user._id.toString())
      return res.status(403).json({ error: 'No puedes escribir en tu propio muro' });

    // ── Verificar permiso ──
    const perm = target.wallPermission || 'everyone';
    if (perm === 'followers') {
      const ok = (target.followers || []).some(f => f.toString() === req.user._id.toString());
      if (!ok) return res.status(403).json({ error: 'Solo seguidores pueden escribir en este muro' });
    } else if (perm === 'following') {
      const ok = (target.following || []).some(f => f.toString() === req.user._id.toString());
      if (!ok) return res.status(403).json({ error: 'Solo usuarios que sigue el dueño pueden escribir aquí' });
    }

    const msg = await WallMessage.create({
      author:     req.user._id,
      targetUser: target._id,
      text:       text.trim(),
    });
    await msg.populate('author', 'username avatarUrl profileFrame profileFrameUrl');

    res.status(201).json({ message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/wall/msg/:id  — borrar mensaje (owner del muro o autor) ───────
router.delete('/msg/:id', authMiddleware, async (req, res) => {
  try {
    const msg = await WallMessage.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });

    const isAuthor = msg.author.toString()     === req.user._id.toString();
    const isOwner  = msg.targetUser.toString() === req.user._id.toString();
    if (!isAuthor && !isOwner)
      return res.status(403).json({ error: 'No tienes permiso para eliminar este mensaje' });

    await WallMessage.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
