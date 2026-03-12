const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { postRules, commentRules } = require('../middlewares/rules');
const { validate } = require('../middlewares/validate');
const { uploadPost } = require('../config/cloudinary');
const Post = require('../models/Post');
const User = require('../models/User');
const {
  createPost, getPosts, getPost,
  reactPost, addComment, deletePost
} = require('../controllers/post.controller');

router.get('/',             authMiddleware, getPosts);
router.post('/',            authMiddleware, uploadPost.single('image'), createPost);
router.get('/user/me',      authMiddleware, async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user._id })
      .sort({ createdAt: -1 })
      .populate('author', 'username avatarUrl xp profileFrame')
      .lean();
    res.json({ posts });
  } catch { res.status(500).json({ error: 'Error al obtener posts' }); }
});
router.get('/user/:username', authMiddleware, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).lean();
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    const posts = await Post.find({ author: user._id })
      .sort({ createdAt: -1 })
      .populate('author', 'username avatarUrl xp profileFrame')
      .lean();
    res.json({ posts });
  } catch { res.status(500).json({ error: 'Error al obtener posts' }); }
});
router.get('/:id',          authMiddleware, getPost);
router.post('/:id/react',   authMiddleware, reactPost);
router.post('/:id/comment', authMiddleware, commentRules, validate, addComment);
router.delete('/:id',       authMiddleware, deletePost);

module.exports = router;
