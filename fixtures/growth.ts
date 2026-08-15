// ═══════════════════════════════════════════════════════════════════════════
// GROWTH, not wall clock.
//
// Several scans in `src/errors/` have been quadratic in the number of marks an
// input carries, and each regression was caught by a test that timed one input
// and compared the answer to a fixed number of milliseconds. That shape cannot
// survive a release gate. `.github/workflows/release.yml` runs the whole suite,
// under v8 coverage instrumentation, on a shared runner, and a fixed budget
// there measures the runner rather than the code: round 23 recorded one such
// test at 314 ms against a 100 ms bound while passing on the same tree three
// runs out of four, and the audit that replaced it with a 4x ratio at a bound
// of 9 watched the ratio itself reach 19.98 under full-suite contention.
//
// What survives is a ratio across a WIDE size step, read from the FASTEST of
// several attempts:
//
//  * A ratio cancels the machine. Whatever one unit of work costs, quadratic
//    growth squares with the input and linear growth does not.
//  * 16x separates the two answers by an order of magnitude — linear lands near
//    16 and quadratic near 256 — so the bound can sit far from both. A 4x step
//    leaves linear at 4 and quadratic at 16, and contention alone crosses that
//    gap.
//  * The FASTEST attempt is the robust statistic here. Contention, GC, and
//    instrumentation only ever ADD time, so noise inflates a sample and never
//    deflates one. A mean carries every stall into the verdict; a minimum
//    carries none.
//
// No function in this file asserts. A caller compares the factor it returns to
// `LINEAR_GROWTH_BOUND`, so the bound is one number in one place.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The growth factor a LINEAR scan must stay under across a 16x step.
 *
 * Linear growth answers about 16 and quadratic about 256. This sits between
 * them, far enough above 16 that a stalled runner cannot reach it and far
 * enough below 256 that a quadratic scan cannot hide under it.
 */
export const LINEAR_GROWTH_BOUND = 40;

/** How many times each input is run. The fastest attempt is the measurement. */
const ATTEMPTS = 5;

/**
 * The floor a single measurement is held at, in milliseconds.
 *
 * `performance.now()` can answer 0 for a fast enough run, and a zero
 * denominator turns the factor into `Infinity` — a failure with no defect
 * behind it.
 */
const FLOOR_MS = 0.05;

/** The fastest of `ATTEMPTS` runs of `run` over `input`, in milliseconds. */
function fastest(input: string, run: (value: string) => unknown): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const started = performance.now();
    run(input);
    best = Math.min(best, performance.now() - started);
  }
  return Math.max(best, FLOOR_MS);
}

/**
 * How much slower `run` gets when its input grows 16 times.
 *
 * `build` takes a UNIT COUNT, not a byte count, so the two inputs differ in the
 * number of marks the scan under test walks — which is the quantity the
 * quadratic regressions grew with.
 *
 * The first attempt inside `fastest` pays for compilation and tier-up, and the
 * minimum discards it, so no separate warm-up pass is needed.
 */
export function growthAcross16x(
  build: (units: number) => string,
  run: (value: string) => unknown,
  units: number,
): number {
  const small = build(units);
  const large = build(units * 16);
  return fastest(large, run) / fastest(small, run);
}
