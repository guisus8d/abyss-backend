const router = require('express').Router();
const Group  = require('../models/Group');
const User   = require('../models/User');
const { authMiddleware } = require('../middlewares/auth');
const { uploadAvatar } = require('../config/cloudinary');

// Obtener mis grupos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const groups = await Group.find({ 'members.user': req.user._id })
      .select('name description imageUrl bgColor members lastMessage lastMessageText unreadCounts creator')
      .sort({ lastMessage: -1 });
    res.json({ groups });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear grupo
router.post('/', authMiddleware, uploadAvatar.single('image'), async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });

    // Verificar que los memberIds son seguidores/siguiendo
    const me = await User.findById(req.user._id);
    const validIds = [...(me.followers || []).map(String), ...(me.following || []).map(String)];
    const parsedIds = JSON.parse(memberIds || '[]').filter(id => validIds.includes(String(id)));

    // Separar mutuos de solo-seguidores
    const meUser = await User.findById(req.user._id);
    const followerIds = (meUser.followers || []).map(String);
    const followingIds = (meUser.following || []).map(String);
    const mutualIds = parsedIds.filter(id => followerIds.includes(String(id)) && followingIds.includes(String(id)));
    const nonMutualIds = parsedIds.filter(id => !mutualIds.includes(id));

    const members = [
      { user: req.user._id, role: 'admin' },
      ...mutualIds.map(id => ({ user: id, role: 'member' })),
    ];

    const group = await Group.create({
      name: name.trim(),
      description: description?.trim() || '',
      imageUrl: req.file?.path || null,
      imagePublicId: req.file?.filename || null,
      creator: req.user._id,
      members,
    });

    // Agregar invitaciones pendientes para no-mutuos
    if (nonMutualIds.length > 0) {
      group.pendingInvites = nonMutualIds;
      await group.save();
      // Crear notificación para cada no-mutuo
      const Notification = require('../models/Notification');
      for (const uid of nonMutualIds) {
        await Notification.create({
          to: uid,
          from: req.user._id,
          type: 'group_invite',
          groupId: group._id,
          groupName: group.name,
        }).catch(() => {});
      }
    }

    await group.populate('members.user', 'username avatarUrl profileFrame profileFrameUrl');
    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Obtener grupo por ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.user', 'username avatarUrl profileFrame profileFrameUrl')
      .populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl');
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isMember = group.members.some(m => m.user._id.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'No eres miembro' });
    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Enviar mensaje
router.post('/:id/message', authMiddleware, async (req, res) => {
  try {
    const { text, replyTo } = req.body;
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'No eres miembro' });
    const isBanned = group.bannedUsers.some(b => b.toString() === req.user._id.toString());
    if (isBanned) return res.status(403).json({ error: 'Estás baneado de este grupo' });

    const msg = { sender: req.user._id, text, replyTo };
    group.messages.push(msg);
    group.lastMessage = new Date();
    group.lastMessageText = text?.slice(0, 60) || '';

    // Incrementar unread para todos menos el sender
    group.members.forEach(m => {
      if (m.user.toString() !== req.user._id.toString()) {
        const current = group.unreadCounts.get(m.user.toString()) || 0;
        group.unreadCounts.set(m.user.toString(), current + 1);
      }
    });

    await group.save();
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl');
    const newMsg = group.messages[group.messages.length - 1];

    // Emitir por socket
    const { getIO } = require('../sockets');
    try {
      getIO().to(`group:${group._id}`).emit('group:message', { groupId: group._id, message: newMsg });
    } catch {}

    res.json({ message: newMsg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Banear usuario (solo admin)
router.post('/:id/ban/:userId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });
    group.bannedUsers.push(req.params.userId);
    group.members = group.members.filter(m => m.user.toString() !== req.params.userId);
    await group.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Borrar mensaje (solo admin)
router.delete('/:id/message/:msgId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    const msg = group.messages.id(req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
    const isOwner = msg.sender.toString() === req.user._id.toString();
    if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos' });
    group.messages = group.messages.filter(m => m._id.toString() !== req.params.msgId);
    await group.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar grupo (nombre, descripción, imagen, fondo) — solo admin
router.patch('/:id', authMiddleware, uploadAvatar.single('image'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });
    const { name, description, bgColor } = req.body;
    if (name) group.name = name.trim();
    if (description !== undefined) group.description = description.trim();
    if (bgColor !== undefined) group.bgColor = bgColor;
    if (req.file) { group.imageUrl = req.file.path; group.imagePublicId = req.file.filename; }
    await group.save();
    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Marcar como leído
router.post('/:id/read', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'No encontrado' });
    group.unreadCounts.set(req.user._id.toString(), 0);
    await group.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
