const { body } = require('express-validator');

const registerRules = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 20 }).withMessage('Username: 3-20 caracteres')
    .matches(/^[a-zA-Z0-9_.]+$/).withMessage('Username: solo letras, números, _ y .'),
  body('email')
    .isEmail().withMessage('Email inválido')
    .normalizeEmail(),
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
