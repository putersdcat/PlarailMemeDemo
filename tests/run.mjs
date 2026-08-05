/**
 * Simple library-free test runner (Node ESM).
 * Run: node tests/run.mjs   or   npm test
 */
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;

globalThis.__plarailTest = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message || err}`);
  }
};

const files = readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

console.log(`\nPlarail tests (${files.length} files)\n`);

for (const f of files) {
  console.log(f);
  await import(pathToFileURL(join(__dirname, f)).href);
  console.log("");
}

console.log(`Results: ${passed} passed, ${failed} failed\n`);
if (failed) process.exitCode = 1;
