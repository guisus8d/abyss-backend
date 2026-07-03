const router = require('express').Router();
const Role   = require('../models/Role');
const Group  = require('../models/Group');
const { authMiddleware } = require('../middlewares/auth');
const { uploadRoleImage } = require('../config/cloudinary');

function getIO() {
  try { return require('../sockets').getIO(); } catch { return null; }
}

function isAdminOrCoAdmin(group, userId) {
  return group.members.some(
    m => m.user.toString() === userId.toString() &&
         (m.role === 'admin' || m.role === 'co-admin')
  );
}

// Libera atómicamente todos los roles que un usuario tiene tomados en una fiesta,
// emitiendo circle:role:released por cada uno.
async function releaseUserRoles(groupId, userId) {
  const taken = await Role.find({ group: groupId, takenBy: userId }).select('_id');
  if (!taken.length) return;
  const now = new Date();
  await Role.updateMany(
    { group: groupId, takenBy: userId },
    [
      {
        $set: {
          totalActiveMinutes: {
            $add: [
              '$totalActiveMinutes',
              {
                $cond: [
                  { $ifNull: ['$takenAt', false] },
                  { $floor: { $divide: [{ $subtract: [now, '$takenAt'] }, 60000] } },
                  0,
                ],
              },
            ],
          },
          takenBy: null,
          takenAt: null,
        },
      },
    ]
  );
  const io = getIO();
  for (const r of taken) {
    io?.to(`group:${groupId}`).emit('circle:role:released', { roleId: r._id.toString(), userId: userId.toString() });
  }
}

// Obtener todos los roles de una fiesta
router.get('/:groupId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).select('members isCircle');
    if (!group) return res.status(404).json({ error: 'Fiesta no encontrada' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'No eres miembro' });

    const roles = await Role.find({ group: req.params.groupId })
      .populate('takenBy', 'username avatarUrl profileFrame profileFrameUrl')
      .sort({ createdAt: 1 });
    res.json({ roles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear rol — admin/co-admin, máximo 10 por fiesta
router.post('/:groupId', authMiddleware, uploadRoleImage.single('image'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).select('members isCircle');
    if (!group) return res.status(404).json({ error: 'Fiesta no encontrada' });
    if (!isAdminOrCoAdmin(group, req.user._id)) return res.status(403).json({ error: 'Solo admin o co-admin' });

    const count = await Role.countDocuments({ group: req.params.groupId });
    if (count >= 10) return res.status(400).json({ error: 'Máximo 10 roles por fiesta' });

    const { name, description, borderColor } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
    if (!req.file) return res.status(400).json({ error: 'Imagen requerida' });

    const role = await Role.create({
      group:       req.params.groupId,
      name:        name.trim().slice(0, 30),
      description: description?.trim().slice(0, 150) || '',
      imageUrl:    req.file.path,
      borderColor: borderColor || '#ffffff',
    });

    getIO()?.to(`group:${req.params.groupId}`).emit('circle:roles:updated', { groupId: req.params.groupId });
    res.status(201).json({ role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar rol — admin/co-admin
router.patch('/:roleId', authMiddleware, uploadRoleImage.single('image'), async (req, res) => {
  try {
    const role = await Role.findById(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
    const group = await Group.findById(role.group).select('members isCircle');
    if (!group) return res.status(404).json({ error: 'Fiesta no encontrada' });
    if (!isAdminOrCoAdmin(group, req.user._id)) return res.status(403).json({ error: 'Solo admin o co-admin' });

    const { name, description, borderColor } = req.body;
    if (name !== undefined)        role.name        = name.trim().slice(0, 30);
    if (description !== undefined) role.description = description.trim().slice(0, 150);
    if (borderColor !== undefined) role.borderColor = borderColor;
    if (req.file)                  role.imageUrl     = req.file.path;

    await role.save();
    getIO()?.to(`group:${role.group}`).emit('circle:roles:updated', { groupId: role.group.toString() });
    res.json({ role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar rol — admin/co-admin
router.delete('/:roleId', authMiddleware, async (req, res) => {
  try {
    const role = await Role.findById(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
    const group = await Group.findById(role.group).select('members isCircle');
    if (!group) return res.status(404).json({ error: 'Fiesta no encontrada' });
    if (!isAdminOrCoAdmin(group, req.user._id)) return res.status(403).json({ error: 'Solo admin o co-admin' });

    const io = getIO();
    if (role.takenBy) {
      io?.to(`group:${role.group}`).emit('circle:role:released', { roleId: role._id.toString(), userId: role.takenBy.toString() });
    }
    await role.deleteOne();
    io?.to(`group:${role.group}`).emit('circle:roles:updated', { groupId: role.group.toString() });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tomar un rol — cualquier miembro; libera antes cualquier otro rol que ya tuviera
router.post('/:roleId/take', authMiddleware, async (req, res) => {
  try {
    const role = await Role.findById(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
    const group = await Group.findById(role.group).select('members isCircle roleplayActive');
    if (!group) return res.status(404).json({ error: 'Fiesta no encontrada' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'No eres miembro' });
    if (!group.roleplayActive) return res.status(400).json({ error: 'La Sala de Rol no esta activa' });

    await releaseUserRoles(role.group, req.user._id);

    const updated = await Role.findOneAndUpdate(
      { _id: req.params.roleId, takenBy: null },
      { $set: { takenBy: req.user._id, takenAt: new Date() }, $inc: { timesUsed: 1 } },
      { new: true }
    );
    if (!updated) return res.status(400).json({ error: 'Rol ya tomado' });

    getIO()?.to(`group:${role.group}`).emit('circle:role:taken', {
      roleId:        updated._id.toString(),
      userId:        req.user._id.toString(),
      username:      req.user.username,
      roleImageUrl:  updated.imageUrl,
      roleName:      updated.name,
      borderColor:   updated.borderColor,
    });
    res.json({ role: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Soltar el rol propio
router.post('/:roleId/release', authMiddleware, async (req, res) => {
  try {
    const role = await Role.findById(req.params.roleId);
    if (!role) return res.status(404).json({ error: 'Rol no encontrado' });
    if (!role.takenBy || role.takenBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'No tienes este rol' });
    }
    const minutosActivos = role.takenAt ? Math.floor((Date.now() - role.takenAt) / 60000) : 0;
    role.takenBy = null;
    role.takenAt = null;
    role.totalActiveMinutes += minutosActivos;
    await role.save();
    getIO()?.to(`group:${role.group}`).emit('circle:role:released', {
      roleId: role._id.toString(),
      userId: req.user._id.toString(),
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
module.exports.releaseUserRoles = releaseUserRoles;
