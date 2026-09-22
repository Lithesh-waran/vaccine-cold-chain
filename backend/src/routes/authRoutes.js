'use strict';

const express = require('express');
const controller = require('../controllers/authController');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const rateLimit = require('../middleware/rateLimit');
const schemas = require('../middleware/schemas');

const router = express.Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 50, message: 'Too many authentication attempts, try again later' });

router.post('/register', authLimiter, optionalAuthenticate, validate(schemas.auth.register), controller.register);
router.post('/login', authLimiter, validate(schemas.auth.login), controller.login);
router.get('/me', authenticate, controller.me);

module.exports = router;
