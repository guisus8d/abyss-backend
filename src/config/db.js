const mongoose = require('mongoose');

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB conectado');
  } catch (err) {
    console.error('❌ Error MongoDB:', err.message);
    process.exit(1);
  }
}

module.exports = { connectDB };
