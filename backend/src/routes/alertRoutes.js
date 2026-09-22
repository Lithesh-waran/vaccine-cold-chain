'use strict';

const express = require('express');
const controller = require('../controllers/alertController');
const { authenticate } = require('../middleware/auth');
const { objectIdParam } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list);
router.get('/active', controller.active);
router.route('/:id/resolve').patch(objectIdParam(), controller.resolve).put(objectIdParam(), controller.resolve);

module.exports = router;
