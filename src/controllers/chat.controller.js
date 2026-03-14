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
    }).populate('participants', 'username profileFrame xp');

    if (!chat) {
      chat = await Chat.create({ participants: [me, userId] });
      await chat.populate('participants', 'username profileFrame xp');
    }

    res.json({ chat });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Listar mis chats con unread count
async function getMyChats(req, res) {
  try {
    const chats = await Chat.find({ participants: req.user._id })
      .sort({ lastMessage: -1 })
      .populate('participants', 'username avatarUrl profileFrame xp');

    const result = chats.map(chat => {
      const unread = chat.messages.filter(
        m => !m.readBy.map(r => r.toString()).includes(req.user._id.toString())
      ).length;
      const obj = chat.toObject();
      delete obj.messages;
      return { ...obj, unread };
    });

    res.json({ chats: result });
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
