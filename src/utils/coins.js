/**
 * Helper de transacciones de coins.
 * TODA operación que mueva coins debe pasar por aquí
 * para garantizar la sesión MongoDB y el registro en Transaction.
 */
const mongoose  = require('mongoose');
const User        = require('../models/User');
const Transaction = require('../models/Transaction');

const COMMISSION = 0.15;
const r2 = v => Math.round(v * 100) / 100;

/**
 * Transfiere coins de emisor a receptor dentro de una sesión activa.
 * @param {object} opts
 * @param {string|ObjectId} opts.emisorId
 * @param {string|ObjectId} opts.receptorId
 * @param {number}          opts.monto       - coins brutos que salen del emisor
 * @param {string}          opts.tipo        - enum Transaction.tipo
 * @param {object}          opts.session     - sesión MongoDB activa
 * @param {string|ObjectId} [opts.item]      - ref Frame (opcional)
 * @param {string|ObjectId} [opts.gift]      - ref Gift (opcional)
 * @param {number}          [opts.cantidadItems]
 * @returns {Promise<Transaction>}
 */
async function transferirCoins({ emisorId, receptorId, monto, tipo, session, item, gift, cantidadItems }) {
  const comision  = r2(monto * COMMISSION);
  const montoNeto = r2(monto - comision);

  // Debit atómico: falla si el saldo es insuficiente
  const emisor = await User.findOneAndUpdate(
    { _id: emisorId, coins: { $gte: monto } },
    { $inc: { coins: -monto } },
    { session, new: true }
  );
  if (!emisor) throw new Error('Monedas insuficientes');

  // Credit al receptor
  await User.findByIdAndUpdate(receptorId, { $inc: { coins: montoNeto } }, { session });

  // Registro de transacción
  const [tx] = await Transaction.create([{
    tipo,
    emisor:    emisorId,
    receptor:  receptorId,
    monto,
    comision,
    montoNeto,
    item:          item          || undefined,
    gift:          gift          || undefined,
    cantidadItems: cantidadItems || 1,
    estado:    'completada',
  }], { session });

  return tx;
}

/**
 * Reserva coins del emisor en escrow (para regalos).
 * Mueve coins de .coins a .coinsReservadas SIN crear Transaction todavía.
 */
async function reservarCoins({ emisorId, monto, session }) {
  const montoR = r2(monto);
  const emisor = await User.findOneAndUpdate(
    { _id: emisorId, coins: { $gte: montoR } },
    { $inc: { coins: -montoR, coinsReservadas: montoR } },
    { session, new: true }
  );
  if (!emisor) throw new Error('Monedas insuficientes');
  return emisor;
}

/**
 * Libera el escrow al aceptar un regalo.
 * Descuenta de coinsReservadas, acredita al receptor.
 */
async function liberarEscrow({ emisorId, receptorId, monto, tipo, giftId, session }) {
  const comision  = r2(monto * COMMISSION);
  const montoNeto = r2(monto - comision);

  // Quitar de reserva del emisor
  await User.findByIdAndUpdate(emisorId, { $inc: { coinsReservadas: -monto } }, { session });

  // Dar al receptor
  await User.findByIdAndUpdate(receptorId, { $inc: { coins: montoNeto } }, { session });

  const [tx] = await Transaction.create([{
    tipo,
    emisor:   emisorId,
    receptor: receptorId,
    monto,
    comision,
    montoNeto,
    gift:   giftId,
    estado: 'completada',
  }], { session });

  return tx;
}

/**
 * Devuelve el escrow al emisor (regalo rechazado / expirado).
 */
async function devolverEscrow({ emisorId, monto, giftId, session }) {
  const montoR = r2(monto);
  await User.findByIdAndUpdate(
    emisorId,
    { $inc: { coins: montoR, coinsReservadas: -montoR } },
    { session }
  );

  const [tx] = await Transaction.create([{
    tipo:     'reembolso',
    emisor:   emisorId,
    receptor: emisorId,
    monto:    montoR,
    comision:  0,
    montoNeto: montoR,
    gift:   giftId,
    estado: 'completada',
  }], { session });

  return tx;
}

module.exports = { transferirCoins, reservarCoins, liberarEscrow, devolverEscrow, COMMISSION };
