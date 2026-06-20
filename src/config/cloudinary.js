const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Intercept upload_stream to log exact params before Cloudinary receives them.
// Temporary diagnostic — remove after investigation.
const _origUploadStream = cloudinary.uploader.upload_stream.bind(cloudinary.uploader);
cloudinary.uploader.upload_stream = function (...args) {
  console.log('[CLD-INTERCEPT] upload_stream called — arg[0] type:', typeof args[0], '| arg[1] type:', typeof args[1]);
  console.log('[CLD-INTERCEPT] arg[0] value:', JSON.stringify(args[0]));
  console.log('[CLD-INTERCEPT] arg[1] value:', typeof args[1] === 'function' ? '<function>' : JSON.stringify(args[1]));
  return _origUploadStream(...args);
};

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

// ── Marcos de perfil ──────────────────────────────────────────────────────────
const frameStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/frames',
    allowed_formats: ['png', 'webp'],
    resource_type:   'video',  // preserva WebP animado (todos los frames)
  },
});
const uploadFrame = multer({ storage: frameStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Marcos — todos los assets en un solo middleware ───────────────────────────
const frameAllStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    let result;
    if (file.fieldname === 'image') result = {
      folder:          'abbys/frames',
      allowed_formats: ['png', 'webp'],
      resource_type:   'video',
    };
    else if (file.fieldname === 'bgImage') result = {
      folder:          'abbys/frame-bgs',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      resource_type:   'video',
      transformation:  [{ width: 1200, crop: 'limit', quality: 'auto:best' }],
    };
    else if (file.fieldname === 'logo') result = {
      folder:          'abbys/frame-logos',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      resource_type:   'video',
      transformation:  [{ width: 400, height: 400, crop: 'fill', gravity: 'center' }],
    };
    else if (file.fieldname === 'pedestal') result = {
      folder:          'abbys/frame-pedestals',
      allowed_formats: ['png', 'webp'],
      resource_type:   'video',
    };
    else result = { folder: 'abbys/frames-misc' };
    return result;
  },
});

const uploadFrameAll = multer({
  storage: frameAllStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
}).fields([
  { name: 'image',    maxCount: 1 },
  { name: 'bgImage',  maxCount: 1 },
  { name: 'logo',     maxCount: 1 },
  { name: 'pedestal', maxCount: 1 },
]);

// ── Imágenes de tienda (banner y logo) ───────────────────────────────────────
const storeBannerStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/stores/banners',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 1600, crop: 'limit', quality: 'auto:best' }],
  },
});
const uploadStoreBanner = multer({ storage: storeBannerStorage, limits: { fileSize: 8 * 1024 * 1024 } });

const storeLogoStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/stores/logos',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 400, height: 400, crop: 'fill', gravity: 'center' }],
  },
});
const uploadStoreLogo = multer({ storage: storeLogoStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// ── Fondos de grupo ───────────────────────────────────────────────────────────
const groupBgStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'abbys/group-bgs',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 1080, crop: 'limit', quality: 'auto:best' }],
  },
});
const uploadGroupBg = multer({ storage: groupBgStorage, limits: { fileSize: 8 * 1024 * 1024 } });

// ── Audio ─────────────────────────────────────────────────────────────────────
const audioStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:        'abbys/audio',
    resource_type: 'video',
    allowed_formats: ['m4a', 'mp3', 'wav', 'ogg', 'webm', 'mp4', 'aac'],
  },
});
const uploadAudio = multer({ storage: audioStorage, limits: { fileSize: 20 * 1024 * 1024 } });

module.exports = {
  cloudinary,
  uploadAvatar,
  uploadGroupBg,
  uploadPost,
  uploadBanner,
  uploadCardBg,
  uploadBlock,
  uploadAudio,
  uploadFrame,
  uploadFrameAll,
  uploadStoreBanner,
  uploadStoreLogo,
};
