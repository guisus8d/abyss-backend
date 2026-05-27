const router = require('express').Router();
const Group  = require('../models/Group');
const User   = require('../models/User');
const { authMiddleware } = require('../middlewares/auth');
const { uploadAvatar } = require('../config/cloudinary');

function getIO() {
  try { return require('../sockets').getIO(); } catch { return null; }
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

// Obtener mis grupos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const groups = await Group.find({ 'members.user': req.user._id })
      .select('name description imageUrl bgColor members lastMessage lastMessageText lastMessageSender unreadCounts creator')
      .sort({ lastMessage: -1 });
    res.json({ groups });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Crear grupo
router.post('/', authMiddleware, uploadAvatar.single('image'), async (req, res) => {
  try {
    const { name, description, memberIds } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });

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

// Obtener grupo por ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id)
      .populate('members.user', 'username avatarUrl profileFrame profileFrameUrl')
      .populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role');
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });

    const isMember  = group.members.some(m => m.user._id.toString() === req.user._id.toString());
    const isPending = group.pendingInvites.some(u => u.toString() === req.user._id.toString());

    if (!isMember && !isPending) return res.status(403).json({ error: 'No eres miembro' });

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

// Editar grupo — solo admin
router.patch('/:id', authMiddleware, uploadAvatar.single('image'), async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });
    const { name, description, bgColor, imageUrl } = req.body;
    if (name)                      group.name        = name.trim();
    if (description !== undefined) group.description = description.trim();
    if (bgColor !== undefined)     group.bgColor     = bgColor;
    if (req.file)                  { group.imageUrl = req.file.path; group.imagePublicId = req.file.filename; }
    else if (imageUrl !== undefined) group.imageUrl  = imageUrl || null;
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

// Expulsar miembro — solo admin (sin banear, puede regresar)
router.post('/:id/kick/:memberId', authMiddleware, async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ error: 'Grupo no encontrado' });
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });
    const target = group.members.find(m => m.user.toString() === req.params.memberId);
    if (!target) return res.status(404).json({ error: 'Miembro no encontrado' });
    if (target.role === 'admin') return res.status(403).json({ error: 'No puedes expulsar a otro admin' });

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
    const isAdmin = group.members.some(m => m.user.toString() === req.user._id.toString() && m.role === 'admin');
    if (!isAdmin) return res.status(403).json({ error: 'Solo admins' });
    const target = group.members.find(m => m.user.toString() === req.params.memberId);
    if (target?.role === 'admin') return res.status(403).json({ error: 'No puedes expulsar a otro admin' });

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
      await emitSystemMessage(group, `${leavingUser.username} salio del grupo`, 'leave');
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
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role');
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
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role');
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
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl role');
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
