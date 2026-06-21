const router   = require('express').Router();
const fs       = require('fs');
const mongoose = require('mongoose');
const { authMiddleware } = require('../middlewares/auth');
const { uploadFrameAll } = require('../config/cloudinary');
const Frame          = require('../models/Frame');
const FrameOwnership = require('../models/FrameOwnership');
const User           = require('../models/User');

function frameLog(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}\n`;
  process.stdout.write(line);
  fs.appendFileSync('/tmp/abyss-frame.log', line);
}

const XP_MINIMO    = 100;
const CREATE_COST  = 50;
const CREATE_UNITS = 5;

// ── GET /frames — catálogo activos (legacy) ─────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const frames = await Frame.find({ status: 'active', units: { $gt: 0 } })
      .populate('creator', 'username avatarUrl profileFrame profileFrameUrl')
      .sort({ createdAt: -1 });
    res.json({ frames });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /frames/my — colección personal ────────────────────────────────────
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const owned = await FrameOwnership.find({ user: req.user._id, units: { $gt: 0 } })
      .populate({ path: 'frame', populate: { path: 'creator', select: 'username avatarUrl profileFrame profileFrameUrl' } });
    res.json({ frames: owned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /frames/me/inventory — inventario del creador ──────────────────────
router.get('/me/inventory', authMiddleware, async (req, res) => {
  try {
    // Todos los marcos que el usuario creó
    const frames = await Frame.find({ creator: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    // Inventario personal (unidades en mano, no en tienda)
    const ownerships = await FrameOwnership.find({
      user:  req.user._id,
      frame: { $in: frames.map(f => f._id) },
    }).lean();

    const ownershipMap = {};
    for (const o of ownerships) ownershipMap[String(o.frame)] = o.units;

    const inventory = frames.map(f => ({
      ...f,
      unidadesEnMano: ownershipMap[String(f._id)] || 0,
      // inventario = enMano + enVenta + vendidas
      // unidadesTotales = enMano + enVenta + totalSold
    }));

    res.json({ inventory });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /frames/:id ─────────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findById(req.params.id)
      .populate('creator', 'username avatarUrl profileFrame profileFrameUrl');
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });
    res.json({ frame });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /frames — crear marco ──────────────────────────────────────────────
router.post('/', authMiddleware, (req, res, next) => {
  frameLog('POST /frames — multer start, content-type:', req.headers['content-type']);
  uploadFrameAll(req, res, (err) => {
    if (err) {
      frameLog('MULTER ERROR message:', err.message);
      frameLog('MULTER ERROR http_code:', err.http_code);
      frameLog('MULTER ERROR name:', err.name);
      frameLog('MULTER ERROR full:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
      return res.status(400).json({ error: `Error al subir imagen: ${err.message}` });
    }
    const mainFile = req.files?.image?.[0];
    frameLog('multer OK — frame:', mainFile
      ? `${mainFile.originalname} ${mainFile.mimetype} ${mainFile.size}b`
      : 'MISSING');
    next();
  });
}, async (req, res) => {
  const mainFile = req.files?.image?.[0];
  if (!mainFile) return res.status(400).json({ error: 'Imagen requerida' });

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const bgImageFile  = req.files?.bgImage?.[0];
    const logoFile     = req.files?.logo?.[0];
    const pedestalFile = req.files?.pedestal?.[0];

    const user     = await User.findById(req.user._id).session(session);
    const pkgUnits = parseInt(req.body.units) || CREATE_UNITS;
    const pkgCost  = parseInt(req.body.cost)  || CREATE_COST;

    frameLog(`user xp=${user.xp} coins=${user.coins} pkgCost=${pkgCost} pkgUnits=${pkgUnits}`);

    if (user.xp < XP_MINIMO && !user.isCreator)
      throw Object.assign(new Error(`Necesitas ${XP_MINIMO} XP para crear marcos`), { status: 403 });
    if (user.coins < pkgCost)
      throw Object.assign(new Error(`Necesitas ${pkgCost} monedas`), { status: 400 });

    const { name, description, bgColor, bgType, bgGradient, price } = req.body;
    const [frame] = await Frame.create([{
      creator:         user._id,
      name,
      description,
      imageUrl:        mainFile.path,
      publicId:        mainFile.filename,
      bgColor:         bgColor    || '#000000',
      bgType:          bgType     || 'color',
      bgGradient:      bgGradient ? JSON.parse(bgGradient) : [],
      bgImageUrl:      bgImageFile?.path  || '',
      logoUrl:         logoFile?.path     || '',
      pedestalUrl:     pedestalFile?.path || '',
      price:           parseInt(price) || 50,
      units:           0,
      unidadesTotales: pkgUnits,
      status:          'draft',
    }], { session });

    user.coins -= pkgCost;
    await user.save({ session });

    await FrameOwnership.create([{
      user:   user._id,
      frame:  frame._id,
      units:  pkgUnits,
      origen: 'creacion',
    }], { session });

    await session.commitTransaction();
    frameLog('Frame created:', frame._id, '— newCoins:', user.coins);
    res.status(201).json({ frame, newCoins: user.coins });
  } catch (err) {
    await session.abortTransaction();
    frameLog('TRANSACTION ERROR:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ── PATCH /frames/:id/publish — poner unidades en venta ─────────────────────
router.patch('/:id/publish', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findOne({ _id: req.params.id, creator: req.user._id });
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });
    if (frame.status === 'retirado') return res.status(400).json({ error: 'Marco retirado definitivamente' });

    const unidades = parseInt(req.body.units) || 1;
    const precio   = parseInt(req.body.price)  || frame.price;

    const ownership = await FrameOwnership.findOne({ user: req.user._id, frame: frame._id });
    if (!ownership || ownership.units < unidades)
      return res.status(400).json({ error: 'No tienes suficientes unidades en inventario' });

    ownership.units -= unidades;
    await ownership.save();

    frame.units  += unidades;
    frame.price   = precio;
    frame.status  = 'active';
    await frame.save();

    res.json({ frame, inventarioRestante: ownership.units });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── PATCH /frames/:id/listing — actualizar precio o poner más/menos unidades ─
router.patch('/:id/listing', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findOne({ _id: req.params.id, creator: req.user._id });
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });
    if (!['active', 'agotado'].includes(frame.status))
      return res.status(400).json({ error: 'Solo se puede editar un listing activo o agotado' });

    const { price, agregarUnidades } = req.body;

    if (price !== undefined) frame.price = parseInt(price);

    if (agregarUnidades && agregarUnidades > 0) {
      const ownership = await FrameOwnership.findOne({ user: req.user._id, frame: frame._id });
      if (!ownership || ownership.units < agregarUnidades)
        return res.status(400).json({ error: 'Unidades insuficientes en inventario' });
      ownership.units -= agregarUnidades;
      await ownership.save();
      frame.units += agregarUnidades;
      if (frame.status === 'agotado' && frame.units > 0) frame.status = 'active';
    }

    await frame.save();
    res.json({ frame });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /frames/my/:frameId — eliminar marco de la colección (sin reembolso) ─
router.delete('/my/:frameId', authMiddleware, async (req, res) => {
  try {
    const ownership = await FrameOwnership.findOne({ user: req.user._id, frame: req.params.frameId });
    if (!ownership) return res.status(404).json({ error: 'Marco no encontrado en tu colección' });

    await ownership.deleteOne();

    let profileCleared = false;
    const user = await User.findById(req.user._id);
    if (String(user.profileFrame) === String(req.params.frameId)) {
      user.profileFrame    = 'default';
      user.profileFrameUrl = null;
      await user.save();
      profileCleared = true;
    }

    res.json({ message: 'Marco eliminado de tu colección', profileCleared });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── DELETE /frames/:id/listing — retirar marco del mercado ──────────────────
router.delete('/:id/listing', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findOne({ _id: req.params.id, creator: req.user._id });
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });
    if (!['active', 'agotado', 'paused'].includes(frame.status))
      return res.status(400).json({ error: 'El marco no está en venta' });

    const unidadesDevueltas = frame.units;

    // Devolver unidades al inventario personal del creador
    if (unidadesDevueltas > 0) {
      await FrameOwnership.findOneAndUpdate(
        { user: req.user._id, frame: frame._id },
        { $inc: { units: unidadesDevueltas } },
        { upsert: true }
      );
    }

    frame.units  = 0;
    frame.status = 'retirado';
    await frame.save();

    res.json({ message: 'Marco retirado del mercado', unidadesDevueltas });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /frames/:id/buy — compra legacy (sin sesión) ──────────────────────
// Mantener por compatibilidad con el cliente anterior
// Para nuevas integraciones usar POST /api/market/frames/:id/buy
router.post('/:id/buy', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findById(req.params.id).populate('creator');
    if (!frame || frame.status !== 'active') return res.status(404).json({ error: 'Marco no disponible' });
    if (frame.units <= 0) return res.status(400).json({ error: 'Sin unidades disponibles' });

    const buyer = await User.findById(req.user._id);
    if (buyer.coins < frame.price) return res.status(400).json({ error: 'Monedas insuficientes' });

    const slotsUsados = await FrameOwnership.countDocuments({ user: req.user._id, units: { $gt: 0 } });
    if (slotsUsados >= buyer.collectionSlots)
      return res.status(400).json({ error: `Colección llena (${buyer.collectionSlots} slots)` });

    const creatorEarnings = Math.round(frame.price * 0.85);
    buyer.coins -= frame.price;
    await buyer.save();
    await User.findByIdAndUpdate(frame.creator._id, { $inc: { coins: creatorEarnings } });

    await FrameOwnership.findOneAndUpdate(
      { user: req.user._id, frame: frame._id },
      { $inc: { units: 1 }, $setOnInsert: { origen: 'compra' } },
      { upsert: true, new: true }
    );

    frame.units     -= 1;
    frame.totalSold += 1;
    if (frame.units === 0) frame.status = 'agotado';
    await frame.save();

    res.json({ message: 'Marco comprado', newCoins: buyer.coins });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /frames/slots/expand ────────────────────────────────────────────────
router.post('/slots/expand', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.collectionSlots >= 500) return res.status(400).json({ error: 'Límite máximo alcanzado' });
    if (user.coins < 10) return res.status(400).json({ error: 'Necesitas 10 monedas' });
    user.coins          -= 10;
    user.collectionSlots += 1;
    await user.save();
    res.json({ collectionSlots: user.collectionSlots, coins: user.coins });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
