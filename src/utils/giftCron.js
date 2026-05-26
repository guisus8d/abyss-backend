const cron           = require('node-cron');
const mongoose       = require('mongoose');
const Gift           = require('../models/Gift');
const FrameOwnership = require('../models/FrameOwnership');
const User           = require('../models/User');
const Chat           = require('../models/Chat');
const Group          = require('../models/Group');
const { devolverEscrow } = require('./coins');

async function markExpiredInMessages(giftId) {
  const setFields = { 'messages.$.giftData.estado': 'expirado' };
  await Chat.updateOne({ 'messages.giftId': giftId }, { $set: setFields }).catch(() => {});
  await Group.updateOne({ 'messages.giftId': giftId }, { $set: setFields }).catch(() => {});
}

async function expirarRegalos() {
  const ahora    = new Date();
  const expirados = await Gift.find({ estado: 'pendiente', expiraEn: { $lt: ahora } });
  if (expirados.length === 0) return;
  console.log(`[giftCron] Procesando ${expirados.length} regalo(s) expirado(s)`);

  for (const gift of expirados) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      if (gift.tipo === 'privado') {
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
      } else {
        // grupal: devolver solo la parte no reclamada
        const claimedCoins   = gift.reclamaciones.reduce((s, r) => s + (r.monedasRecibidas || 0), 0);
        const unclaimedCoins = Math.round((gift.montoReservado - claimedCoins) * 100) / 100;
        if (unclaimedCoins > 0) {
          await User.findByIdAndUpdate(
            gift.emisor,
            { $inc: { coins: unclaimedCoins, coinsReservadas: -unclaimedCoins } },
            { session }
          );
        }
        const claimedCount = gift.reclamaciones.length;
        for (const item of gift.items) {
          const unclaimedUnits = item.cantidad - claimedCount;
          if (unclaimedUnits > 0) {
            await FrameOwnership.findOneAndUpdate(
              { user: gift.emisor, frame: item.frame },
              { $inc: { units: unclaimedUnits } },
              { upsert: true, session }
            );
          }
        }
      }

      gift.estado = 'expirado';
      await gift.save({ session });
      await session.commitTransaction();

      await markExpiredInMessages(gift._id);
      console.log(`[giftCron] Gift ${gift._id} (${gift.tipo}) expirado — reembolso parcial al emisor ${gift.emisor}`);
    } catch (err) {
      await session.abortTransaction();
      console.error(`[giftCron] Error procesando gift ${gift._id}:`, err.message);
    } finally {
      session.endSession();
    }
  }
}

function startGiftCron() {
  cron.schedule('0 3 * * *', () => {
    console.log('[giftCron] Verificando regalos expirados...');
    expirarRegalos().catch(err => console.error('[giftCron] Error:', err.message));
  });
  console.log('[giftCron] Cron de expiración activo (03:00 AM diario, ventana 30 días)');
}

module.exports = { startGiftCron, expirarRegalos };
