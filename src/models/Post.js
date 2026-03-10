const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, default: 'like' },
}, { _id: false });

const commentSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text:      { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
  replyTo: {
    commentId: { type: mongoose.Schema.Types.ObjectId },
    username:  { type: String },
    text:      { type: String },
  },
});

const postSchema = new mongoose.Schema({
  author:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content:        { type: String, required: true, maxlength: 1000 },
  imageUrl:       { type: String, default: null },
  imagePublicId:  { type: String, default: null },
  tags:           [{ type: String }],
  group:          { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  reactions:      [reactionSchema],
  comments:       [commentSchema],
}, { timestamps: true });

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ tags: 1 });

module.exports = mongoose.model('Post', postSchema);
