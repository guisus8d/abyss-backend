const jwt  = require('jsonwebtoken');
const User = require('../models/User');

async function register(req, res) {
  try {
    const { username, email, password, gender } = req.body;
    const user = new User({
      username,
      email,
      passwordHash: password,
      gender: gender || 'prefiero-no-decir',
    });
    await user.save();

    // Si mandaron avatar, subirlo
    if (req.file) {
      user.avatarUrl      = req.file.path;
      user.avatarPublicId = req.file.filename;
      await user.save();
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN
    });
    res.status(201).json({ token, user });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Email o username ya en uso' });
    res.status(500).json({ error: err.message });
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    user.lastActive = new Date();
    await user.save();
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN
    });
    res.json({ token, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { register, login };
