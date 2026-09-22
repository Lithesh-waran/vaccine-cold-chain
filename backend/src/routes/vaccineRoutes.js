'use strict';

const express = require('express');
const controller = require('../controllers/vaccineController');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, objectIdParam } = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list);
router.get('/:id', objectIdParam(), controller.getOne);
router.post('/', authorize(ROLES.ADMIN), validate(schemas.vaccine), controller.create);
router.put('/:id', authorize(ROLES.ADMIN), objectIdParam(), validate(schemas.vaccine, { partial: true }), controller.update);
router.delete('/:id', authorize(ROLES.ADMIN), objectIdParam(), controller.remove);

module.exports = router;
