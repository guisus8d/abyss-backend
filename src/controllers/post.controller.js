const Post = require('../models/Post');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { checkAndAwardBadges } = require('../utils/badges');
const { cloudinary } = require('../config/cloudinary');
const { getIO } = require('../sockets');

async function createPost(req, res) {
  try {
    const { content, tags, postType, title } = req.body;
    if (!content?.trim() && !title?.trim() && !req.file)
      return res.status(400).json({ error: 'Contenido requerido' });

    const postData = {
      author:   req.user._id,
      content:  content?.trim() || '',
      postType: postType || 'quick',
      title:    title || '',
      tags:     Array.isArray(tags) ? tags : (tags ? [tags] : []),
    };

    if (req.file) {
      postData.imageUrl      = req.file.path;
      postData.imagePublicId = req.file.filename;
    }

    const post = await Post.create(postData);
    await post.populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl');

    await User.findByIdAndUpdate(req.user._id, { $inc: { xp: 10 } });
    const newBadges = await checkAndAwardBadges(req.user._id);

    res.status(201).json({ post, newBadges });
  } catch (err) {
    console.error('createPost error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

// ── Para Ti — todos los posts, 10 por página ─────────────────────────────────
async function getPosts(req, res) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;

    const posts = await Post.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl')
      .populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl');

    const total = await Post.countDocuments();
    res.json({ posts, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Siguiendo — posts de usuarios que sigo ───────────────────────────────────
async function getFollowingPosts(req, res) {
  try {
    const page  = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip  = (page - 1) * limit;

    const me       = await User.findById(req.user._id).select('following');
    const following = me?.following || [];

    if (following.length === 0) {
      return res.json({ posts: [], page: 1, totalPages: 0, total: 0 });
    }

    const posts = await Post.find({ author: { $in: following } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl')
      .populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl');

    const total = await Post.countDocuments({ author: { $in: following } });
    res.json({ posts, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Trending — los más reaccionados/comentados de los últimos 7 días ─────────
async function getTrendingPosts(req, res) {
  try {
    const page  = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip  = (page - 1) * limit;

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const posts = await Post.aggregate([
      { $match: { createdAt: { $gte: since } } },
      {
        $addFields: {
          score: {
            $add: [
              { $size: '$reactions' },
              { $multiply: [{ $size: '$comments' }, 2] },
            ],
          },
        },
      },
      { $sort: { score: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);

    await Post.populate(posts, [
      { path: 'author',        select: '_id username profileFrame profileFrameUrl xp avatarUrl' },
      { path: 'comments.user', select: 'username avatarUrl profileFrame profileFrameUrl' },
    ]);

    const total = await Post.countDocuments({ createdAt: { $gte: since } });
    res.json({ posts, page, totalPages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPost(req, res) {
  try {
    const post = await Post.findById(req.params.id)
      .populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl')
      .populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl');
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });
    res.json({ post });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function reactPost(req, res) {
  try {
    const { type = 'like' } = req.body;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });
    const userId = req.user._id.toString();

    if (type === 'like') {
      const idx = post.reactions.findIndex(
        r => r.user.toString() === userId && r.type === 'like'
      );
      if (idx >= 0) {
        post.reactions.splice(idx, 1);
      } else {
        post.reactions.push({ user: req.user._id, type: 'like' });
        if (post.author.toString() !== userId) {
          await Notification.create({
            to: post.author, from: req.user._id, type: 'like', post: post._id, text: '❤️',
          });
          getIO()?.to(`user:${post.author.toString()}`).emit('notification:new');
        }
      }
    } else {
      const prevIdx = post.reactions.findIndex(
        r => r.user.toString() === userId && r.type !== 'like'
      );
      if (prevIdx >= 0) {
        if (post.reactions[prevIdx].type === type) {
          post.reactions.splice(prevIdx, 1);
        } else {
          post.reactions[prevIdx].type = type;
        }
      } else {
        post.reactions.push({ user: req.user._id, type });
        if (post.author.toString() !== userId) {
          await Notification.create({
            to: post.author, from: req.user._id, type: 'like', post: post._id, text: type,
          });
          getIO()?.to(`user:${post.author.toString()}`).emit('notification:new');
        }
      }
    }

    await post.save();
    res.json({ reactions: post.reactions });
  } catch (err) {
    console.error('REACT ERR:', err.message);
    res.status(500).json({ error: err.message });
  }
}

async function addComment(req, res) {
  try {
    const { text, replyTo } = req.body;
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });

    const comment = { user: req.user._id, text: text.trim() };
    if (replyTo?.commentId) comment.replyTo = replyTo;
    post.comments.push(comment);
    await post.save();
    await post.populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl');

    await User.findByIdAndUpdate(req.user._id, { $inc: { xp: 2 } });
    await checkAndAwardBadges(req.user._id);

    const newComment = post.comments[post.comments.length - 1];

    if (post.author.toString() !== req.user._id.toString()) {
      await Notification.create({
        to: post.author, from: req.user._id,
        type: 'comment', post: post._id, text: 'comentó en tu post',
      });
      try { getIO().to(`user:${post.author}`).emit('notification:new'); } catch {}
    }

    if (replyTo?.commentId) {
      const repliedComment = post.comments.find(
        c => c._id.toString() === replyTo.commentId.toString()
      );
      if (repliedComment) {
        const repliedUserId = repliedComment.user?._id || repliedComment.user;
        if (
          repliedUserId &&
          repliedUserId.toString() !== req.user._id.toString() &&
          repliedUserId.toString() !== post.author.toString()
        ) {
          await Notification.create({
            to: repliedUserId, from: req.user._id,
            type: 'comment', post: post._id, text: '↩ te respondió en un post',
          });
          getIO()?.to(`user:${repliedUserId.toString()}`).emit('notification:new');
        }
      }
    }

    res.status(201).json({ comment: newComment, comments: post.comments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deletePost(req, res) {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });
    if (post.author.toString() !== req.user._id.toString())
      return res.status(403).json({ error: 'No autorizado' });
    if (post.imagePublicId) await cloudinary.uploader.destroy(post.imagePublicId);
    await post.deleteOne();
    res.json({ message: 'Post eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = {
  createPost, getPosts, getFollowingPosts, getTrendingPosts,
  getPost, reactPost, addComment, deletePost,
};
