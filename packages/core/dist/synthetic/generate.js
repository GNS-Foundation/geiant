#!/usr/bin/env tsx
"use strict";
// =============================================================================
// GEIANT — DATASET GENERATOR CLI
// Run: tsx src/synthetic/generate.ts [output-dir]
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
const exporter_1 = require("./export/exporter");
const path_1 = require("path");
const outputDir = process.argv[2] ?? (0, path_1.join)(process.cwd(), 'dataset-output');
console.log('\n🐜 GEIANT — Synthetic Dataset Generator');
console.log('   Geo-Identity Agent Navigation & Tasking\n');
console.log(`📁 Output directory: ${outputDir}\n`);
const manifest = (0, exporter_1.runExportPipeline)(outputDir);
console.log('✅ Dataset generated successfully!\n');
console.log('📊 Summary:');
console.log(`   Total records  : ${manifest.total_records}`);
for (const [family, count] of Object.entries(manifest.records_by_family)) {
    console.log(`     · ${family.padEnd(30)} ${count} records`);
}
console.log(`\n   By difficulty:`);
for (const [diff, count] of Object.entries(manifest.records_by_difficulty)) {
    console.log(`     · ${diff.padEnd(15)} ${count}`);
}
console.log(`\n   By outcome:`);
for (const [outcome, count] of Object.entries(manifest.records_by_outcome ?? {})) {
    console.log(`     · ${outcome.padEnd(30)} ${count}`);
}
console.log(`\n📄 Output: ${outputDir}/`);
console.log(`\n🚀 Next: huggingface-cli upload GNS-Foundation/geiant-geospatial-agent-benchmark ${outputDir}\n`);
//# sourceMappingURL=generate.js.map