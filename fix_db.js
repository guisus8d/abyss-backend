const mongoose = require('mongoose');

mongoose.connect('mongodb+srv://jimenezmartinezjesus76_db_user:RXvHVMIZyGvprCSV@abyss.2cdv9w9.mongodb.net/abbysdb')
  .then(async () => {
    const User          = require('./src/models/User');
    const Frame         = require('./src/models/Frame');
    const FrameOwnership = require('./src/models/FrameOwnership');

    // Dar monedas y XP
    const u = await User.findOneAndUpdate(
      { email: 'britanichans@gmail.com' },
      { $set: { coins: 2000, xp: 500 } },
      { new: true }
    );
    console.log(`✅ Monedas: ${u.coins} | XP: ${u.xp}`);

    // Limpiar todos los marcos creados por jesusjm
    const deleted = await Frame.deleteMany({ creator: u._id });
    await FrameOwnership.deleteMany({ user: u._id });
    console.log(`🗑️  Marcos eliminados: ${deleted.deletedCount}`);

    mongoose.disconnect();
  })
  .catch(e => { console.error(e); process.exit(1); });
