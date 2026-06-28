const router          = require('express').Router();
const checkAppVersion = require('../middlewares/checkAppVersion');

router.use(checkAppVersion);

router.use('/auth',         require('./auth.routes'));
router.use('/users',        require('./user.routes'));
router.use('/posts',        require('./post.routes'));
router.use('/frames',       require('./frame.routes'));
router.use('/chats',        require('./chat.routes'));
router.use('/social',       require('./social.routes'));
router.use('/notifications',require('./notification.routes'));
router.use('/groups',       require('./group.routes'));
router.use('/reports',      require('./report.routes'));
router.use('/modlogs',      require('./modlog.routes'));
router.use('/mod',          require('./mod.routes'));
// Sistema de tienda
router.use('/market',       require('./market.routes'));
router.use('/store',        require('./store.routes'));
router.use('/gifts',        require('./gift.routes'));
router.use('/transactions', require('./wallet.routes'));
router.use('/coins',        require('./wallet.routes'));
router.use('/wall',         require('./wall.routes'));
router.use('/ads',          require('./ads.routes'));
module.exports = router;
