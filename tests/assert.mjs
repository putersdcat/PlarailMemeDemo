/** Tiny assert helpers (no test framework). */

export function test(name, fn) {
  // Replaced by runner when collecting; direct use for standalone:
  if (globalThis.__plarailTest) {
    globalThis.__plarailTest(name, fn);
    return;
  }
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message || err}`);
    throw err;
  }
}

export function assert(cond, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}

export function assertEq(a, b, msg) {
  if (a !== b) {
    throw new Error(
      msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`
    );
  }
}

export function assertApprox(a, b, eps = 1e-6, msg) {
  if (Math.abs(a - b) > eps) {
    throw new Error(msg || `expected ~${b} (±${eps}), got ${a}`);
  }
}
