'use strict';

const User = require('../models/User');
const Vaccine = require('../models/Vaccine');
const Batch = require('../models/Batch');
const Inventory = require('../models/Inventory');
const Shipment = require('../models/Shipment');
const { ROLES, SHIPMENT_STATUS, VEHICLE_STATE } = require('../config/constants');
const { generateRoute } = require('../utils/geo');
const { createRng } = require('../utils/random');
const inventoryService = require('./inventoryService');
const logger = require('../utils/logger');

const DAY = 24 * 60 * 60 * 1000;

const DEFAULT_PASSWORDS = {
  ADMIN: 'Admin@12345',
  OPERATOR: 'Operator@12345',
  WAREHOUSE: 'Warehouse@12345',
};

const passwords = {
  ADMIN: process.env.SEED_ADMIN_PASSWORD || DEFAULT_PASSWORDS.ADMIN,
  OPERATOR: process.env.SEED_OPERATOR_PASSWORD || DEFAULT_PASSWORDS.OPERATOR,
  WAREHOUSE: process.env.SEED_WAREHOUSE_PASSWORD || DEFAULT_PASSWORDS.WAREHOUSE,
};

const USERS = [
  { name: 'Asha Admin', email: 'admin@coldchain.local', role: ROLES.ADMIN },
  { name: 'Omar Operator', email: 'operator@coldchain.local', role: ROLES.OPERATOR },
  { name: 'Wanda Warehouse', email: 'warehouse@coldchain.local', role: ROLES.WAREHOUSE },
];

const VACCINES = [
  { name: 'Covishield', manufacturer: 'Serum Institute of India', type: 'Viral vector', storageMin: 2, storageMax: 8, description: 'COVID-19 vector vaccine, store refrigerated, do not freeze.' },
  { name: 'Covaxin', manufacturer: 'Bharat Biotech', type: 'Inactivated', storageMin: 2, storageMax: 8, description: 'Whole-virion inactivated COVID-19 vaccine, store refrigerated.' },
  { name: 'Comirnaty', manufacturer: 'BioNTech / Pfizer', type: 'mRNA', storageMin: -90, storageMax: -60, description: 'mRNA vaccine requiring ultra-low temperature storage.' },
  { name: 'Spikevax', manufacturer: 'Moderna', type: 'mRNA', storageMin: -50, storageMax: -15, description: 'mRNA vaccine stored frozen.' },
  { name: 'M-M-R II', manufacturer: 'Merck', type: 'Live attenuated', storageMin: 2, storageMax: 8, description: 'Measles, mumps and rubella vaccine.' },
  { name: 'Engerix-B', manufacturer: 'GSK', type: 'Recombinant', storageMin: 2, storageMax: 8, description: 'Hepatitis B vaccine, must not be frozen.' },
  { name: 'Rotarix', manufacturer: 'GSK', type: 'Live attenuated', storageMin: 2, storageMax: 8, description: 'Oral rotavirus vaccine.' },
];

const BATCHES = [
  ['Covishield', 'CVS-2026-A01', 5000, 60, 300, 'WH-CHENNAI', 500],
  ['Covaxin', 'CVX-2026-B07', 3000, 45, 240, 'WH-CHENNAI', 300],
  ['Comirnaty', 'PFZ-2026-C12', 1200, 30, 150, 'WH-CHENNAI', 200],
  ['Spikevax', 'MOD-2026-D03', 800, 40, 120, 'WH-BENGALURU', 100],
  ['M-M-R II', 'MMR-2026-E21', 2500, 200, 20, 'WH-COIMBATORE', 300],
  ['Engerix-B', 'HEP-2026-F05', 400, 90, 400, 'WH-MADURAI', 500],
  ['Rotarix', 'ROT-2026-G09', 1500, 20, 200, 'WH-BENGALURU', 150],
];

const WAREHOUSES = {
  'WH-CHENNAI': { name: 'Chennai Central Vaccine Store', latitude: 13.0827, longitude: 80.2707, warehouseId: 'WH-CHENNAI' },
  'WH-BENGALURU': { name: 'Bengaluru Regional Cold Store', latitude: 12.9716, longitude: 77.5946, warehouseId: 'WH-BENGALURU' },
  'WH-COIMBATORE': { name: 'Coimbatore District Cold Store', latitude: 11.0168, longitude: 76.9558, warehouseId: 'WH-COIMBATORE' },
  'WH-MADURAI': { name: 'Madurai District Cold Store', latitude: 9.9252, longitude: 78.1198, warehouseId: 'WH-MADURAI' },
};

