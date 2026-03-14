const mongoose = require('mongoose');

const badgeSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  description: { type: String },
  icon:        { type: String, default: '🏆' },
  type:        { type: String, enum: ['participation', 'seniority', 'special_event'] },
  condition:   { type: Object }
}, { timestamps: true });

module.exports = mongoose.model('Badge', badgeSchema);
