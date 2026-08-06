/**
 * Pure helpers for demo loop cut (start-pose return after re-rail).
 * Used by scripts/record-demo.mjs; unit-tested without Playwright.
 */

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

/**
 * @param {{x:number,y:number,ang:number}|null} pose
 * @param {{x:number,y:number,ang:number}|null} start
 * @param {number} posTol
 * @param {number} angTol
 */
export function nearStart(pose, start, posTol = 40, angTol = 0.85) {
  if (!pose || !start) return false;
  const d = Math.hypot(pose.x - start.x, pose.y - start.y);
  if (d > posTol) return false;
  const a = angDiff(pose.ang, start.ang);
  const aFlip = angDiff(pose.ang, start.ang + Math.PI);
  return Math.min(a, aFlip) <= angTol;
}

/**
 * After re-rail: require leave-start then return, with min time.
 * @returns {{ close: boolean, away: boolean }}
 */
export function loopCloseState({
  pose,
  start,
  afterRerailMs,
  sawAwayAfterRerail,
  graceMs = 2500,
  minMs = 6000,
  awayDist = 140,
  posTol = 40,
  angTol = 0.85,
}) {
  if (!pose || !start) return { close: false, away: sawAwayAfterRerail };
  const d = Math.hypot(pose.x - start.x, pose.y - start.y);
  const away = sawAwayAfterRerail || d >= awayDist;
  const close =
    afterRerailMs >= Math.max(graceMs, minMs) &&
    away &&
    nearStart(pose, start, posTol, angTol);
  return { close, away };
}
