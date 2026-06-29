const router       = require('express').Router();
const { authMiddleware } = require('../middlewares/auth');
const MeetSession  = require('../models/MeetSession');
const Chat         = require('../models/Chat');
const User         = require('../models/User');
const { getIO }    = require('../sockets');

function mapGender(g) {
  if (g === 'hombre') return 'male';
  if (g === 'mujer')  return 'female';
  return 'other';
}

async function cleanupSession(session, io) {
  if (!session) return;
  if (session.matchedWith) {
    io.to(`user:${session.matchedWith}`).emit('meet:partner-left', {});
    await MeetSession.deleteOne({ user: session.matchedWith });
  }
  await MeetSession.deleteOne({ user: session.user });
}

// ── POST /meet/text/join ────────────────────────────────────────────────────
router.post('/text/join', authMiddleware, async (req, res) => {
  try {
    const userId      = req.user._id;
    const { genderPreference = 'any' } = req.body;
    const io = getIO();

    // Limpiar sesión previa si existe
    const existing = await MeetSession.findOne({ user: userId });
    if (existing) await cleanupSession(existing, io);

    // Obtener género y perfil del usuario
    const me         = await User.findById(userId).select('gender avatarUrl username profileFrame profileFrameUrl').lean();
    const userGender = mapGender(me?.gender);

    // Buscar sesión compatible en waiting
    const prefFilter = genderPreference === 'any' ? {} : { userGender: genderPreference };
    const match = await MeetSession.findOne({
      status:           'waiting',
      user:             { $ne: userId },
      $or: [{ genderPreference: 'any' }, { genderPreference: userGender }],
      ...prefFilter,
    });

    if (match) {
      const roomId    = `meet_${Date.now()}_${userId}`;
      const startedAt = new Date();

      await MeetSession.updateOne(
        { _id: match._id },
        { $set: { status: 'chatting', matchedWith: userId, roomId, startedAt } },
      );

      // Crear sesión propia ya emparejada
      await MeetSession.create({
        user: userId, userGender, genderPreference,
        status: 'chatting', matchedWith: match.user, roomId, startedAt,
      });

      // Perfil del partner para cada lado
      const matchUser = await User.findById(match.user).select('username avatarUrl profileFrame profileFrameUrl').lean();

      const partnerForJoiner = {
        _id:             matchUser?._id             || match.user,
        avatarUrl:       matchUser?.avatarUrl       || null,
        username:        matchUser?.username         || 'Usuario',
        profileFrame:    matchUser?.profileFrame     || null,
        profileFrameUrl: matchUser?.profileFrameUrl  || null,
      };
      const partnerForWaiter = {
        _id:             me?._id             || userId,
        avatarUrl:       me?.avatarUrl       || null,
        username:        me?.username         || 'Usuario',
        profileFrame:    me?.profileFrame     || null,
        profileFrameUrl: me?.profileFrameUrl  || null,
      };

      // Notificar al usuario en espera (su partner es el que acaba de hacer join = me)
      io.to(`user:${match.user}`).emit('meet:matched', { roomId, startedAt, partner: partnerForWaiter });

      // HTTP response al que hizo join (su partner es el que estaba esperando = matchUser)
      return res.json({ matched: true, roomId, startedAt, partner: partnerForJoiner });
    }

    // Sin match → poner en espera
    await MeetSession.create({ user: userId, userGender, genderPreference });
    res.json({ matched: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /meet/text/leave ───────────────────────────────────────────────────
router.post('/text/leave', authMiddleware, async (req, res) => {
  try {
    const session = await MeetSession.findOne({ user: req.user._id });
    if (session) await cleanupSession(session, getIO());
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /meet/text/match-decision ─────────────────────────────────────────
router.post('/text/match-decision', authMiddleware, async (req, res) => {
  try {
    const userId  = req.user._id;
    const { accept } = req.body;
    const io = getIO();

    const mySession = await MeetSession.findOneAndUpdate(
      { user: userId, status: { $in: ['chatting', 'deciding'] } },
      { $set: { matchAccepted: Boolean(accept), status: 'deciding' } },
      { new: true },
    );
    if (!mySession) return res.status(404).json({ error: 'Sesion no encontrada' });

    if (!accept) {
      io.to(`user:${userId}`).emit('meet:match-rejected', {});
      io.to(`user:${mySession.matchedWith}`).emit('meet:match-rejected', {});
      await MeetSession.deleteMany({ user: { $in: [userId, mySession.matchedWith] } });
      return res.json({ ok: true });
    }

    // accept=true → comprobar si el partner también aceptó (atómico: lo borramos nosotros o ellos)
    const partnerDeleted = await MeetSession.findOneAndDelete({
      user:          mySession.matchedWith,
      matchAccepted: true,
    });

    if (partnerDeleted) {
      // Ambos aceptaron — nosotros ganamos la carrera → crear chat (o reutilizar si ya existe)
      await MeetSession.deleteOne({ user: userId });
      const [existing, userA, userB] = await Promise.all([
        Chat.findOne({ participants: { $all: [userId, mySession.matchedWith], $size: 2 } }),
        User.findById(userId).select('username avatarUrl profileFrame profileFrameUrl').lean(),
        User.findById(mySession.matchedWith).select('username avatarUrl profileFrame profileFrameUrl').lean(),
      ]);
      const chat = existing || await Chat.create({ participants: [userId, mySession.matchedWith], lastMessageText: '' });
      const partnerForA = {
        _id:             userB?._id             || mySession.matchedWith,
        avatarUrl:       userB?.avatarUrl       || null,
        username:        userB?.username         || 'Usuario',
        profileFrame:    userB?.profileFrame     || null,
        profileFrameUrl: userB?.profileFrameUrl  || null,
      };
      const partnerForB = {
        _id:             userA?._id             || userId,
        avatarUrl:       userA?.avatarUrl       || null,
        username:        userA?.username         || 'Usuario',
        profileFrame:    userA?.profileFrame     || null,
        profileFrameUrl: userA?.profileFrameUrl  || null,
      };
      io.to(`user:${userId}`).emit('meet:match-accepted',               { chatId: chat._id, partner: partnerForA });
      io.to(`user:${mySession.matchedWith}`).emit('meet:match-accepted', { chatId: chat._id, partner: partnerForB });
      return res.json({ chatId: chat._id, partner: partnerForA });
    }

    // Partner aún no decidió
    res.json({ waiting: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /meet/text/waiting-count ────────────────────────────────────────────
router.get('/text/waiting-count', async (req, res) => {
  try {
    const count = await MeetSession.countDocuments({ status: 'waiting' });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
