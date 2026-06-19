const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { getMyChats, getChatMessages } = require('../controllers/chat.controller');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Notification = require('../models/Notification');

// ── Mis chats ─────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, getMyChats);

// ── Solicitudes enviadas (legacy — devuelve vacío) ────────────────────────────
router.get('/requests/sent', authMiddleware, async (req, res) => {
  res.json({ sent: [] });
});

// ── Solicitudes pendientes (legacy — devuelve vacío) ─────────────────────────
router.get('/requests/pending', authMiddleware, async (req, res) => {
  res.json({ requests: [] });
});

// ── Crear o abrir chat directo con un usuario ─────────────────────────────────
router.post('/request/:userId', authMiddleware, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target._id.toString() === req.user._id.toString())
      return res.status(400).json({ error: 'No puedes chatear contigo mismo' });

    let chat = await Chat.findOne({ participants: { $all: [req.user._id, target._id] } })
      .populate('participants', 'username avatarUrl xp profileFrame profileFrameUrl gender');

    if (!chat) {
      chat = await Chat.create({ participants: [req.user._id, target._id], messages: [] });
      await chat.populate('participants', 'username avatarUrl xp profileFrame profileFrameUrl');
      try {
        const { getIO } = require('../sockets');
        getIO()?.to(`user:${target._id}`).emit('chat:notification');
      } catch (e) {}
    }

    const obj = chat.toObject();
    delete obj.messages;
    res.json({ chat: obj });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Verificar si existe chat con un usuario ───────────────────────────────────
router.get('/check/:userId', authMiddleware, async (req, res) => {
  try {
    const existing = await Chat.findOne({
      participants: { $all: [req.user._id, req.params.userId] }
    });
    if (existing) return res.json({ status: 'active', chatId: existing._id });
    res.json({ status: 'none' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Abrir chat activo con usuario ─────────────────────────────────────────────
router.get('/with/:userId', authMiddleware, async (req, res) => {
  try {
    const existing = await Chat.findOne({
      participants: { $all: [req.user._id, req.params.userId] }
    }).populate('participants', 'username avatarUrl xp profileFrame profileFrameUrl');
    if (!existing) return res.status(404).json({ error: 'No tienen chat activo' });
    res.json({ chat: existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Compartir post en un chat activo ─────────────────────────────────────────
router.post('/:chatId/share-post', authMiddleware, async (req, res) => {
  try {
    const { postId, title, content, imageUrl, authorUsername, authorAvatarUrl, postType, text } = req.body;
    if (!postId) return res.status(400).json({ error: 'postId requerido' });

    const chat = await Chat.findOne({
      _id: req.params.chatId,
      participants: req.user._id,
    });
    if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });

    const newMessage = {
      sender:     req.user._id,
      type:       'shared_post',
      text:       text?.trim() || '',
      sharedPost: { postId, title, content, imageUrl, authorUsername, authorAvatarUrl, postType },
      readBy:     [req.user._id],
    };

    chat.messages.push(newMessage);
    chat.lastMessage     = new Date();
    chat.lastMessageText = `Post de @${authorUsername}`;
    await chat.save();

    const saved = chat.messages[chat.messages.length - 1];

    try {
      const { getIO } = require('../sockets');
      const io = getIO();
      chat.participants.forEach(p => {
        io?.to(`user:${p.toString()}`).emit('chat:message', {
          chatId:  chat._id,
          message: saved,
        });
      });
    } catch (e) {}

    res.status(201).json({ message: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Mensajes de un chat — AL FINAL (/:chatId captura todo) ───────────────────
router.get('/:chatId/messages', authMiddleware, getChatMessages);

// ── Reaccionar a mensaje ──────────────────────────────────────────────────────
router.post('/:chatId/message/:msgId/react', authMiddleware, async (req, res) => {
  try {
    const { emoji } = req.body;
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });
    const msg = chat.messages.id(req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
    const userId = req.user._id.toString();
    const idx = msg.reactions.findIndex(r => r.user.toString() === userId);
    if (idx >= 0) {
      if (msg.reactions[idx].emoji === emoji) msg.reactions.splice(idx, 1);
      else msg.reactions[idx].emoji = emoji;
    } else {
      msg.reactions.push({ user: req.user._id, emoji });
    }
    await chat.save();
    const { getIO } = require('../sockets');
    chat.participants.forEach(p => {
      getIO()?.to(`user:${p.toString()}`).emit('chat:message_reaction', {
        chatId: chat._id, msgId: req.params.msgId, reactions: msg.reactions,
      });
    });
    res.json({ reactions: msg.reactions });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Borrar mensaje para mí ────────────────────────────────────────────────────
router.delete('/:chatId/message/:msgId', authMiddleware, async (req, res) => {
  try {
    const chat = await Chat.findById(req.params.chatId);
    if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });
    const msg = chat.messages.id(req.params.msgId);
    if (!msg) return res.status(404).json({ error: 'Mensaje no encontrado' });
    msg.deletedFor.push(req.user._id);
    await chat.save();
    res.json({ ok: true });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// ── Compartir perfil en un chat activo ───────────────────────────────────────
router.post('/:chatId/share-profile', authMiddleware, async (req, res) => {
  try {
    const { userId, username, avatarUrl, xp, followersCount, profileFrame, profileFrameUrl } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requerido' });
    const chat = await Chat.findOne({ _id: req.params.chatId, participants: req.user._id });
    if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });
    const newMessage = {
      sender: req.user._id, type: 'shared_profile', text: '',
      sharedProfile: { userId, username, avatarUrl, xp: xp||0, followersCount: followersCount||0, profileFrame: profileFrame||null, profileFrameUrl: profileFrameUrl||null },
      readBy: [req.user._id],
    };
    chat.messages.push(newMessage);
    chat.lastMessage = new Date();
    chat.lastMessageText = `Perfil de @${username}`;
    chat.participants.forEach(p => {
      if (p.toString() !== req.user._id.toString()) {
        const cur = chat.unreadCounts?.get(p.toString()) || 0;
        chat.unreadCounts.set(p.toString(), cur + 1);
      }
    });
    chat.markModified('unreadCounts');
    await chat.save();
    const saved = chat.messages[chat.messages.length - 1];
    try { const { getIO } = require('../sockets'); getIO()?.to(`chat:${chat._id}`).emit('chat:message', { chatId: chat._id, message: { ...saved.toObject(), sender: { _id: req.user._id } } }); } catch {}
    res.status(201).json({ message: saved });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Upload media ──────────────────────────────────────────────────────────────
const { uploadPost: uploadMedia, uploadAudio } = require('../config/cloudinary');

router.post('/upload', authMiddleware, uploadMedia.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ url: req.file.path });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/upload/audio', authMiddleware, uploadAudio.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ url: req.file.path });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
