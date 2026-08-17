import {
  angleDiff,
  normalizeAngle,
  pointOnPolyline,
} from "../geometry.js";

export function livePathForRef(board, ref) {
  if (!board || !ref) return null;
  return (
    board.pathIndex?.find(
      (path) =>
        path.active &&
        path.pieceId === ref.pieceId &&
        path.id === ref.pathId
    ) || null
  );
}

function connectedPathCandidates(
  board,
  nodeKey,
  excludedKey,
  desiredDir,
  travelAng
) {
  const graph = board?.graph;
  if (!graph?.nodes) return [];
  const queue = [nodeKey];
  const seen = new Set([nodeKey]);
  const candidates = [];
  while (queue.length) {
    const key = queue.shift();
    const node = graph.nodes.get(key);
    if (!node) continue;
    for (const edge of node.edges || []) {
      if (edge.link) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          queue.push(edge.to);
        }
        continue;
      }
      const path = edge.path;
      if (!path?.active) continue;
      const pathKey = `${path.pieceId}:${path.id}`;
      if (pathKey === excludedKey) continue;
      const candidateDir = edge.reverse ? 1 : -1;
      const endpointS = candidateDir > 0 ? 1 : 0;
      const endpoint = pointOnPolyline(path.points, endpointS);
      const entryAng =
        candidateDir > 0
          ? endpoint.ang
          : normalizeAngle(endpoint.ang + Math.PI);
      candidates.push({
        path,
        dir: candidateDir,
        s: endpointS,
        err: angleDiff(entryAng, travelAng),
        dirPenalty: candidateDir === desiredDir ? 0 : Math.PI,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      a.err * 2 + a.dirPenalty * 0.05 -
      (b.err * 2 + b.dirPenalty * 0.05)
  );
  return candidates;
}

/** Return a front-axle path pose a fixed route distance behind a rail entity. */
export function pathPoseBehind(board, entity, distance) {
  let path = livePathForRef(board, entity?.pathRef);
  if (!path || path.length <= 1e-6) return null;
  let dir = entity.dir === -1 ? -1 : 1;
  let s = Math.max(0, Math.min(1, Number(entity.s) || 0));
  let remaining = Math.max(0, distance);
  const travelPose = pointOnPolyline(path.points, s);
  const travelAng =
    dir > 0 ? travelPose.ang : normalizeAngle(travelPose.ang + Math.PI);

  for (let hop = 0; hop < 64; hop++) {
    const length = Math.max(path.length || 0, 1e-6);
    const available = dir > 0 ? s * length : (1 - s) * length;
    if (remaining <= available + 1e-6) {
      const targetS =
        dir > 0 ? s - remaining / length : s + remaining / length;
      const target = pointOnPolyline(path.points, targetS);
      const ang =
        dir > 0 ? target.ang : normalizeAngle(target.ang + Math.PI);
      return { path, s: targetS, dir, x: target.x, y: target.y, ang };
    }

    remaining -= available;
    const nodeKey = `${path.pieceId}:${dir > 0 ? path.fromC : path.toC}`;
    const next = connectedPathCandidates(
      board,
      nodeKey,
      `${path.pieceId}:${path.id}`,
      dir,
      travelAng
    )[0];
    if (!next) return null;
    path = next.path;
    dir = next.dir;
    s = next.s;
  }
  return null;
}
