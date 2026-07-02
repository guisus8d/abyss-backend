const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema({
  group:       { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  name:        { type: String, required: true, maxlength: 30 },
  description: { type: String, default: '', maxlength: 150 },
  imageUrl:    { type: String, default: null },
  borderColor: { type: String, default: '#ffffff' },
  takenBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

roleSchema.index({ group: 1 });

module.exports = mongoose.model('Role', roleSchema);
