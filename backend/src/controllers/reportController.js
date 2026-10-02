'use strict';

const reportService = require('../services/reportService');
const asyncHandler = require('../utils/asyncHandler');

/** GET /api/reports/shipments/:id -> PDF download */
const shipmentReport = asyncHandler(async (req, res) => {
  const { buffer, filename } = await reportService.generateShipmentReport(req.params.id);
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'no-store',
  });
  return res.status(200).end(buffer);
});

module.exports = { shipmentReport };
