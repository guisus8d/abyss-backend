/**
 * seed_bots.js — crea 20 bots nuevos directamente en MongoDB.
 * Corre UNA vez en local: node backend/scripts/seed_bots.js
 * NO requiere push a Railway.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose  = require('mongoose');
const cloudinary = require('cloudinary').v2;
const fs        = require('fs');
const path      = require('path');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const PRESETS_DIR   = path.join(__dirname, '../../mobile/assets/profile-presets');
const CREDENTIALS   = path.join(__dirname, '../bots_credentials.txt');

// ── Definición de los 20 bots ────────────────────────────────────────────────
// Contraseñas únicas y seguras — también están en bots.js (misma lista)
const BOTS_SEED = [
  { username: 'camila_mv',    email: 'camila.mv@abbys.bot',    password: 'cMv#7xTq9!Ln3Z' },
  { username: 'rodrigo_vx',   email: 'rodrigo.vx@abbys.bot',   password: 'rVx$2kPm5@Bw8Y' },
  { username: 'valentina_ok', email: 'valentina.ok@abbys.bot', password: 'vOk!8nRs3#Jq1F' },
  { username: 'mateo_lz',     email: 'mateo.lz@abbys.bot',     password: 'mLz%6hYp1@Dt4C' },
  { username: 'daniela_rr',   email: 'daniela.rr@abbys.bot',   password: 'dRr#4cXw7!Fv2S' },
  { username: 'sebastian_fw', email: 'sebastian.fw@abbys.bot', password: 'sFw$9mZk2@Hb6T' },
  { username: 'lucia_bp',     email: 'lucia.bp@abbys.bot',     password: 'lBp!5tNq8#Gx0R' },
  { username: 'andres_tm',    email: 'andres.tm@abbys.bot',    password: 'aTm%3vWs6@Kj9D' },
  { username: 'isabella_cn',  email: 'isabella.cn@abbys.bot',  password: 'iCn#1xPr4!Mw7H' },
  { username: 'felipe_qr',    email: 'felipe.qr@abbys.bot',    password: 'fQr$7bYh9@Ls5E' },
  { username: 'mariana_js',   email: 'mariana.js@abbys.bot',   password: 'mJs!2nTv5#Rx3A' },
  { username: 'nicolas_hv',   email: 'nicolas.hv@abbys.bot',   password: 'nHv%8cZm3@Pk1W' },
  { username: 'sofia_dk',     email: 'sofia.dk@abbys.bot',     password: 'sDk#6qWb1!Yt4N' },
  { username: 'gabriel_pw',   email: 'gabriel.pw@abbys.bot',   password: 'gPw$4hXs7@Nf2Q' },
  { username: 'alejandra_nt', email: 'alejandra.nt@abbys.bot', password: 'aNt!9vKp2#Qm6L' },
  { username: 'emilio_yx',    email: 'emilio.yx@abbys.bot',    password: 'eYx%5tBr8@Jc0P' },
  { username: 'natalia_gc',   email: 'natalia.gc@abbys.bot',   password: 'nGc#3mLw6!Sv7U' },
  { username: 'jorge_ab',     email: 'jorge.ab@abbys.bot',     password: 'jAb$1xYq4@Th8V' },
  { username: 'paula_rf',     email: 'paula.rf@abbys.bot',     password: 'pRf!7nZs9#Bk2X' },
  { username: 'diego_sf',     email: 'diego.sf@abbys.bot',     password: 'dSf%2cPr5@Wx6M' },
];

async function uploadPresets() {
  console.log('☁️  Subiendo 8 presets a Cloudinary (una vez cada uno)...');
  const urls = {};
  for (let i = 1; i <= 8; i++) {
    const num  = String(i).padStart(2, '0');
    const file = path.join(PRESETS_DIR, `preset_avatar_${num}.png`);
    if (!fs.existsSync(file)) {
      console.warn(`  ⚠️  No encontré: ${file} — skipping`);
      continue;
    }
    const result = await cloudinary.uploader.upload(file, {
      folder:        'avatars/presets',
      public_id:     `preset_bot_${num}`,
      overwrite:     false,
      resource_type: 'image',
    });
    urls[i] = result.secure_url;
    console.log(`  ✅ preset_${num} → ${result.secure_url}`);
  }
  return urls;
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('🔌 MongoDB conectado');

  const User = require('../src/models/User');

  // Subir los 8 presets a Cloudinary
  const presetUrls = await uploadPresets();

  const lines   = ['username | email | password', '─'.repeat(60)];
  let   created = 0;
  let   skipped = 0;

  for (let idx = 0; idx < BOTS_SEED.length; idx++) {
    const { username, email, password } = BOTS_SEED[idx];

    const exists = await User.findOne({ $or: [{ username }, { email }] }).lean();
    if (exists) {
      console.log(`⏭  Existe: ${username}`);
      lines.push(`${username} | ${email} | ${password}  [ya existía]`);
      skipped++;
      continue;
    }

    // El pre-save hook de User hashea passwordHash automáticamente
    const presetNum = (idx % 8) + 1;
    const avatarUrl = presetUrls[presetNum] || null;

    await User.create({
      username,
      email,
      passwordHash: password,   // hook lo hashea
      avatarUrl,
      role:         'user',
      emailVerified: true,
    });

    console.log(`✅ Creado: ${username}  (preset_${String(presetNum).padStart(2, '0')})`);
    lines.push(`${username} | ${email} | ${password}`);
    created++;
  }

  // Guardar credenciales localmente
  fs.writeFileSync(CREDENTIALS, lines.join('\n') + '\n', 'utf8');
  console.log(`\n📄 Credenciales guardadas en: ${CREDENTIALS}`);
  console.log(`\n🎉 Listo — ${created} bots creados, ${skipped} ya existían.`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
