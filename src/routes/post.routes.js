const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { postRules, commentRules } = require('../middlewares/rules');
const { validate } = require('../middlewares/validate');
const { uploadPost } = require('../config/cloudinary');
const {
  createPost, getPosts, getPost,
  reactPost, addComment, deletePost
} = require('../controllers/post.controller');

router.get('/',             authMiddleware, getPosts);
router.post('/',            authMiddleware, uploadPost.single('image'), createPost);
router.get('/:id',          authMiddleware, getPost);
router.post('/:id/react',   authMiddleware, reactPost);
router.post('/:id/comment', authMiddleware, commentRules, validate, addComment);
router.delete('/:id',       authMiddleware, deletePost);

module.exports = router;
