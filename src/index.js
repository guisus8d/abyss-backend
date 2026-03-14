require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('mongo-sanitize');
const { connectDB } = require('./config/db');
const { connectRedis } = require('./config/redis');
const { initSockets } = require('./sockets');
const routes = require('./routes');

const app = express();
const server = http.createServer(app);

// ── Seguridad básica ──────────────────────────
app.use(helmet());
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '20mb' })); // limitar tamaño body

// ── Sanitizar inputs MongoDB ──────────────────
app.use((req, res, next) => {
  req.body = mongoSanitize(req.body);
  req.query = mongoSanitize(req.query);
  next();
});

// ── Trust proxy (Railway) ───────────────────
app.set('trust proxy', 1);
// ── Rate limit global: 100 req / 15min por IP ─
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas peticiones, espera un momento' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', globalLimiter);

// ── Rate limit estricto para auth ─────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos, espera 15 minutos' },
});
app.use('/api/auth', authLimiter);

// ── Rutas ─────────────────────────────────────
app.use('/api', routes);
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// ── Error handler global ──────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

const { seedBadges } = require("./utils/seedBadges");

async function start() {
  await connectDB();
  await connectRedis();
  await seedBadges();
  initSockets(server);
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`\n🚀 Backend en http://localhost:${PORT}`);
    console.log(`🔒 Seguridad: helmet + rate limit + sanitización\n`);
  });
}

start().catch(console.error);

// Bots de actividad
const { startBots } = require('./utils/bots');
startBots();
