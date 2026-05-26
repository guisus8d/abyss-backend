const mongoose = require('mongoose');
const frameSchema = new mongoose.Schema({
  creator:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:        { type: String, required: true, maxlength: 50 },
  description: { type: String, default: '', maxlength: 200 },
  imageUrl:    { type: String, required: true },
  publicId:    { type: String, default: '' },
  bgColor:     { type: String, default: '#000000' },
  bgType:      { type: String, default: 'color', enum: ['color', 'gradient', 'image'] },
  bgGradient:  { type: [String], default: [] },
  bgImageUrl:  { type: String, default: '' },
  logoUrl:     { type: String, default: '' },
  pedestalUrl: { type: String, default: '' },
  price:           { type: Number, default: 50 },
  units:           { type: Number, default: 0 },   // unidades en venta actualmente
  totalSold:       { type: Number, default: 0 },   // vendidas históricamente
  unidadesTotales: { type: Number, default: 0 },   // total creadas (inventario del creador)
  status:      { type: String, default: 'draft', enum: ['draft', 'active', 'paused', 'retirado', 'agotado'] },
  xpRequired:  { type: Number, default: 100 },
  likes:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  likesCount:    { type: Number, default: 0 },
  comments:      [{
    user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text:      { type: String, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  }],
  commentsCount: { type: Number, default: 0 },
}, { timestamps: true });
module.exports = mongoose.model('Frame', frameSchema);
