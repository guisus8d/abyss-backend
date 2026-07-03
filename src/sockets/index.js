const { Server } = require('socket.io');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Chat = require('../models/Chat');
const Group = require('../models/Group');
const Notification = require('../models/Notification');
const User = require('../models/User');
const MeetSession = require('../models/MeetSession');
const { sendPush } = require('../utils/pushNotifications');

const cinemaActiveSessions = new Map(); // groupId → { videoId, startedAt, proyectorId, proyectorUsername }
const pushCooldown = new Map(); // `${chatId}:${recipientId}` → timestamp del último push enviado

async function handleProyectorLeave(userId, io, specificGroupId = null) {
  for (const [groupId, session] of cinemaActiveSessions.entries()) {
    if (specificGroupId && groupId !== specificGroupId.toString()) continue;
    if (session.proyectorId !== userId.toString()) continue;
    cinemaActiveSessions.delete(groupId);
    io.to(`group:${groupId}`).emit('circle:cinema:stop', { groupId });
    try {
      const group = await Group.findById(groupId).select('members isCircle messages lastMessage lastMessageText');
      if (!group) continue;
      const msgText = 'Se cerro la Sala de Cine';
      group.messages.push({ text: msgText, type: 'system', sender: null });
      group.lastMessage     = new Date();
      group.lastMessageText = msgText;
      await group.save();
      const sysMsg = group.messages[group.messages.length - 1];
      io.to(`group:${groupId}`).emit('group:message', { groupId, message: sysMsg.toObject() });
    } catch (e) { console.error('handleProyectorLeave error:', e.message); }
  }
}

