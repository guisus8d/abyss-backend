const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { uploadPost: uploadFrame } = require('../config/cloudinary');
const Frame = require('../models/Frame');
const FrameOwnership = require('../models/FrameOwnership');
const User = require('../models/User');

const PLATFORM_FEE = 0.15;
const CREATE_COST  = 50;
const CREATE_UNITS = 5;

// Listar marcos del catálogo (activos)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const frames = await Frame.find({ status: 'active' })
      .populate('creator', 'username avatarUrl')
      .sort({ createdAt: -1 });
    res.json({ frames });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mis marcos (colección)
router.get('/my', authMiddleware, async (req, res) => {
  try {
    const owned = await FrameOwnership.find({ user: req.user._id, units: { $gt: 0 } })
      .populate('frame');
    res.json({ frames: owned });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear marco (requiere 200 XP y 50 monedas)
router.post('/', authMiddleware, uploadFrame.single('image'), async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (user.xp < 200) return res.status(403).json({ error: 'Necesitas 200 XP para crear marcos' });
    if (user.coins < CREATE_COST) return res.status(403).json({ error: 'Necesitas 50 monedas' });
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });

    const { name, description, bgColor, bgType, bgGradient, bgImageUrl, price } = req.body;
    const frame = await Frame.create({
      creator: user._id,
      name, description,
      imageUrl:   req.file.path,
      publicId:   req.file.filename,
      bgColor:    bgColor || '#000000',
      bgType:     bgType  || 'color',
      bgGradient: bgGradient ? JSON.parse(bgGradient) : [],
      bgImageUrl: bgImageUrl || '',
      price:      parseInt(price) || 50,
      units:      0,
      status:     'draft',
    });

    // Descontar monedas y dar 5 unidades al creador
    user.coins -= CREATE_COST;
    await user.save();

    await FrameOwnership.create({ user: user._id, frame: frame._id, units: CREATE_UNITS });

    res.status(201).json({ frame, newCoins: user.coins });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Publicar marco en tienda
router.patch('/:id/publish', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findOne({ _id: req.params.id, creator: req.user._id });
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });
    const { units, price } = req.body;
    const ownership = await FrameOwnership.findOne({ user: req.user._id, frame: frame._id });
    if (!ownership || ownership.units < units)
      return res.status(400).json({ error: 'No tienes suficientes unidades' });
    ownership.units -= units;
    await ownership.save();
    frame.units  += units;
    frame.price   = parseInt(price) || frame.price;
    frame.status  = 'active';
    await frame.save();
    res.json({ frame });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Comprar marco
router.post('/:id/buy', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findById(req.params.id).populate('creator');
    if (!frame || frame.status !== 'active') return res.status(404).json({ error: 'Marco no disponible' });
    if (frame.units <= 0) return res.status(400).json({ error: 'Sin unidades disponibles' });

    const buyer = await User.findById(req.user._id);
    if (buyer.coins < frame.price) return res.status(400).json({ error: 'Monedas insuficientes' });

    // Verificar límite de colección
    const currentOwned = await FrameOwnership.countDocuments({ user: req.user._id, units: { $gt: 0 } });
    if (currentOwned >= buyer.collectionSlots)
      return res.status(400).json({ error: `Colección llena (${buyer.collectionSlots} slots). Compra más espacio.` });

    // Transferir monedas
    const creatorEarnings = Math.floor(frame.price * (1 - PLATFORM_FEE));
    buyer.coins -= frame.price;
    await buyer.save();
    await User.findByIdAndUpdate(frame.creator._id, { $inc: { coins: creatorEarnings } });

    // Dar unidad al comprador
    await FrameOwnership.findOneAndUpdate(
      { user: req.user._id, frame: frame._id },
      { $inc: { units: 1 } },
      { upsert: true, new: true }
    );

    frame.units     -= 1;
    frame.totalSold += 1;
    await frame.save();

    res.json({ message: 'Marco comprado', newCoins: buyer.coins });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Expandir colección (+1 slot = 10 monedas)
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
