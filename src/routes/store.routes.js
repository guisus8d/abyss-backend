const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { uploadStoreBanner, uploadStoreLogo } = require('../config/cloudinary');
const Store = require('../models/Store');
const Frame = require('../models/Frame');
const User  = require('../models/User');

// ── POST /api/store — crear tienda propia ───────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const exists = await Store.findOne({ usuario: req.user._id });
    if (exists) return res.status(409).json({ error: 'Ya tienes una tienda' });

    const { nombre, descripcion } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });

    const store = await Store.create({
      usuario:     req.user._id,
      nombre:      nombre.trim(),
      descripcion: descripcion?.trim() || '',
    });

    res.status(201).json({ store });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/store/me/stats — métricas de la tienda propia ─────────────────
router.get('/me/stats', authMiddleware, async (req, res) => {
  try {
    const store = await Store.findOne({ usuario: req.user._id });
    if (!store) return res.status(404).json({ error: 'No tienes tienda' });

    const marcosActivos = await Frame.countDocuments({
      creator: req.user._id,
      status: { $in: ['active'] },
    });

    // Sincronizar marcosActivos por si hay desfase
    if (store.marcosActivos !== marcosActivos) {
      store.marcosActivos = marcosActivos;
      await store.save();
    }

    res.json({ store, marcosActivos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/store/me — editar tienda propia ─────────────────────────────
router.patch('/me', authMiddleware, async (req, res) => {
  try {
    const store = await Store.findOne({ usuario: req.user._id });
    if (!store) return res.status(404).json({ error: 'No tienes tienda' });

    const campos = ['nombre', 'descripcion', 'banner', 'logo'];
    for (const c of campos) {
      if (req.body[c] !== undefined) store[c] = req.body[c];
    }
    await store.save();
    res.json({ store });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/store/me/banner — subir imagen de banner ────────────────────
router.patch('/me/banner', authMiddleware, (req, res, next) => {
  uploadStoreBanner.single('banner')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });
    const store = await Store.findOneAndUpdate(
      { usuario: req.user._id },
      { banner: req.file.path },
      { new: true }
    );
    if (!store) return res.status(404).json({ error: 'No tienes tienda' });
    res.json({ url: req.file.path, store });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /api/store/me/logo — subir imagen de logo ────────────────────────
router.patch('/me/logo', authMiddleware, (req, res, next) => {
  uploadStoreLogo.single('logo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });
    const store = await Store.findOneAndUpdate(
      { usuario: req.user._id },
      { logo: req.file.path },
      { new: true }
    );
    if (!store) return res.status(404).json({ error: 'No tienes tienda' });
    res.json({ url: req.file.path, store });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/store/:username — ver tienda de un usuario ────────────────────
router.get('/:username', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: decodeURIComponent(req.params.username) }).select('_id username avatarUrl profileFrame profileFrameUrl xp');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const store = await Store.findOne({ usuario: user._id, activa: true });
    if (!store) return res.status(404).json({ error: 'Este usuario no tiene tienda' });

    const frames = await Frame.find({
      creator: user._id,
      status:  'active',
      units:   { $gt: 0 },
    })
      .sort({ createdAt: -1 })
      .lean();

    res.json({ store, user, frames });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
