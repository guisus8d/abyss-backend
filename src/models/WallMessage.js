const mongoose = require('mongoose');

const wallMessageSchema = new mongoose.Schema({
  author:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:       { type: String, required: true, maxlength: 500, trim: true },
}, { timestamps: true });

wallMessageSchema.index({ targetUser: 1, createdAt: -1 });

module.exports = mongoose.model('WallMessage', wallMessageSchema);
