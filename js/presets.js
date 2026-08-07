/**
 * Built-in layouts.
 * Default: gold-standard WORKING meme track (plarail-layout-WORKING-*).
 */

import { UNIT, PIECE_TYPES } from "./geometry.js";
import { addPiece, clearBoard, rebuild, loadBoard } from "./track.js";
import { ARNTENOUGHRAILS_LAYOUT } from "./layouts-arntenoughrails.js";
import { threeCarConsistSpec } from "./train/consist.js";

export { ARNTENOUGHRAILS_LAYOUT };

/** Absolute layout — functionally tested gold standard. */
export const REAL_MEME_LAYOUT = {
  "format": "plarail-meme-layout",
  "version": 1,
  "name": "Real-2-Sim meme track (20260806-2026)",
  "source": "plarail-layout-20260806-2026.json",
  "pieces": [
    {
      "id": "p1",
      "type": "R17",
      "x": 584.5762768884263,
      "y": 495.9059741054823,
      "rotSteps": 1,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p3",
      "type": "R01",
      "x": 446,
      "y": 653,
      "rotSteps": 0,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p4",
      "type": "R04",
      "x": 398,
      "y": 518.6,
      "rotSteps": 2,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "green"
    },
    {
      "id": "p5",
      "type": "R02",
      "x": 285.99428586005087,
      "y": 596.6645886429949,
      "rotSteps": 1,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p6",
      "type": "R08",
      "x": 235.0825976146195,
      "y": 545.7529003975634,
      "rotSteps": 1,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p7",
      "type": "R02",
      "x": 184.17090936918808,
      "y": 494.8412121521319,
      "rotSteps": 1,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p8",
      "type": "R105",
      "x": 235.0825976146195,
      "y": 409.9883984097462,
      "rotSteps": 3,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "red"
    },
    {
      "id": "p9",
      "type": "R01",
      "x": 269.02372311157376,
      "y": 240.28277092497484,
      "rotSteps": 3,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p10",
      "type": "R17",
      "x": 342.32969721705604,
      "y": 159.3064940365486,
      "rotSteps": 2,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p16",
      "type": "R20",
      "x": 657.670302782944,
      "y": 501.32969721705604,
      "rotSteps": 0,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p17",
      "type": "R105",
      "x": 669.670302782944,
      "y": 405.32969721705604,
      "rotSteps": 0,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "yellow"
    },
    {
      "id": "p19",
      "type": "R02",
      "x": 710,
      "y": 653,
      "rotSteps": 0,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p20",
      "type": "R01",
      "x": 782,
      "y": 653,
      "rotSteps": 0,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "gray"
    },
    {
      "id": "p21",
      "type": "R105",
      "x": 830,
      "y": 557,
      "rotSteps": 0,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p25",
      "type": "R20",
      "x": 790.8470996024366,
      "y": 377.7529003975635,
      "rotSteps": 0,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p30",
      "type": "R02",
      "x": 293.0237231115738,
      "y": 280.0472729127919,
      "rotSteps": 4,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p31",
      "type": "R11",
      "x": 201.14147211766522,
      "y": 308.1650219188834,
      "rotSteps": 7,
      "flip": true,
      "branchSide": "R",
      "switchState": 1,
      "color": "blue"
    },
    {
      "id": "p412",
      "type": "R20",
      "x": 329.0237231115738,
      "y": 280.0472729127919,
      "rotSteps": 4,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p417",
      "type": "R14",
      "x": 590,
      "y": 653,
      "rotSteps": 6,
      "flip": false,
      "branchSide": "R",
      "switchState": 1,
      "color": "blue"
    },
    {
      "id": "p421",
      "type": "R20",
      "x": 926,
      "y": 545,
      "rotSteps": 6,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p422",
      "type": "R11",
      "x": 926,
      "y": 485,
      "rotSteps": 6,
      "flip": false,
      "branchSide": "L",
      "switchState": 1,
      "color": "blue"
    },
    {
      "id": "p423",
      "type": "R04",
      "x": 802.8470996024366,
      "y": 512.1529003975635,
      "rotSteps": 6,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p424",
      "type": "R02",
      "x": 754.8470996024366,
      "y": 377.7529003975635,
      "rotSteps": 0,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p425",
      "type": "R01",
      "x": 926,
      "y": 389,
      "rotSteps": 2,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p426",
      "type": "R21",
      "x": 830,
      "y": 341,
      "rotSteps": 6,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "red"
    },
    {
      "id": "p427",
      "type": "R14",
      "x": 734,
      "y": 245.00000000000003,
      "rotSteps": 6,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p428",
      "type": "R02",
      "x": 614,
      "y": 245.00000000000006,
      "rotSteps": 0,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p429",
      "type": "R01",
      "x": 542,
      "y": 245.00000000000006,
      "rotSteps": 0,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p430",
      "type": "R11",
      "x": 446,
      "y": 245.00000000000006,
      "rotSteps": 4,
      "flip": false,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    },
    {
      "id": "p432",
      "type": "R02",
      "x": 374,
      "y": 245.00000000000006,
      "rotSteps": 0,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "red"
    },
    {
      "id": "p433",
      "type": "R105",
      "x": 448.8117749006092,
      "y": 495.9059741054823,
      "rotSteps": 5,
      "flip": true,
      "branchSide": "R",
      "switchState": 0,
      "color": "blue"
    }
  ],
  "train": {
    "x": 232.4119223098867,
    "y": 543.0822250928305,
    "ang": 0.7853981633974487,
    "mode": "idle",
    "speed": 210
  }
};

