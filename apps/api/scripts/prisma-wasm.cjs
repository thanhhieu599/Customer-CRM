#!/usr/bin/env node
// Pinned Prisma packages contain the verified WASM and TypeScript generator.
// No network downloads or verification overrides are needed by this helper.
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
require('dotenv').config({ path: path.join(__dirname, '../.env'), quiet: true });
const root = path.join(__dirname, '../prisma');
async function main() {
  const command = process.argv[2];
  if (command === 'generate') {
    const { getGenerators } = require('@prisma/internals');
    const { PrismaClientTsGenerator } = require('@prisma/client-generator-ts');
    const generators = await getGenerators({
      schemaPath: path.join(root, 'schema.prisma'),
      registry: { 'prisma-client': { type: 'in-process', generator: new PrismaClientTsGenerator() } },
      skipDownload: true,
      cliCommand: 'prisma generate',
    });
    try {
      for (const generator of generators) await generator.generate();
    } finally {
      for (const generator of generators) generator.stop();
    }
    console.log('Prisma client generated (WASM).');
    return;
  }
  if (command !== 'deploy') throw new Error('Usage: node scripts/prisma-wasm.cjs generate|deploy');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const { PrismaPg } = require('@prisma/adapter-pg');
  const { bindMigrationAwareSqlAdapterFactory } = require('@prisma/driver-adapter-utils');
  // Instantiate the WASM shipped by the pinned npm package, following Prisma's loader.
  const runtimePath = require.resolve('@prisma/schema-engine-wasm/schema_engine_bg');
  const runtime = await import(pathToFileURL(runtimePath).href);
  const module = new WebAssembly.Module(fs.readFileSync(path.join(path.dirname(runtimePath), 'schema_engine_bg.wasm')));
  const instance = new WebAssembly.Instance(module, { './schema_engine_bg.js': runtime });
  runtime.__wbg_set_wasm(instance.exports);
  instance.exports.__wbindgen_start();
  const engine = await runtime.SchemaEngine.new(
    { datamodels: undefined },
    () => {},
    bindMigrationAwareSqlAdapterFactory(new PrismaPg({ connectionString: process.env.DATABASE_URL })),
  );
  const filters = { externalTables: [], externalEnums: [] };
  try {
    const dir = path.join(root, 'migrations');
    const migrationsList = {
      baseDir: dir,
      lockfile: {
        path: 'migration_lock.toml',
        content: fs.readFileSync(path.join(dir, 'migration_lock.toml'), 'utf8'),
      },
      shadowDbInitScript: '',
      migrationDirectories: fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({
          path: entry.name,
          migrationFile: {
            path: 'migration.sql',
            content: { tag: 'ok', value: fs.readFileSync(path.join(dir, entry.name, 'migration.sql'), 'utf8') },
          },
        })),
    };
    console.log(await engine.applyMigrations({ migrationsList, filters }));
  } finally {
    engine.free();
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
