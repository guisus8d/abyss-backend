const Badge = require('../models/Badge');

const BADGES = [
  { name: 'Primer Post',  icon: '✍️',  type: 'participation', description: 'Publicaste tu primer post' },
  { name: 'Activo',       icon: '🔥',  type: 'participation', description: '10 posts publicados' },
  { name: 'Veterano',     icon: '⭐',  type: 'seniority',     description: 'Miembro por 30 días' },
  { name: 'Fundador',     icon: '🏆',  type: 'seniority',     description: 'Uno de los primeros miembros' },
];

async function seedBadges() {
  for (const b of BADGES) {
    await Badge.findOneAndUpdate(
      { name: b.name },
      b,
      { upsert: true, new: true }
    );
  }
  console.log('✅ Badges inicializados');
}

module.exports = { seedBadges };