// Apaga la sesion de cine activa de una fiesta (si hay una). No valida permisos —
// el llamador (route o handler) ya debe haber verificado admin/co-admin.
async function stopCinemaForGroup(groupId) {
  const gid = groupId.toString();
  if (!cinemaActiveSessions.has(gid)) return;
  cinemaActiveSessions.delete(gid);
  _io?.to(`group:${gid}`).emit('circle:cinema:stop', { groupId: gid });
  try {
    const group = await Group.findById(gid).select('members isCircle messages lastMessage lastMessageText');
    if (!group) return;
    const msgText = 'Se cerro la Sala de Cine';
    group.messages.push({ text: msgText, type: 'system', sender: null });
    group.lastMessage     = new Date();
    group.lastMessageText = msgText;
    await group.save();
    const sysMsg = group.messages[group.messages.length - 1];
    _io?.to(`group:${gid}`).emit('group:message', { groupId: gid, message: sysMsg.toObject() });
  } catch (e) { console.error('stopCinemaForGroup error:', e.message); }
}

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
          type === 'gift'  ? 'Nuevo regalo disponible' :
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
          select: 'username avatarUrl profileFrame profileFrameUrl gender isCreator',
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

        for (const p of chat.participants) {
          if (p.toString() === socket.userId.toString()) continue;

          io.to(`user:${p}`).emit('chat:notification', {
            chatId,
            lastMessageText: chat.lastMessageText,
            lastMessage:     chat.lastMessage,
          });

          // No push si el receptor tiene este chat abierto ahora mismo
          const chatRoom = io.sockets.adapter.rooms.get(`chat:${chatId}`);
          const userRoom = io.sockets.adapter.rooms.get(`user:${p}`);
          const isActive = chatRoom && userRoom &&
            [...chatRoom].some(sid => userRoom.has(sid));
          if (isActive) continue; // ya ve el mensaje en tiempo real

          // Cooldown de 60s por (chatId, receptor) para no spamear en ráfagas
          const cooldownKey = `${chatId}:${p}`;
          const lastPush = pushCooldown.get(cooldownKey) || 0;
          const now = Date.now();
          if (now - lastPush < 60000) continue;
          pushCooldown.set(cooldownKey, now);

          const recipient = await User.findById(p).select('pushToken username').lean();
          const preview = type === 'image' ? '📷 Imagen' : type === 'audio' ? '🎤 Audio' : (text?.trim()?.slice(0, 60) || '');
          sendPush(recipient?.pushToken, `${populated.sender?.username || 'Mensaje'}`, preview, { type: 'chat', chatId: chatId.toString() });
        }
      } catch (err) {
        console.error('chat:send error:', err.message);
      }
    });

    socket.on('chat:typing', ({ chatId, isTyping }) => {
      socket.to(`chat:${chatId}`).emit('chat:typing', { userId: socket.userId, isTyping });
    });

    // ── Grupos ───────────────────────────────────────────────────────────────
    socket.on('group:join', ({ groupId }) => {
      socket.join(`group:${groupId}`);
      const session = cinemaActiveSessions.get(groupId.toString());
      if (session) socket.emit('circle:cinema:start', { groupId, videoId: session.videoId });
    });
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
          select: 'username avatarUrl profileFrame profileFrameUrl gender isCreator',
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

    // ── Sala de Cine (Fiestas) ───────────────────────────────────────────────
    socket.on('circle:cinema:start', async ({ groupId, videoId, startedBy }) => {
      try {
        if (!groupId || !videoId) return;
        const group = await Group.findById(groupId).select('members isCircle messages lastMessage lastMessageText');
        if (!group?.isCircle) return;
        const member = group.members.find(m => m.user.toString() === socket.userId.toString());
        if (!member || (member.role !== 'admin' && member.role !== 'co-admin')) return;
        io.to(`group:${groupId}`).emit('circle:cinema:start', { groupId, videoId, startedBy });
        cinemaActiveSessions.set(groupId.toString(), {
          videoId,
          startedAt:          Date.now(),
          proyectorId:        socket.userId.toString(),
          proyectorUsername:  startedBy,
        });
        const msgText = `${startedBy} inicio la Sala de Cine`;
        group.messages.push({ text: msgText, type: 'system', sender: null });
        group.lastMessage     = new Date();
        group.lastMessageText = msgText;
        await group.save();
        const sysMsg = group.messages[group.messages.length - 1];
        io.to(`group:${groupId}`).emit('group:message', { groupId, message: sysMsg.toObject() });
      } catch (e) { console.error('circle:cinema:start error:', e.message); }
    });

    socket.on('circle:cinema:sync', ({ groupId, action, currentTime }) => {
      if (!groupId || !action) return;
      const session = cinemaActiveSessions.get(groupId.toString());
      if (!session || session.proyectorId !== socket.userId.toString()) return;
      socket.to(`group:${groupId}`).emit('circle:cinema:sync', { groupId, action, currentTime: currentTime ?? 0 });
    });

    socket.on('circle:cinema:stop', async ({ groupId }) => {
      try {
        if (!groupId) return;
        const group = await Group.findById(groupId).select('members isCircle');
        if (!group?.isCircle) return;
        const member = group.members.find(m => m.user.toString() === socket.userId.toString());
        if (!member || (member.role !== 'admin' && member.role !== 'co-admin')) return;
        await stopCinemaForGroup(groupId);
      } catch (e) { console.error('circle:cinema:stop error:', e.message); }
    });

    socket.on('circle:cinema:proyector:leave', ({ groupId }) => {
      handleProyectorLeave(socket.userId, io, groupId);
    });

    // ── Meet de Texto ─────────────────────────────────────────────────────
    socket.on('meet:join_room', ({ roomId }) => {
      if (roomId) socket.join(`meet:${roomId}`);
    });

    socket.on('meet:message', ({ roomId, text }) => {
      if (!roomId || !text?.trim()) return;
      socket.to(`meet:${roomId}`).emit('meet:message', {
        id:        Date.now().toString(),
        text:      text.trim(),
        createdAt: new Date().toISOString(),
      });
    });

    socket.on('disconnect', () => {
      clearInterval(keepAlive);
      User.findByIdAndUpdate(socket.userId, { lastActive: new Date() }).catch(() => {});
      // Limpiar sesión meet si estaba activa
      MeetSession.findOneAndDelete({ user: socket.userId }).then(session => {
        if (session?.matchedWith) {
          io.to(`user:${session.matchedWith}`).emit('meet:partner-left', {});
          MeetSession.deleteOne({ user: session.matchedWith }).catch(() => {});
        }
      }).catch(() => {});
    });
  });
}

let _io = null;
function getIO() { return _io; }

module.exports = { initSockets, getIO, stopCinemaForGroup };
