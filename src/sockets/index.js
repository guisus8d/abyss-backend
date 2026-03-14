const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Chat = require('../models/Chat');
const Notification = require('../models/Notification');

function initSockets(server) {
  const io = new Server(server, { cors: { origin: '*' } });
  _io = io;  // guardar referencia real al io

  // Autenticar por token
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

    // Unirse a sala personal (para recibir mensajes)
    socket.join(`user:${socket.userId}`);

    // Unirse a sala de chat
    socket.on('chat:join', ({ chatId }) => {
      socket.join(`chat:${chatId}`);
    });

    // Salir de sala
    socket.on('chat:leave', ({ chatId }) => {
      socket.leave(`chat:${chatId}`);
    });

    // Enviar mensaje
    // Marcar mensajes como leídos en tiempo real
    socket.on('chat:read', async ({ chatId }) => {
      try {
        const chat = await Chat.findOne({ _id: chatId, participants: socket.userId });
        if (!chat) return;
        let changed = false;
        chat.messages.forEach(m => {
          if (!m.readBy.map(r => r.toString()).includes(socket.userId.toString())) {
            m.readBy.push(socket.userId);
            changed = true;
          }
        });
        // Resetear contador de no leídos
        chat.unreadCounts.set(socket.userId.toString(), 0);
        chat.markModified('unreadCounts');
        await chat.save();
        // Avisar a los otros participantes que se leyó
        chat.participants.forEach(p => {
          if (p.toString() !== socket.userId.toString()) {
            io.to(`user:${p}`).emit('chat:read_ack', { chatId, readBy: socket.userId });
          }
        });
      } catch (e) { console.log('chat:read error', e.message); }
    });

    socket.on('chat:send', async ({ chatId, text, replyTo }) => {
      try {
        const chat = await Chat.findOne({
          _id: chatId,
          participants: socket.userId,
        });
        if (!chat) return;

        const message = {
          sender:    socket.userId,
          text:      text.trim(),
          readBy:    [socket.userId],
          createdAt: new Date(),
          ...(replyTo ? { replyTo } : {}),
        };

        chat.messages.push(message);
        chat.lastMessage = new Date();
        chat.lastMessageText = text.trim();
        // Incrementar unread para todos menos el sender
        chat.participants.forEach(p => {
          if (p.toString() !== socket.userId.toString()) {
            const cur = chat.unreadCounts?.get(p.toString()) || 0;
            chat.unreadCounts.set(p.toString(), cur + 1);
          }
        });
        chat.markModified('unreadCounts');
        await chat.save();

        const saved = chat.messages[chat.messages.length - 1];

        // Emitir a todos en la sala del chat
        io.to(`chat:${chatId}`).emit('chat:message', {
          chatId,
          message: { ...saved.toObject(), sender: { _id: socket.userId } }
        });

        // Notificar a participantes fuera de la sala
        chat.participants.forEach(p => {
          if (p.toString() !== socket.userId) {
            io.to(`user:${p}`).emit('chat:notification', { chatId });
          }
        });

      } catch (err) {
        console.error('Socket error:', err.message);
      }
    });

    // Typing indicator
    socket.on('chat:typing', ({ chatId, isTyping }) => {
      socket.to(`chat:${chatId}`).emit('chat:typing', {
        userId: socket.userId,
        isTyping,
      });
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Desconectado: ${socket.userId}`);
    });
  });
}

let _io = null;
function getIO() { return _io; }

module.exports = { initSockets, getIO };
