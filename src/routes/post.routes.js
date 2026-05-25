const router = require('express').Router();
const { authMiddleware }            = require('../middlewares/auth');
const { postRules, commentRules }   = require('../middlewares/rules');
const { validate }                  = require('../middlewares/validate');
const { uploadPost }                = require('../config/cloudinary');
const Post                          = require('../models/Post');
const User                          = require('../models/User');
const { optionalAuth } = require('../middlewares/optionalAuth');
const {
  createPost, getPosts, getFollowingPosts, getTrendingPosts,
  getPost, reactPost, addComment, deletePost,
} = require('../controllers/post.controller');

// ── Feed principal ────────────────────────────────────────────────────────────
router.get('/',           optionalAuth, getPosts);
router.post('/',          authMiddleware, uploadPost.single('image'), createPost);

// ── Feeds especializados — ANTES de /:id para evitar conflictos ───────────────
router.get('/following',  authMiddleware, getFollowingPosts);
router.get('/trending',   optionalAuth,   getTrendingPosts);

// ── Búsqueda de posts por texto ───────────────────────────────────────────────
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ posts: [] });
    const regex = new RegExp(q.trim(), 'i');
    const posts = await Post.find({ $or: [{ content: regex }, { title: regex }] })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('author', '_id username avatarUrl xp profileFrame profileFrameUrl role')
      .lean();
    res.json({ posts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Posts del usuario autenticado ─────────────────────────────────────────────
router.get('/user/me',    authMiddleware, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user._id })
      .sort({ createdAt: -1 })
      .populate('author', '_id username avatarUrl xp profileFrame profileFrameUrl role')
      .populate('comments.user', '_id username avatarUrl profileFrame profileFrameUrl role')
      .lean();
    res.json({ posts });
  } catch { res.status(500).json({ error: 'Error al obtener posts' }); }
});

// ── Posts de un usuario por username ─────────────────────────────────────────
router.get('/user/:username', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const user = await User.findOne({ username: req.params.username }).lean();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const [posts, total] = await Promise.all([
      Post.find({ author: user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('author', '_id username avatarUrl xp profileFrame profileFrameUrl role')
        .populate('comments.user', '_id username avatarUrl profileFrame profileFrameUrl role')
        .lean(),
      Post.countDocuments({ author: user._id }),
    ]);
    res.json({ posts, total, hasMore: skip + posts.length < total });
  } catch { res.status(500).json({ error: 'Error al obtener posts' }); }
});

// ── CRUD individual ───────────────────────────────────────────────────────────
router.get('/:id',          optionalAuth, getPost);
router.post('/:id/react',   authMiddleware, reactPost);
router.post('/:id/comment', authMiddleware, commentRules, validate, addComment);
router.delete('/:id',       authMiddleware, deletePost);

router.delete('/:id/comment/:commentId', authMiddleware, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post no encontrado' });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comentario no encontrado' });

    const isMod    = ['mod', 'admin'].includes(req.user.role);
    const isOwner  = comment.user.toString() === req.user._id.toString();
    if (!isOwner && !isMod) return res.status(403).json({ error: 'Sin permisos' });

    post.comments = post.comments.filter(
      c =>
        c._id.toString() !== req.params.commentId &&
        c.replyTo?.commentId?.toString() !== req.params.commentId
    );

    await post.save();
    await post.populate('comments.user', 'username avatarUrl profileFrame profileFrameUrl role');
    res.json({ comments: post.comments });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
