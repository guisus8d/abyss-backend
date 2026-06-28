const mongoose = require('mongoose');

const GENDER_ENUM = ['male', 'female', 'other'];
const PREF_ENUM   = ['male', 'female', 'any'];
const STATUS_ENUM = ['waiting', 'chatting', 'deciding'];

const meetSessionSchema = new mongoose.Schema({
  user:             { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  userGender:       { type: String, enum: GENDER_ENUM, required: true },
  genderPreference: { type: String, enum: PREF_ENUM,   required: true },
  status:           { type: String, enum: STATUS_ENUM, default: 'waiting' },
  matchedWith:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  roomId:           { type: String, default: null },
  startedAt:        { type: Date,   default: null },
  matchAccepted:    { type: Boolean, default: false },
  createdAt:        { type: Date,   default: Date.now },
});

// TTL: limpia sesiones huérfanas después de 1 hora
meetSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 3600 });
meetSessionSchema.index({ status: 1 });

module.exports = mongoose.model('MeetSession', meetSessionSchema);
