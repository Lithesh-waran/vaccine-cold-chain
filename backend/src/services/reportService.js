'use strict';

const { PassThrough } = require('stream');
const PDFDocument = require('pdfkit');
const Shipment = require('../models/Shipment');
const Alert = require('../models/Alert');
const shipmentService = require('./shipmentService');
const complianceService = require('./complianceService');
const { routeLengthKm } = require('../utils/geo');
const { DISCLAIMER } = require('../utils/compliance');

const MARGIN = 50;
const COLORS = { primary: '#0b5394', text: '#222222', muted: '#666666', line: '#c9d3df', head: '#e8eef5', bad: '#b42318', good: '#067647' };

const fmtDate = (d) => (d ? `${new Date(d).toISOString().replace('T', ' ').slice(0, 19)} UTC` : '-');
const fmtTemp = (t) => (t === null || t === undefined ? '-' : `${Number(t).toFixed(2)} \u00b0C`);

/** Collects everything the report needs (throws 404 for unknown shipments before any byte is streamed). */
async function buildReportData(ref) {
  const base = await shipmentService.getByRef(ref);
  const shipment = await Shipment.findById(base._id)
    .populate({ path: 'batchId', populate: { path: 'vaccineId' } })
    .populate('createdBy', 'name email')
    .lean();
  const batch = shipment.batchId || {};
  const vaccine = batch.vaccineId || {};
  const { compliance, summary, events } = await complianceService.computeForShipment(base);
  const alerts = await Alert.find({ shipmentId: base._id }).sort({ timestamp: 1 }).lean();

  return {
    generatedAt: new Date(),
    shipment,
    batch,
    vaccine,
    routeKm: routeLengthKm(shipment.route),
    summary,
    events,
    alerts,
    compliance,
  };
}

