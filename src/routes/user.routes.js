const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { uploadAvatar: uploadMiddleware } = require('../config/cloudinary');
const { getProfile, getUserByUsername, updateProfile, uploadAvatar } = require('../controllers/user.controller');

router.get('/me', authMiddleware, getProfile);

router.get('/top', authMiddleware, async (req, res) => {
  try {
    const User = require('../models/User');
    const users = await User.find()
      .select('username avatarUrl xp profileFrame badges')
      .sort({ xp: -1 })
      .limit(10);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ users: [] });
    const User = require('../models/User');
    const users = await User.find({
      username: { $regex: q.trim(), $options: 'i' },
      _id: { $ne: req.user._id },
    })
    .select('username avatarUrl xp badges profileFrame')
    .limit(10);
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:username',      authMiddleware, getUserByUsername);
router.patch('/me/profile',   authMiddleware, updateProfile);
router.post('/me/avatar',     authMiddleware, uploadMiddleware.single('avatar'), uploadAvatar);


router.post('/me/upload', authMiddleware, uploadMiddleware.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image' });
    res.json({ url: req.file.path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
module.exports = router;
