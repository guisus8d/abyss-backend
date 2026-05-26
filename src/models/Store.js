const mongoose = require('mongoose');

const storeSchema = new mongoose.Schema({
  usuario:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  nombre:      { type: String, required: true, maxlength: 50 },
  descripcion: { type: String, maxlength: 300, default: '' },
  banner:      { type: String, default: '' },
  logo:        { type: String, default: '' },

  // Nivel 1–5 calculado por ventas
  nivel: { type: Number, default: 1, min: 1, max: 5 },

  // Métricas denormalizadas
  ventasTotales: { type: Number, default: 0 },
  ingresosTotal: { type: Number, default: 0 },  // coins post-comisión
  marcosActivos: { type: Number, default: 0 },

  activa: { type: Boolean, default: true },
}, { timestamps: true });

// Recalcula nivel basado en ventas totales
storeSchema.methods.recalcularNivel = function () {
  const v = this.ventasTotales;
  if      (v >= 500) this.nivel = 5;
  else if (v >= 100) this.nivel = 4;
  else if (v >= 25)  this.nivel = 3;
  else if (v >= 5)   this.nivel = 2;
  else               this.nivel = 1;
};

module.exports = mongoose.model('Store', storeSchema);
