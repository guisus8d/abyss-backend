const cron  = require('node-cron');
const axios = require('axios');

const BASE_URL = process.env.API_URL || 'http://localhost:3000/api';

const BOTS = [
  {
    username: 'abbys_neural',
    email:    'neural@abbys.bot',
    password: 'b0tS3cur3!1',
    personality: 'introspective', // piensa mucho, escribe poco
  },
  {
    username: 'void_echo',
    email:    'echo@abbys.bot',
    password: 'b0tS3cur3!2',
    personality: 'chaotic', // escribe cosas random a horas raras
  },
  {
    username: 'cypher_ghost',
    email:    'cypher@abbys.bot',
    password: 'b0tS3cur3!3',
    personality: 'social', // comenta y reacciona más que postea
  },
];

// Posts por personalidad — más largos, más humanos, con typos ocasionales
const POSTS = {
  introspective: [
    'a veces abro la app sin saber qué busco. supongo que todos hacemos eso',
    'hay algo raro en cómo la luz de la pantalla te hace sentir menos solo a las 2am',
    'llevo días pensando en algo que alguien dijo y ya ni recuerdo quién era la persona',
    'el problema de pensar demasiado es que te convences de cosas que no existen',
    'me gusta cuando la música encaja exactamente con lo que estás sintiendo. raro pero real',
    'algunas cosas solo tienen sentido cuando ya pasaron. en el momento solo duelen',
    'hay gente que entra a tu vida y la reorganiza sin pedirte permiso',
    'no sé si crecer significa entender más o simplemente aceptar que no entiendes nada',
    'escribir esto me hace sentir que alguien lo va a leer aunque sea en 3 años',
    'el silencio también dice cosas. a veces dice demasiado',
  ],
  chaotic: [
    'oigan por qué nadie habla de lo bueno que está el aire cuando llueve??? literalmente gratuito',
    'acabo de ver algo tan raro que no tengo palabras. la vida es una simulación confirmado',
    'me desperté pensando en los delfines. sin razón. solo pasó',
    'si alguien sabe cómo dejar de pensar en cosas a las 3am avíseme gracias',
    'hoy el universo me mandó una señal y era un semáforo en rojo. clásico',
    'random pero necesito que alguien me diga que no soy el único que hace esto',
    'hay canciones que solo puedes escuchar en la oscuridad. no sé por qué pero es así',
    'acabo de terminar algo y no sé si reír o llorar. ambas opciones aplican',
    'el caos tiene su propio orden si lo miras suficiente tiempo',
    'someone told me to touch grass. i did. still weird. 10/10 would recommend',
  ],
  social: [
    'leyendo todo lo que postean aquí y de verdad hay gente con mucho que decir 👀',
    'por qué cuando alguien te pregunta cómo estás de verdad no sabes qué responder',
    'me gusta esta app. siente diferente a las otras. menos performance más honestidad',
    'alguien más usa esto para procesar cosas o solo yo soy así de raro',
    'hay posts aquí que me han hecho pensar más que libros enteros. en serio',
    'vine a postear algo importante y se me olvidó. típico. buenas noches a todos',
    'qué difícil es ser honesto en internet sin que se malinterprete todo',
    'a veces solo quiero que alguien diga "también me pasa" y ya',
  ],
};

const COMMENTS = {
  introspective: [
    'esto me hizo pensar en algo que no quería recordar hoy',
    'qué manera de describirlo exactamente como es',
    'ojalá pudiera escribir lo que pienso así de claro',
    'guardé esto. gracias por postearlo',
    'hay mucho aquí entre líneas',
    'no sé por qué pero esto me llegó',
  ],
  chaotic: [
    'ESTO. exactamente esto.',
    'bro cómo sabías',
    'ok esto me lo quedo',
    'alguien necesitaba decirlo y ese alguien eras tú',
    'me reí pero también me dolió un poco jajaja',
    'esto debería tener más likes de los que tiene',
  ],
  social: [
    'gracias por compartir esto de verdad',
    'me alegra saber que alguien más lo siente',
    'te entiendo más de lo que crees',
    'oye esto está muy bueno, de verdad',
    'me quedé pensando en esto un rato',
    'necesitaba leer esto hoy específicamente',
  ],
};

const botTokens = {};

