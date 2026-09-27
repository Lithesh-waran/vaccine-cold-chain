'use strict';

const express = require('express');
const controller = require('../controllers/simulationController');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, refParam } = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

const canOperate = authorize(ROLES.ADMIN, ROLES.OPERATOR);

router.get('/', controller.listActive);
router.get('/scenarios', controller.listScenarios);

router.post('/:id/start', canOperate, refParam(), validate(schemas.simulationStart, { partial: true, allowEmpty: true }), controller.start);
router.post('/:id/pause', canOperate, refParam(), controller.pause);
router.post('/:id/resume', canOperate, refParam(), controller.resume);
router.post('/:id/stop', canOperate, refParam(), controller.stop);
router.post('/:id/reset', canOperate, refParam(), controller.reset);
router.post('/:id/scenario', canOperate, refParam(), validate(schemas.simulationScenario), controller.scenario);
router.get('/:id/status', refParam(), controller.status);

module.exports = router;
