const router       = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const User         = require('../models/User');
const Notification = require('../models/Notification');

const AD_DAILY_LIMIT  = 5;
const COINS_PER_AD    = 3;

function isSameUTCDay(date) {
  if (!date) return false;
  const now = new Date();
  const d   = new Date(date);
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth()    === now.getUTCMonth()    &&
    d.getUTCDate()     === now.getUTCDate()
  );
}

// POST /ads/reward
router.post('/reward', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const user   = await User.findById(userId).select('coins adViewsToday');

    const sameDay    = isSameUTCDay(user.adViewsToday?.date);
    const countToday = sameDay ? (user.adViewsToday?.count ?? 0) : 0;

    if (countToday >= AD_DAILY_LIMIT) {
      return res.status(429).json({ error: 'Límite diario de anuncios alcanzado' });
    }

    const newCount = countToday + 1;
    const updated  = await User.findByIdAndUpdate(
      userId,
      {
        $inc: { coins: COINS_PER_AD },
        $set: {
          'adViewsToday.count': newCount,
          'adViewsToday.date':  new Date(),
        },
      },
      { new: true, select: 'coins adViewsToday' },
    );

    await Notification.create({
      to:   userId,
      from: userId,
      type: 'ad_reward',
      text: '+3 coins por ver un anuncio',
    });

    res.json({
      coins:        updated.coins,
      adViewsToday: { count: updated.adViewsToday.count, date: updated.adViewsToday.date },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
