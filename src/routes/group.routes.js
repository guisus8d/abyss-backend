const router = require('express').Router();
const Group  = require('../models/Group');
const User   = require('../models/User');
const { authMiddleware } = require('../middlewares/auth');
const { uploadAvatar, uploadGroupImage, uploadGroupBg } = require('../config/cloudinary');

function getIO() {
  try { return require('../sockets').getIO(); } catch { return null; }
}

function isAdminOrCoAdmin(group, userId) {
  return group.members.some(
    m => m.user.toString() === userId.toString() &&
         (m.role === 'admin' || m.role === 'co-admin')
  );
}

// ─── helper: push + emit mensaje de sistema ────────────────────────────────────
async function emitSystemMessage(group, text, action) {
  group.messages.push({ text, type: 'system', systemAction: action, sender: null });
  group.lastMessage     = new Date();
  group.lastMessageText = text;
  await group.save();
  const sysMsg = group.messages[group.messages.length - 1];
  getIO()?.to(`group:${group._id}`).emit('group:message', {
    groupId: group._id.toString(),
    message: sysMsg.toObject(),
  });
}

// ─── Círculos ──────────────────────────────────────────────────────────────────

// Crear círculo
router.post('/circles', authMiddleware, uploadGroupImage.single('image'), async (req, res) => {
  try {
    const { name, description, hashtags } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });

    const parsedTags = (() => {
      try { return JSON.parse(hashtags || '[]'); } catch { return []; }
    })();

    const circle = await Group.create({
      name:         name.trim(),
      description:  description?.trim() || '',
      imageUrl:     req.file?.path || null,
      imagePublicId:req.file?.filename || null,
      creator:      req.user._id,
      isCircle:     true,
      isPublic:     true,
      hashtags:     parsedTags.map(t => String(t).toLowerCase().replace(/[^a-z0-9_]/g, '')).filter(Boolean),
      membersCount: 1,
      members:      [{ user: req.user._id, role: 'admin' }],
    });

    const populated = await Group.findById(circle._id)
      .select('name description imageUrl hashtags membersCount members lastMessage lastMessageText creator isCircle isPublic');
    res.status(201).json({ group: populated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mis círculos
router.get('/circles/mine', authMiddleware, async (req, res) => {
  try {
    const circles = await Group.find({ isCircle: true, 'members.user': req.user._id })
      .select('name description imageUrl hashtags rules membersCount members lastMessage lastMessageText lastMessageSender unreadCounts creator isCircle isPublic isActive activatedAt')
      .populate('members.user', 'username avatarUrl profileFrame profileFrameUrl')
      .sort({ lastMessage: -1 });
    res.json({ circles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fiestas públicas y activas (sin auth requerida)
router.get('/circles/public', async (req, res) => {
  try {
    const { hashtag } = req.query;
    const filter = { isCircle: true, isPublic: true };
    if (hashtag) filter.hashtags = hashtag;
    const circles = await Group
      .find(filter)
      .sort({ isActive: -1, membersCount: -1 })
      .limit(30)
      .select('name imageUrl membersCount hashtags isCircle isPublic isActive');
    res.json({ circles });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/circles/search', authMiddleware, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) return res.json({ circles: [] });
    const regex = new RegExp(q.trim(), 'i');
    const circles = await Group.find({
      isCircle: true,
      $or: [{ name: regex }, { hashtags: regex }],
    })
      .select('name imageUrl membersCount hashtags isActive members')
      .populate({ path: 'members.user', select: 'username avatarUrl profileFrame profileFrameUrl' })
      .limit(5)
      .lean();
    const mapped = circles.map(c => {
      const adminMember = (c.members || []).find(m => m.role === 'admin');
      return {
        _id: c._id,
        name: c.name,
        imageUrl: c.imageUrl,
        membersCount: c.membersCount,
        hashtags: c.hashtags,
        isActive: c.isActive,
        admin: adminMember?.user || null,
      };
    });
    res.json({ circles: mapped });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Activar / desactivar círculo (admin o co-admin)
router.patch('/circles/:id/toggle-active', authMiddleware, async (req, res) => {
  try {
    const circle = await Group.findOne({ _id: req.params.id, isCircle: true });
    if (!circle) return res.status(404).json({ error: 'Círculo no encontrado' });

    if (!isAdminOrCoAdmin(circle, req.user._id))
      return res.status(403).json({ error: 'Solo admin o co-admin puede cambiar el estado' });

    circle.isActive = !circle.isActive;
    if (circle.isActive) {
      circle.activatedAt = new Date();
    } else {
      circle.activatedAt = null;
    }
    await circle.save();
    if (circle.isActive) {
      getIO()?.to(`group:${circle._id}`).emit('circle:activated', { groupId: circle._id.toString() });
    } else {
      getIO()?.to(`group:${circle._id}`).emit('circle:deactivated', { groupId: circle._id.toString() });
    }
    res.json({ group: circle });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Asignar / quitar co-admin (solo admin)
router.patch('/circles/:id/set-role', authMiddleware, async (req, res) => {
  try {
    const circle = await Group.findOne({ _id: req.params.id, isCircle: true });
    if (!circle) return res.status(404).json({ error: 'Círculo no encontrado' });

    const isAdmin = circle.members.some(
      m => m.user.toString() === req.user._id.toString() && m.role === 'admin'
    );
    if (!isAdmin) return res.status(403).json({ error: 'Solo el admin puede asignar roles' });

    const { memberId, role } = req.body;
    if (!memberId) return res.status(400).json({ error: 'memberId requerido' });
    if (!['co-admin', 'member'].includes(role)) return res.status(400).json({ error: 'Rol inválido' });

    const target = circle.members.find(m => m.user.toString() === memberId.toString());
    if (!target) return res.status(404).json({ error: 'Miembro no encontrado' });
    if (target.role === 'admin') return res.status(403).json({ error: 'No puedes cambiar el rol del admin' });

    target.role = role;
    await circle.save();
    res.json({ ok: true, role });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar reglas del círculo (admin o co-admin)
router.patch('/circles/:id/rules', authMiddleware, async (req, res) => {
  try {
    const circle = await Group.findOne({ _id: req.params.id, isCircle: true });
    if (!circle) return res.status(404).json({ error: 'Círculo no encontrado' });

    if (!isAdminOrCoAdmin(circle, req.user._id))
      return res.status(403).json({ error: 'Solo admin o co-admin' });

    const { rules } = req.body;
    if (!Array.isArray(rules)) return res.status(400).json({ error: 'rules debe ser un array' });
    if (rules.length > 10) return res.status(400).json({ error: 'Máximo 10 reglas' });

    circle.rules = rules.map(r => String(r).trim()).filter(Boolean);
    await circle.save();
    res.json({ rules: circle.rules });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Unirse a un círculo (sin aprobación)
router.post('/circles/:id/join', authMiddleware, async (req, res) => {
  try {
    const circle = await Group.findOneAndUpdate(
      { _id: req.params.id, isCircle: true, 'members.user': { $ne: req.user._id } },
      { $push: { members: { user: req.user._id, role: 'member' } }, $inc: { membersCount: 1 } },
      { new: true }
    );

    if (!circle) {
      const exists = await Group.exists({ _id: req.params.id, isCircle: true });
      if (!exists) return res.status(404).json({ error: 'Círculo no encontrado' });
      return res.status(400).json({ error: 'Ya eres miembro' });
    }

    const joiningUser = await User.findById(req.user._id).select('username').lean();
    if (joiningUser) {
      await emitSystemMessage(circle, `${joiningUser.username} se unió a la fiesta`, 'join');
    }

    const populated = await Group.findById(circle._id)
      .select('name description imageUrl hashtags membersCount members lastMessage lastMessageText creator isCircle isPublic isActive welcomeMessage announcementBanner rules');
    res.json({ group: populated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Salir de un círculo
router.delete('/circles/:id/leave', authMiddleware, async (req, res) => {
  try {
    const circle = await Group.findOne({ _id: req.params.id, isCircle: true });
    if (!circle) return res.status(404).json({ error: 'Círculo no encontrado' });

    const isMember = circle.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(400).json({ error: 'No eres miembro' });

    circle.members = circle.members.filter(m => m.user.toString() !== req.user._id.toString());
    circle.membersCount = circle.members.length;

    // Si no quedan admins, promueve al siguiente miembro
    const hasAdmin = circle.members.some(m => m.role === 'admin');
    if (!hasAdmin && circle.members.length > 0) {
      circle.members[0].role = 'admin';
    }

    await circle.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Grupos regulares ───────────────────────────────────────────────────────────

// Obtener mis grupos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const groups = await Group.find({ 'members.user': req.user._id })
      .select('name description imageUrl bgColor members lastMessage lastMessageText lastMessageSender unreadCounts creator isCircle')
      .sort({ lastMessage: -1 });
    res.json({ groups });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear grupo
router.post('/', authMiddleware, uploadAvatar.single('image'), async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });

    const adminGroupCount = await Group.countDocuments({
      tipo: 'privado',
      members: { $elemMatch: { user: req.user._id, role: 'admin' } },
    });
    if (adminGroupCount >= 10)
      return res.status(400).json({ error: 'Has alcanzado el límite de 10 grupos privados como administrador. Elimina uno antes de crear otro.' });

    const me = await User.findById(req.user._id);
    const validIds = [...(me.followers || []).map(String), ...(me.following || []).map(String)];
    const parsedIds = JSON.parse(memberIds || '[]').filter(id => validIds.includes(String(id)));

    const group = await Group.create({
      name:          name.trim(),
      description:   description?.trim() || '',
      imageUrl:      req.file?.path || null,
      imagePublicId: req.file?.filename || null,
      creator:       req.user._id,
      members:       [
        { user: req.user._id, role: 'admin' },
        ...parsedIds.map(id => ({ user: id, role: 'member' })),
      ],
    });

    // Notificar a los agregados para que actualicen su lista de grupos
    for (const uid of parsedIds) {
      getIO()?.to(`user:${uid}`).emit('group:added', { groupId: group._id.toString() });
    }

    await group.populate('members.user', 'username avatarUrl profileFrame profileFrameUrl');
    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mensajes paginados del grupo
router.get('/:id/messages', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = Math.max(0,   parseInt(req.query.skip)  || 0);

    const group = await Group.findById(req.params.id)
      .populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role gender isCreator');
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const isMember = group.members.some(
      m => (m.user?._id || m.user).toString() === req.user._id.toString()
    );
    if (!isMember && !(group.isCircle && group.isPublic)) return res.status(403).json({ error: 'No eres miembro' });

    const total    = group.messages.length;
    const messages = group.messages.slice().reverse().slice(skip, skip + limit).reverse();

    res.json({ messages, hasMore: total > skip + limit });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Obtener grupo por ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.user', 'username avatarUrl profileFrame profileFrameUrl')
      .populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role gender isCreator');
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const isMember  = group.members.some(m => m.user._id.toString() === req.user._id.toString());
    const isPending = group.pendingInvites.some(u => u.toString() === req.user._id.toString());

    const isPublicCircle = group.isCircle && group.isPublic;
    if (!isMember && !isPending && !isPublicCircle) return res.status(403).json({ error: 'No eres miembro' });

    // Pendientes ven el grupo sin historial de mensajes
    if (isPending) {
      const groupObj = group.toObject();
      groupObj.messages = [];
      return res.json({ group: groupObj, isPending: true });
    }

    const groupObj = group.toObject();
    groupObj.messages = groupObj.messages.slice(-50);
    res.json({ group: groupObj });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Editar grupo — admin (o co-admin si es círculo)
router.patch('/:id', authMiddleware, uploadGroupImage.single('image'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const canEdit = group.isCircle
      ? isAdminOrCoAdmin(group, req.user._id)
      : group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!canEdit) return res.status(403).json({ error: 'Solo admins' });

    const { name, description, bgColor, imageUrl, hashtags, welcomeMessage, announcementBanner } = req.body;
    if (name)                      group.name        = name.trim();
    if (description !== undefined) group.description = description.trim();
    if (bgColor !== undefined)     group.bgColor     = bgColor;
    if (req.file)                  { group.imageUrl = req.file.path; group.imagePublicId = req.file.filename; }
    else if (imageUrl !== undefined) group.imageUrl  = imageUrl || null;
    if (hashtags !== undefined && group.isCircle) {
      try {
        const parsed = typeof hashtags === 'string' ? JSON.parse(hashtags) : hashtags;
        if (Array.isArray(parsed)) {
          group.hashtags = parsed
            .map(t => String(t).toLowerCase().replace(/[^a-z0-9_]/g, ''))
            .filter(Boolean)
            .slice(0, 5);
        }
      } catch {}
    }
    if (welcomeMessage !== undefined)     group.welcomeMessage     = welcomeMessage.toString().trim().slice(0, 500);
    if (announcementBanner !== undefined) group.announcementBanner = announcementBanner.toString().trim().slice(0, 300);
    await group.save();
    await group.populate('members.user', 'username avatarUrl profileFrame profileFrameUrl');
    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Agregar miembros — solo admin
router.post('/:id/add-members', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });

    const { memberIds = [] } = req.body;
    const currentIds = new Set(group.members.map(m => m.user.toString()));
    const toAdd = memberIds.filter(id => !currentIds.has(String(id)));

    for (const id of toAdd) {
      group.members.push({ user: id, role: 'member' });
      // If user was previously banned, clear the ban so they can talk
      group.bannedUsers = group.bannedUsers.filter(b => b.toString() !== String(id));
    }
    await group.save();
    await group.populate('members.user', 'username avatarUrl profileFrame profileFrameUrl');

    for (const id of toAdd) {
      const newUser = await User.findById(id).select('username').lean();
      if (newUser) {
        await emitSystemMessage(group, `${newUser.username} se agregó al grupo`, 'join');
      }
    }

    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Expulsar miembro — admin siempre; co-admin solo puede expulsar members (en círculos)
router.post('/:id/kick/:memberId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const callerMember = group.members.find(m => m.user.toString() === req.user._id.toString());
    const callerRole   = callerMember?.role;
    const canKick = callerRole === 'admin' || (group.isCircle && callerRole === 'co-admin');
    if (!canKick) return res.status(403).json({ error: 'Solo admins' });
    const target = group.members.find(m => m.user.toString() === req.params.memberId);
    if (!target) return res.status(404).json({ error: 'Miembro no encontrado' });
    if (target.role === 'admin') return res.status(403).json({ error: 'No puedes expulsar a un admin' });
    if (target.role === 'co-admin' && callerRole !== 'admin') return res.status(403).json({ error: 'Solo el admin puede expulsar a un co-admin' });

    const kickedUser = await User.findById(req.params.memberId).select('username').lean();
    group.members = group.members.filter(m => m.user.toString() !== req.params.memberId);
    await group.save();

    // Notificar al expulsado via socket para que vea el banner
    getIO()?.to(`group:${group._id}`).emit('group:kicked', {
      groupId:  group._id.toString(),
      userId:   req.params.memberId,
      username: kickedUser?.username,
    });

    if (kickedUser) {
      await emitSystemMessage(group, `${kickedUser.username} fue expulsado del grupo`, 'kick');
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Expulsar miembro por DELETE (compatibilidad con GroupSettingsScreen existente)
router.delete('/:id/members/:memberId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const callerMember = group.members.find(m => m.user.toString() === req.user._id.toString());
    const callerRole   = callerMember?.role;
    const canKick = callerRole === 'admin' || (group.isCircle && callerRole === 'co-admin');
    if (!canKick) return res.status(403).json({ error: 'Solo admins' });
    const target = group.members.find(m => m.user.toString() === req.params.memberId);
    if (target?.role === 'admin') return res.status(403).json({ error: 'No puedes expulsar a un admin' });
    if (target?.role === 'co-admin' && callerRole !== 'admin') return res.status(403).json({ error: 'Solo el admin puede expulsar a un co-admin' });

    const kickedUser = await User.findById(req.params.memberId).select('username').lean();
    group.members = group.members.filter(m => m.user.toString() !== req.params.memberId);
    await group.save();

    getIO()?.to(`group:${group._id}`).emit('group:kicked', {
      groupId:  group._id.toString(),
      userId:   req.params.memberId,
      username: kickedUser?.username,
    });

    if (kickedUser) {
      await emitSystemMessage(group, `${kickedUser.username} fue expulsado del grupo`, 'kick');
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Salir del grupo
router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(404).json({ error: 'No eres miembro' });

    const leavingUser = await User.findById(req.user._id).select('username').lean();

    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    const otherAdmins = group.members.filter(m => m.user.toString() !== req.user._id.toString() && m.role === 'admin');
    let newAdminUser = null;
    if (isAdmin && otherAdmins.length === 0) {
      const nextMember = group.members.find(m => m.user.toString() !== req.user._id.toString());
      if (nextMember) {
        nextMember.role = 'admin';
        newAdminUser = await User.findById(nextMember.user).select('username').lean();
      }
    }
    group.members = group.members.filter(m => m.user.toString() !== req.user._id.toString());

    if (group.members.length === 0) {
      await Group.deleteOne({ _id: group._id });
      return res.json({ ok: true, deleted: true });
    }
    await group.save();

    if (leavingUser) {
      const leaveText = group.isCircle
        ? `${leavingUser.username} salió de la fiesta`
        : `${leavingUser.username} salio del grupo`;
      await emitSystemMessage(group, leaveText, 'leave');
    }
    if (newAdminUser) {
      await emitSystemMessage(group, `${newAdminUser.username} es el nuevo administrador`, 'new_admin');
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Iniciar transferencia de admin
router.post('/:id/transfer-admin', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });

    const { newAdminId } = req.body;
    if (!newAdminId) return res.status(400).json({ error: 'newAdminId requerido' });

    const isMember = group.members.some(m => m.user.toString() === newAdminId.toString());
    if (!isMember) return res.status(400).json({ error: 'El usuario no es miembro del grupo' });

    const Notification = require('../models/Notification');
    await Notification.deleteMany({ type: 'admin_transfer', groupId: group._id, to: newAdminId });

    await Notification.create({
      to:               newAdminId,
      from:             req.user._id,
      type:             'admin_transfer',
      groupId:          group._id,
      groupName:        group.name,
      groupDescription: group.description,
      groupImageUrl:    group.imageUrl,
    });

    getIO()?.to(`user:${newAdminId}`).emit('notification:new');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Aceptar transferencia de admin
router.post('/:id/transfer-admin/accept', authMiddleware, async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const notif = await Notification.findOne({
      type: 'admin_transfer', groupId: req.params.id, to: req.user._id,
    });
    if (!notif) return res.status(404).json({ error: 'No tienes una solicitud de transferencia pendiente' });

    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const currentAdmin = group.members.find(m => m.user.toString() === notif.from.toString() && m.role === 'admin');
    if (currentAdmin) currentAdmin.role = 'member';

    const newAdmin = group.members.find(m => m.user.toString() === req.user._id.toString());
    if (!newAdmin) return res.status(400).json({ error: 'Ya no eres miembro del grupo' });
    newAdmin.role = 'admin';

    await group.save();
    await notif.deleteOne();

    const newAdminUser = await User.findById(req.user._id).select('username').lean();
    if (newAdminUser) {
      await emitSystemMessage(group, `${newAdminUser.username} es el nuevo administrador`, 'new_admin');
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rechazar transferencia de admin
router.post('/:id/transfer-admin/decline', authMiddleware, async (req, res) => {
  try {
    const Notification = require('../models/Notification');
    const notif = await Notification.findOne({
      type: 'admin_transfer', groupId: req.params.id, to: req.user._id,
    });
    if (!notif) return res.status(404).json({ error: 'No tienes una solicitud de transferencia pendiente' });

    const group = await Group.findById(req.params.id);
    const decliningUser = await User.findById(req.user._id).select('username').lean();

    await Notification.create({
      to:               notif.from,
      from:             req.user._id,
      type:             'admin_transfer_declined',
      groupId:          notif.groupId,
      groupName:        notif.groupName,
      text:             `${decliningUser?.username} rechazó la transferencia de admin en "${notif.groupName}"`,
    });

    await notif.deleteOne();
    getIO()?.to(`user:${notif.from}`).emit('notification:new');
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Eliminar grupo — solo admin
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });

    const memberIds = group.members.map(m => m.user.toString());
    await Group.deleteOne({ _id: group._id });

    const io = getIO();
    for (const uid of memberIds) {
      io?.to(`user:${uid}`).emit('group:deleted', { groupId: group._id.toString() });
    }
    io?.to(`group:${group._id}`).emit('group:deleted', { groupId: group._id.toString() });

    res.json({ ok: true });
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
    if (isBanned) return res.status(403).json({ error: 'Estas baneado de este grupo' });

    const msg = { sender: req.user._id, text, replyTo };
    group.messages.push(msg);
    group.lastMessage       = new Date();
    group.lastMessageText   = text?.slice(0, 60) || '';
    group.lastMessageSender = req.user.username || '';

    group.members.forEach(m => {
      if (m.user.toString() !== req.user._id.toString()) {
        const current = group.unreadCounts.get(m.user.toString()) || 0;
        group.unreadCounts.set(m.user.toString(), current + 1);
      }
    });

    await group.save();
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role gender isCreator');
    const newMsg = group.messages[group.messages.length - 1];

    getIO()?.to(`group:${group._id}`).emit('group:message', { groupId: group._id, message: newMsg });
    res.json({ message: newMsg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Compartir post en grupo
router.post('/:id/share-post', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'No eres miembro' });
    const isBanned = group.bannedUsers.some(b => b.toString() === req.user._id.toString());
    if (isBanned) return res.status(403).json({ error: 'Estas baneado de este grupo' });

    const { postId, title, content, imageUrl, authorUsername, authorAvatarUrl, postType } = req.body;
    const newMsg = {
      sender: req.user._id, text: '', type: 'shared_post',
      sharedPost: { postId: postId || null, title: title || '', content: content || '',
        imageUrl: imageUrl || null, authorUsername: authorUsername || '',
        authorAvatarUrl: authorAvatarUrl || null, postType: postType || 'quick' },
    };

    group.messages.push(newMsg);
    group.lastMessage       = new Date();
    group.lastMessageText   = 'Post compartido';
    group.lastMessageSender = req.user.username || '';
    group.members.forEach(m => {
      if (m.user.toString() !== req.user._id.toString()) {
        const current = group.unreadCounts.get(m.user.toString()) || 0;
        group.unreadCounts.set(m.user.toString(), current + 1);
      }
    });

    await group.save();
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role gender isCreator');
    const savedMsg = group.messages[group.messages.length - 1];

    getIO()?.to(`group:${group._id}`).emit('group:message', { groupId: group._id, message: savedMsg });
    res.json({ ok: true, messageId: savedMsg._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Banear usuario — solo admin
// Acepta query param ?deleteMessages=true para borrar todos sus mensajes
router.post('/:id/ban/:userId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'No encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });

    const bannedUser = await User.findById(req.params.userId).select('username').lean();

    // Borrar todos sus mensajes si se solicita
    if (req.query.deleteMessages === 'true') {
      group.messages = group.messages.filter(
        m => m.sender?.toString() !== req.params.userId
      );
    }

    group.bannedUsers.push(req.params.userId);
    group.members = group.members.filter(m => m.user.toString() !== req.params.userId);
    await group.save();

    // Notificar al baneado via socket
    getIO()?.to(`group:${group._id}`).emit('group:banned', {
      groupId:  group._id.toString(),
      userId:   req.params.userId,
      username: bannedUser?.username,
    });

    if (bannedUser) {
      await emitSystemMessage(group, `${bannedUser.username} fue baneado del grupo`, 'ban');
    }

    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Desbanear usuario — solo admin
router.delete('/:id/ban/:userId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'No encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });
    group.bannedUsers = group.bannedUsers.filter(b => b.toString() !== req.params.userId);
    // Re-add to members if not already there (ban removes them)
    const alreadyMember = group.members.some(m => m.user.toString() === req.params.userId);
    if (!alreadyMember) {
      group.members.push({ user: req.params.userId, role: 'member' });
    }
    await group.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Obtener lista de baneados — solo admin
router.get('/:id/banned', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('bannedUsers', 'username avatarUrl profileFrame profileFrameUrl');
    if (!group) return res.status(404).json({ error: 'No encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });
    res.json({ bannedUsers: group.bannedUsers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Unirse al grupo (para usuarios expulsados que no fueron baneados)
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isBanned = group.bannedUsers.some(b => b.toString() === req.user._id.toString());
    if (isBanned) return res.status(403).json({ error: 'Estas baneado de este grupo' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (isMember) return res.status(400).json({ error: 'Ya eres miembro' });
    group.members.push({ user: req.user._id, role: 'member' });
    await group.save();
    const joiningUser = await User.findById(req.user._id).select('username').lean();
    if (joiningUser) {
      await emitSystemMessage(group, `${joiningUser.username} se agregó al grupo`, 'join');
    }
    await group.populate('members.user', 'username avatarUrl profileFrame profileFrameUrl');
    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Borrar mensaje
router.delete('/:id/message/:msgId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    const msg = group.messages.id(req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
    const isOwner = msg.sender?.toString() === req.user._id.toString();
    const forAll  = req.query.forAll === 'true';

    if (forAll) {
      if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Sin permisos' });
      group.messages = group.messages.filter(m => m._id.toString() !== req.params.msgId);
      await group.save();
      getIO()?.to(`group:${group._id}`).emit('group:message_deleted', {
        groupId: group._id.toString(),
        msgId:   req.params.msgId,
        forAll:  true,
      });
    } else {
      if (!msg.deletedFor) msg.deletedFor = [];
      if (!msg.deletedFor.map(d => d.toString()).includes(req.user._id.toString())) {
        msg.deletedFor.push(req.user._id);
      }
      await group.save();
    }

    res.json({ ok: true, forAll });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Compartir perfil en grupo ─────────────────────────────────────────────────
router.post('/:id/share-profile', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isMember = group.members.some(m => m.user.toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'No eres miembro' });
    const { userId, username, avatarUrl, xp, followersCount, profileFrame, profileFrameUrl } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requerido' });
    const newMsg = {
      sender: req.user._id, type: 'shared_profile', text: '',
      sharedProfile: { userId, username, avatarUrl, xp: xp||0, followersCount: followersCount||0, profileFrame: profileFrame||null, profileFrameUrl: profileFrameUrl||null },
    };
    group.messages.push(newMsg);
    group.lastMessage       = new Date();
    group.lastMessageText   = `Perfil de @${username}`;
    group.lastMessageSender = req.user.username || '';
    group.members.forEach(m => {
      const uid = m.user.toString();
      if (uid !== req.user._id.toString()) {
        const cur = group.unreadCounts?.get(uid) || 0;
        group.unreadCounts.set(uid, cur + 1);
      }
    });
    group.markModified('unreadCounts');
    await group.save();
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role gender isCreator');
    const savedMsg = group.messages[group.messages.length - 1];
    const { getIO } = require('../sockets');
    getIO()?.to(`group:${group._id}`).emit('group:message', { groupId: group._id, message: savedMsg });
    res.status(201).json({ ok: true, messageId: savedMsg._id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Aceptar invitación al grupo
router.post('/:id/invite/accept', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const isInvited = group.pendingInvites.some(u => u.toString() === req.user._id.toString());
    if (!isInvited) return res.status(403).json({ error: 'No tienes invitación pendiente' });

    const isBanned = group.bannedUsers.some(b => b.toString() === req.user._id.toString());
    if (isBanned) return res.status(403).json({ error: 'Estas baneado de este grupo' });

    group.pendingInvites = group.pendingInvites.filter(u => u.toString() !== req.user._id.toString());
    group.members.push({ user: req.user._id, role: 'member' });

    const Notification = require('../models/Notification');
    await Notification.deleteOne({ to: req.user._id, type: 'group_invite', groupId: group._id });

    await group.save();

    const joiningUser = await User.findById(req.user._id).select('username').lean();
    if (joiningUser) {
      await emitSystemMessage(group, `${joiningUser.username} se agregó al grupo`, 'join');
    }

    await group.populate('members.user', 'username avatarUrl profileFrame profileFrameUrl');
    res.json({ group });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Rechazar invitación al grupo
router.post('/:id/invite/decline', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const isInvited = group.pendingInvites.some(u => u.toString() === req.user._id.toString());
    if (!isInvited) return res.status(403).json({ error: 'No tienes invitación pendiente' });

    group.pendingInvites = group.pendingInvites.filter(u => u.toString() !== req.user._id.toString());

    const Notification = require('../models/Notification');
    await Notification.deleteOne({ to: req.user._id, type: 'group_invite', groupId: group._id });

    await group.save();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Historial de fotos del grupo — todos los miembros
router.get('/:id/media/images', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const lim  = Math.min(Number(limit), 60);
    const skip = (Number(page) - 1) * lim;
    const group = await Group.findById(req.params.id)
      .select('members messages')
      .populate('messages.sender', 'username avatarUrl')
      .lean();
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isMember = group.members.some(m => (m.user?._id || m.user).toString() === req.user._id.toString());
    if (!isMember) return res.status(403).json({ error: 'No eres miembro' });
    const imgs = group.messages
      .filter(m => m.type === 'image' && m.mediaUrl)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const total = imgs.length;
    const paged = imgs.slice(skip, skip + lim).map(m => ({
      _id: m._id, mediaUrl: m.mediaUrl, sender: m.sender, createdAt: m.createdAt,
    }));
    res.json({ images: paged, total, page: Number(page), pages: Math.ceil(total / lim) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cambiar fondo del grupo — solo admin
router.patch('/:id/background', authMiddleware, uploadGroupBg.single('file'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });

    if (req.file) {
      group.backgroundUrl = req.file.path;
    } else {
      group.backgroundUrl = req.body.preset ?? null;
    }

    await group.save();
    getIO()?.to(`group:${group._id}`).emit('group:background_updated', {
      groupId:       group._id.toString(),
      backgroundUrl: group.backgroundUrl,
    });
    res.json({ ok: true, backgroundUrl: group.backgroundUrl });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Marcar como leido
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
