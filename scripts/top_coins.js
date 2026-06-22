/**
 * top_coins.js
 * Lista los TOP 10 usuarios por coins — solo lectura, no modifica nada.
 *
 * USO:
 *   node scripts/top_coins.js
 *   node scripts/top_coins.js --top 20   → ampliar a N resultados
 */

require('dotenv').config();
const mongoose = require('mongoose');

const TOP_N = (() => {
  const idx = process.argv.indexOf('--top');
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) || 10 : 10;
})();

async function main() {
  console.log('\n=== TOP USUARIOS POR COINS (solo lectura) ===\n');
  console.log('Conectando a MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado\n');

  const User        = require('../src/models/User');
  const Transaction = require('../src/models/Transaction');

  // Stats globales para calcular desviación
  const [stats] = await User.aggregate([
    { $match: { banned: false } },
    {
      $group: {
        _id:    null,
        media:  { $avg: '$coins' },
        total:  { $sum: 1 },
        maxCoins: { $max: '$coins' },
      },
    },
  ]);

  console.log(`Usuarios activos en DB: ${stats?.total ?? '?'}`);
  console.log(`Media de coins:         ${stats?.media?.toFixed(1) ?? '?'}`);
  console.log(`Máximo coins:           ${stats?.maxCoins ?? '?'}\n`);

  // Top N por coins
  const topUsers = await User.find({}, {
    username:  1,
    coins:     1,
    banned:    1,
    role:      1,
    createdAt: 1,
    _id:       1,
  })
    .sort({ coins: -1 })
    .limit(TOP_N)
    .lean();

  if (topUsers.length === 0) {
    console.log('No hay usuarios en la base de datos.');
    await mongoose.disconnect();
    return;
  }

  // Contar transacciones recibidas para cada uno en paralelo
  const txCounts = await Promise.all(
    topUsers.map(u =>
      Transaction.countDocuments({ receptor: u._id, estado: 'completada' })
    )
  );

  // Contar transacciones recibidas de cuentas fld (emisor ya eliminado → no aplica,
  // pero sí las que quedaron registradas antes del borrado)
  const fldPattern = /^fld\d+$/;
  const fldUsers   = await User.find({ username: { $regex: fldPattern } }, { _id: 1 }).lean();
  const fldIds     = fldUsers.map(u => u._id);

  const fldTxCounts = await Promise.all(
    topUsers.map(u =>
      fldIds.length > 0
        ? Transaction.countDocuments({ receptor: u._id, emisor: { $in: fldIds }, estado: 'completada' })
        : Promise.resolve(0)
    )
  );

  // Mostrar tabla
  const header = [
    '#'.padStart(2),
    'username'.padEnd(22),
    'coins'.padStart(8),
    'de fld'.padStart(7),
    'txs recibidas'.padStart(14),
    'rol'.padEnd(12),
    'creado'.padEnd(12),
    'baneado',
  ].join('  ');

  console.log(header);
  console.log('─'.repeat(header.length));

  topUsers.forEach((u, i) => {
    const creado   = u.createdAt ? u.createdAt.toISOString().slice(0, 10) : '—';
    const fldFlag  = fldTxCounts[i] > 0 ? `⚠️ ${fldTxCounts[i]}` : '—';
    const banFlag  = u.banned ? '🚫 SÍ' : 'no';
    const coinsStr = u.coins.toLocaleString('es-MX').padStart(8);

    const row = [
      String(i + 1).padStart(2),
      `@${u.username}`.padEnd(22),
      coinsStr,
      fldFlag.padStart(7),
      String(txCounts[i]).padStart(14),
      (u.role ?? 'user').padEnd(12),
      creado.padEnd(12),
      banFlag,
    ].join('  ');

    console.log(row);
  });

  if (fldIds.length === 0) {
    console.log('\n  (No quedan cuentas fld en DB — columna "de fld" siempre será —)');
  }

  console.log(`\nTop ${TOP_N} mostrado. Para ampliar: node scripts/top_coins.js --top 20\n`);

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
