const { createClient } = require('redis');

let client;

async function connectRedis() {
  client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => console.error('Redis error:', err));
  await client.connect();
  console.log('✅ Redis conectado');
}

function getRedis() { return client; }

module.exports = { connectRedis, getRedis };
