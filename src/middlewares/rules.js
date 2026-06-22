const { body } = require('express-validator');

const BLOCKED_EMAIL_DOMAINS = new Set([
  'tmp.xyz', 'mailinator.com', 'guerrillamail.com', 'trashmail.com',
  'throwam.com', 'sharklasers.com', 'yopmail.com', 'tempmail.com',
  'dispostable.com', 'maildrop.cc', 'getairmail.com', 'fakeinbox.com',
  'spamgourmet.com', 'trashmail.me', 'spamgourmet.net', 'tempr.email',
]);

const registerRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 }).withMessage('Username: 3-20 caracteres')
    .matches(/^[a-zA-Z0-9_.]+$/).withMessage('Username: solo letras, números, _ y .')
    .custom(val => {
      if (/^\d+$/.test(val))
        throw new Error('Username no puede ser solo números');
      if (/^[a-zA-Z]{1,8}\d{3,}$/.test(val))
        throw new Error('Username no puede ser prefijo + 3 o más dígitos');
      return true;
    }),
  body('email')
    .isEmail().withMessage('Email inválido')
    .normalizeEmail()
    .custom(val => {
      const domain = val.split('@')[1]?.toLowerCase();
      if (BLOCKED_EMAIL_DOMAINS.has(domain))
        throw new Error('No se permiten emails de dominios temporales');
      return true;
    }),
  body('password')
    .isLength({ min: 6 }).withMessage('Contraseña: mínimo 6 caracteres'),
];

const loginRules = [
  body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
  body('password').notEmpty().withMessage('Contraseña requerida'),
];

const postRules = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 1000 }).withMessage('El post debe tener entre 1 y 1000 caracteres'),
];

const commentRules = [
  body('text')
    .trim()
    .isLength({ min: 1, max: 500 }).withMessage('El comentario debe tener entre 1 y 500 caracteres'),
];

module.exports = { registerRules, loginRules, postRules, commentRules };
