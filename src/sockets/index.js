const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Chat = require('../models/Chat');
const Group = require('../models/Group');
const Notification = require('../models/Notification');

function initSockets(server) {
  const io = new Server(server, { cors: { origin: '*' } });
  _io = io;

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
    socket.join(`user:${socket.userId}`);

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

    socket.on('chat:send', async ({ chatId, text, replyTo, type, mediaUrl, audioDuration }) => {
      try {
        const chat = await Chat.findOne({ _id: chatId, participants: socket.userId });
        if (!chat) return;

        const message = {
          sender:        socket.userId,
          text:          text?.trim() || '',
          type:          type || 'text',
          mediaUrl:      mediaUrl || null,
          audioDuration: audioDuration || null,
          readBy:        [socket.userId],
          createdAt:     new Date(),
          ...(replyTo ? { replyTo } : {}),
        };

        chat.messages.push(message);
        chat.lastMessage = new Date();
        chat.lastMessageText =
          type === 'image' ? '[Imagen]' :
          type === 'audio' ? '[Audio]'  :
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

        // Populate del sender — igual que en grupos, manda objeto completo
        await Chat.populate(chat, {
          path:   'messages.sender',
          select: 'username avatarUrl profileFrame profileFrameUrl',
          match:  { _id: socket.userId },
        });

        const populated = chat.messages[chat.messages.length - 1];

        io.to(`chat:${chatId}`).emit('chat:message', {
          chatId,
          message: {
            _id:           saved._id,
            text:          saved.text,
            type:          saved.type,
            mediaUrl:      saved.mediaUrl,
            audioDuration: saved.audioDuration,
            replyTo:       saved.replyTo,
            reactions:     saved.reactions,
            readBy:        saved.readBy,
            createdAt:     saved.createdAt,
            sender:        populated.sender,
          },
        });

        chat.participants.forEach(p => {
          if (p.toString() !== socket.userId.toString()) {
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

    socket.on('group:message', async ({ groupId, text, type, mediaUrl, audioDuration, replyTo }) => {
      try {
        if (!text?.trim() && !mediaUrl) return;

        const group = await Group.findOne({
          _id: groupId,
          'members.user': socket.userId,
          bannedUsers: { $ne: socket.userId },
        });
        if (!group) return;

        const message = {
          sender:        socket.userId,
          text:          text?.trim() || '',
          type:          type || 'text',
          mediaUrl:      mediaUrl || null,
          audioDuration: audioDuration || null,
          createdAt:     new Date(),
          ...(replyTo ? { replyTo } : {}),
        };

        group.messages.push(message);
        group.lastMessage     = message.createdAt;
        group.lastMessageText = type === 'image' ? '[Imagen]' : type === 'audio' ? '[Audio]' : text?.trim() || '';

        group.members.forEach(m => {
          const uid = m.user.toString();
          if (uid !== socket.userId.toString()) {
            const cur = group.unreadCounts?.get(uid) || 0;
            group.unreadCounts.set(uid, cur + 1);
          }
        });
        group.markModified('unreadCounts');
        await group.save();

        const saved = group.messages[group.messages.length - 1];
        await Group.populate(group, {
          path:   'messages.sender',
          select: 'username avatarUrl profileFrame profileFrameUrl',
          match:  { _id: socket.userId },
        });

        const populated = group.messages[group.messages.length - 1];

        io.to(`group:${groupId}`).emit('group:message', {
          groupId,
          message: {
            _id:           saved._id,
            text:          saved.text,
            type:          saved.type,
            mediaUrl:      saved.mediaUrl,
            audioDuration: saved.audioDuration,
            replyTo:       saved.replyTo,
            createdAt:     saved.createdAt,
            sender:        populated.sender,
          },
        });

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
