const crypto = require('crypto');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { checkAndAwardBadges } = require('../utils/badges');
const { cloudinary } = require('../config/cloudinary');
const { getIO } = require('../sockets');
const { sendPush } = require('../utils/pushNotifications');

function normalizeText(str) {
  return str.toLowerCase().trim()
    .replace(/[!?.,;:'"()\-]+/g, '')
    .replace(/[\u{1F300}-\u{1FAFF}]+/gu, '')
    .replace(/\s+/g, ' ');
}

function hashText(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function levenshteinSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxLen * 0.15) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return 1 - dp[a.length][b.length] / maxLen;
}

async function createPost(req, res) {
  try {
    const {
      content, tags, postType, title, commentPermission,
      videoUrl, videoDuration, videoStartTime, videoEndTime, videoThumbnailUrl,
      backgroundUrl, imageLink,
    } = req.body;
    if (!content?.trim() && !title?.trim() && !req.file && !videoUrl)
      return res.status(400).json({ error: 'Contenido requerido' });

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentPosts = await Post.countDocuments({ author: req.user._id, createdAt: { $gte: fiveMinAgo } });
    if (recentPosts >= 3)
      return res.status(429).json({ error: 'Has alcanzado el límite de 3 publicaciones cada 5 minutos. Intenta de nuevo en unos minutos.' });

    const VALID_PERMISSIONS = ['everyone', 'friends', 'following', 'nobody'];
    const postData = {
      author:   req.user._id,
      content:  content?.trim() || '',
      postType: postType || 'quick',
      title:    title || '',
      tags:     Array.isArray(tags) ? tags : (tags ? [tags] : []),
      ...(commentPermission && VALID_PERMISSIONS.includes(commentPermission) ? { commentPermission } : {}),
    };

    if (req.file) {
      postData.imageUrl      = req.file.path;
      postData.imagePublicId = req.file.filename;
    }
    if (backgroundUrl) postData.backgroundUrl = backgroundUrl;
    if (imageLink)     postData.imageLink     = imageLink;
    if (videoUrl) {
      postData.videoUrl          = videoUrl;
      if (videoDuration  != null) postData.videoDuration     = Number(videoDuration);
      if (videoStartTime != null) postData.videoStartTime    = Number(videoStartTime);
      if (videoEndTime   != null) postData.videoEndTime      = Number(videoEndTime);
      if (videoThumbnailUrl)      postData.videoThumbnailUrl = videoThumbnailUrl;
    }

    const post = await Post.create(postData);
    await post.populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl role gender');

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
    const page    = parseInt(req.query.page)  || 1;
    const limit   = parseInt(req.query.limit) || 10;
    const skip    = (page - 1) * limit;
    const blocked = req.user
      ? ((await User.findById(req.user._id).select('blocked').lean())?.blocked || [])
      : [];

    const query = blocked.length ? { author: { $nin: blocked } } : {};

    const posts = await Post.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl role gender')
      .populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl role');

    const total = await Post.countDocuments(query);
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
      .populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl role gender')
      .populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl role');

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
      { path: 'author',        select: '_id username profileFrame profileFrameUrl xp avatarUrl role gender' },
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
    const page  = Math.max(1, parseInt(req.query.commentsPage) || 1);
    const limit = Math.min(50, parseInt(req.query.commentsLimit) || 20);

    const post = await Post.findById(req.params.id)
      .populate('author', '_id username profileFrame profileFrameUrl xp avatarUrl role gender')
      .populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl role');
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });

    const all      = post.toObject().comments;
    const topLevel = all.filter(c => !c.replyTo?.commentId);
    const total    = topLevel.length;
    const sliced   = topLevel.slice((page - 1) * limit, page * limit);
    const ids      = new Set(sliced.map(c => c._id.toString()));
    const replies  = all.filter(c => ids.has(c.replyTo?.commentId?.toString()));

    const postObj = post.toObject();
    postObj.comments = [...sliced, ...replies];

    res.json({ post: postObj, totalComments: total, hasMore: page * limit < total, commentsPage: page });
  } catch (err) {
    console.error('[GET-POST-ERROR]', err.message, err.stack);
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
          const author = await User.findById(post.author).select('pushToken username').lean();
          sendPush(author?.pushToken, 'Nuevo like', `${req.user.username} le dio ❤️ a tu post`, { type: 'like', postId: post._id.toString() });
        }
      }
    } else {
      const distinctTypes = new Set(
        post.reactions.filter(r => r.type !== 'like').map(r => r.type)
      );
      const prevIdx = post.reactions.findIndex(
        r => r.user.toString() === userId && r.type === type
      );
      if (prevIdx >= 0) {
        post.reactions.splice(prevIdx, 1);
      } else {
        if (!distinctTypes.has(type) && distinctTypes.size >= 20) {
          return res.status(400).json({ error: 'max_emojis', message: 'Maximo 20 tipos de emoji por post' });
        }
        post.reactions.push({ user: req.user._id, type });
        if (post.author.toString() !== userId) {
          await Notification.create({
            to: post.author, from: req.user._id, type: 'like', post: post._id, text: type,
          });
          getIO()?.to(`user:${post.author.toString()}`).emit('notification:new');
          const author = await User.findById(post.author).select('pushToken username').lean();
          sendPush(author?.pushToken, 'Nueva reacción', `${req.user.username} reaccionó a tu post`, { type: 'react', postId: post._id.toString() });
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

    const oneMinAgo = new Date(Date.now() - 60 * 1000);
    const [rateResult] = await Post.aggregate([
      { $match: { comments: { $elemMatch: { user: req.user._id, createdAt: { $gte: oneMinAgo } } } } },
      { $unwind: '$comments' },
      { $match: { 'comments.user': req.user._id, 'comments.createdAt': { $gte: oneMinAgo } } },
      { $count: 'total' },
    ]);
    if ((rateResult?.total || 0) >= 5)
      return res.status(429).json({ error: 'Demasiados comentarios. Máximo 5 por minuto. Intenta de nuevo en un momento.' });

    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentDocs = await Post.aggregate([
      { $match: { comments: { $elemMatch: { user: req.user._id, createdAt: { $gte: tenMinAgo } } } } },
      { $unwind: '$comments' },
      { $match: { 'comments.user': req.user._id, 'comments.createdAt': { $gte: tenMinAgo } } },
      { $sort: { 'comments.createdAt': -1 } },
      { $limit: 10 },
      { $project: { text: '$comments.text', _id: 0 } },
    ]);
    if (recentDocs.length > 0 && text?.trim()) {
      const normNew = normalizeText(text.trim());
      const newHash = hashText(normNew);
      const spamCount = recentDocs.filter(c => {
        const normOld = normalizeText(c.text);
        return hashText(normOld) === newHash || levenshteinSimilarity(normNew, normOld) > 0.85;
      }).length;
      if (spamCount >= 2)
        return res.status(429).json({ error: 'Comentario spam detectado. Evita repetir mensajes similares.' });
    }

    // 3.3 — Permiso de comentarios del post
    if (post.commentPermission && post.commentPermission !== 'everyone') {
      const userId   = req.user._id.toString();
      const authorId = post.author.toString();
      if (userId !== authorId) {
        if (post.commentPermission === 'nobody')
          return res.status(403).json({ error: 'Los comentarios están deshabilitados en esta publicación.' });
        const author = await User.findById(post.author).select('following followers').lean();
        if (post.commentPermission === 'following') {
          if (!author.following.map(String).includes(userId))
            return res.status(403).json({ error: 'Solo pueden comentar usuarios que el autor sigue.' });
        } else if (post.commentPermission === 'friends') {
          const authorFollows = author.following.map(String).includes(userId);
          const followsAuthor = author.followers.map(String).includes(userId);
          if (!authorFollows || !followsAuthor)
            return res.status(403).json({ error: 'Solo pueden comentar amigos del autor.' });
        }
      }
    }

    // 3.5 — Bloqueo de enlaces externos (solo abyss.social permitido)
    const URL_REGEX = /https?:\/\/[^\s]+/gi;
    const urls = (text?.trim() || '').match(URL_REGEX) || [];
    const ALLOWED = /^https?:\/\/(www\.)?abyss\.social(\/|$)/i;
    for (const url of urls) {
      if (!ALLOWED.test(url))
        return res.status(400).json({ error: 'No se permiten enlaces externos. Solo se aceptan enlaces de abyss.social.' });
    }

    const comment = { user: req.user._id, text: text.trim() };
    if (replyTo?.commentId) comment.replyTo = replyTo;
    post.comments.push(comment);
    await post.save();
    await post.populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl role');

    await User.findByIdAndUpdate(req.user._id, { $inc: { xp: 2 } });
    await checkAndAwardBadges(req.user._id);

    const newComment = post.comments[post.comments.length - 1];

    if (post.author.toString() !== req.user._id.toString()) {
      await Notification.create({
        to: post.author, from: req.user._id,
        type: 'comment', post: post._id, text: 'comentó en tu post',
      });
      try { getIO().to(`user:${post.author}`).emit('notification:new'); } catch {}
      const postAuthor = await User.findById(post.author).select('pushToken').lean();
      sendPush(postAuthor?.pushToken, 'Nuevo comentario', `${req.user.username} comentó tu post`, { type: 'comment', postId: post._id.toString() });
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
          const repliedUser = await User.findById(repliedUserId).select('pushToken').lean();
          sendPush(repliedUser?.pushToken, 'Nueva respuesta', `${req.user.username} te respondió en un post`, { type: 'comment', postId: post._id.toString() });
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
