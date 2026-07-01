const router  = require('express').Router();
const Report  = require('../models/Report');
const ModLog  = require('../models/ModLog');
const { authMiddleware } = require('../middlewares/auth');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer  = require('multer');
const { cloudinary } = require('../config/cloudinary');

const modOnly = async (req, res, next) => {
  if (req.user?.role !== 'mod' && req.user?.role !== 'admin')
    return res.status(403).json({ error: 'Solo moderadores' });
  next();
};

// Storage para evidencia — carpeta separada, max 4 archivos
const evidenceStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/reports',
    allowed_formats: ['jpg','jpeg','png','webp'],
    transformation:  [{ width:1920, crop:'limit', quality:'auto:good' }],
  },
});
const uploadEvidence = multer({
  storage: evidenceStorage,
  limits:  { fileSize: 10 * 1024 * 1024 },
}).array('images', 4); // hasta 4 imágenes

// ── Crear reporte ─────────────────────────────────────────────────────────────
router.post('/', authMiddleware, (req, res, next) => {
  uploadEvidence(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    const { type, targetId, targetName, targetAuthorId, reason, details } = req.body;
    if (!type || !targetId || !reason)
      return res.status(400).json({ error: 'type, targetId y reason son requeridos' });

    // Evitar spam: mismo reporter, mismo target, pendiente
    const exists = await Report.findOne({ reporter: req.user._id, targetId, status: 'pending' });
    if (exists) return res.status(409).json({ error: 'Ya tienes un reporte pendiente sobre este contenido' });

    const images = (req.files || []).map(f => ({ url: f.path, publicId: f.filename }));

    const report = await Report.create({
      reporter:       req.user._id,
      type, targetId,
      targetName:     targetName    || '',
      targetAuthorId: targetAuthorId || null,
      reason,
      details:        details       || '',
      images,
    });

    res.status(201).json({ ok: true, report });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Listar reportes (mod) ─────────────────────────────────────────────────────
router.get('/', authMiddleware, modOnly, async (req, res) => {
  try {
    const { status = 'pending', type, page = 1 } = req.query;
    const filter = {};
    if (status !== 'all') filter.status = status;
    if (type)             filter.type   = type;

    const reports = await Report.find(filter)
      .populate('reporter',       'username avatarUrl')
      .populate('targetAuthorId', 'username _id')
      .populate('resolvedBy',     'username')
      .sort({ createdAt: -1 })
      .skip((page - 1) * 30)
      .limit(30);

    const [total, pending, reviewed, dismissed] = await Promise.all([
      Report.countDocuments(filter),
      Report.countDocuments({ status: 'pending' }),
      Report.countDocuments({ status: 'reviewed' }),
      Report.countDocuments({ status: 'dismissed' }),
    ]);

    res.json({ reports, total, pending, reviewed, dismissed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Actualizar estado (mod) ───────────────────────────────────────────────────
router.patch('/:id', authMiddleware, modOnly, async (req, res) => {
  try {
    const { status, modNotes } = req.body;
    if (!['reviewed','dismissed'].includes(status))
      return res.status(400).json({ error: 'Estado inválido' });

    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status, modNotes: modNotes||'', resolvedBy: req.user._id, resolvedAt: new Date() },
      { new: true }
    ).populate('reporter', 'username avatarUrl');

    if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });
    res.json({ ok: true, report });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Acción directa desde reporte: eliminar post ───────────────────────────────
router.delete('/:id/action/post', authMiddleware, modOnly, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report || report.type !== 'post') return res.status(400).json({ error: 'Reporte inválido' });

    const Post = require('../models/Post');
    await Post.findByIdAndDelete(report.targetId);

    // Marcar reporte como revisado
    report.status     = 'reviewed';
    report.modNotes   = (report.modNotes ? report.modNotes + '\n' : '') + `[Auto] Post eliminado por @${req.user.username}`;
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();
    await report.save();

    await ModLog.create({ action: 'delete_post', mod: req.user._id, target: report.targetAuthorId || null, details: { postId: report.targetId, reportId: report._id.toString(), targetName: report.targetName } });
    res.json({ ok: true, action: 'post_deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Acción directa desde reporte: banear usuario ──────────────────────────────
router.post('/:id/action/ban', authMiddleware, modOnly, async (req, res) => {
  try {
    const { reason } = req.body;
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ error: 'Reporte no encontrado' });

    // Para user reports: banear targetId. Para post reports: banear targetAuthorId
    const userToBan = report.type === 'user' ? report.targetId : report.targetAuthorId;
    if (!userToBan) return res.status(400).json({ error: 'No se puede identificar al usuario a banear' });

    const User = require('../models/User');
    const target = await User.findById(userToBan);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.role === 'admin') return res.status(403).json({ error: 'No puedes banear a un admin' });

    target.banned       = true;
    target.bannedReason = reason || `Reporte #${report._id}`;
    await target.save();

    // Marcar reporte como revisado
    report.status     = 'reviewed';
    report.modNotes   = (report.modNotes ? report.modNotes + '\n' : '') + `[Auto] @${target.username} baneado por @${req.user.username}`;
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();
    await report.save();

    await ModLog.create({ action: 'ban', mod: req.user._id, target: target._id, details: { reason: target.bannedReason, username: target.username, reportId: report._id.toString() } });
    res.json({ ok: true, action: 'user_banned', username: target.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Eliminar registro de reporte (mod) ───────────────────────────────────────
router.delete('/:id', authMiddleware, modOnly, async (req, res) => {
  try {
    const deleted = await Report.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Reporte no encontrado' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Conteo pendientes ─────────────────────────────────────────────────────────
router.get('/count/pending', authMiddleware, modOnly, async (req, res) => {
  try {
    const count = await Report.countDocuments({ status: 'pending' });
    res.json({ count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
