const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporter:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:           { type: String, enum: ['post', 'user', 'group'], required: true },
  targetId:       { type: mongoose.Schema.Types.ObjectId, required: true },
  targetName:     { type: String, default: '' },
  // Para posts: ID del autor — permite banear directamente desde el reporte
  targetAuthorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reason:         { type: String, required: true },
  details:        { type: String, default: '' },
  // Hasta 4 imágenes de evidencia
  images:         [{ url: String, publicId: String }],
  status:         { type: String, enum: ['pending', 'reviewed', 'dismissed'], default: 'pending' },
  modNotes:       { type: String, default: '' },
  resolvedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  resolvedAt:     { type: Date, default: null },
}, { timestamps: true });

reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ reporter: 1, targetId: 1 });

module.exports = mongoose.model('Report', reportSchema);
