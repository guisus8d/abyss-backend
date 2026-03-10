const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const {
  followUser, blockUser,
  getFollowers, getFollowing, getFollowingFeed
} = require('../controllers/social.controller');

router.post('/follow/:username',    authMiddleware, followUser);
router.post('/block/:username',     authMiddleware, blockUser);
router.get('/followers/:username',  authMiddleware, getFollowers);
router.get('/following/:username',  authMiddleware, getFollowing);
router.get('/feed',                 authMiddleware, getFollowingFeed);

module.exports = router;
