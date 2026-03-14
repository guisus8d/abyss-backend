const mongoose = require('mongoose');

const messageReactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  emoji: { type: String },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:      { type: String, required: true, maxlength: 2000 },
  readBy:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: [messageReactionSchema],
  replyTo:   {
    messageId: { type: mongoose.Schema.Types.ObjectId },
    text:      { type: String },
    senderUsername: { type: String },
  },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

const chatSchema = new mongoose.Schema({
  participants:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  messages:        [messageSchema],
  lastMessage:     { type: Date, default: Date.now },
  lastMessageText: { type: String, default: '' },
  pendingMessages: [messageSchema],
  unreadCounts:    { type: Map, of: Number, default: {} },
}, { timestamps: true });

chatSchema.index({ participants: 1 });
chatSchema.index({ lastMessage: -1 });

module.exports = mongoose.model('Chat', chatSchema);