async function loginBot(bot) {
  try {
    const { data } = await axios.post(`${BASE_URL}/auth/login`, {
      email: bot.email, password: bot.password,
    });
    botTokens[bot.username] = data.token;
    return data.token;
  } catch {
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

function auth(token) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Delay humano — entre min y max segundos
function humanDelay(minSec = 2, maxSec = 12) {
  const ms = (minSec + Math.random() * (maxSec - minSec)) * 1000;
  return new Promise(r => setTimeout(r, ms));
}

// Solo actuar en horarios "humanos" (8am - 1am)
function isHumanHour() {
  const h = new Date().getHours();
  return h >= 8 || h <= 1;
}

async function initBots() {
  console.log('🤖 Inicializando bots...');
  for (const bot of BOTS) {
    await loginBot(bot);
    await humanDelay(0.5, 1.5);
  }
  console.log('✅ Bots listos:', Object.keys(botTokens).join(', '));
}

async function botPost() {
  if (!isHumanHour()) return;

  const bot   = pick(BOTS);
  const token = botTokens[bot.username] || await loginBot(bot);
  if (!token) return;

  // 20% chance de no postear nada (como haría un humano)
  if (Math.random() < 0.2) return;

  const pool    = POSTS[bot.personality];
  const content = pick(pool);

  await humanDelay(3, 20); // piensa antes de postear

  try {
    await axios.post(`${BASE_URL}/posts`, { content }, auth(token));
    console.log(`📝 [${bot.username}] publicó`);
  } catch (err) {
    if (err.response?.status !== 429) {
      console.error(`❌ Post falló [${bot.username}]:`, err.response?.data?.error);
    }
  }
}

async function botReact() {
  if (!isHumanHour()) return;

  // Solo 1-2 bots reaccionan por ciclo, no todos
  const activeBots = BOTS.filter(() => Math.random() > 0.4);
  if (!activeBots.length) return;

  for (const bot of activeBots) {
    const token = botTokens[bot.username] || await loginBot(bot);
    if (!token) continue;

    try {
      const { data } = await axios.get(`${BASE_URL}/posts?limit=15`, auth(token));
      const posts = data.posts.filter(p => !BOTS.some(b => b.username === p.author?.username));
      if (!posts.length) continue;

      // Solo reaccionar a 1-3 posts por ciclo
      const count = Math.floor(Math.random() * 3) + 1;
      const targets = posts.sort(() => Math.random() - 0.5).slice(0, count);

      for (const post of targets) {
        await humanDelay(5, 30); // lee antes de reaccionar

        const emojis = ['like', '🔥', '😮', '💀', '🥰', '😂'];
        const weights = [0.5, 0.2, 0.1, 0.08, 0.07, 0.05];
        let r = Math.random(), type = 'like';
        let acc = 0;
        for (let i = 0; i < weights.length; i++) {
          acc += weights[i];
          if (r < acc) { type = emojis[i]; break; }
        }

        await axios.post(`${BASE_URL}/posts/${post._id}/react`, { type }, auth(token)).catch(() => {});

        // Comentar con probabilidad según personalidad
        const commentChance = bot.personality === 'social' ? 0.5 : bot.personality === 'chaotic' ? 0.3 : 0.2;
        if (Math.random() < commentChance) {
          await humanDelay(8, 40); // piensa el comentario
          const text = pick(COMMENTS[bot.personality]);
          await axios.post(`${BASE_URL}/posts/${post._id}/comment`, { text }, auth(token)).catch(() => {});
          console.log(`💬 [${bot.username}] comentó en post de ${post.author?.username}`);
        }
      }
    } catch (err) {
      if (err.response?.status !== 429) {
        console.error(`❌ React falló [${bot.username}]:`, err.response?.data?.error);
      }
    }

    await humanDelay(10, 60); // pausa entre bots
  }
}

async function botFollow() {
  const bot   = pick(BOTS);
  const token = botTokens[bot.username] || await loginBot(bot);
  if (!token) return;

  try {
    const { data } = await axios.get(`${BASE_URL}/posts?limit=20`, auth(token));
    const authors = [...new Map(
      data.posts
        .map(p => p.author)
        .filter(a => a && !BOTS.some(b => b.username === a.username))
        .map(a => [a._id, a])
    ).values()];

    if (!authors.length) return;

    // Seguir solo 1 usuario por ciclo
    const target = pick(authors);
    await humanDelay(5, 15);
    await axios.post(`${BASE_URL}/social/follow/${target.username}`, {}, auth(token)).catch(() => {});
    console.log(`➕ [${bot.username}] siguió a ${target.username}`);
  } catch { /* ya lo sigue */ }
}

function startBots() {
  initBots().then(() => {

    // Postear 2-4 veces al día en horas variables
    cron.schedule('0 9,13,18,22 * * *', async () => {
      if (Math.random() > 0.4) await botPost(); // no siempre postean
    });

    // Reaccionar cada 45 minutos en horas humanas
    cron.schedule('*/45 * * * *', botReact);

    // Seguir usuarios una vez al día
    cron.schedule('0 11 * * *', botFollow);

    console.log('⏰ Crons de bots activos');

    // Al arrancar: reaccionar a lo que hay (con delay humano)
    setTimeout(async () => {
      await botReact();
      await humanDelay(30, 90);
      await botPost();
      await humanDelay(20, 60);
      await botFollow();
    }, 8000);
  });
}

module.exports = { startBots };
