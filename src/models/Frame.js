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
  price:       { type: Number, default: 50 },
  units:       { type: Number, default: 0 },
  totalSold:   { type: Number, default: 0 },
  status:      { type: String, default: 'draft', enum: ['draft', 'active', 'paused'] },
  xpRequired:  { type: Number, default: 200 },
}, { timestamps: true });
module.exports = mongoose.model('Frame', frameSchema);
