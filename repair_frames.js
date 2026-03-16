const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://jimenezmartinezjesus76_db_user:RXvHVMIZyGvprCSV@abyss.2cdv9w9.mongodb.net/abbysdb')
  .then(async () => {
    const User  = require('./src/models/User');
    const Frame = require('./src/models/Frame');
    
    const users = await User.find({ 
      profileFrame: { $exists: true, $ne: null, $ne: '' },
      $or: [{ profileFrameUrl: null }, { profileFrameUrl: { $exists: false } }]
    });
    
    console.log('Usuarios a reparar:', users.length);
    
    for (const u of users) {
      const pf = u.profileFrame;
      if (!pf || pf === 'default' || pf === 'frame_001') {
        console.log(u.username, '→ skip:', pf);
        continue;
      }
      const isValidId = /^[a-f\d]{24}$/i.test(pf);
      if (!isValidId) { console.log(u.username, '→ ID inválido:', pf); continue; }
      
      const frame = await Frame.findById(pf);
      if (frame && frame.imageUrl) {
        await User.updateOne({ _id: u._id }, { profileFrameUrl: frame.imageUrl });
        console.log('✅', u.username, '→', frame.imageUrl);
      } else {
        console.log('⚠️', u.username, '→ frame no encontrado, limpiando');
        await User.updateOne({ _id: u._id }, { profileFrame: 'default', profileFrameUrl: null });
      }
    }
    
    mongoose.disconnect();
    console.log('✅ Listo');
  }).catch(console.error);
