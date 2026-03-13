const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('./Badge');

const userSchema = new mongoose.Schema({
  username:       { type: String, required: true, unique: true, trim: true },
  email:          { type: String, required: true, unique: true, lowercase: true },
  passwordHash:   { type: String, required: true },
  gender:         { type: String, enum: ['hombre', 'mujer', 'no-binario', 'prefiero-no-decir'], default: 'prefiero-no-decir' },
  bio:            { type: String, default: '' },
  profileText:    { type: String, default: '' },
  profileBg:      { type: String, default: '' },
  profileBgType:  { type: String, default: 'color' },
  profileBlocks:  { type: Array,  default: [] },
  profileFrame:   { type: String, default: 'default' },
  avatarUrl:      { type: String, default: null },
  avatarPublicId: { type: String, default: null },
  badges:         [{ type: mongoose.Schema.Types.ObjectId, ref: 'Badge' }],
  xp:             { type: Number, default: 0 },
  following:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  followers:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  blocked:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  chatRequests:   [{
    from:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status:    { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    messages:  [{ sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, text: String, createdAt: { type: Date, default: Date.now } }],
  }],
  lastActive:     { type: Date, default: Date.now },
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash')) return next();
  this.passwordHash = await bcrypt.hash(this.passwordHash, 10);
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
