'use strict';

const express = require('express');
const controller = require('../controllers/batchController');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, objectIdParam } = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

const canManage = authorize(ROLES.ADMIN, ROLES.WAREHOUSE);

router.get('/', controller.list);
router.get('/:id', objectIdParam(), controller.getOne);
router.post('/', canManage, validate(schemas.batchCreate), controller.create);
router.put('/:id', canManage, objectIdParam(), validate(schemas.batchUpdate, { partial: true }), controller.update);
router.delete('/:id', authorize(ROLES.ADMIN), objectIdParam(), controller.remove);

module.exports = router;
