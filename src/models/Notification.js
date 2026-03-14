const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  to:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  from:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:    { type: String, enum: ['like', 'comment', 'follow', 'chat_accepted'], required: true },
  post:    { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  text:    { type: String },
  read:    { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ to: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
