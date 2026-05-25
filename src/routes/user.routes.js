const router = require('express').Router();
const User = require('../models/User');
const { authMiddleware } = require('../middlewares/auth');
const {
  uploadAvatar: uploadAvatarMiddleware,
  uploadBanner,
  uploadCardBg,
  uploadBlock,
} = require('../config/cloudinary');
const { optionalAuth } = require('../middlewares/optionalAuth');
const { getProfile, getUserByUsername, updateProfile, uploadAvatar } = require('../controllers/user.controller');

router.get('/me', authMiddleware, getProfile);

router.patch('/me/active', authMiddleware, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user._id, { lastActive: new Date() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/push-token', authMiddleware, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });
    await User.findByIdAndUpdate(req.user._id, { pushToken: token });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/top', optionalAuth, async (req, res) => {
  try {
    const users = await User.find()
      .select('username avatarUrl xp profileFrame profileFrameUrl badges')
      .sort({ xp: -1 }).limit(10);
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ users: [] });
    const filter = { username: { $regex: q.trim(), $options: 'i' } };
    if (req.user) filter._id = { $ne: req.user._id };
    const users = await User.find(filter)
      .select('username avatarUrl xp badges profileFrame profileFrameUrl').limit(10);
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/random', authMiddleware, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const toOid = id => mongoose.Types.ObjectId.createFromHexString(id.toString());

    const currentId = toOid(req.user._id);

    const seenIds = (req.query.seen || '')
      .split(',')
      .filter(Boolean)
      .map(id => { try { return toOid(id.trim()); } catch { return null; } })
      .filter(Boolean);

    const users = await User.aggregate([
      { $match: {
        _id:      { $nin: [currentId, ...seenIds] },
        banned:   { $ne: true },
        followers: { $nin: [currentId] },
      }},
      { $sample: { size: 10 } },
      { $project: { username: 1, avatarUrl: 1, xp: 1, profileFrame: 1, profileFrameUrl: 1 } },
    ]);
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:username',    optionalAuth, getUserByUsername);
router.patch('/me/profile', authMiddleware, updateProfile);

router.post('/me/avatar',  authMiddleware, uploadAvatarMiddleware.single('avatar'), uploadAvatar);

router.post('/me/upload', authMiddleware, uploadBlock.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image' });
    res.json({ url: req.file.path });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/me/banner', authMiddleware, uploadBanner.single('banner'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profileBanner: req.file.path, profileBannerType: 'image' },
      { new: true }
    );
    res.json({ bannerUrl: req.file.path, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/me/card-bg', authMiddleware, uploadCardBg.single('cardBg'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { profileBg: req.file.path, profileBgType: 'image' },
      { new: true }
    );
    res.json({ cardBgUrl: req.file.path, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Mod middleware ─────────────────────────────────────────────────────────────
const ModLog = require('../models/ModLog');
const modMiddleware = async (req, res, next) => {
  if (req.user?.role !== 'mod' && req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Solo moderadores' });
  next();
};

// ── Listar usuarios (mod) ──────────────────────────────────────────────────────
router.get('/mod/users', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    const users = await User.find(
      q ? { username: { $regex: q, $options: 'i' } } : {}
    ).select('username email avatarUrl role banned bannedReason createdAt xp').limit(50);
    res.json({ users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Banear usuario ─────────────────────────────────────────────────────────────
router.post('/mod/ban/:userId', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) return res.status(400).json({ error: 'Motivo requerido' });

    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Mods no pueden banear admins
    if (target.role === 'admin') return res.status(403).json({ error: 'No puedes banear a un admin' });
    // Solo admins pueden banear mods
    if (target.role === 'mod' && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Solo admins pueden banear mods' });

    target.banned       = true;
    target.bannedReason = reason.trim();
    await target.save();
    await ModLog.create({ action: 'ban', mod: req.user._id, target: target._id, details: { reason: reason.trim(), username: target.username } });
    res.json({ ok: true, user: target });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Desbanear usuario ──────────────────────────────────────────────────────────
router.post('/mod/unban/:userId', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { banned: false, bannedReason: '' },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    await ModLog.create({ action: 'unban', mod: req.user._id, target: user._id, details: { username: user.username } });
    res.json({ ok: true, user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Eliminar post (mod) ────────────────────────────────────────────────────────
router.delete('/mod/post/:postId', authMiddleware, modMiddleware, async (req, res) => {
  try {
    const Post = require('../models/Post');
    await Post.findByIdAndDelete(req.params.postId);
    await ModLog.create({ action: 'delete_post', mod: req.user._id, target: null, details: { postId: req.params.postId } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Cambiar rol (solo admin) ───────────────────────────────────────────────────
router.post('/mod/setrole/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo admins' });
    const { role } = req.body;
    if (!['user', 'collaborator', 'mod', 'admin'].includes(role))
      return res.status(400).json({ error: 'Rol inválido' });
    const before = await User.findById(req.params.userId).select('role username');
    if (!before) return res.status(404).json({ error: 'Usuario no encontrado' });
    const user = await User.findByIdAndUpdate(req.params.userId, { role }, { new: true });
    await ModLog.create({ action: 'change_role', mod: req.user._id, target: before._id, details: { oldRole: before.role, newRole: role, username: before.username } });
    res.json({ user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Eliminar cuenta propia ─────────────────────────────────────────────────────
router.delete('/me', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const Post = require('../models/Post');
    await Post.deleteMany({ author: userId });
    await User.findByIdAndDelete(userId);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
