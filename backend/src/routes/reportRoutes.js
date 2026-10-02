'use strict';

const express = require('express');
const controller = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');
const { refParam } = require('../middleware/validate');

const router = express.Router();
router.use(authenticate);

router.get('/shipments/:id', refParam(), controller.shipmentReport);

module.exports = router;
