const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  tipo: {
    type: String,
    required: true,
    enum: ['compra_marco', 'regalo_coins', 'regalo_marco', 'comision', 'reembolso'],
  },
  emisor:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receptor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  monto:     { type: Number, required: true },  // bruto que sale del emisor
  comision:  { type: Number, required: true },  // 15% → plataforma
  montoNeto: { type: Number, required: true },  // 85% → receptor

  item:          { type: mongoose.Schema.Types.ObjectId, ref: 'Frame' },
  cantidadItems: { type: Number, default: 1 },
  gift:          { type: mongoose.Schema.Types.ObjectId, ref: 'Gift' },

  estado: {
    type: String,
    enum: ['pendiente', 'completada', 'fallida', 'revertida'],
    default: 'completada',
  },

  metadata: { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

transactionSchema.index({ emisor:   1, createdAt: -1 });
transactionSchema.index({ receptor: 1, createdAt: -1 });
transactionSchema.index({ gift: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
