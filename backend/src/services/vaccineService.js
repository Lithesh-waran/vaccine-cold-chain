'use strict';

const Vaccine = require('../models/Vaccine');
const Batch = require('../models/Batch');
const AppError = require('../utils/AppError');
const escapeRegex = require('../utils/escapeRegex');
const { parsePagination, buildMeta, parseSort } = require('../utils/pagination');

const SORT_FIELDS = ['name', 'manufacturer', 'type', 'storageMin', 'storageMax', 'createdAt'];

async function list(query = {}) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.type) filter.type = new RegExp(`^${escapeRegex(String(query.type).trim())}$`, 'i');
  if (query.manufacturer) filter.manufacturer = new RegExp(escapeRegex(String(query.manufacturer).trim()), 'i');
  if (query.search) {
    const rx = new RegExp(escapeRegex(String(query.search).trim()), 'i');
    filter.$or = [{ name: rx }, { manufacturer: rx }, { type: rx }];
  }
  const sort = parseSort(query.sort, SORT_FIELDS, { name: 1 });

  const [items, total] = await Promise.all([
    Vaccine.find(filter).sort(sort).skip(skip).limit(limit).select('-__v').lean(),
    Vaccine.countDocuments(filter),
  ]);
  return { items, meta: buildMeta(page, limit, total) };
}

async function getById(id) {
  const vaccine = await Vaccine.findById(id).select('-__v').lean();
  if (!vaccine) throw AppError.notFound('Vaccine not found');
  return vaccine;
}

async function create(data) {
  const vaccine = await Vaccine.create(data);
  return vaccine.toObject();
}

async function update(id, data) {
  const vaccine = await Vaccine.findById(id);
  if (!vaccine) throw AppError.notFound('Vaccine not found');
  vaccine.set(data);
  await vaccine.save(); // runs schema validators and the storageMin < storageMax check
  return vaccine.toObject();
}

async function remove(id) {
  const vaccine = await Vaccine.findById(id);
  if (!vaccine) throw AppError.notFound('Vaccine not found');
  const batches = await Batch.countDocuments({ vaccineId: id });
  if (batches > 0) throw AppError.conflict(`Vaccine is used by ${batches} batch(es) and cannot be deleted`);
  await vaccine.deleteOne();
  return { id };
}

module.exports = { list, getById, create, update, remove };
