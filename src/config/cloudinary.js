const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Avatares ──────────────────────────────────────────────────────────────────
const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/avatars',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
  },
});
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Posts ─────────────────────────────────────────────────────────────────────
const postStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/posts',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation:  [{ width: 1080, crop: 'limit', quality: 'auto:best' }],
  },
});
const uploadPost = multer({ storage: postStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// ── Banner del hero (franja superior del perfil) ──────────────────────────────
// Sin crop ni transformación agresiva — solo limit de ancho para no subir 10MB
const bannerStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/banners',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 1600, crop: 'limit', quality: 'auto:best' }],
  },
});
const uploadBanner = multer({ storage: bannerStorage, limits: { fileSize: 8 * 1024 * 1024 } });

// ── Fondo de la card de perfil ────────────────────────────────────────────────
const cardBgStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/card-bgs',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 1200, crop: 'limit', quality: 'auto:best' }],
  },
});
const uploadCardBg = multer({ storage: cardBgStorage, limits: { fileSize: 8 * 1024 * 1024 } });

// ── Bloques de perfil ─────────────────────────────────────────────────────────
const blockStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/blocks',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 1200, crop: 'limit', quality: 'auto:best' }],
  },
});
const uploadBlock = multer({ storage: blockStorage, limits: { fileSize: 8 * 1024 * 1024 } });

// ── Audio ─────────────────────────────────────────────────────────────────────
const audioStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:        'abbys/audio',
    resource_type: 'video',
    allowed_formats: ['m4a', 'mp3', 'wav', 'ogg', 'webm'],
  },
});
const uploadAudio = multer({ storage: audioStorage, limits: { fileSize: 20 * 1024 * 1024 } });

module.exports = {
  cloudinary,
  uploadAvatar,
  uploadPost,
  uploadBanner,
  uploadCardBg,
  uploadBlock,
  uploadAudio,
};
