const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  sender:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  text:     { type: String, default: '', maxlength: 2000 },
  type:     { type: String, default: 'text', enum: ['text', 'image', 'audio', 'shared_post', 'shared_profile', 'system', 'gift'] },
  systemAction: { type: String, default: null }, // 'join' | 'leave' | 'kick' | 'ban'
  mediaUrl:      { type: String, default: null },
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
  sharedProfile: {
    userId:          { type: String, default: null },
    username:        { type: String, default: '' },
    avatarUrl:       { type: String, default: null },
    xp:              { type: Number, default: 0 },
    followersCount:  { type: Number, default: 0 },
    profileFrame:    { type: String, default: null },
    profileFrameUrl: { type: String, default: null },
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
  lastMessage:       { type: Date, default: Date.now },
  lastMessageText:   { type: String, default: '' },
  lastMessageSender: { type: String, default: '' },
  unreadCounts:    { type: Map, of: Number, default: {} },
  bannedUsers:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  backgroundUrl:   { type: String, default: null },
  isCircle:        { type: Boolean, default: false },
  isPublic:        { type: Boolean, default: false },
  hashtags:        [{ type: String }],
  membersCount:    { type: Number,  default: 0 },
}, { timestamps: true });

groupSchema.index({ 'members.user': 1 });
groupSchema.index({ lastMessage: -1 });

module.exports = mongoose.model('Group', groupSchema);
