const cron         = require('node-cron');
const Group        = require('../models/Group');
const User         = require('../models/User');
const Notification = require('../models/Notification');
const { sendPush } = require('./pushNotifications');

function getIO() {
  try { return require('../sockets').getIO(); } catch { return null; }
}

async function apagarFiestasExpiradas() {
  const limite = new Date(Date.now() - 3_600_000); // 1 hora

  const fiestas = await Group.find({
    isCircle:    true,
    isActive:    true,
    activatedAt: { $lt: limite },
  }).select('_id name imageUrl creator members');

  if (!fiestas.length) return;
  console.log(`[circleCron] Apagando ${fiestas.length} fiesta(s) expirada(s)`);

  for (const circle of fiestas) {
    circle.isActive    = false;
    circle.activatedAt = null;
    await circle.save();

    getIO()?.to(`group:${circle._id}`).emit('circle:deactivated', {
      groupId: circle._id.toString(),
    });

    const responsables = circle.members.filter(
      m => m.role === 'admin' || m.role === 'co-admin'
    );

    for (const m of responsables) {
      const uid        = m.user.toString();
      const targetUser = await User.findById(uid).select('pushToken').lean();

      await Notification.create({
        to:            uid,
        from:          circle.creator,
        type:          'circle_deactivated',
        groupId:       circle._id,
        groupName:     circle.name,
        groupImageUrl: circle.imageUrl || null,
        text:          `Tu fiesta "${circle.name}" se apago automaticamente despues de 1 hora.`,
      }).catch(err => console.error(`[circleCron] Notif error (${uid}):`, err.message));

      if (targetUser?.pushToken) {
        sendPush(
          targetUser.pushToken,
          'Fiesta apagada',
          `"${circle.name}" se apago automaticamente.`,
          { type: 'circle_deactivated', groupId: circle._id.toString() }
        );
      }
    }

    console.log(`[circleCron] Fiesta "${circle.name}" (${circle._id}) apagada`);
  }
}

function startCircleCron() {
  cron.schedule('*/5 * * * *', () => {
    apagarFiestasExpiradas().catch(err =>
      console.error('[circleCron] Error:', err.message)
    );
  });
  console.log('[circleCron] Cron de apagado activo (cada 5 min, ventana 1 hora)');
}

module.exports = { startCircleCron, apagarFiestasExpiradas };
