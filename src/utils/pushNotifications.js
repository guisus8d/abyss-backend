const { Expo } = require('expo-server-sdk');
const expo = new Expo();

exports.sendPush = async (pushToken, title, body, data = {}) => {
  if (!pushToken) { console.log('[Push] Token vacío, omitiendo'); return; }
  if (!Expo.isExpoPushToken(pushToken)) { console.log('[Push] Token inválido:', pushToken); return; }

  console.log('[Push] Enviando →', { token: pushToken, title, body });
  try {
    const tickets = await expo.sendPushNotificationsAsync([{
      to:    pushToken,
      sound: 'default',
      title,
      body,
      data,
    }]);
    console.log('[Push] Ticket:', JSON.stringify(tickets[0]));
    if (tickets[0]?.status === 'error') {
      console.error('[Push] Error en ticket:', tickets[0].message, tickets[0].details);
    }
  } catch (e) {
    console.error('[Push] Error enviando:', e.message, e.details || '');
  }
};
