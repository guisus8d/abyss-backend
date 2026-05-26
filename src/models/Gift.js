const mongoose = require('mongoose');

const giftSchema = new mongoose.Schema({
  emisor:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receptor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  tipo:     { type: String, enum: ['privado', 'grupal'], default: 'privado' },

  mensaje:  { type: String, maxlength: 200, default: '' },
  items: [{
    frame:    { type: mongoose.Schema.Types.ObjectId, ref: 'Frame' },
    cantidad: { type: Number, default: 1, min: 1 },
  }],
  monedas: { type: Number, default: 0, min: 0 },

  // private: always 1. group-coins: max claimers. group-frames: total units.
  slots: { type: Number, default: 1, min: 1 },

  montoReservado:    { type: Number, required: true, min: 0 },
  comisionReservada: { type: Number, required: true, min: 0 },

  reclamaciones: [{
    user:             { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    monedasRecibidas: { type: Number, default: 0 },
    claimedAt:        { type: Date, default: Date.now },
  }],

  estado: {
    type: String,
    enum: ['pendiente', 'aceptado', 'rechazado', 'expirado'],
    default: 'pendiente',
  },
  expiraEn:        { type: Date, required: true },
  transaccionPago: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
}, { timestamps: true });

giftSchema.index({ receptor: 1, estado: 1 });
giftSchema.index({ emisor:   1, createdAt: -1 });
giftSchema.index({ expiraEn: 1, estado: 1 });

module.exports = mongoose.model('Gift', giftSchema);
