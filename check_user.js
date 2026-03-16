const mongoose = require('mongoose');
mongoose.connect('mongodb+srv://jimenezmartinezjesus76_db_user:RXvHVMIZyGvprCSV@abyss.2cdv9w9.mongodb.net/abbysdb')
  .then(async () => {
    const User  = require('./src/models/User');
    const Frame = require('./src/models/Frame');

    const u = await User.findOne({ email: 'britanichans@gmail.com' });
    console.log('profileFrame:', u.profileFrame);
    console.log('profileFrameUrl:', u.profileFrameUrl);

    // Reparar manualmente
    if (u.profileFrame && u.profileFrame !== 'default' && u.profileFrame !== 'frame_001') {
      const frame = await Frame.findById(u.profileFrame);
      console.log('Frame encontrado:', frame?.name, frame?.imageUrl);
      if (frame?.imageUrl) {
        await User.updateOne({ _id: u._id }, { profileFrameUrl: frame.imageUrl });
        console.log('✅ Reparado');
      }
    }
    mongoose.disconnect();
  }).catch(console.error);
