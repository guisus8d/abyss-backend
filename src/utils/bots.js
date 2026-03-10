const cron  = require('node-cron');
const axios = require('axios');

const BASE_URL = 'http://localhost:3000/api';

// Cuentas bot — se crean automáticamente si no existen
const BOTS = [
  { username: 'abbys_neural',  email: 'neural@abbys.bot',  password: 'b0tS3cur3!1', bio: 'IA flotando en el vacío digital 🧠' },
  { username: 'void_echo',     email: 'echo@abbys.bot',    password: 'b0tS3cur3!2', bio: 'Resonando desde el abismo 🌀' },
  { username: 'cypher_ghost',  email: 'cypher@abbys.bot',  password: 'b0tS3cur3!3', bio: 'Código y caos. #darkweb 👾' },
];

// Contenido temático cyberpunk/dark para los posts
const POST_POOL = [
  'El silencio digital pesa más que cualquier ruido. #abbys #darkvibes',
  'Vivimos en simulación y aun así duele. 💀 #existencial',
  'No todo el que brilla en pantalla está bien. #realidad #abbys',
  'El código no miente. La gente sí. #tech #thoughts',
  '3am pensamientos que no deberían existir 🌑 #noche',
  'Construyendo desde el vacío. Un bit a la vez. #builder #grind',
  'Si lees esto es que también estás despierto a horas inhumanas 👁️ #insomnia',
  'La conexión más rara es la que tienes contigo mismo. #introspección',
  'El futuro ya llegó, solo que no está bien distribuido. #cyberpunk',
  'Datos, emociones, ruido. Difícil distinguirlos. #digital #abbys',
  'Alguien más siente que internet es más real que afuera? 🕳️ #internetkid',
  'Sistema operativo: caos controlado. #life #tech',
  'No hay patch para las emociones rotas. #nochill #abbys',
  'Scrolleando el vacío existencial como siempre 🖤 #vibes',
  'La red nos conecta pero también nos aisla. Paradoja del siglo. #reflexión',
];

const COMMENTS_POOL = [
  'Esto me llegó directo 🖤',
  'Frío pero real.',
  'Exactamente lo que necesitaba leer.',
  'El abismo te devuelve la mirada 👁️',
  '💯 sin más palabras',
  'Alguien tiene que decirlo.',
  'Guardando esto para las 3am.',
  'Te entiendo más de lo que crees.',
];

// Estado en memoria de los tokens
const botTokens = {};

async function loginBot(bot) {
  try {
    const { data } = await axios.post(`${BASE_URL}/auth/login`, {
      email: bot.email, password: bot.password,
    });
    botTokens[bot.username] = data.token;
    return data.token;
  } catch {
    // Si no existe, registrar
    try {
      const { data } = await axios.post(`${BASE_URL}/auth/register`, {
        username: bot.username, email: bot.email, password: bot.password,
      });
      botTokens[bot.username] = data.token;
      console.log(`🤖 Bot creado: ${bot.username}`);
      return data.token;
    } catch (err) {
      console.error(`❌ Bot ${bot.username} falló:`, err.response?.data?.error);
      return null;
    }
  }
}

function authHeader(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Inicializar todos los bots
async function initBots() {
  console.log('🤖 Inicializando bots...');
  for (const bot of BOTS) {
    await loginBot(bot);
    await sleep(500);
  }
  console.log('✅ Bots listos:', Object.keys(botTokens).join(', '));
}

// Publicar un post con un bot aleatorio
async function botPost() {
  const bot   = randomItem(BOTS);
  const token = botTokens[bot.username] || await loginBot(bot);
  if (!token) return;

  const content = randomItem(POST_POOL);
  try {
    await axios.post(`${BASE_URL}/posts`, { content }, authHeader(token));
    console.log(`📝 [${bot.username}] publicó: ${content.slice(0, 40)}...`);
  } catch (err) {
    console.error(`❌ Post falló [${bot.username}]:`, err.response?.data?.error);
  }
}

// Reaccionar a posts recientes de usuarios reales
async function botReact() {
  const bot   = randomItem(BOTS);
  const token = botTokens[bot.username] || await loginBot(bot);
  if (!token) return;

  try {
    const { data } = await axios.get(`${BASE_URL}/posts?limit=10`, authHeader(token));
    const posts = data.posts.filter(p => !BOTS.some(b => b.username === p.author.username));
    if (!posts.length) return;

    const post = randomItem(posts);
    const type = Math.random() > 0.4 ? 'like' : 'fire';
    await axios.post(`${BASE_URL}/posts/${post._id}/react`, { type }, authHeader(token));
    console.log(`${type === 'like' ? '♥' : '🔥'} [${bot.username}] reaccionó al post de ${post.author.username}`);

    // 30% chance de comentar también
    if (Math.random() < 0.3) {
      const text = randomItem(COMMENTS_POOL);
      await axios.post(`${BASE_URL}/posts/${post._id}/comment`, { text }, authHeader(token));
      console.log(`💬 [${bot.username}] comentó: ${text}`);
    }
  } catch (err) {
    console.error(`❌ React falló [${bot.username}]:`, err.response?.data?.error);
  }
}

// Seguir a usuarios nuevos que los bots no siguen aún
async function botFollow() {
  const bot   = randomItem(BOTS);
  const token = botTokens[bot.username] || await loginBot(bot);
  if (!token) return;

  try {
    const { data } = await axios.get(`${BASE_URL}/posts?limit=20`, authHeader(token));
    const authors = [...new Set(
      data.posts
        .map(p => p.author)
        .filter(a => !BOTS.some(b => b.username === a.username))
    )];
    if (!authors.length) return;

    const target = randomItem(authors);
    await axios.post(`${BASE_URL}/social/${target._id}/follow`, {}, authHeader(token));
    console.log(`➕ [${bot.username}] siguió a ${target.username}`);
  } catch {
    // Ya sigue al usuario — silencioso
  }
}

// Arrancar todos los crons
function startBots() {
  initBots().then(() => {

    // Publicar cada hora en minuto aleatorio
    cron.schedule('0 * * * *', async () => {
      await botPost();
      await sleep(Math.random() * 5000);
      await botReact();
    });

    // Reaccionar cada 30 minutos
    cron.schedule('*/30 * * * *', botReact);

    // Seguir usuarios cada 2 horas
    cron.schedule('0 */2 * * *', botFollow);

    console.log('⏰ Crons de bots activos');

    // Acción inmediata al arrancar para poblar
    setTimeout(async () => {
      await botPost();
      await sleep(2000);
      await botReact();
      await sleep(2000);
      await botFollow();
    }, 5000);
  });
}

module.exports = { startBots };
