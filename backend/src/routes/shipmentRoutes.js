'use strict';

const express = require('express');
const controller = require('../controllers/shipmentController');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, refParam } = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

const canOperate = authorize(ROLES.ADMIN, ROLES.OPERATOR);

router.get('/', controller.list);
router.post('/', canOperate, validate(schemas.shipmentCreate), controller.create);

router.get('/:id', refParam(), controller.getOne);
router.put('/:id', canOperate, refParam(), validate(schemas.shipmentUpdate, { partial: true }), controller.update);
router.delete('/:id', authorize(ROLES.ADMIN), refParam(), controller.remove);

router.post('/:id/start', canOperate, refParam(), validate(schemas.simulationStart, { partial: true, allowEmpty: true }), controller.start);
router.get('/:id/temperature', refParam(), controller.temperature);
router.get('/:id/location', refParam(), controller.location);
router.get('/:id/alerts', refParam(), controller.alerts);
router.get('/:id/compliance', refParam(), controller.compliance);
router.get('/:id/report', refParam(), controller.report);

module.exports = router;
