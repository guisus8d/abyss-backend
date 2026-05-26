const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const {
  followUser, blockUser,
  getFollowers, getFollowing, getFollowingFeed
} = require('../controllers/social.controller');

router.post('/follow/:username',    authMiddleware, followUser);
router.post('/block/:username',     authMiddleware, blockUser);
router.get('/blocked',              authMiddleware, async (req, res) => {
  try {
    const me = await require('../models/User')
      .findById(req.user._id)
      .populate('blocked', '_id username avatarUrl profileFrame profileFrameUrl xp')
      .select('blocked');
    res.json({ blocked: me.blocked || [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.get('/followers/:username',  authMiddleware, getFollowers);
router.get('/following/:username',  authMiddleware, getFollowing);
router.get('/feed',                 authMiddleware, getFollowingFeed);

module.exports = router;
