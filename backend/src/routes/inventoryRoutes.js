'use strict';

const express = require('express');
const controller = require('../controllers/inventoryController');
const { authenticate, authorize } = require('../middleware/auth');
const { validate, objectIdParam } = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const { ROLES } = require('../config/constants');

const router = express.Router();
router.use(authenticate);

router.get('/', controller.list);
router.get('/low-stock', controller.lowStock);
router.get('/expiring', controller.expiring);
router.get('/warehouse/:warehouseId', controller.byWarehouse);
router.patch(
  '/:id',
  authorize(ROLES.ADMIN, ROLES.WAREHOUSE),
  objectIdParam(),
  validate(schemas.inventoryUpdate),
  controller.updateSettings
);

module.exports = router;