/** Renders the report to any writable stream (HTTP response, file, ...). */
function renderPdf(data, output) {
  const { shipment, batch, vaccine, summary, events, alerts, compliance } = data;
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: `Cold-chain report ${shipment.shipmentId}`, Author: 'Vaccine Cold-Chain Monitoring & Compliance Platform' },
  });
  doc.pipe(output);

  const contentWidth = () => doc.page.width - MARGIN * 2;
  const ensureSpace = (height) => {
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };

  const section = (title) => {
    ensureSpace(50);
    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.primary).text(title, MARGIN, doc.y);
    const y = doc.y + 2;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + contentWidth(), y).lineWidth(1).strokeColor(COLORS.primary).stroke();
    doc.y = y + 8;
    doc.x = MARGIN;
  };

  const keyValues = (rows) => {
    for (const [label, value] of rows) {
      ensureSpace(18);
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.muted).text(label, MARGIN, y, { width: 150 });
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(String(value), MARGIN + 155, y, { width: contentWidth() - 155 });
      doc.x = MARGIN;
    }
  };

  const table = (headers, widths, rows) => {
    const rowHeight = 16;
    const drawRow = (cells, header) => {
      ensureSpace(rowHeight + 2);
      const y = doc.y;
      if (header) doc.rect(MARGIN, y - 2, contentWidth(), rowHeight).fill(COLORS.head);
      doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5).fillColor(COLORS.text);
      let x = MARGIN + 3;
      cells.forEach((cell, i) => {
        doc.text(String(cell), x, y + 1, { width: widths[i] - 6, height: rowHeight - 2, lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      doc.y = y + rowHeight;
      doc.x = MARGIN;
    };
    drawRow(headers, true);
    rows.forEach((row) => drawRow(row, false));
  };

  // ---- title
  doc.font('Helvetica-Bold').fontSize(20).fillColor(COLORS.primary).text('Cold-Chain Shipment Report', MARGIN, MARGIN);
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted).text(`Shipment ${shipment.shipmentId}`);
  doc.text(`Generated: ${fmtDate(data.generatedAt)}`);
  doc.fontSize(9).text('Data produced by the platform simulation engine (virtual sensors, GPS and vehicles).');

  // ---- shipment
  section('1. Shipment information');
  keyValues([
    ['Shipment ID', shipment.shipmentId],
    ['Status', shipment.status],
    ['Quantity', `${shipment.quantity} units`],
    ['Vehicle', shipment.vehicle && shipment.vehicle.vehicleId ? shipment.vehicle.vehicleId : '-'],
    ['Planned route length', data.routeKm ? `${data.routeKm.toFixed(1)} km` : '-'],
    ['Departure', fmtDate(shipment.startTime)],
    ['Expected delivery', fmtDate(shipment.expectedDelivery)],
    ['Actual delivery', fmtDate(shipment.actualDelivery)],
    ['Created by', shipment.createdBy ? `${shipment.createdBy.name} (${shipment.createdBy.email})` : '-'],
  ]);

  section('2. Vaccine and batch');
  keyValues([
    ['Vaccine', vaccine.name || '-'],
    ['Manufacturer', vaccine.manufacturer || '-'],
    ['Type', vaccine.type || '-'],
    ['Storage range', vaccine.storageMin !== undefined ? `${vaccine.storageMin} to ${vaccine.storageMax} \u00b0C` : '-'],
    ['Batch number', batch.batchNumber || '-'],
    ['Manufactured', fmtDate(batch.manufacturingDate)],
    ['Expiry date', fmtDate(batch.expiryDate)],
  ]);

  section('3. Source and destination');
  const place = (p) => `${p.name}${p.warehouseId ? ` [${p.warehouseId}]` : ''} (${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)})`;
  keyValues([
    ['Source', place(shipment.source)],
    ['Destination', place(shipment.destination)],
    ['Last known position', shipment.currentLatitude !== null && shipment.currentLatitude !== undefined
      ? `${Number(shipment.currentLatitude).toFixed(4)}, ${Number(shipment.currentLongitude).toFixed(4)}`
      : '-'],
  ]);

  section('4. Temperature summary');
  keyValues([
    ['Allowed range', `${shipment.temperatureMin} to ${shipment.temperatureMax} \u00b0C`],
    ['Readings (total / normal)', `${summary.total} / ${summary.normal}`],
    ['Excursion readings', summary.excursions],
    ['Minimum', fmtTemp(summary.min)],
    ['Maximum', fmtTemp(summary.max)],
    ['Average', fmtTemp(summary.average)],
    ['Current / last reading', fmtTemp(shipment.currentTemperature)],
  ]);

  section('5. Temperature excursions');
  if (events.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.good).text('No temperature excursions were recorded.', MARGIN, doc.y);
  } else {
    table(
      ['#', 'Start', 'End', 'Min', 'Direction', 'Peak', 'Deviation'],
      [25, 120, 120, 45, 65, 60, 60],
      events.map((e, i) => [i + 1, fmtDate(e.start), fmtDate(e.end), `${e.durationMinutes}`, e.direction, fmtTemp(e.peakTemperature), `${e.peakDeviation} \u00b0C`])
    );
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('Min = duration in simulated minutes.', MARGIN, doc.y + 2);
  }

  section('6. Alerts');
  if (alerts.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.good).text('No alerts were raised for this shipment.', MARGIN, doc.y);
  } else {
    const shown = alerts.slice(0, 60);
    table(
      ['Time', 'Type', 'Severity', 'Resolved', 'Message'],
      [110, 105, 55, 45, 180],
      shown.map((a) => [fmtDate(a.timestamp), a.type, a.severity, a.resolved ? 'yes' : 'no', a.message])
    );
    if (alerts.length > shown.length) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(`... and ${alerts.length - shown.length} more alert(s).`, MARGIN, doc.y + 2);
    }
  }

  section('7. Compliance');
  const score = compliance.score;
  keyValues([
    ['Compliance score', score === null ? 'n/a (no readings)' : `${score} %`],
    ['Total readings', compliance.totalReadings],
    ['Normal readings', compliance.normalReadings],
    ['Excursions (events)', compliance.excursionCount],
    ['Delay alerts', compliance.delayCount],
    ['Route deviation alerts', compliance.routeDeviationCount],
    ['Sensor failure alerts', compliance.sensorFailureCount],
  ]);
  doc.moveDown(0.6);
  doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(COLORS.muted).text(DISCLAIMER, MARGIN, doc.y, { width: contentWidth() });

  // ---- footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // otherwise writing into the bottom margin would add a new page
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text(
      `Shipment ${shipment.shipmentId}  -  Page ${i - range.start + 1} of ${range.count}`,
      MARGIN,
      doc.page.height - 35,
      { width: contentWidth(), align: 'center', lineBreak: false }
    );
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return doc;
}

/** Renders the PDF fully in memory (reports are small), so a failure never leaves a half-written response. */
function renderPdfBuffer(data) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const out = new PassThrough();
    out.on('data', (chunk) => chunks.push(chunk));
    out.on('end', () => resolve(Buffer.concat(chunks)));
    out.on('error', reject);
    try {
      renderPdf(data, out);
    } catch (err) {
      reject(err);
    }
  });
}

async function generateShipmentReport(ref) {
  const data = await buildReportData(ref);
  const buffer = await renderPdfBuffer(data);
  return { buffer, filename: `cold-chain-report-${data.shipment.shipmentId}.pdf`, data };
}

module.exports = { buildReportData, renderPdf, renderPdfBuffer, generateShipmentReport };
