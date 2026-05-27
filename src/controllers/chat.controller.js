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

    const myIdStr = req.user._id.toString();
    const total   = await Chat.countDocuments({ participants: req.user._id });

    // select('-messages') evita cargar el historial solo para contar no leídos
    const chats = await Chat.find({ participants: req.user._id })
      .sort({ lastMessage: -1 })
      .skip(skip)
      .limit(limit)
      .select('-messages')
      .populate('participants', 'username avatarUrl profileFrame profileFrameUrl xp');

    const result = chats.map(chat => {
      const obj    = chat.toObject();
      obj.unread   = chat.unreadCounts?.get(myIdStr) || 0;
      return obj;
    });

    res.json({ chats: result, page, pages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Historial de mensajes de un chat (paginado — últimos 50 por defecto)
async function getChatMessages(req, res) {
  try {
    const limit = Math.min(200, parseInt(req.query.limit) || 50);
    const skip  = Math.max(0,   parseInt(req.query.skip)  || 0);

    const chat = await Chat.findOne({
      _id: req.params.chatId,
      participants: req.user._id,
    }).populate('messages.sender', 'username avatarUrl profileFrame profileFrameUrl');

    if (!chat) return res.status(404).json({ error: 'Chat no encontrado' });

    // Marcar mensajes como leídos (el socket chat:read también lo hace al conectar)
    chat.messages.forEach(m => {
      if (!m.readBy.includes(req.user._id)) m.readBy.push(req.user._id);
    });
    await chat.save();

    const total    = chat.messages.length;
    const messages = chat.messages.slice().reverse().slice(skip, skip + limit).reverse();

    res.json({ messages, hasMore: total > skip + limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getOrCreateChat, getMyChats, getChatMessages };
