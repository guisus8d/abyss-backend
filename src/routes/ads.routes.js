const router       = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const User         = require('../models/User');
const Notification = require('../models/Notification');

const AD_DAILY_LIMIT  = 5;
const COINS_PER_AD    = 3;

// POST /ads/reward
router.post('/reward', authMiddleware, async (req, res) => {
  try {
    const userId = req.user._id;
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    // Intento 1: mismo día y aún con cupo — incrementa atómicamente.
    let updated = await User.findOneAndUpdate(
      {
        _id: userId,
        'adViewsToday.date':  { $gte: startOfToday },
        'adViewsToday.count': { $lt: AD_DAILY_LIMIT },
      },
      { $inc: { coins: COINS_PER_AD, 'adViewsToday.count': 1 } },
      { new: true, select: 'coins adViewsToday' },
    );

    // Intento 2: día nuevo (o nunca vio un anuncio) — resetea el contador a 1.
    if (!updated) {
      updated = await User.findOneAndUpdate(
        {
          _id: userId,
          $or: [
            { 'adViewsToday.date': null },
            { 'adViewsToday.date': { $lt: startOfToday } },
          ],
        },
        {
          $inc: { coins: COINS_PER_AD },
          $set: { 'adViewsToday.count': 1, 'adViewsToday.date': new Date() },
        },
        { new: true, select: 'coins adViewsToday' },
      );
    }

    if (!updated) {
      return res.status(429).json({ error: 'Límite diario de anuncios alcanzado' });
    }

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
