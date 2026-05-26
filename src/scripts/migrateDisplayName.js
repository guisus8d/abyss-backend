/**
 * Migración: asignar displayName = username a todos los usuarios que no lo tengan
 * 
 * Uso:
 *   cd /home/jesus/abyss/proyecto-mvp/backend
 *   node src/scripts/migrateDisplayName.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ No se encontró MONGO_URI en las variables de entorno');
  process.exit(1);
}

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Conectado a MongoDB');

  const result = await mongoose.connection.collection('users').updateMany(
    {
      $or: [
        { displayName: { $exists: false } },
        { displayName: null },
        { displayName: '' },
      ]
    },
    [
      { $set: { displayName: '$username' } }
    ]
  );

  console.log(`✅ Migración completa`);
  console.log(`   → Usuarios actualizados: ${result.modifiedCount}`);
  console.log(`   → Usuarios sin cambio:   ${result.matchedCount - result.modifiedCount}`);

  await mongoose.disconnect();
  console.log('🔌 Desconectado de MongoDB');
}

migrate().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
