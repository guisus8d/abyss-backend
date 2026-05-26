const mongoose = require('mongoose');

const modLogSchema = new mongoose.Schema({
  action:  { type: String, enum: ['ban', 'unban', 'delete_post', 'change_role'], required: true },
  mod:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  target:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  details: { type: Object, default: {} },
  // Solo para ban y change_role: si ya fue revertida
  reverted:   { type: Boolean, default: false },
  revertedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revertedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ModLog', modLogSchema);
