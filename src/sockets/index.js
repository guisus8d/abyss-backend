const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const Chat = require('../models/Chat');
const Group = require('../models/Group');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendPush } = require('../utils/pushNotifications');

function initSockets(server) {
  const io = new Server(server, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
  });
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
    User.findByIdAndUpdate(socket.userId, { lastActive: new Date() }).catch(() => {});
    User.findById(socket.userId).select('username').lean().then(u => { socket.username = u?.username || ''; }).catch(() => {});
    const keepAlive = setInterval(() => {
      User.findByIdAndUpdate(socket.userId, { lastActive: new Date() }).catch(() => {});
    }, 120000);

    socket.on('chat:join',  ({ chatId }) => socket.join(`chat:${chatId}`));
    socket.on('chat:leave', ({ chatId }) => socket.leave(`chat:${chatId}`));

    // ✅ FIX: en vez de findOne (carga todos los mensajes) + forEach + save,
    // usamos updateOne con $set directo en MongoDB.
    // Esto es una sola operación atómica — no carga ningún mensaje al servidor.
    socket.on('chat:read', async ({ chatId }) => {
      try {
        // Verificar que el usuario es participante sin cargar los mensajes
        const isMember = await Chat.exists({ _id: chatId, participants: socket.userId });
        if (!isMember) return;

        const userIdStr = socket.userId.toString();

        // Marcar como leídos solo los mensajes donde readBy NO contiene al usuario
        // y agregar su ID al array — sin cargar ni un solo mensaje en memoria
        await Chat.updateOne(
          { _id: chatId },
          [
            {
              $set: {
                messages: {
                  $map: {
                    input: '$messages',
                    as:    'msg',
                    in: {
                      $mergeObjects: [
                        '$$msg',
                        {
                          readBy: {
                            $cond: {
                              if: {
                                $in: [
                                  { $toObjectId: userIdStr },
                                  '$$msg.readBy',
                                ],
                              },
                              then: '$$msg.readBy',
                              else: {
                                $concatArrays: [
                                  '$$msg.readBy',
                                  [{ $toObjectId: userIdStr }],
                                ],
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
                [`unreadCounts.${userIdStr}`]: 0,
              },
            },
          ]
        );

        // Notificar al otro participante que leyó
        const chat = await Chat.findById(chatId).select('participants').lean();
        chat?.participants?.forEach(p => {
          if (p.toString() !== userIdStr) {
            io.to(`user:${p}`).emit('chat:read_ack', { chatId, readBy: socket.userId });
          }
        });
      } catch (e) { console.log('chat:read error', e.message); }
    });

    socket.on('chat:send', async ({ chatId, text, replyTo, type, mediaUrl, audioDuration, giftId, giftData }) => {
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
          ...(replyTo  ? { replyTo }  : {}),
          ...(giftId   ? { giftId }   : {}),
          ...(giftData ? { giftData } : {}),
        };

        chat.messages.push(message);
        chat.lastMessage = new Date();
        chat.lastMessageText =
          type === 'image' ? '[Imagen]' :
          type === 'audio' ? '[Audio]'  :
          type === 'gift'  ? '🎁 Nuevo regalo disponible' :
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
            giftId:        saved.giftId   || null,
            giftData:      saved.giftData || null,
          },
        });

        await Promise.all(chat.participants
          .filter(p => p.toString() !== socket.userId.toString())
          .map(async p => {
            io.to(`user:${p}`).emit('chat:notification', {
              chatId,
              lastMessageText: chat.lastMessageText,
              lastMessage:     chat.lastMessage,
            });
            const recipient = await User.findById(p).select('pushToken username').lean();
            const preview = type === 'image' ? '📷 Imagen' : type === 'audio' ? '🎤 Audio' : (text?.trim()?.slice(0, 60) || '');
            sendPush(recipient?.pushToken, `${populated.sender?.username || 'Mensaje'}`, preview, { type: 'chat', chatId: chatId.toString() });
          })
        );
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

    socket.on('group:message', async ({ groupId, text, type, mediaUrl, audioDuration, replyTo, giftId, giftData }) => {
      try {
        if (!text?.trim() && !mediaUrl && type !== 'gift') return;

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
          ...(replyTo  ? { replyTo }  : {}),
          ...(giftId   ? { giftId }   : {}),
          ...(giftData ? { giftData } : {}),
        };

        group.messages.push(message);
        group.lastMessage       = message.createdAt;
        group.lastMessageText   =
          type === 'image' ? '[Imagen]' :
          type === 'audio' ? '[Audio]'  :
          type === 'gift'  ? '🎁 Nuevo regalo disponible' :
          text?.trim() || '';
        group.lastMessageSender = socket.username || '';

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
            giftId:        saved.giftId   || null,
            giftData:      saved.giftData || null,
          },
        });

        group.members.forEach(m => {
          const uid = m.user.toString();
          if (uid !== socket.userId.toString()) {
            io.to(`user:${uid}`).emit('group:notification', {
              groupId,
              lastMessageText:   group.lastMessageText,
              lastMessage:       group.lastMessage,
              lastMessageSender: group.lastMessageSender,
            });
          }
        });

        // Notificaciones de @mención
        if (saved.type === 'text' && saved.text) {
          const mentionRegex = /@(\w+)/g;
          const matches = [...saved.text.matchAll(mentionRegex)];
          if (matches.length > 0) {
            const Notification = require('../models/Notification');
            const User         = require('../models/User');
            const senderMember = group.members.find(m => m.user.toString() === socket.userId.toString());
            const isAdmin      = senderMember?.role === 'admin';

            for (const [, username] of matches) {
              // @todos / @all — solo admin
              if (username === 'todos' || username === 'all') {
                if (!isAdmin) continue;
                for (const m of group.members) {
                  const uid = m.user.toString();
                  if (uid === socket.userId.toString()) continue;
                  await Notification.create({ to: uid, from: socket.userId, type: 'mention', text: saved.text.slice(0, 100) }).catch(() => {});
                  io.to(`user:${uid}`).emit('notification:new');
                }
                continue;
              }
              // @username individual
              const mentioned = await User.findOne({ username: new RegExp(`^${username}$`, 'i') }).select('_id pushToken').lean();
              if (!mentioned || mentioned._id.toString() === socket.userId.toString()) continue;
              const isMemberOfGroup = group.members.some(m => m.user.toString() === mentioned._id.toString());
              if (!isMemberOfGroup) continue;
              await Notification.create({ to: mentioned._id, from: socket.userId, type: 'mention', text: saved.text.slice(0, 100) }).catch(() => {});
              io.to(`user:${mentioned._id}`).emit('notification:new');
              sendPush(mentioned.pushToken, `${group.name}`, `@${username} te mencionó`, { type: 'mention', groupId: groupId.toString() });
            }
          }
        }
      } catch (err) {
        console.error('group:message error:', err.message);
      }
    });

    socket.on('disconnect', () => {
      clearInterval(keepAlive);
      console.log(`🔌 Desconectado: ${socket.userId}`);
      User.findByIdAndUpdate(socket.userId, { lastActive: new Date() }).catch(() => {});
    });
  });
}

let _io = null;
function getIO() { return _io; }

module.exports = { initSockets, getIO };
