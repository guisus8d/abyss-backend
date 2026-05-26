const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const Transaction = require('../models/Transaction');
const User        = require('../models/User');

// ── GET /api/coins/balance ──────────────────────────────────────────────────
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('coins coinsReservadas');
    res.json({
      coins:           user.coins,
      coinsReservadas: user.coinsReservadas,
      disponible:      user.coins,  // coins ya es el saldo disponible
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/transactions/me ────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);

    const filter = {
      $or: [{ emisor: req.user._id }, { receptor: req.user._id }],
    };
    if (req.query.tipo) filter.tipo = req.query.tipo;

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('emisor',   'username avatarUrl')
        .populate('receptor', 'username avatarUrl')
        .populate('item',     'name imageUrl')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Transaction.countDocuments(filter),
    ]);

    res.json({ transactions, total, page, totalPages: Math.ceil(total / limit) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
