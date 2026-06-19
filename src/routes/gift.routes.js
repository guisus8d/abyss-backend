const router         = require('express').Router();
const mongoose       = require('mongoose');
const { authMiddleware } = require('../middlewares/auth');
const Gift           = require('../models/Gift');
const Frame          = require('../models/Frame');
const FrameOwnership = require('../models/FrameOwnership');
const User           = require('../models/User');
const Chat           = require('../models/Chat');
const Group          = require('../models/Group');
const { reservarCoins, liberarEscrow, devolverEscrow } = require('../utils/coins');
const { getIO } = require('../sockets');
const { sendPush } = require('../utils/pushNotifications');
const Notification = require('../models/Notification');

const DIAS_EXPIRACION    = 30;
const ITEM_TRANSFER_COST = 5;  // private frames only

async function syncGiftDataInMessages(giftId, update, session) {
  const setFields = {};
  for (const [k, v] of Object.entries(update)) {
    setFields[`messages.$.giftData.${k}`] = v;
  }
  const opts = session ? { session } : {};
  await Chat.updateOne({ 'messages.giftId': giftId }, { $set: setFields }, opts);
  await Group.updateOne({ 'messages.giftId': giftId }, { $set: setFields }, opts);
}

// ── POST /api/gifts — regalo privado ──────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { receptorUsername, monedas = 0, items = [], mensaje = '' } = req.body;

    if (!receptorUsername)
      throw Object.assign(new Error('Receptor requerido'), { status: 400 });

    const receptor = await User.findOne({ username: receptorUsername });
    if (!receptor) throw Object.assign(new Error('Usuario no encontrado'), { status: 404 });
    if (String(receptor._id) === String(req.user._id))
      throw Object.assign(new Error('No puedes enviarte un regalo a ti mismo'), { status: 400 });
    if (monedas === 0 && items.length === 0)
      throw Object.assign(new Error('El regalo debe incluir monedas o marcos'), { status: 400 });

    let montoReservado = 0;
    let comisionReservada = 0;
    if (monedas > 0) {
      montoReservado    = monedas;
      comisionReservada = Math.round(monedas * 0.15);
      await reservarCoins({ emisorId: req.user._id, monto: montoReservado, session });
    }

    const itemsValidados = [];
    for (const it of items) {
      const { frameId, cantidad = 1 } = it;
      const frame = await Frame.findById(frameId).session(session);
      if (!frame) throw Object.assign(new Error(`Marco ${frameId} no encontrado`), { status: 404 });

      const ownership = await FrameOwnership.findOne({ user: req.user._id, frame: frameId }).session(session);
      if (!ownership || ownership.units < cantidad)
        throw Object.assign(new Error(`No tienes ${cantidad} unidad(es) del marco "${frame.name}"`), { status: 400 });

      ownership.units -= cantidad;
      await ownership.save({ session });

      if (ownership.units === 0) {
        await User.findOneAndUpdate(
          { _id: req.user._id, profileFrame: String(frameId) },
          { profileFrame: 'default', profileFrameUrl: null },
          { session }
        );
      }

      itemsValidados.push({ frame: frameId, cantidad });
    }

    const totalItemCost = itemsValidados.reduce((sum, it) => sum + it.cantidad, 0) * ITEM_TRANSFER_COST;
    if (totalItemCost > 0) {
      const senderDoc = await User.findById(req.user._id).session(session);
      if (!senderDoc || senderDoc.coins < totalItemCost)
        throw Object.assign(new Error(`Necesitas ${totalItemCost} coins para la tarifa de transferencia`), { status: 400 });
      await User.findByIdAndUpdate(req.user._id, { $inc: { coins: -totalItemCost } }, { session });
    }

    const expiraEn = new Date(Date.now() + DIAS_EXPIRACION * 24 * 60 * 60 * 1000);
    const [gift] = await Gift.create([{
      emisor: req.user._id, receptor: receptor._id, tipo: 'privado',
      mensaje: mensaje.slice(0, 200), items: itemsValidados,
      monedas, slots: 1, montoReservado, comisionReservada, expiraEn,
    }], { session });

    await session.commitTransaction();

    const giftPoblado = await Gift.findById(gift._id)
      .populate('emisor',   'username avatarUrl')
      .populate('receptor', 'username avatarUrl')
      .populate('items.frame', 'name imageUrl price');

    res.status(201).json({ gift: giftPoblado });
  } catch (err) {
    await session.abortTransaction();
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ── POST /api/gifts/group — lluvia de regalos (grupal) ────────────────────────
router.post('/group', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { monedas = 0, items = [], mensaje = '' } = req.body;
    const slots = parseInt(req.body.slots) || 2;

    if (monedas === 0 && items.length === 0)
      throw Object.assign(new Error('El regalo debe incluir monedas o marcos'), { status: 400 });
    if (monedas > 0 && items.length > 0)
      throw Object.assign(new Error('Elige solo un tipo: monedas o marcos'), { status: 400 });

    let montoReservado = 0;
    let giftSlots = slots;

    if (monedas > 0) {
      if (slots < 2 || slots > 50)
        throw Object.assign(new Error('Los slots deben ser entre 2 y 50'), { status: 400 });
      montoReservado = monedas;
      await reservarCoins({ emisorId: req.user._id, monto: monedas, session });
    }

    const itemsValidados = [];
    for (const it of items) {
      const { frameId, cantidad = 1 } = it;
      const cant = parseInt(cantidad) || 1;
      if (cant < 1 || cant > 50)
        throw Object.assign(new Error('La cantidad debe ser entre 1 y 50'), { status: 400 });

      const frame = await Frame.findById(frameId).session(session);
      if (!frame) throw Object.assign(new Error('Marco no encontrado'), { status: 404 });

      const ownership = await FrameOwnership.findOne({ user: req.user._id, frame: frameId }).session(session);
      if (!ownership || ownership.units < cant)
        throw Object.assign(new Error(`No tienes ${cant} unidad(es) de "${frame.name}"`), { status: 400 });

      ownership.units -= cant;
      await ownership.save({ session });

      if (ownership.units === 0) {
        await User.findOneAndUpdate(
          { _id: req.user._id, profileFrame: String(frameId) },
          { profileFrame: 'default', profileFrameUrl: null },
          { session }
        );
      }

      itemsValidados.push({ frame: frameId, cantidad: cant });
      giftSlots = cant;
    }

    const expiraEn = new Date(Date.now() + DIAS_EXPIRACION * 24 * 60 * 60 * 1000);
    const [gift] = await Gift.create([{
      emisor: req.user._id, tipo: 'grupal',
      mensaje: mensaje.slice(0, 200), items: itemsValidados,
      monedas, slots: giftSlots, montoReservado, comisionReservada: 0, expiraEn,
    }], { session });

    await session.commitTransaction();

    const giftPoblado = await Gift.findById(gift._id)
      .populate('emisor', 'username avatarUrl')
      .populate('items.frame', 'name imageUrl price');

    res.status(201).json({ gift: giftPoblado });
  } catch (err) {
    await session.abortTransaction();
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ── GET /api/gifts/received — regalos privados recibidos ──────────────────────
// ?all=true  → todos los estados (historial); por defecto solo pendientes
router.get('/received', authMiddleware, async (req, res) => {
  try {
    const filter = { receptor: req.user._id, tipo: 'privado' };
    if (!req.query.all) filter.estado = 'pendiente';
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 30);
    const gifts = await Gift.find(filter)
      .populate('emisor',      'username avatarUrl profileFrame profileFrameUrl')
      .populate('items.frame', 'name imageUrl price')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({ gifts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/gifts/sent ───────────────────────────────────────────────────────
router.get('/sent', authMiddleware, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const gifts = await Gift.find({ emisor: req.user._id })
      .populate('receptor',    'username avatarUrl')
      .populate('items.frame', 'name imageUrl price')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    res.json({ gifts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/gifts/:id/accept — aceptar regalo privado ──────────────────────
router.post('/:id/accept', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const gift = await Gift.findOne({ _id: req.params.id, receptor: req.user._id, tipo: 'privado' }).session(session);
    if (!gift) throw Object.assign(new Error('Regalo no encontrado'), { status: 404 });
    if (gift.estado !== 'pendiente') throw Object.assign(new Error(`El regalo ya fue ${gift.estado}`), { status: 400 });
    if (gift.expiraEn < new Date()) throw Object.assign(new Error('El regalo ha expirado'), { status: 400 });

    let tx = null;
    if (gift.montoReservado > 0) {
      tx = await liberarEscrow({
        emisorId: gift.emisor, receptorId: req.user._id,
        monto: gift.montoReservado, tipo: 'regalo_coins', giftId: gift._id, session,
      });
    }

    for (const item of gift.items) {
      const receptor    = await User.findById(req.user._id).session(session);
      const slotsUsados = await FrameOwnership.countDocuments({ user: req.user._id, units: { $gt: 0 } }).session(session);
      if (slotsUsados >= receptor.collectionSlots)
        throw Object.assign(new Error(`Colección llena (${receptor.collectionSlots} slots)`), { status: 400 });

      await FrameOwnership.findOneAndUpdate(
        { user: req.user._id, frame: item.frame },
        { $inc: { units: item.cantidad }, $setOnInsert: { origen: 'regalo' } },
        { upsert: true, session, new: true }
      );
    }

    await syncGiftDataInMessages(gift._id, { estado: 'aceptado' }, session);
    gift.estado = 'aceptado';
    if (tx) gift.transaccionPago = tx._id;
    await gift.save({ session });

    await session.commitTransaction();
    try { getIO().to(`user:${gift.emisor}`).emit('gift:update', { giftId: gift._id, estado: 'aceptado' }); } catch (_) {}
    res.json({ message: 'Regalo aceptado', gift });
  } catch (err) {
    await session.abortTransaction();
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ── POST /api/gifts/:id/reject — rechazar regalo privado ─────────────────────
router.post('/:id/reject', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const gift = await Gift.findOne({ _id: req.params.id, receptor: req.user._id, tipo: 'privado' }).session(session);
    if (!gift) throw Object.assign(new Error('Regalo no encontrado'), { status: 404 });
    if (gift.estado !== 'pendiente') throw Object.assign(new Error(`El regalo ya fue ${gift.estado}`), { status: 400 });

    if (gift.montoReservado > 0) {
      await devolverEscrow({ emisorId: gift.emisor, monto: gift.montoReservado, giftId: gift._id, session });
    }
    for (const item of gift.items) {
      await FrameOwnership.findOneAndUpdate(
        { user: gift.emisor, frame: item.frame },
        { $inc: { units: item.cantidad } },
        { upsert: true, session }
      );
    }
    const totalItemCost = gift.items.reduce((sum, it) => sum + it.cantidad, 0) * ITEM_TRANSFER_COST;
    if (totalItemCost > 0) {
      await User.findByIdAndUpdate(gift.emisor, { $inc: { coins: totalItemCost } }, { session });
    }

    await syncGiftDataInMessages(gift._id, { estado: 'rechazado' }, session);
    gift.estado = 'rechazado';
    await gift.save({ session });

    await session.commitTransaction();
    try { getIO().to(`user:${gift.emisor}`).emit('gift:update', { giftId: gift._id, estado: 'rechazado' }); } catch (_) {}
    res.json({ message: 'Regalo rechazado' });
  } catch (err) {
    await session.abortTransaction();
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ── POST /api/gifts/:id/claim — reclamar regalo grupal ───────────────────────
router.post('/:id/claim', authMiddleware, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { roomId, roomType } = req.body;

    const gift = await Gift.findById(req.params.id).session(session);
    if (!gift) throw Object.assign(new Error('Regalo no encontrado'), { status: 404 });
    if (gift.tipo !== 'grupal') throw Object.assign(new Error('Este regalo no se puede reclamar'), { status: 400 });
    if (gift.estado !== 'pendiente') throw Object.assign(new Error('Este regalo ya no está disponible'), { status: 400 });
    if (gift.expiraEn < new Date()) throw Object.assign(new Error('El regalo ha expirado'), { status: 400 });
    if (gift.reclamaciones.some(r => String(r.user) === String(req.user._id)))
      throw Object.assign(new Error('Ya reclamaste este regalo'), { status: 400 });
    if (gift.reclamaciones.length >= gift.slots)
      throw Object.assign(new Error('Este regalo ya no tiene unidades disponibles'), { status: 400 });

    let monedasRecibidas = 0;

    if (gift.monedas > 0) {
      // Deduct proportional escrow share (full monedas / slots) so reserve drains correctly.
      // Recipient gets the net share after 15% Abyss commission.
      const escrowPorSlot = Math.floor(gift.monedas / gift.slots);
      monedasRecibidas    = Math.round((gift.monedas * 0.85) / gift.slots * 100) / 100;
      await User.findByIdAndUpdate(gift.emisor, { $inc: { coinsReservadas: -escrowPorSlot } }, { session });
      await User.findByIdAndUpdate(req.user._id, { $inc: { coins: monedasRecibidas } }, { session });
    }

    for (const item of gift.items) {
      const claimer     = await User.findById(req.user._id).session(session);
      const slotsUsados = await FrameOwnership.countDocuments({ user: req.user._id, units: { $gt: 0 } }).session(session);
      if (slotsUsados >= claimer.collectionSlots)
        throw Object.assign(new Error(`Colección llena (${claimer.collectionSlots} slots)`), { status: 400 });

      await FrameOwnership.findOneAndUpdate(
        { user: req.user._id, frame: item.frame },
        { $inc: { units: 1 }, $setOnInsert: { origen: 'regalo' } },
        { upsert: true, session, new: true }
      );
    }

    gift.reclamaciones.push({ user: req.user._id, monedasRecibidas, claimedAt: new Date() });
    const slotsReclamados = gift.reclamaciones.length;
    const allClaimed = slotsReclamados >= gift.slots;
    if (allClaimed) gift.estado = 'aceptado';
    await gift.save({ session });

    const reclamadoPor = gift.reclamaciones.map(r => String(r.user));
    const msgUpdate = { slotsReclamados, reclamadoPor, ...(allClaimed ? { estado: 'aceptado' } : {}) };
    await syncGiftDataInMessages(gift._id, msgUpdate, session);

    await session.commitTransaction();

    try {
      const roomKey = roomType === 'group' ? `group:${roomId}` : `chat:${roomId}`;
      getIO().to(roomKey).emit('gift:update', { giftId: String(gift._id), ...msgUpdate });
    } catch (_) {}

    // Push + Notification al emisor (fuera de transacción, no bloquea la respuesta)
    try {
      if (String(gift.emisor) !== String(req.user._id)) {
        const [claimerDoc, emisorDoc] = await Promise.all([
          User.findById(req.user._id, 'username'),
          User.findById(gift.emisor, 'pushToken'),
        ]);
        if (claimerDoc?.username) {
          const body = allClaimed
            ? `@${claimerDoc.username} reclamó tu regalo — ¡regalo completado!`
            : `@${claimerDoc.username} reclamó tu regalo`;
          await Notification.create({
            to:   gift.emisor,
            from: req.user._id,
            type: 'gift_claimed',
            text: body,
          });
          getIO().to(String(gift.emisor)).emit('notification:new');
          if (emisorDoc?.pushToken) {
            sendPush(emisorDoc.pushToken, 'Regalo reclamado', body, { giftId: String(gift._id) });
          }
        }
      }
    } catch (_) {}

    res.json({ message: 'Regalo reclamado', monedasRecibidas, slotsReclamados });
  } catch (err) {
    await session.abortTransaction();
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

module.exports = router;
