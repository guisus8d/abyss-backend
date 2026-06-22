const router = require('express').Router();
const User        = require('../models/User');
const Frame       = require('../models/Frame');
const Transaction = require('../models/Transaction');
const { authMiddleware } = require('../middlewares/auth');

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo admins' });
  next();
};

router.get('/metrics', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [userAgg, frameAgg, txAgg] = await Promise.all([
      User.aggregate([
        { $match: { email: { $not: /@abbys\.bot$/ } } },
        { $group: { _id: null, totalCoins: { $sum: '$coins' }, totalUsers: { $sum: 1 } } },
      ]),
      Frame.aggregate([
        { $match: { status: 'active' } },
        { $facet: {
          summary:   [{ $group: { _id: null, totalFrames: { $sum: 1 }, totalFramesSold: { $sum: '$totalSold' } } }],
          topFrames: [{ $sort: { totalSold: -1 } }, { $limit: 3 }, { $project: { name: 1, totalSold: 1, price: 1, _id: 0 } }],
        }},
      ]),
      Transaction.aggregate([
        { $match: { estado: 'completada' } },
        { $count: 'total' },
      ]),
    ]);

    const u              = userAgg[0]              || { totalCoins: 0, totalUsers: 0 };
    const frameSummary   = frameAgg[0]?.summary[0] || { totalFrames: 0, totalFramesSold: 0 };
    const topFrames      = frameAgg[0]?.topFrames  || [];
    const totalTransactions = txAgg[0]?.total      ?? 0;

    res.json({
      totalUsers:          u.totalUsers,
      totalCoins:          u.totalCoins,
      coinsInCirculation:  u.totalCoins,
      totalFrames:         frameSummary.totalFrames,
      totalFramesSold:     frameSummary.totalFramesSold,
      totalTransactions,
      topFrames,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
