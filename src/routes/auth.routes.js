const router = require('express').Router();
const { register, login } = require('../controllers/auth.controller');
const { validate } = require('../middlewares/validate');
const { registerRules, loginRules } = require('../middlewares/rules');
const { uploadAvatar } = require('../config/cloudinary');

router.post('/register', uploadAvatar.single('avatar'), registerRules, validate, register);
router.post('/login',    loginRules, validate, login);

const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client('841197288611-3uhrf7lv42jdae4703unshffp0rfralj.apps.googleusercontent.com');

router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: '841197288611-3uhrf7lv42jdae4703unshffp0rfralj.apps.googleusercontent.com',
    });
    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    let user = await User.findOne({ email });
    if (!user) {
      // Crear usuario nuevo
      const username = name.replace(/s+/g, '').toLowerCase().slice(0, 20) + Math.floor(Math.random() * 999);
      user = new User({
        username,
        email,
        avatarUrl: picture,
        googleId,
        passwordHash: googleId, // placeholder
      });
      await user.save();
    }

    user.lastActive = new Date();
    await user.save();

    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });
    res.json({ token, user });
  } catch (err) {
    res.status(401).json({ error: 'Token de Google inválido', detail: err.message });
  }
});

const User = require('../models/User');
module.exports = router;