/**
 * Load the gold-standard Real-2-Sim meme track.
 */
export function loadRealMemeTrack(board) {
  const result = loadBoard(board, REAL_MEME_LAYOUT);
  const t = REAL_MEME_LAYOUT.train;
  const th = t
    ? { x: t.x, y: t.y, ang: t.ang, speed: t.speed ?? 210 }
    : {"x":232.4119223098867,"y":543.0822250928305,"ang":0.7853981633974487,"speed":210};
  return {
    ok: result.ok,
    pieceCount: result.pieceCount,
    trainHint: th,
    speed: th.speed,
    solidPlayfield: false,
    consist: null,
    note: `Loaded Real-2-Sim meme track (${result.pieceCount} pieces). Drag train onto a rail, then Start.`,
  };
}

/**
 * Load godi3 "not enough rails" meme track — sparse incomplete rails,
 * multi-car consist (lead + mid + reverse trail engine), solid walls.
 * https://x.com/godi3/status/945956752515670016
 */
export function loadArntenoughrailsTrack(board) {
  const result = loadBoard(board, ARNTENOUGHRAILS_LAYOUT);
  const t = ARNTENOUGHRAILS_LAYOUT.train;
  const th = t
    ? { x: t.x, y: t.y, ang: t.ang, speed: t.speed ?? 200 }
    : { x: 180, y: 580, ang: -Math.PI / 2, speed: 200 };
  const consist =
    t?.consist?.length >= 3 ? t.consist : threeCarConsistSpec();
  return {
    ok: result.ok,
    pieceCount: result.pieceCount,
    trainHint: th,
    speed: th.speed,
    solidPlayfield: true,
    northAlign: true,
    consist,
    note: `Loaded “Not enough rails” (${result.pieceCount} pieces, 3-car train, solid walls). Mid car in palette · 🦄 switches powered engine · Delete uncouples.`,
  };
}

/**
 * Built-in tracks for the Load dropdown (more entries will land here later).
 * @type {{ id: string, name: string, load: (board: object) => object }[]}
 */
export const TRACK_CATALOG = [
  {
    id: "real-meme",
    name: "Real-2-Sim meme track",
    load: loadRealMemeTrack,
  },
  {
    id: "arntenoughrails",
    name: "Not enough rails (godi3)",
    load: loadArntenoughrailsTrack,
  },
];

export function getTrackById(id) {
  return TRACK_CATALOG.find((t) => t.id === id) || TRACK_CATALOG[0] || null;
}

/** Alias used by older call sites. */
export function loadMemeStyle(board, _cx, _cy) {
  return loadRealMemeTrack(board);
}

export function loadOval(board, cx, cy) {
  clearBoard(board);
  for (let i = 0; i < 8; i++) {
    addPiece(board, PIECE_TYPES.R03, cx, cy, i, { flip: false });
  }
  rebuild(board);
  return { trainHint: { x: cx + UNIT, y: cy }, note: "Oval loop (8x R-03)." };
}

export function loadOpenRun(board, cx, cy) {
  clearBoard(board);
  for (let i = 0; i < 4; i++) {
    addPiece(board, PIECE_TYPES.R01, cx + i * UNIT, cy, 0);
  }
  rebuild(board);
  return { trainHint: { x: cx - UNIT / 2 + 20, y: cy } };
}
