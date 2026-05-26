const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  to:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  from:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:      { type: String, enum: ['like', 'comment', 'follow', 'chat_accepted', 'group_invite', 'mention', 'admin_transfer', 'admin_transfer_declined'], required: true },
  post:      { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  frame:     { type: mongoose.Schema.Types.ObjectId, ref: 'Frame' },
  text:      { type: String },
  read:      { type: Boolean, default: false },
  groupId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },
  groupName:        { type: String },
  groupDescription: { type: String },
  groupImageUrl:    { type: String },
}, { timestamps: true });

notificationSchema.index({ to: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
