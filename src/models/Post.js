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
  reactions: [reactionSchema],
});

const postSchema = new mongoose.Schema({
  postType: { type: String, default: "quick", enum: ["quick","image","news","video","circle_share"] },
  title:    { type: String, default: "" },
  author:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content:        { type: String, required: true, maxlength: 5000 },
  imageUrl:       { type: String, default: null },
  imagePublicId:  { type: String, default: null },
  imageLink:      { type: String, default: null },
  backgroundUrl:  { type: String, default: null },
  videoUrl:          { type: String, default: null },
  videoDuration:     { type: Number, default: null },
  videoStartTime:    { type: Number, default: null },
  videoEndTime:      { type: Number, default: null },
  videoThumbnailUrl: { type: String, default: null },
  tags:           [{ type: String }],
  circleRef:      { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  membersCount:   { type: Number, default: 0 },
  group:          { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  reactions:      [reactionSchema],
  comments:       [commentSchema],
  commentPermission: { type: String, enum: ['everyone', 'friends', 'following', 'nobody'], default: 'everyone' },
}, { timestamps: true });

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ tags: 1 });

module.exports = mongoose.model('Post', postSchema);
// vie 13 mar 2026 22:40:37 CST
