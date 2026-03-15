const router = require('express').Router();
const User = require('../models/User');
const { authMiddleware } = require('../middlewares/auth');
const { uploadAvatar: uploadMiddleware, uploadBlock } = require('../config/cloudinary');
const { getProfile, getUserByUsername, updateProfile, uploadAvatar } = require('../controllers/user.controller');

router.get('/me', authMiddleware, getProfile);

router.get('/top', authMiddleware, async (req, res) => {
  try {
    const User = require('../models/User');
    const users = await User.find()
      .select('username avatarUrl xp profileFrame badges')
      .sort({ xp: -1 })
      .limit(10);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ users: [] });
    const User = require('../models/User');
    const users = await User.find({
      username: { $regex: q.trim(), $options: 'i' },
      _id: { $ne: req.user._id },
    })
    .select('username avatarUrl xp badges profileFrame')
    .limit(10);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/random', authMiddleware, async (req, res) => {
  try {
    const users = await User.aggregate([
      { $match: { _id: { $ne: require('mongoose').Types.ObjectId.createFromHexString(req.user._id.toString()) }, banned: { $ne: true } } },
      { $sample: { size: 10 } },
      { $project: { username: 1, avatarUrl: 1, xp: 1, profileFrame: 1 } }
    ]);
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:username',      authMiddleware, getUserByUsername);
router.patch('/me/profile',   authMiddleware, updateProfile);
router.post('/me/avatar',     authMiddleware, uploadMiddleware.single('avatar'), uploadAvatar);


router.post('/me/upload', authMiddleware, uploadBlock.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image' });
    res.json({ url: req.file.path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Moderación ──────────────────────────────────────────────
const modMiddleware = (req, res, next) => {
  if (!['mod','admin'].includes(req.user?.role)) return res.status(403).json({ error: 'Sin permisos' });
  next();
};

// Banear usuario
router.post('/mod/ban/:userId', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'admin') return res.status(403).json({ error: 'No puedes banear a un admin' });
    if (target.role === 'mod' && req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admins pueden banear mods' });
    target.banned = true;
    target.bannedReason = reason || 'Violación de normas';
    await target.save();
    res.json({ message: 'Usuario baneado', user: target });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Desbanear usuario
router.post('/mod/unban/:userId', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId,
      { banned: false, bannedReason: '' }, { new: true });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario desbaneado', user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Listar usuarios para panel
router.get('/mod/users', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const q = req.query.q || '';
    const users = await User.find(
      q ? { username: { $regex: q, $options: 'i' } } : {}
    ).select('username email avatarUrl role banned bannedReason createdAt xp').limit(50);
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar post (mod)
router.delete('/mod/post/:postId', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const Post = require('../models/Post');
    await Post.findByIdAndDelete(req.params.postId);
    res.json({ message: 'Post eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Dar/quitar rol mod (solo admin)
router.post('/mod/setrole/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo admins' });
    const { role } = req.body;
    const user = await User.findByIdAndUpdate(req.params.userId, { role }, { new: true });
    res.json({ user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;

router.delete('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const Post    = require('../models/Post');
    const User    = require('../models/User');
    await Post.deleteMany({ author: userId });
    await User.findByIdAndDelete(userId);
    res.json({ message: 'Cuenta eliminada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

