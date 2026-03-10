const router = require('express').Router();
const { register, login } = require('../controllers/auth.controller');
const { validate } = require('../middlewares/validate');
const { registerRules, loginRules } = require('../middlewares/rules');
const { uploadAvatar } = require('../config/cloudinary');

router.post('/register', uploadAvatar.single('avatar'), registerRules, validate, register);
router.post('/login',    loginRules, validate, login);

module.exports = router;
