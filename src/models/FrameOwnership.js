const mongoose = require('mongoose');
const frameOwnershipSchema = new mongoose.Schema({
  user:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  frame:   { type: mongoose.Schema.Types.ObjectId, ref: 'Frame', required: true },
  units:   { type: Number, default: 0 },
  equipped: { type: Boolean, default: false },
}, { timestamps: true });
frameOwnershipSchema.index({ user: 1, frame: 1 }, { unique: true });
module.exports = mongoose.model('FrameOwnership', frameOwnershipSchema);
