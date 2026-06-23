/**
 * ban_fake_accounts.js
 * Elimina completamente cuentas fake que coincidan con cualquiera de los
 * patrones definidos en FAKE_PATTERNS.
 * Corre en tu máquina, se conecta directamente a MongoDB.
 *
 * USO:
 *   node scripts/ban_fake_accounts.js           → preview sin modificar nada
 *   node scripts/ban_fake_accounts.js --confirm → pide YES y ejecuta
 */

require('dotenv').config();
const mongoose = require('mongoose');
const readline = require('readline');

// field: campo de User sobre el que se aplica el regex (default 'username')
// field: campo de User sobre el que se aplica el regex (default 'username')
// field: campo de User sobre el que se aplica el regex (default 'username')
const FAKE_PATTERNS = [
  { label: 'fld+dígitos',       field: 'username', regex: /^fld\d+$/           },
  { label: 'flood+dígitos',     field: 'username', regex: /^flood\d+$/          },
  { label: 'teste+dígitos',     field: 'username', regex: /^teste\d+$/          },
  { label: 'p+dígitos',         field: 'username', regex: /^p\d+$/              },
  { label: 'n+dígitos',         field: 'username', regex: /^n\d+$/              },
  { label: 'abyss+dígitos',     field: 'username', regex: /^abyss\d+$/          },
  { label: 'gold+dígitos',      field: 'username', regex: /^gold\d+$/           },
  { label: 'farm+dígitos',      field: 'username', regex: /^farm\d+$/           },
  { label: 'x+dígitos',         field: 'username', regex: /^x\d+$/              },
  { label: 'conta+dígitos',     field: 'username', regex: /^conta\d+$/          },
  { label: 'email @tmp.xyz',    field: 'email',    regex: /@tmp\.xyz$/i         },
  { label: 'email p####@gmail', field: 'email',    regex: /^p\d+@gmail\.com$/i  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

function step(msg) {
  process.stdout.write(`  ${msg}… `);
}
function ok(n) {
  console.log(typeof n === 'number' ? `${n} docs` : 'ok');
}

async function askYes(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve, reject) => {
    rl.question(question, ans => {
      rl.close();
      ans.trim() === 'YES' ? resolve() : reject(new Error('cancelled'));
    });
  });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const confirmed = process.argv.includes('--confirm');

  console.log('\n=== ELIMINACIÓN MASIVA: cuentas fake (múltiples patrones) ===\n');
  console.log('Conectando a MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado\n');

  const User           = require('../src/models/User');
  const Post           = require('../src/models/Post');
  const Notification   = require('../src/models/Notification');
  const FrameOwnership = require('../src/models/FrameOwnership');

  // ── FASE 1: contar por patrón y en total ─────────────────────────────────────

  // Conteo individual por patrón para el resumen
  const perPattern = await Promise.all(
    FAKE_PATTERNS.map(async ({ label, field, regex }) => {
      const users = await User.find(
        { [field]: { $regex: regex } },
        { _id: 1, username: 1, email: 1, coins: 1, banned: 1 }
      ).lean();
      return { label, field, regex, users };
    })
  );

  // Deduplicar por _id (un username no debería matchear dos patrones, pero por si acaso)
  const seen     = new Set();
  const allFake  = [];
  for (const { users } of perPattern) {
    for (const u of users) {
      const id = u._id.toString();
      if (!seen.has(id)) { seen.add(id); allFake.push(u); }
    }
  }

  const fakeIds = allFake.map(u => u._id);
  const total   = allFake.length;

  // Resumen por patrón
  console.log('Conteo por patrón:');
  for (const { label, field, regex, users } of perPattern) {
    const fieldTag = field !== 'username' ? ` [campo: ${field}]` : '';
    console.log(`  /${regex.source}/${fieldTag}  (${label})  →  ${users.length} cuentas`);
  }
  console.log(`  ${'TOTAL'.padEnd(38)}  →  ${total} cuentas`);

  if (total === 0) {
    console.log('\nNada que hacer. Saliendo.');
    await mongoose.disconnect();
    return;
  }

  // Impacto en otras colecciones
  const [postCount, commentCount, reactionCount, notifCount, frameCount] = await Promise.all([
    Post.countDocuments({ author: { $in: fakeIds } }),
    Post.countDocuments({ 'comments.user': { $in: fakeIds } }),
    Post.countDocuments({ 'reactions.user': { $in: fakeIds } }),
    Notification.countDocuments({ $or: [{ from: { $in: fakeIds } }, { to: { $in: fakeIds } }] }),
    FrameOwnership.countDocuments({ user: { $in: fakeIds } }),
  ]);

  console.log('\nImpacto en otras colecciones:');
  console.log(`  Posts propios a eliminar:              ${postCount}`);
  console.log(`  Posts ajenos con comentarios suyos:   ${commentCount}`);
  console.log(`  Posts ajenos con reacciones suyas:    ${reactionCount}  ← también se limpian`);
  console.log(`  Notificaciones a eliminar:             ${notifCount}`);
  console.log(`  FrameOwnerships a eliminar:            ${frameCount}`);

  // Muestra las primeras 10 de cada patrón
  console.log('\nMuestra (primeras 5 por patrón):');
  for (const { label, field, regex, users } of perPattern) {
    if (users.length === 0) { console.log(`  [${label}] — ninguna`); continue; }
    console.log(`  [${label}]`);
    users.slice(0, 5).forEach(u => {
      const identifier = field === 'email'
        ? `@${u.username} <${u.email}>`.padEnd(40)
        : `@${u.username}`.padEnd(22);
      console.log(`    ${identifier}  coins=${u.coins}  banned=${u.banned}`);
    });
    if (users.length > 5) console.log(`    … y ${users.length - 5} más`);
  }

  if (!confirmed) {
    console.log('\n⚠️  MODO PREVIEW — no se ha modificado nada.');
    console.log('Para ejecutar la eliminación real, corre:');
    console.log('  node scripts/ban_fake_accounts.js --confirm\n');
    await mongoose.disconnect();
    return;
  }

  // ── FASE 2: confirmación interactiva ────────────────────────────────────────

  await askYes(
    `\n⚠️  ¿Confirmas ELIMINAR PERMANENTEMENTE ${total} usuarios y todos sus datos?\n` +
    `Escribe YES (en mayúsculas) para continuar: `
  );

  console.log('\nEjecutando…\n');

  // Paso 1: posts propios
  step('1/5  Eliminando posts de las cuentas fake');
  const r1 = await Post.deleteMany({ author: { $in: fakeIds } });
  ok(r1.deletedCount);

  // Paso 2a: comentarios embebidos en posts de otros
  step('2a/5 Eliminando sus comentarios en posts ajenos');
  const r2a = await Post.updateMany(
    { 'comments.user': { $in: fakeIds } },
    { $pull: { comments: { user: { $in: fakeIds } } } }
  );
  ok(r2a.modifiedCount);

  // Paso 2b: reacciones embebidas en posts de otros
  step('2b/5 Eliminando sus reacciones en posts ajenos');
  const r2b = await Post.updateMany(
    { 'reactions.user': { $in: fakeIds } },
    { $pull: { reactions: { user: { $in: fakeIds } } } }
  );
  ok(r2b.modifiedCount);

  // Paso 3: notificaciones (from o to)
  step('3/5  Eliminando notificaciones');
  const r3 = await Notification.deleteMany({
    $or: [{ from: { $in: fakeIds } }, { to: { $in: fakeIds } }],
  });
  ok(r3.deletedCount);

  // Paso 4: FrameOwnership
  step('4/5  Eliminando FrameOwnerships');
  const r4 = await FrameOwnership.deleteMany({ user: { $in: fakeIds } });
  ok(r4.deletedCount);

  // Paso 5: usuarios
  step('5/5  Eliminando usuarios');
  const r5 = await User.deleteMany({ _id: { $in: fakeIds } });
  ok(r5.deletedCount);

  // ── resumen final ─────────────────────────────────────────────────────────────

  console.log('\n✅ Eliminación completada:');
  console.log(`   Usuarios eliminados:                           ${r5.deletedCount}`);
  console.log(`   Posts eliminados:                              ${r1.deletedCount}`);
  console.log(`   Posts actualizados (comentarios/reacciones):   ${Math.max(r2a.modifiedCount, r2b.modifiedCount)}`);
  console.log(`   Notificaciones eliminadas:                     ${r3.deletedCount}`);
  console.log(`   FrameOwnerships eliminados:                    ${r4.deletedCount}`);

  await mongoose.disconnect();
  console.log('\nDesconectado de MongoDB.\n');
}

main().catch(err => {
  if (err.message === 'cancelled') {
    console.log('\nCancelado. No se modificó nada.\n');
    process.exit(0);
  }
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
