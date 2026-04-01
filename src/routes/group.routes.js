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

    const me = await User.findById(req.user._id);
    const validIds = [...(me.followers || []).map(String), ...(me.following || []).map(String)];
    const parsedIds = JSON.parse(memberIds || '[]').filter(id => validIds.includes(String(id)));

    const followerIds  = (me.followers  || []).map(String);
    const followingIds = (me.following  || []).map(String);
    const mutualIds    = parsedIds.filter(id =>  followerIds.includes(String(id)) && followingIds.includes(String(id)));
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

    if (nonMutualIds.length > 0) {
      group.pendingInvites = nonMutualIds;
      await group.save();
      const Notification = require('../models/Notification');
      for (const uid of nonMutualIds) {
        await Notification.create({
          to: uid, from: req.user._id,
          type: 'group_invite', groupId: group._id, groupName: group.name,
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
        await emitSystemMessage(group, `${newUser.username} se unio al grupo`, 'join');
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
    if (isAdmin && otherAdmins.length === 0) {
      const nextMember = group.members.find(m => m.user.toString() !== req.user._id.toString());
      if (nextMember) nextMember.role = 'admin';
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
    group.lastMessage = new Date();
    group.lastMessageText = text?.slice(0, 60) || '';

    group.members.forEach(m => {
      if (m.user.toString() !== req.user._id.toString()) {
        const current = group.unreadCounts.get(m.user.toString()) || 0;
        group.unreadCounts.set(m.user.toString(), current + 1);
      }
    });

    await group.save();
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl');
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
    group.lastMessage = new Date();
    group.lastMessageText = 'Post compartido';
    group.members.forEach(m => {
      if (m.user.toString() !== req.user._id.toString()) {
        const current = group.unreadCounts.get(m.user.toString()) || 0;
        group.unreadCounts.set(m.user.toString(), current + 1);
      }
    });

    await group.save();
    await group.populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl');
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
      await emitSystemMessage(group, `${joiningUser.username} se unio al grupo`, 'join');
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
