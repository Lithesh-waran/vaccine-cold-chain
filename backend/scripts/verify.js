'use strict';

/**
 * Static + load-time sanity check (no database, no network):
 *   1. every source file can be required (syntax errors, bad relative imports, missing packages),
 *   2. every `Module.fn` / `{ fn } = require('./module')` reference points at something the module really exports,
 *   3. the simulation engine's injected collaborators expose every method the engine calls.
 *
 *   npm run verify
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const SKIP_LOAD = new Set(['src/server.js']); // starts listening when required

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });
}

const files = walk(path.join(root, 'src'));
const rel = (f) => path.relative(root, f).split(path.sep).join('/');
const problems = [];
const modules = new Map();

for (const file of files) {
  if (SKIP_LOAD.has(rel(file))) continue;
  try {
    modules.set(file, require(file));
  } catch (err) {
    problems.push(`${rel(file)}: cannot be loaded - ${err.message}`);
  }
}

const resolveRel = (from, request) => require.resolve(path.resolve(path.dirname(from), request));

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');

  // const X = require('./y');  ->  X.something must exist on y
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*require\('(\.[^']+)'\)/g)) {
    const [, name, request] = match;
    let target;
    try {
      target = modules.get(resolveRel(file, request));
    } catch (err) {
      problems.push(`${rel(file)}: cannot resolve ${request}`);
      continue;
    }
    if (target === undefined) continue;
    const used = new Set([...source.matchAll(new RegExp(`\\b${name}\\.(\\w+)`, 'g'))].map((m) => m[1]));
    for (const prop of used) {
      if (!(prop in Object(target))) problems.push(`${rel(file)}: ${name}.${prop} is not exported by ${request}`);
    }
  }

  // const { a, b } = require('./y');
  for (const match of source.matchAll(/const\s+\{([^}]+)\}\s*=\s*require\('(\.[^']+)'\)/g)) {
    const names = match[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
    let target;
    try {
      target = modules.get(resolveRel(file, match[2]));
    } catch (err) {
      problems.push(`${rel(file)}: cannot resolve ${match[2]}`);
      continue;
    }
    if (target === undefined) continue;
    for (const name of names) {
      if (!(name in Object(target))) problems.push(`${rel(file)}: { ${name} } is not exported by ${match[2]}`);
    }
  }
}

// Collaborators injected into the simulation engine (see src/simulation/deps.js)
const injected = {
  readingService: 'src/services/readingService.js',
  alertService: 'src/services/alertService.js',
  shipmentService: 'src/services/shipmentService.js',
  inventorySimulator: 'src/simulation/inventorySimulator.js',
  emitter: 'src/sockets/socketEmitter.js',
};
for (const file of files.filter((f) => rel(f).startsWith('src/simulation/'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [name, modulePath] of Object.entries(injected)) {
    const target = modules.get(path.join(root, modulePath));
    if (!target) continue;
    for (const match of source.matchAll(new RegExp(`\\b${name}\\.(\\w+)\\(`, 'g'))) {
      if (!(match[1] in target)) problems.push(`${rel(file)}: ${name}.${match[1]}() does not exist in ${modulePath}`);
    }
  }
}

if (problems.length) {
  console.error(`verify: ${problems.length} problem(s) found`);
  problems.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log(`verify: OK - ${modules.size} modules loaded, all cross-module references resolved.`);
process.exit(0);
