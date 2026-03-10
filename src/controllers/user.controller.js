const Notification = require('../models/Notification');
const { getIO } = require('../sockets');
const User = require('../models/User');
const { cloudinary } = require('../config/cloudinary');

async function getProfile(req, res) {
  const user = await User.findById(req.user._id).populate('badges');
  res.json({ user });
}

async function getUserByUsername(req, res) {
  try {
    const user = await User.findOne({ username: req.params.username })
      .populate('badges')
      .select('-passwordHash -blocked');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateProfile(req, res) {
  try {
    const { profileFrame } = req.body;
    const update = {};
    if (profileFrame) update.profileFrame = profileFrame;
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true }).populate('badges');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadAvatar(req, res) {
  try {
    // multer-storage-cloudinary ya subió el archivo — solo leer req.file
    if (!req.file) return res.status(400).json({ error: 'No se recibió imagen' });

    // Borrar avatar anterior si existe
    const currentUser = await User.findById(req.user._id);
    if (currentUser.avatarPublicId) {
      await cloudinary.uploader.destroy(currentUser.avatarPublicId);
    }

    // req.file.path = secure_url, req.file.filename = public_id
    const user = await User.findByIdAndUpdate(
      req.user._id,
      {
        avatarUrl: req.file.path,
        avatarPublicId: req.file.filename,
      },
      { new: true }
    ).populate('badges');

    res.json({ user, avatarUrl: req.file.path });
  } catch (err) {
    console.error('uploadAvatar error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getProfile, getUserByUsername, updateProfile, uploadAvatar };
