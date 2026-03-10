const User  = require('../models/User');
const Badge = require('../models/Badge');

// Definición de badges y sus condiciones
const BADGE_RULES = [
  {
    name:      'Primer Post',
    condition: (stats) => stats.postCount >= 1,
  },
  {
    name:      'Activo',
    condition: (stats) => stats.postCount >= 10,
  },
  {
    name:      'Veterano',
    condition: (stats) => stats.daysSinceJoin >= 30,
  },
  {
    name:      'Fundador',
    condition: (stats) => stats.userId <= 100, // primeros 100 usuarios
  },
];

async function checkAndAwardBadges(userId) {
  try {
    const user = await User.findById(userId).populate('badges');
    if (!user) return;

    const Post  = require('../models/Post');
    const postCount     = await Post.countDocuments({ author: userId });
    const daysSinceJoin = Math.floor((Date.now() - user.createdAt) / 86400000);
    const userNumber    = parseInt(user._id.toString().slice(-4), 16) % 1000;

    const stats = { postCount, daysSinceJoin, userId: userNumber };

    const earnedNames = user.badges.map(b => b.name);
    const newBadges   = [];

    for (const rule of BADGE_RULES) {
      if (earnedNames.includes(rule.name)) continue;
      if (!rule.condition(stats)) continue;

      // Buscar o crear el badge
      let badge = await Badge.findOne({ name: rule.name });
      if (!badge) continue;

      user.badges.push(badge._id);
      newBadges.push(badge);
    }

    if (newBadges.length > 0) {
      await user.save();
      console.log(`🏆 ${user.username} ganó: ${newBadges.map(b => b.name).join(', ')}`);
    }

    return newBadges;
  } catch (err) {
    console.error('Badge check error:', err.message);
    return [];
  }
}

module.exports = { checkAndAwardBadges };
