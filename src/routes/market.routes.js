const router         = require('express').Router();
const mongoose       = require('mongoose');
const { authMiddleware } = require('../middlewares/auth');
const { optionalAuth }   = require('../middlewares/optionalAuth');
const Frame          = require('../models/Frame');
const FrameOwnership = require('../models/FrameOwnership');
const Store          = require('../models/Store');
const User           = require('../models/User');
const Notification   = require('../models/Notification');
const { transferirCoins } = require('../utils/coins');
const { getIO }      = require('../sockets');
const { sendPush }   = require('../utils/pushNotifications');

// ── GET /api/market/frames ──────────────────────────────────────────────────
// Lista marcos activos con paginación y filtros opcionales
router.get('/frames', optionalAuth, async (req, res) => {
  try {
    const page     = Math.max(1, parseInt(req.query.page)  || 1);
    const limit    = Math.min(50, parseInt(req.query.limit) || 20);
    const skip     = (page - 1) * limit;
    const sort     = req.query.sort === 'precio_asc'  ? { price: 1 }
                   : req.query.sort === 'precio_desc' ? { price: -1 }
                   : req.query.sort === 'populares'   ? { totalSold: -1 }
                   : { createdAt: -1 };

    const filter = { status: 'active', units: { $gt: 0 } };
    if (req.query.creator)  filter.creator  = req.query.creator;
    if (req.query.precioMin) filter.price = { ...filter.price, $gte: Number(req.query.precioMin) };
    if (req.query.precioMax) filter.price = { ...filter.price, $lte: Number(req.query.precioMax) };
    if (req.query.q) filter.name = { $regex: req.query.q, $options: 'i' };

    const [frames, total] = await Promise.all([
      Frame.find(filter)
        .populate('creator', 'username avatarUrl profileFrame profileFrameUrl')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Frame.countDocuments(filter),
    ]);

    const uid = req.user ? String(req.user._id) : null;
    const framesWithMeta = frames.map(f => ({
      ...f,
      likedByMe: uid ? (Array.isArray(f.likes) && f.likes.some(id => String(id) === uid)) : false,
    }));
    res.json({ frames: framesWithMeta, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/market/frames/:id ──────────────────────────────────────────────
// Detalle de un marco con ownership del usuario autenticado
router.get('/frames/:id', optionalAuth, async (req, res) => {
  try {
    const frame = await Frame.findById(req.params.id)
      .populate('creator', 'username avatarUrl profileFrame profileFrameUrl xp');
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });

    const ownership = req.user
      ? await FrameOwnership.findOne({ user: req.user._id, frame: frame._id })
      : null;
    const store = await Store.findOne({ usuario: frame.creator._id });

    const frameObj = frame.toObject();
    frameObj.likedByMe = req.user
      ? frame.likes.some(id => String(id) === String(req.user._id))
      : false;
    res.json({ frame: frameObj, ownership: ownership || null, store: store || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/market/frames/:id/buy ────────────────────────────────────────
// Compra un marco — usa sesión MongoDB para atomicidad total
router.post('/frames/:id/buy', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const frame = await Frame.findById(req.params.id)
      .populate('creator', '_id')
      .session(session);

    if (!frame || frame.status !== 'active')
      throw Object.assign(new Error('Marco no disponible'), { status: 400 });
    if (frame.units <= 0)
      throw Object.assign(new Error('Sin unidades disponibles'), { status: 400 });
    if (String(frame.creator._id) === String(req.user._id))
      throw Object.assign(new Error('No puedes comprarte tu propio marco'), { status: 400 });

    // Verificar espacio en colección
    const buyer = await require('../models/User').findById(req.user._id).session(session);
    const slotsUsados = await FrameOwnership.countDocuments({ user: req.user._id, units: { $gt: 0 } }).session(session);
    if (slotsUsados >= buyer.collectionSlots)
      throw Object.assign(new Error(`Colección llena (${buyer.collectionSlots} slots)`), { status: 400 });

    // Transferir coins con comisión 15%
    const tx = await transferirCoins({
      emisorId:   req.user._id,
      receptorId: frame.creator._id,
      monto:      frame.price,
      tipo:       'compra_marco',
      item:       frame._id,
      session,
    });

    // Dar unidad al comprador (upsert)
    await FrameOwnership.findOneAndUpdate(
      { user: req.user._id, frame: frame._id },
      { $inc: { units: 1 }, $setOnInsert: { origen: 'compra' } },
      { upsert: true, session, new: true }
    );

    // Descontar del stock y marcar agotado si corresponde
    const updatedFrame = await Frame.findOneAndUpdate(
      { _id: frame._id, units: { $gt: 0 } },
      { $inc: { units: -1, totalSold: 1 } },
      { session, new: true }
    );
    if (!updatedFrame) throw Object.assign(new Error('Marco agotado'), { status: 400 });
    if (updatedFrame.units === 0) {
      await Frame.findByIdAndUpdate(frame._id, { status: 'agotado' }, { session });
    }

    // Actualizar tienda del creador si existe
    const store = await Store.findOne({ usuario: frame.creator._id }).session(session);
    if (store) {
      store.ventasTotales += 1;
      store.ingresosTotal += tx.montoNeto;
      store.recalcularNivel();
      await store.save({ session });
    }

    await session.commitTransaction();

    // Obtener saldo actualizado del comprador
    const nuevoSaldo = await require('../models/User').findById(req.user._id).select('coins');
    res.json({ message: 'Marco comprado', newCoins: nuevoSaldo.coins, transaccion: tx._id });
  } catch (err) {
    await session.abortTransaction();
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ── POST /api/market/frames/:id/like — toggle like ─────────────────────────
router.post('/frames/:id/like', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findById(req.params.id)
      .populate('creator', '_id username pushToken');
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });

    const userId  = String(req.user._id);
    const already = frame.likes.some(id => String(id) === userId);

    if (already) {
      frame.likes.pull(req.user._id);
      frame.likesCount = Math.max(0, frame.likesCount - 1);
    } else {
      frame.likes.push(req.user._id);
      frame.likesCount += 1;

      if (String(frame.creator._id) !== userId) {
        await Notification.create({
          to:    frame.creator._id,
          from:  req.user._id,
          type:  'like',
          frame: frame._id,
          text:  `@${req.user.username} le dio like a tu marco ${frame.name}`,
        });
        sendPush(
          frame.creator.pushToken,
          'Nuevo like',
          `@${req.user.username} le dio like a tu marco ${frame.name}`,
          { type: 'frame_like', frameId: frame._id.toString() }
        );
        getIO().to(String(frame.creator._id)).emit('notification');
      }
    }

    await frame.save();
    res.json({ liked: !already, likesCount: frame.likesCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/market/frames/:id/comments ────────────────────────────────────
router.get('/frames/:id/comments', authMiddleware, async (req, res) => {
  try {
    const frame = await Frame.findById(req.params.id)
      .select('comments commentsCount')
      .populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl');
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });

    const comments = frame.comments.slice().reverse();
    res.json({ comments, total: frame.commentsCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/market/frames/:id/comment ────────────────────────────────────
router.post('/frames/:id/comment', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Comentario vacío' });
    if (text.length > 500) return res.status(400).json({ error: 'Máximo 500 caracteres' });

    const frame = await Frame.findById(req.params.id)
      .populate('creator', '_id username pushToken');
    if (!frame) return res.status(404).json({ error: 'Marco no encontrado' });

    frame.comments.push({ user: req.user._id, text: text.trim(), createdAt: new Date() });
    frame.commentsCount += 1;
    await frame.save();

    const userId  = String(req.user._id);
    if (String(frame.creator._id) !== userId) {
      await Notification.create({
        to:    frame.creator._id,
        from:  req.user._id,
        type:  'comment',
        frame: frame._id,
        text:  `@${req.user.username} comentó tu marco ${frame.name}`,
      });
      sendPush(
        frame.creator.pushToken,
        'Nuevo comentario',
        `@${req.user.username} comentó tu marco ${frame.name}`,
        { type: 'frame_comment', frameId: frame._id.toString() }
      );
      getIO().to(String(frame.creator._id)).emit('notification');
    }

    const poster     = await User.findById(req.user._id).select('username avatarUrl profileFrame profileFrameUrl');
    const newComment = frame.comments[frame.comments.length - 1];
    res.status(201).json({
      comment:       { ...newComment.toObject(), user: poster },
      commentsCount: frame.commentsCount,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
