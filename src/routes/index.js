const router = require('express').Router();
router.use('/auth',   require('./auth.routes'));
router.use('/users',  require('./user.routes'));
router.use('/posts',  require('./post.routes'));
router.use('/chats',  require('./chat.routes'));
router.use('/social', require('./social.routes'));
router.use('/notifications', require('./notification.routes'));
module.exports = router;
