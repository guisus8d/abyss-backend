const mongoose = require('mongoose');

const betaRegistrationSchema = new mongoose.Schema({
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  registeredAt: { type: Date, default: Date.now },
  ip:           { type: String },
});

module.exports = mongoose.model('BetaRegistration', betaRegistrationSchema);
