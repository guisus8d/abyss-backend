const User = require('../models/User');
const Notification = require('../models/Notification');

// Seguir usuario
async function followUser(req, res) {
  try {
    const { username } = req.params;
    const me = req.user._id;

    const target = await User.findOne({ username });
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target._id.toString() === me.toString()) {
      return res.status(400).json({ error: 'No puedes seguirte a ti mismo' });
    }

    const alreadyFollowing = req.user.following.includes(target._id);

    if (alreadyFollowing) {
      // Dejar de seguir
      await User.findByIdAndUpdate(me,          { $pull: { following: target._id } });
      await User.findByIdAndUpdate(target._id,  { $pull: { followers: me } });
      res.json({ following: false, message: `Dejaste de seguir a ${username}` });
    } else {
      // Seguir
      await User.findByIdAndUpdate(me,          { $addToSet: { following: target._id } });
      await User.findByIdAndUpdate(target._id,  { $addToSet: { followers: me } });
      await Notification.create({ to: target._id, from: me, type: 'follow' });
      try {
        const { getIO } = require('../sockets');
        getIO().to(`user:${target._id}`).emit('notification:new');
      } catch(e) {}
      res.json({ following: true, message: `Ahora sigues a ${username}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Bloquear / desbloquear usuario
async function blockUser(req, res) {
  try {
    const { username } = req.params;
    const me = req.user._id;

    const target = await User.findOne({ username });
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target._id.toString() === me.toString()) {
      return res.status(400).json({ error: 'No puedes bloquearte a ti mismo' });
    }

    const isBlocked = req.user.blocked?.includes(target._id);

    if (isBlocked) {
      await User.findByIdAndUpdate(me, { $pull: { blocked: target._id } });
      res.json({ blocked: false, message: `Desbloqueaste a ${username}` });
    } else {
      // Al bloquear también dejar de seguir mutuamente
      await User.findByIdAndUpdate(me, {
        $addToSet: { blocked: target._id },
        $pull: { following: target._id, followers: target._id },
      });
      await User.findByIdAndUpdate(target._id, {
        $pull: { following: me, followers: me },
      });
      res.json({ blocked: true, message: `Bloqueaste a ${username}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Ver seguidores de un usuario
async function getFollowers(req, res) {
  try {
    const user = await User.findOne({ username: req.params.username })
      .populate('followers', 'username xp badges profileFrame');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ followers: user.followers, count: user.followers.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Ver a quién sigue un usuario
async function getFollowing(req, res) {
  try {
    const user = await User.findOne({ username: req.params.username })
      .populate('following', 'username xp badges profileFrame');
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ following: user.following, count: user.following.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Feed personalizado — posts de usuarios que sigo
async function getFollowingFeed(req, res) {
  try {
    const Post = require('../models/Post');
    const me   = await User.findById(req.user._id);

    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const posts = await Post.find({ author: { $in: [...me.following, me._id] } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('author', 'username profileFrame xp')
      .populate('comments.user', 'username');

    res.json({ posts, page });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { followUser, blockUser, getFollowers, getFollowing, getFollowingFeed };
