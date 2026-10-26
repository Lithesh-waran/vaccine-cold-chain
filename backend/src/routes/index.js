'use strict';

const express = require('express');

const router = express.Router();

router.get('/', (req, res) =>
  res.json({
    success: true,
    data: {
      name: 'Vaccine Cold-Chain Monitoring & Compliance Platform API',
      version: '1.0.0',
      endpoints: ['/auth', '/vaccines', '/batches', '/shipments', '/inventory', '/alerts', '/dashboard', '/reports', '/simulation'],
    },
  })
);

router.use('/auth', require('./authRoutes'));
router.use('/vaccines', require('./vaccineRoutes'));
router.use('/batches', require('./batchRoutes'));
router.use('/shipments', require('./shipmentRoutes'));
router.use('/inventory', require('./inventoryRoutes'));
router.use('/alerts', require('./alertRoutes'));
router.use('/dashboard', require('./dashboardRoutes'));
router.use('/reports', require('./reportRoutes'));
router.use('/simulation', require('./simulationRoutes'));

router.post('/setup/seed', async (req, res, next) => {
  try {
    const seedService = require('../services/seedService');
    const result = await seedService.autoSeedIfEmpty();
    res.json({
      success: true,
      message: result.seeded ? 'Database seeded successfully' : 'Database already contains data',
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
