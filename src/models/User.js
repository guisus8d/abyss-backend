const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('./Badge');

const userSchema = new mongoose.Schema({
  username:         { type: String, required: true, unique: true, trim: true },
  displayName:      { type: String, default: '', trim: false },
  email:            { type: String, required: true, unique: true, lowercase: true },
  passwordHash:     { type: String, required: true },
  gender:           { type: String, enum: ['hombre', 'mujer', 'no-binario', 'prefiero-no-decir'], default: 'prefiero-no-decir' },
  bio:              { type: String, default: '' },
  profileText:      { type: String, default: '' },
  profileBanner:    { type: String, default: '' },
  profileBannerType:{ type: String, default: 'color' },
  profileBg:        { type: String, default: '' },
  profileBgType:    { type: String, default: 'color' },
  profileBlocks:    { type: Array,  default: [] },
  googleId:         { type: String, default: null },
  coins:            { type: Number, default: 50 },
  collectionSlots:  { type: Number, default: 10 },
  role:             { type: String, default: 'user', enum: ['user', 'mod', 'admin'] },
  banned:           { type: Boolean, default: false },
  bannedReason:     { type: String, default: '' },
  profilePrefs:     { type: Object, default: { showXp: true, showFollowers: true, showFollowing: true, showPosts: true } },
  profileFrame:     { type: String, default: 'default' },
  profileFrameUrl:  { type: String, default: null },
  avatarUrl:        { type: String, default: null },
  avatarPublicId:   { type: String, default: null },
  badges:           [{ type: mongoose.Schema.Types.ObjectId, ref: 'Badge' }],
  xp:               { type: Number, default: 0 },
  following:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  followers:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blocked:          [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  chatRequests:     [{
    from:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status:    { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    messages:  [{ sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, text: String, createdAt: { type: Date, default: Date.now } }],
  }],
  lastActive: { type: Date, default: Date.now },
}, { timestamps: true });

// ✅ FIX: separado en dos responsabilidades claras
userSchema.pre('save', async function(next) {
  // 1. Si displayName está vacío, usa username como valor inicial
  if (!this.displayName || this.displayName.trim() === '') {
    this.displayName = this.username;
  }

  // 2. Hashear password:
  //    - Si es documento nuevo (isNew) → siempre hashear
  //    - Si es update → solo si passwordHash fue modificado
  if (this.isNew || this.isModified('passwordHash')) {
    this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
  }

  next();
});

userSchema.methods.comparePassword = function(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.blocked;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
