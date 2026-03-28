const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:     { type: String, default: '', maxlength: 2000 },
  type:     { type: String, default: 'text', enum: ['text', 'image', 'audio', 'shared_post'] },
  mediaUrl:      { type: String, default: null },
  audioDuration: { type: Number, default: null },
  replyTo:  {
    messageId:      { type: mongoose.Schema.Types.ObjectId },
    text:           { type: String },
    senderUsername: { type: String },
  },
  sharedPost: {
    postId:          { type: String, default: null },
    title:           { type: String, default: '' },
    content:         { type: String, default: '' },
    imageUrl:        { type: String, default: null },
    authorUsername:  { type: String, default: '' },
    authorAvatarUrl: { type: String, default: null },
    postType:        { type: String, default: 'quick' },
  },
  deletedFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions:  [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, emoji: String }],
}, { timestamps: true });

const memberSchema = new mongoose.Schema({
  user:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:     { type: String, enum: ['admin', 'member'], default: 'member' },
  joinedAt: { type: Date, default: Date.now },
}, { _id: false });

const groupSchema = new mongoose.Schema({
  name:            { type: String, required: true, maxlength: 60 },
  description:     { type: String, default: '', maxlength: 200 },
  imageUrl:        { type: String, default: null },
  imagePublicId:   { type: String, default: null },
  bgColor:         { type: String, default: '' },
  creator:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members:         [memberSchema],
  pendingInvites:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  messages:        [messageSchema],
  lastMessage:     { type: Date, default: Date.now },
  lastMessageText: { type: String, default: '' },
  unreadCounts:    { type: Map, of: Number, default: {} },
  bannedUsers:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

groupSchema.index({ 'members.user': 1 });
groupSchema.index({ lastMessage: -1 });

module.exports = mongoose.model('Group', groupSchema);
