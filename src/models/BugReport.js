const mongoose = require('mongoose');

const bugReportSchema = new mongoose.Schema({
  user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  username:    { type: String, default: null },
  description: { type: String, required: true },
  imageUrl:    { type: String, default: null },
  screen:      { type: String, default: null },
  deviceInfo:  { type: String, default: null },
  status:      { type: String, enum: ['new', 'reviewing', 'resolved'], default: 'new' },
}, { timestamps: true });

module.exports = mongoose.model('BugReport', bugReportSchema);
