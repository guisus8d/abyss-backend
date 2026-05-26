const Chat = require('../models/Chat');

// Obtener o crear chat privado entre 2 usuarios
async function getOrCreateChat(req, res) {
  try {
    const { userId } = req.params;
    const me = req.user._id;

    if (userId === me.toString()) {
      return res.status(400).json({ error: 'No puedes chatear contigo mismo' });
    }

    let chat = await Chat.findOne({
      participants: { $all: [me, userId], $size: 2 }
    }).populate('participants', 'username avatarUrl profileFrame profileFrameUrl xp');

    if (!chat) {
      chat = await Chat.create({ participants: [me, userId] });
      await chat.populate('participants', 'username avatarUrl profileFrame profileFrameUrl xp');
    }

    res.json({ chat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Listar mis chats con unread count + paginación
async function getMyChats(req, res) {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;

    const total = await Chat.countDocuments({ participants: req.user._id });
    const chats = await Chat.find({ participants: req.user._id })
      .sort({ lastMessage: -1 })
      .skip(skip)
      .limit(limit)
      .populate('participants', 'username avatarUrl profileFrame profileFrameUrl xp');

    const myIdStr = req.user._id.toString();
    const result = chats.map(chat => {
      const unread = chat.messages.filter(
        m => !m.readBy.map(r => r.toString()).includes(myIdStr)
      ).length;
      const obj = chat.toObject();
      delete obj.messages;
      return { ...obj, unread };
    });

    res.json({ chats: result, page, pages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Historial de mensajes de un chat
async function getChatMessages(req, res) {
  try {
    const chat = await Chat.findOne({
      _id: req.params.chatId,
      participants: req.user._id,
    }).populate('messages.sender', 'username');

    if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });

    // Marcar mensajes como leídos
    chat.messages.forEach(m => {
      if (!m.readBy.includes(req.user._id)) m.readBy.push(req.user._id);
    });
    await chat.save();

    res.json({ messages: chat.messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getOrCreateChat, getMyChats, getChatMessages };
