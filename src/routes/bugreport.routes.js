const router     = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const BugReport  = require('../models/BugReport');
const { uploadBugReport } = require('../config/cloudinary');

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo admins' });
  next();
};

// POST /api/bug-reports — crear reporte (imagen opcional vía multipart)
router.post('/', authMiddleware, uploadBugReport.single('image'), async (req, res) => {
  try {
    const { description, screen, deviceInfo } = req.body;
    if (!description?.trim()) return res.status(400).json({ error: 'Descripcion requerida' });

    const bug = await BugReport.create({
      user:        req.user._id,
      description: description.trim(),
      imageUrl:    req.file?.path || null,
      screen:      screen   || null,
      deviceInfo:  deviceInfo || null,
    });

    res.json({ ok: true, id: bug._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bug-reports — listar (solo admin)
router.get('/', authMiddleware, adminOnly, async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const bugs   = await BugReport.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'username avatarUrl')
      .lean();
    res.json({ bugs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/bug-reports/:id/status — actualizar estado (solo admin)
router.patch('/:id/status', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['new', 'reviewing', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'Status invalido' });
    }
    await BugReport.findByIdAndUpdate(req.params.id, { status });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
