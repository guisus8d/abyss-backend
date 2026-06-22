/**
 * ban_anjometraton.js
 * Zerear coins y banear @anjometraton.
 *
 * USO:
 *   node scripts/ban_anjometraton.js           → preview sin modificar nada
 *   node scripts/ban_anjometraton.js --confirm → pide YES y ejecuta
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

const TARGET_USERNAME = 'anjometraton';
const BAN_REASON      = 'Receptor de transferencias fraudulentas masivas';

async function askYes(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(question, ans => {
      rl.close();
      ans.trim() === 'YES' ? resolve() : reject(new Error('cancelled'));
    });
  });
}

async function main() {
  const confirmed = process.argv.includes('--confirm');

  console.log(`\n=== BAN + ZEREAR COINS: @${TARGET_USERNAME} ===\n`);
  console.log('Conectando a MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado\n');

  const User = require('../src/models/User');

  const user = await User.findOne({ username: TARGET_USERNAME }, {
    username: 1, coins: 1, coinsReservadas: 1, banned: 1, bannedReason: 1, role: 1, createdAt: 1,
  }).lean();

  if (!user) {
    console.log(`❌ Usuario @${TARGET_USERNAME} no encontrado en la base de datos.`);
    await mongoose.disconnect();
    return;
  }

  console.log('Usuario encontrado:');
  console.log(`  username:        @${user.username}`);
  console.log(`  rol:             ${user.role}`);
  console.log(`  coins actuales:  ${user.coins}`);
  console.log(`  coinsReservadas: ${user.coinsReservadas}`);
  console.log(`  banned:          ${user.banned}`);
  console.log(`  bannedReason:    ${user.bannedReason || '—'}`);
  console.log(`  createdAt:       ${user.createdAt?.toISOString().slice(0, 10)}`);

  console.log('\nCambios a aplicar:');
  console.log(`  coins           ${user.coins} → 0`);
  console.log(`  coinsReservadas ${user.coinsReservadas} → 0`);
  console.log(`  banned          ${user.banned} → true`);
  console.log(`  bannedReason    → "${BAN_REASON}"`);

  if (!confirmed) {
    console.log('\n⚠️  MODO PREVIEW — no se ha modificado nada.');
    console.log('Para ejecutar, corre:');
    console.log(`  node scripts/ban_anjometraton.js --confirm\n`);
    await mongoose.disconnect();
    return;
  }

  await askYes(
    `\n⚠️  ¿Confirmas zerear coins y banear @${TARGET_USERNAME}?\n` +
    `Escribe YES (en mayúsculas) para continuar: `
  );

  const result = await User.updateOne(
    { _id: user._id },
    {
      $set: {
        coins:           0,
        coinsReservadas: 0,
        banned:          true,
        bannedReason:    BAN_REASON,
      },
    }
  );

  if (result.modifiedCount === 1) {
    console.log(`\n✅ @${TARGET_USERNAME} baneada y coins zereados.`);
  } else {
    console.log('\n⚠️  No se modificó ningún documento (¿ya estaba en ese estado?).');
  }

  await mongoose.disconnect();
  console.log('Desconectado de MongoDB.\n');
}

main().catch(err => {
  if (err.message === 'cancelled') {
    console.log('\nCancelado. No se modificó nada.\n');
    process.exit(0);
  }
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
