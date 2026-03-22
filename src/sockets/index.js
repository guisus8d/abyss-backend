const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Chat = require('../models/Chat');
const Group = require('../models/Group');
const Notification = require('../models/Notification');

function initSockets(server) {
  const io = new Server(server, { cors: { origin: '*' } });
  _io = io;

  // ── Auth middleware ──────────────────────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Token requerido'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Token inválido'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`🔌 Conectado: ${socket.userId}`);

    // Sala personal (notificaciones, etc.)
    socket.join(`user:${socket.userId}`);

    // ── Chats privados ───────────────────────────────────────────────────────
    socket.on('chat:join',  ({ chatId }) => socket.join(`chat:${chatId}`));
    socket.on('chat:leave', ({ chatId }) => socket.leave(`chat:${chatId}`));

    socket.on('chat:read', async ({ chatId }) => {
      try {
        const chat = await Chat.findOne({ _id: chatId, participants: socket.userId });
        if (!chat) return;
        chat.messages.forEach(m => {
          if (!m.readBy.map(r => r.toString()).includes(socket.userId.toString())) {
            m.readBy.push(socket.userId);
          }
        });
        chat.unreadCounts.set(socket.userId.toString(), 0);
        chat.markModified('unreadCounts');
        await chat.save();
        chat.participants.forEach(p => {
          if (p.toString() !== socket.userId.toString()) {
            io.to(`user:${p}`).emit('chat:read_ack', { chatId, readBy: socket.userId });
          }
        });
      } catch (e) { console.log('chat:read error', e.message); }
    });

    socket.on('chat:send', async ({ chatId, text, replyTo, type, mediaUrl }) => {
      try {
        const chat = await Chat.findOne({ _id: chatId, participants: socket.userId });
        if (!chat) return;

        const message = {
          sender:    socket.userId,
          text:      text?.trim() || '',
          type:      type || 'text',
          mediaUrl:  mediaUrl || null,
          readBy:    [socket.userId],
          createdAt: new Date(),
          ...(replyTo ? { replyTo } : {}),
        };

        chat.messages.push(message);
        chat.lastMessage = new Date();
        chat.lastMessageText =
          type === 'image' ? '[Imagen]' :
          type === 'audio' ? '[Audio]' :
          text?.trim() || '';

        chat.participants.forEach(p => {
          if (p.toString() !== socket.userId.toString()) {
            const cur = chat.unreadCounts?.get(p.toString()) || 0;
            chat.unreadCounts.set(p.toString(), cur + 1);
          }
        });
        chat.markModified('unreadCounts');
        await chat.save();

        const saved = chat.messages[chat.messages.length - 1];
        io.to(`chat:${chatId}`).emit('chat:message', {
          chatId,
          message: { ...saved.toObject(), sender: { _id: socket.userId } },
        });

        chat.participants.forEach(p => {
          if (p.toString() !== socket.userId) {
            io.to(`user:${p}`).emit('chat:notification', { chatId });
          }
        });
      } catch (err) {
        console.error('chat:send error:', err.message);
      }
    });

    socket.on('chat:typing', ({ chatId, isTyping }) => {
      socket.to(`chat:${chatId}`).emit('chat:typing', { userId: socket.userId, isTyping });
    });

    // ── Grupos ───────────────────────────────────────────────────────────────
    socket.on('group:join',  ({ groupId }) => socket.join(`group:${groupId}`));
    socket.on('group:leave', ({ groupId }) => socket.leave(`group:${groupId}`));

    socket.on('group:message', async ({ groupId, text }) => {
      try {
        if (!text?.trim()) return;

        // Verificar que el usuario es miembro activo del grupo
        const group = await Group.findOne({
          _id: groupId,
          'members.user': socket.userId,
          bannedUsers: { $ne: socket.userId },
        });
        if (!group) return;

        const message = {
          sender:    socket.userId,
          text:      text.trim(),
          createdAt: new Date(),
        };

        group.messages.push(message);

        // Actualizar lastMessage y lastMessageText
        group.lastMessage     = message.createdAt;
        group.lastMessageText = text.trim();

        // Incrementar unreadCounts para todos los miembros menos el sender
        group.members.forEach(m => {
          const uid = m.user.toString();
          if (uid !== socket.userId.toString()) {
            const cur = group.unreadCounts?.get(uid) || 0;
            group.unreadCounts.set(uid, cur + 1);
          }
        });
        group.markModified('unreadCounts');
        await group.save();

        // Populate del sender para incluir avatar, frame, etc.
        const saved = group.messages[group.messages.length - 1];
        await Group.populate(group, {
          path:   'messages.sender',
          select: 'username avatarUrl profileFrame profileFrameUrl',
          match:  { _id: socket.userId },
        });

        const populated = group.messages[group.messages.length - 1];

        // Emitir el mensaje a todos en el room (incluye al emisor)
        io.to(`group:${groupId}`).emit('group:message', {
          groupId,
          message: {
            _id:       saved._id,
            text:      saved.text,
            createdAt: saved.createdAt,
            sender:    populated.sender,
          },
        });

        // Notificar a miembros fuera del room para que recarguen la lista
        group.members.forEach(m => {
          const uid = m.user.toString();
          if (uid !== socket.userId.toString()) {
            io.to(`user:${uid}`).emit('group:notification', { groupId });
          }
        });
      } catch (err) {
        console.error('group:message error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Desconectado: ${socket.userId}`);
    });
  });
}

let _io = null;
function getIO() { return _io; }

module.exports = { initSockets, getIO };
