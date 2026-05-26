const { createClient } = require('redis');

let client;

async function connectRedis() {
  if (!process.env.REDIS_URL || process.env.REDIS_URL.includes('localhost')) {
    console.log('⚠️  Redis omitido (no configurado)');
    return;
  }
  try {
    client = createClient({ url: process.env.REDIS_URL });
    client.on('error', (err) => console.error('Redis error:', err.message));
    await client.connect();
    console.log('✅ Redis conectado');
  } catch (err) {
    console.warn('⚠️  Redis no disponible:', err.message);
  }
}

function getRedis() { return client; }

module.exports = { connectRedis, getRedis };
