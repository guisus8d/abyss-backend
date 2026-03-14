const router = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const { getMyChats, getChatMessages } = require('../controllers/chat.controller');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Notification = require('../models/Notification');

// IMPORTANTE: rutas específicas ANTES que rutas con parámetros

// Mis chats
router.get('/', authMiddleware, getMyChats);

// Solicitudes que YO envié (para mostrar en mi lista como "pendiente")
router.get('/requests/sent', authMiddleware, async (req, res) => {
  try {
    const users = await User.find({
      'chatRequests.from': req.user._id,
      'chatRequests.status': 'pending',
    }).select('username avatarUrl xp chatRequests');

    const sent = users.map(u => {
      const req_ = u.chatRequests.find(
        r => r.from.toString() === req.user._id.toString() && r.status === 'pending'
      );
      return {
        _id: req_._id,
        to: { _id: u._id, username: u.username, avatarUrl: u.avatarUrl, xp: u.xp },
        messages: req_.messages || [],
        createdAt: req_.createdAt,
      };
    });
    res.json({ sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Solicitudes pendientes
router.get('/requests/pending', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('chatRequests.from', 'username avatarUrl xp');
    const pending = (user.chatRequests || []).filter(r => r.status === 'pending');
    res.json({ requests: pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enviar solicitud
router.post('/request/:userId', authMiddleware, async (req, res) => {
  try {
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target._id.toString() === req.user._id.toString())
      return res.status(400).json({ error: 'No puedes enviarte una solicitud' });
    const already = (target.chatRequests || []).find(
      r => r.from.toString() === req.user._id.toString() && r.status === 'pending'
    );
    if (already) return res.status(400).json({ error: 'Solicitud ya enviada' });
    const existing = await Chat.findOne({ participants: { $all: [req.user._id, target._id] } });
    if (existing) return res.status(400).json({ error: 'Ya tienen un chat activo' });
    target.chatRequests.push({ from: req.user._id });
    await target.save();
    res.json({ message: 'Solicitud enviada' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aceptar o rechazar
router.patch('/request/:fromId', authMiddleware, async (req, res) => {
  try {
    const { action } = req.body;
    const user = await User.findById(req.user._id);
    const req_ = (user.chatRequests || []).find(r => r.from.toString() === req.params.fromId);
    if (!req_) return res.status(404).json({ error: 'Solicitud no encontrada' });
    if (action === 'accept') {
      req_.status = 'accepted';
      const pendingMsgs = (req_.messages || []).map(m => ({
        sender: m.sender,
        text: m.text,
        readBy: [req.user._id],   // el que acepta los marca como leídos
        createdAt: m.createdAt,
      }));
      await user.save();
      const lastPending = pendingMsgs[pendingMsgs.length - 1];
      const chat = await Chat.create({
        participants: [req.user._id, req.params.fromId],
        messages: pendingMsgs,
        lastMessage: lastPending?.createdAt || new Date(),
        lastMessageText: lastPending?.text || '',
      });
      await chat.populate('participants', 'username avatarUrl xp');
      // Notificar al solicitante que fue aceptado
      await Notification.create({ to: req.params.fromId, from: req.user._id, type: 'chat_accepted' });
      try {
        const { getIO } = require('../sockets');
        getIO().to(`user:${req.params.fromId}`).emit('notification:new');
      } catch(e) {}
      return res.json({ message: 'Chat aceptado', chat });
    } else {
      req_.status = 'rejected';
      await user.save();
      return res.json({ message: 'Solicitud rechazada' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Verificar estado del chat
router.get('/check/:userId', authMiddleware, async (req, res) => {
  try {
    const existing = await Chat.findOne({
      participants: { $all: [req.user._id, req.params.userId] }
    });
    if (existing) return res.json({ status: 'active', chatId: existing._id });
    const target = await User.findById(req.params.userId);
    const pending = (target?.chatRequests || []).find(
      r => r.from.toString() === req.user._id.toString() && r.status === 'pending'
    );
    if (pending) return res.json({ status: 'requested' });
    res.json({ status: 'none' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Abrir chat activo
router.get('/with/:userId', authMiddleware, async (req, res) => {
  try {
    const existing = await Chat.findOne({
      participants: { $all: [req.user._id, req.params.userId] }
    }).populate('participants', 'username avatarUrl xp');
    if (!existing) return res.status(404).json({ error: 'No tienen chat activo' });
    res.json({ chat: existing });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Enviar mensaje dentro de una solicitud (sin chat activo aún)
router.post('/request/:userId/message', authMiddleware, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Texto vacío' });
    const target = await User.findById(req.params.userId);
    if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Buscar la solicitud pendiente
    const chatReq = (target.chatRequests || []).find(
      r => r.from.toString() === req.user._id.toString() && r.status === 'pending'
    );
    if (!chatReq) return res.status(400).json({ error: 'No tienes solicitud pendiente' });

    // Guardar mensaje en campo pendingMessages del "chat fantasma"
    // Usamos un documento temporal en User para simplificar
    if (!chatReq.messages) chatReq.messages = [];
    chatReq.messages.push({ sender: req.user._id, text: text.trim(), createdAt: new Date() });
    target.markModified('chatRequests');
    await target.save();

    res.json({ message: { sender: req.user._id, text: text.trim(), createdAt: new Date() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mensajes — AL FINAL porque /:chatId captura todo
router.get('/:chatId/messages', authMiddleware, getChatMessages);

// Reaccionar a mensaje
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
    // Emitir por socket
    const { getIO } = require('../sockets');
    chat.participants.forEach(p => {
      getIO()?.to(`user:${p.toString()}`).emit('chat:message_reaction', {
        chatId: chat._id, msgId: req.params.msgId, reactions: msg.reactions,
      });
    });
    res.json({ reactions: msg.reactions });
  } catch(err) { res.status(500).json({ error: err.message }); }
});

// Borrar mensaje para mí
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

module.exports = router;