const SHIPMENTS = [
  ['SHP-DEMO-001', 'CVS-2026-A01', 1000, 'WH-CHENNAI', 'WH-BENGALURU'],
  ['SHP-DEMO-002', 'PFZ-2026-C12', 300, 'WH-CHENNAI', 'WH-MADURAI'],
  ['SHP-DEMO-003', 'CVX-2026-B07', 500, 'WH-CHENNAI', 'WH-COIMBATORE'],
];

async function seedUsers() {
  const result = {};
  for (const data of USERS) {
    let user = await User.findOne({ email: data.email });
    if (!user) {
      user = await User.create({ ...data, password: passwords[data.role] });
      logger.info(`  [Seed] user created: ${data.email} (${data.role})`);
    }
    result[data.role] = user;
  }
  return result;
}

async function seedVaccines() {
  const byName = {};
  for (const data of VACCINES) {
    let vaccine = await Vaccine.findOne({ name: data.name, manufacturer: data.manufacturer });
    if (!vaccine) {
      vaccine = await Vaccine.create(data);
      logger.info(`  [Seed] vaccine created: ${data.name}`);
    }
    byName[data.name] = vaccine;
  }
  return byName;
}

async function seedBatches(vaccines) {
  const byNumber = {};
  const now = Date.now();
  for (const [vaccineName, batchNumber, quantity, mfgDaysAgo, expiresInDays, warehouseId, minimumStock] of BATCHES) {
    let batch = await Batch.findOne({ batchNumber });
    if (!batch) {
      batch = await Batch.create({
        batchNumber,
        vaccineId: vaccines[vaccineName]._id,
        quantity,
        manufacturingDate: new Date(now - mfgDaysAgo * DAY),
        expiryDate: new Date(now + expiresInDays * DAY),
        warehouseId,
      });
      logger.info(`  [Seed] batch created: ${batchNumber} (${quantity} units in ${warehouseId})`);
    }
    await Inventory.updateOne(
      { warehouseId, batchId: batch._id },
      { $setOnInsert: { quantity, minimumStock } },
      { upsert: true }
    );
    byNumber[batchNumber] = batch;
  }

  await Inventory.updateOne(
    { warehouseId: 'WH-BENGALURU', batchId: byNumber['CVS-2026-A01']._id },
    { $setOnInsert: { quantity: 800, minimumStock: 200 } },
    { upsert: true }
  );
  return byNumber;
}

async function seedShipments(batches, vaccines, admin) {
  const rng = createRng(20260924);
  for (const [shipmentId, batchNumber, quantity, from, to] of SHIPMENTS) {
    if (await Shipment.exists({ shipmentId })) {
      continue;
    }
    const batch = batches[batchNumber];
    const vaccine = Object.values(vaccines).find((v) => String(v._id) === String(batch.vaccineId));
    const source = WAREHOUSES[from];
    const destination = WAREHOUSES[to];
    await Shipment.create({
      shipmentId,
      batchId: batch._id,
      quantity,
      source,
      destination,
      route: generateRoute(source, destination, { rng }),
      status: SHIPMENT_STATUS.PREPARING,
      autoExpectedDelivery: true,
      temperatureMin: vaccine.storageMin,
      temperatureMax: vaccine.storageMax,
      vehicle: { vehicleId: `VEH-${shipmentId.slice(-3)}`, state: VEHICLE_STATE.STOPPED, speedKmph: 0 },
      createdBy: admin._id,
    });
    logger.info(`  [Seed] shipment created: ${shipmentId}`);
  }
}

async function autoSeedIfEmpty() {
  const count = await User.countDocuments();
  if (count > 0) return { seeded: false, count };

  logger.info('Database has no users. Automatically seeding initial demo data...');
  const users = await seedUsers();
  const vaccines = await seedVaccines();
  const batches = await seedBatches(vaccines);
  if (users.ADMIN) {
    await seedShipments(batches, vaccines, users.ADMIN);
  }
  await inventoryService.scanAll();
  logger.info('Database auto-seeded successfully!');
  return { seeded: true, users: USERS.length };
}

module.exports = {
  autoSeedIfEmpty,
  seedUsers,
  seedVaccines,
  seedBatches,
  seedShipments,
};
