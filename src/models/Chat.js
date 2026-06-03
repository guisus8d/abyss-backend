const mongoose = require('mongoose');

const messageReactionSchema = new mongoose.Schema({
  user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  emoji: { type: String },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:      { type: String, default: '', maxlength: 2000 },
  type:      { type: String, default: 'text', enum: ['text', 'image', 'audio', 'shared_post', 'shared_profile', 'gift'] },
  mediaUrl:      { type: String, default: null },
  audioDuration: { type: Number, default: null },
  giftId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Gift', default: null },
  giftData: {
    monedas:         { type: Number,   default: 0 },
    items:           { type: Array,    default: [] },
    mensaje:         { type: String,   default: '' },
    estado:          { type: String,   default: 'pendiente' },
    emisorUsername:  { type: String,   default: '' },
    tipo:            { type: String,   default: 'privado' },
    slots:           { type: Number,   default: 1 },
    slotsReclamados: { type: Number,   default: 0 },
    reclamadoPor:    { type: [String], default: [] },
  },
  readBy:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: [messageReactionSchema],
  replyTo: {
    messageId:      { type: mongoose.Schema.Types.ObjectId },
    text:           { type: String },
    senderUsername: { type: String },
  },
  // ── Post compartido ──────────────────────────────────────────────────────
  sharedPost: {
    postId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
    title:           { type: String, default: '' },
    content:         { type: String, default: '' },
    imageUrl:        { type: String, default: null },
    authorUsername:  { type: String, default: '' },
    authorAvatarUrl: { type: String, default: null },
    postType:        { type: String, default: 'quick' },
  },

  sharedProfile: {
    userId:          { type: mongoose.Schema.Types.ObjectId },
    username:        { type: String, default: '' },
    avatarUrl:       { type: String, default: null },
    xp:              { type: Number, default: 0 },
    followersCount:  { type: Number, default: 0 },
    profileFrame:    { type: String, default: null },
    profileFrameUrl: { type: String, default: null },
  },

  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

const chatSchema = new mongoose.Schema({
  participants:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  messages:        [messageSchema],
  lastMessage:     { type: Date, default: Date.now },
  lastMessageText: { type: String, default: '' },
  unreadCounts:    { type: Map, of: Number, default: {} },
}, { timestamps: true });

chatSchema.index({ participants: 1 });
chatSchema.index({ lastMessage: -1 });

module.exports = mongoose.model('Chat', chatSchema);
