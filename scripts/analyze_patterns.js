/**
 * analyze_patterns.js
 * Detecta automáticamente patrones sospechosos en usernames de la BD.
 * Solo lectura — no modifica nada.
 *
 * USO:
 *   node scripts/analyze_patterns.js
 *   node scripts/analyze_patterns.js --top 20   → más resultados
 *   node scripts/analyze_patterns.js --all       → incluye usuarios con pocas coincidencias
 */

require('dotenv').config();
const mongoose = require('mongoose');

const TOP_N    = (() => { const i = process.argv.indexOf('--top'); return i !== -1 ? parseInt(process.argv[i+1],10)||10 : 10; })();
const SHOW_ALL = process.argv.includes('--all');

// ── clasificadores de patrón ─────────────────────────────────────────────────
// Cada función recibe un username y devuelve una clave de patrón o null.
// El orden importa: el primero que matchea gana.

const CLASSIFIERS = [
  // letra(s) fijas + dígitos puros  → el más común en bots
  { name: 'prefijo_fijo+dígitos',  fn: u => { const m = u.match(/^([a-z]{1,8})(\d+)$/i); return m ? `"${m[1].toLowerCase()}"+dígitos` : null; } },
  // solo dígitos
  { name: 'solo_dígitos',          fn: u => /^\d+$/.test(u) ? 'solo_dígitos' : null },
  // 4-10 chars completamente aleatorios (sin vocal O con >3 consonantes seguidas)
  { name: 'aleatorio_sin_vocales', fn: u => u.length >= 4 && u.length <= 12 && /^[bcdfghjklmnpqrstvwxyz]{4,}$/i.test(u) ? 'aleatorio_sin_vocales' : null },
  // alfanumérico puro corto (6-10 chars mezclando letras y números sin sentido)
  { name: 'alfanum_corto',         fn: u => /^(?=.*[a-z])(?=.*\d)[a-z0-9]{5,10}$/i.test(u) && !/[_.]/.test(u) ? 'alfanum_corto' : null },
  // patrón tipo "user1234" genérico
  { name: 'user+número',           fn: u => /^user\d+$/i.test(u) ? 'user+número' : null },
];

function classify(username) {
  for (const { fn, name } of CLASSIFIERS) {
    const key = fn(username);
    if (key) return key;
  }
  return null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function bar(n, max, width = 30) {
  const filled = Math.round((n / max) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n=== ANÁLISIS DE PATRONES SOSPECHOSOS EN USERNAMES ===\n');
  console.log('Conectando a MongoDB…');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅ Conectado\n');

  const User = require('../src/models/User');

  const total = await User.countDocuments();
  console.log(`Total de usuarios en BD: ${total}\n`);

  // Traer todos los usernames (solo ese campo, lean para velocidad)
  process.stdout.write('Cargando usernames… ');
  const users = await User.find({}, { username: 1, email: 1, createdAt: 1, banned: 1, _id: 0 }).lean();
  console.log(`${users.length} cargados\n`);

  // ── 1. Clasificación por patrón ────────────────────────────────────────────

  const buckets = {};   // patternKey → { count, examples, emails }

  for (const u of users) {
    const key = classify(u.username);
    if (!key) continue;
    if (!buckets[key]) buckets[key] = { count: 0, examples: [], emails: {} };
    buckets[key].count++;
    if (buckets[key].examples.length < 6) buckets[key].examples.push(u.username);
    // agrupar dominios de email para detectar olas coordinadas
    const domain = u.email?.split('@')[1];
    if (domain) buckets[key].emails[domain] = (buckets[key].emails[domain] || 0) + 1;
  }

  const sorted = Object.entries(buckets)
    .sort((a, b) => b[1].count - a[1].count)
    .filter(([, v]) => SHOW_ALL || v.count >= 3);

  const maxCount = sorted[0]?.[1].count ?? 1;

  console.log(`Top ${TOP_N} patrones de username más frecuentes:`);
  console.log('─'.repeat(72));

  sorted.slice(0, TOP_N).forEach(([key, { count, examples, emails }], i) => {
    const pct       = ((count / total) * 100).toFixed(1);
    const topDomain = Object.entries(emails).sort((a,b) => b[1]-a[1]).slice(0, 3)
                        .map(([d, n]) => `${d}(${n})`).join(', ');
    console.log(`\n${String(i+1).padStart(2)}. ${key}  —  ${count} usuarios (${pct}% del total)`);
    console.log(`    ${bar(count, maxCount)}  ${count}`);
    console.log(`    Ejemplos: ${examples.join(', ')}`);
    if (topDomain) console.log(`    Dominios: ${topDomain}`);
  });

  // ── 2. Dominios de email más frecuentes en NO-gmail/hotmail/outlook ────────

  console.log('\n\n─'.repeat(37));
  console.log('Dominios de email inusuales (excluye gmail/hotmail/outlook/yahoo/icloud):');
  console.log('─'.repeat(72));

  const COMMON = new Set(['gmail.com','hotmail.com','outlook.com','yahoo.com','icloud.com','live.com','me.com','protonmail.com']);
  const domainCount = {};
  for (const u of users) {
    const d = u.email?.split('@')[1]?.toLowerCase();
    if (d && !COMMON.has(d)) domainCount[d] = (domainCount[d] || 0) + 1;
  }

  const topDomains = Object.entries(domainCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  if (topDomains.length === 0) {
    console.log('  Ninguno inusual detectado.');
  } else {
    const maxD = topDomains[0][1];
    topDomains.forEach(([d, n]) => {
      console.log(`  ${d.padEnd(30)}  ${bar(n, maxD, 20)}  ${n} usuarios`);
    });
  }

  // ── 3. Cuentas recientes en masa (últimas 48 h) ────────────────────────────

  console.log('\n─'.repeat(37));
  console.log('Picos de registro (agrupado por hora, últimas 48 h):');
  console.log('─'.repeat(72));

  const cutoff = new Date(Date.now() - 48 * 3600 * 1000);
  const recent = users.filter(u => u.createdAt && new Date(u.createdAt) > cutoff);

  if (recent.length === 0) {
    console.log('  Sin registros en las últimas 48 h.');
  } else {
    const byHour = {};
    for (const u of recent) {
      const key = new Date(u.createdAt).toISOString().slice(0, 13) + ':00';
      byHour[key] = (byHour[key] || 0) + 1;
    }
    const hoursSorted = Object.entries(byHour).sort((a,b) => a[0].localeCompare(b[0]));
    const maxH = Math.max(...hoursSorted.map(([,n]) => n));
    hoursSorted.forEach(([h, n]) => {
      const flag = n >= 10 ? '  ⚠️' : '';
      console.log(`  ${h}  ${bar(n, maxH, 20)}  ${String(n).padStart(4)} regs${flag}`);
    });
  }

  console.log('\n');
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
