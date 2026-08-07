/**
 * Top-down white bullet / Shinkansen train drawing (single car or multi-consist).
 */
import {
  TRAIN_LENGTH,
  TRAIN_RADIUS,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
  TrainMode,
} from "../train.js";

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Draw one car body. kind: "engine" | "mid". Engines get nose glass; mid is boxy.
 * car.facing === -1 draws the same engine body reversed (trailing double-header).
 */
export function drawTrainCar(ctx, car, mode = TrainMode.IDLE) {
  const { x, y, ang } = car;
  const kind = car.kind || (car.role === "mid" ? "mid" : "engine");
  const isMid = kind === "mid";
  const facing = car.facing == null ? 1 : car.facing;
  ctx.save();
  ctx.translate(x, y);
  // facing -1: reverse visual body so nose points opposite travel ang
  ctx.rotate(ang + (facing < 0 ? Math.PI : 0));

  const L = TRAIN_LENGTH * (isMid ? 0.92 : 1);
  const R = TRAIN_RADIUS;
  const nose = L * 0.5;
  const tail = -L * 0.5;
  const tipR = isMid ? R * 0.35 : R * 0.9;
  const tipCx = nose - tipR;
  const pinchX = tipCx - (isMid ? 2 : R * 0.28);

  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(1.5, 3.5, L * 0.46, R * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyPath = () => {
    ctx.beginPath();
    if (isMid) {
      // Boxy middle car — rounded rectangle
      const rr = R * 0.35;
      ctx.moveTo(tail + rr, -R);
      ctx.lineTo(nose - rr, -R);
      ctx.quadraticCurveTo(nose, -R, nose, -R + rr);
      ctx.lineTo(nose, R - rr);
      ctx.quadraticCurveTo(nose, R, nose - rr, R);
      ctx.lineTo(tail + rr, R);
      ctx.quadraticCurveTo(tail, R, tail, R - rr);
      ctx.lineTo(tail, -R + rr);
      ctx.quadraticCurveTo(tail, -R, tail + rr, -R);
      ctx.closePath();
    } else {
      ctx.moveTo(tail + 6, -R);
      ctx.lineTo(pinchX - R * 0.35, -R);
      ctx.quadraticCurveTo(pinchX + R * 0.05, -R, tipCx, -tipR);
      ctx.arc(tipCx, 0, tipR, -Math.PI / 2, Math.PI / 2, false);
      ctx.quadraticCurveTo(pinchX + R * 0.05, R, pinchX - R * 0.35, R);
      ctx.lineTo(tail + 6, R);
      ctx.quadraticCurveTo(tail - 1, R * 0.7, tail - 1, 0);
      ctx.quadraticCurveTo(tail - 1, -R * 0.7, tail + 6, -R);
      ctx.closePath();
    }
  };

  const grd = ctx.createLinearGradient(tail, 0, nose, 0);
  grd.addColorStop(0, "#eef1f4");
  grd.addColorStop(0.35, "#ffffff");
  grd.addColorStop(0.85, "#f7f9fb");
  grd.addColorStop(1, "#e8eef4");
  bodyPath();
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.strokeStyle = "#c5ccd4";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  ctx.save();
  bodyPath();
  ctx.clip();
  const roofG = ctx.createLinearGradient(0, -R, 0, R);
  roofG.addColorStop(0, "rgba(255,255,255,0.55)");
  roofG.addColorStop(0.45, "rgba(255,255,255,0)");
  roofG.addColorStop(1, "rgba(200,210,220,0.25)");
  ctx.fillStyle = roofG;
  ctx.fillRect(tail - 4, -R - 2, L + 12, R * 2 + 4);
  ctx.fillStyle = "rgba(170, 180, 190, 0.75)";
  roundRect(ctx, tail + 10, -2.6, L * 0.38, 5.2, 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "#3a7ec4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tail + 14, -R * 0.72);
  ctx.lineTo(nose - (isMid ? 10 : tipR + 8), -R * 0.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tail + 14, R * 0.72);
  ctx.lineTo(nose - (isMid ? 10 : tipR + 8), R * 0.72);
  ctx.stroke();

  if (!isMid) {
    const glassFront = tipCx - tipR * 0.05;
    const glassRear = tipCx - tipR * 1.45;
    const glassHalfH = R * 0.58;
    const tipJoin = glassRear + tipR * 0.35;
    const crescentPath = () => {
      ctx.beginPath();
      ctx.moveTo(tipJoin, -glassHalfH);
      ctx.bezierCurveTo(
        glassFront + tipR * 0.55,
        -glassHalfH * 0.5,
        glassFront + tipR * 0.55,
        glassHalfH * 0.5,
        tipJoin,
        glassHalfH
      );
      ctx.bezierCurveTo(
        glassRear + tipR * 0.35,
        glassHalfH * 0.42,
        glassRear + tipR * 0.35,
        -glassHalfH * 0.42,
        tipJoin,
        -glassHalfH
      );
      ctx.closePath();
    };
    ctx.fillStyle = "#1a1e24";
    crescentPath();
    ctx.fill();
    const glassG = ctx.createLinearGradient(
      glassRear,
      -glassHalfH,
      glassFront + tipR * 0.35,
      glassHalfH
    );
    glassG.addColorStop(0, "rgba(90, 140, 180, 0.42)");
    glassG.addColorStop(0.45, "rgba(40, 50, 60, 0.12)");
    glassG.addColorStop(1, "rgba(20, 25, 30, 0.5)");
    ctx.fillStyle = glassG;
    crescentPath();
    ctx.fill();

    ctx.fillStyle = "#f0f4f8";
    ctx.beginPath();
    ctx.arc(tipCx + tipR * 0.78, -R * 0.26, 1.5, 0, Math.PI * 2);
    ctx.arc(tipCx + tipR * 0.78, R * 0.26, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 230, 120, 0.9)";
    ctx.beginPath();
    ctx.arc(tipCx + tipR * 0.84, -R * 0.26, 0.75, 0, Math.PI * 2);
    ctx.arc(tipCx + tipR * 0.84, R * 0.26, 0.75, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(55, 70, 85, 0.32)";
  const bogieXs = [FRONT_AXLE_OFFSET, REAR_AXLE_OFFSET];
  for (const wx of bogieXs) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(wx, side * R * 0.58, 5.5, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (mode === TrainMode.STOPPED) {
    ctx.strokeStyle = "rgba(226,85,85,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.48, R + 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Powered engine highlight ring
  if (car.powered) {
    ctx.strokeStyle = "rgba(80, 200, 120, 0.85)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, R + 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (car.selected) {
    ctx.strokeStyle = "rgba(58, 143, 214, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, R + 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Short thin white plastic Plarail-style coupler bar (fixed gap, not elastic).
 */
export function drawCouplerLink(ctx, link) {
  if (!link) return;
  const dx = link.x2 - link.x1;
  const dy = link.y2 - link.y1;
  const len = Math.hypot(dx, dy) || 1;
  if (len < 4) return;
  // Pull ends slightly inward so the bar sits cleanly in the gap
  const ux = dx / len;
  const uy = dy / len;
  const inset = Math.min(2.5, len * 0.12);
  const x1 = link.x1 + ux * inset;
  const y1 = link.y1 + uy * inset;
  const x2 = link.x2 - ux * inset;
  const y2 = link.y2 - uy * inset;
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(x1 + 0.8, y1 + 1.2);
  ctx.lineTo(x2 + 0.8, y2 + 1.2);
  ctx.stroke();
  ctx.strokeStyle = "#f2f5f8";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.fillStyle = "#eef2f6";
  ctx.strokeStyle = "rgba(130,140,150,0.65)";
  ctx.lineWidth = 0.7;
  for (const p of [
    [x1, y1],
    [x2, y2],
  ]) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 1.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Top-down white train: draws full consist (trail → mid → lead) or single body.
 */
export function drawTrain(ctx, train) {
  const cars =
    train.cars && train.cars.length > 0
      ? train.cars
      : [
          {
            x: train.x,
            y: train.y,
            ang: train.ang,
            role: "lead",
            kind: "engine",
            facing: 1,
            powered: true,
          },
        ];

  // Short white plastic coupler bars in the air gap between body shells
  {
    const powered = cars.find((c) => c.powered) || cars[0];
    const ord = [powered];
    for (const c of cars) {
      if (c !== powered && c.coupled !== false) ord.push(c);
    }
    for (let i = 1; i < ord.length; i++) {
      const prev = ord[i - 1];
      const car = ord[i];
      if (car.coupled === false) continue;
      // Body half-length (mid cars slightly shorter visually)
      const halfPrev =
        TRAIN_LENGTH * ((prev.kind === "mid" ? 0.92 : 1) * 0.5);
      const halfCar =
        TRAIN_LENGTH * ((car.kind === "mid" ? 0.92 : 1) * 0.5);
      const x1 = prev.x - Math.cos(prev.ang) * halfPrev;
      const y1 = prev.y - Math.sin(prev.ang) * halfPrev;
      const x2 = car.x + Math.cos(car.ang) * halfCar;
      const y2 = car.y + Math.sin(car.ang) * halfCar;
      drawCouplerLink(ctx, { x1, y1, x2, y2 });
    }
  }

  // Draw trail first so lead paints on top
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = { ...cars[i] };
    if (train.selectedCarId && c.id === train.selectedCarId) c.selected = true;
    drawTrainCar(ctx, c, train.mode);
  }
}

/** Render a small train icon for the palette (same idea as track piece canvases). */
export function drawPaletteTrainIcon(canvas, kind = "engine") {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1e2229";
  ctx.fillRect(0, 0, w, h);
  const car = {
    x: w / 2,
    y: h / 2,
    ang: 0,
    kind: kind === "mid" ? "mid" : "engine",
    facing: kind === "trail" ? -1 : 1,
    role: kind === "mid" ? "mid" : "lead",
    powered: kind === "engine",
  };
  ctx.save();
  // Scale down for icon
  ctx.translate(w / 2, h / 2);
  ctx.scale(0.42, 0.42);
  ctx.translate(-w / 2, -h / 2);
  drawTrainCar(ctx, { ...car, x: w / 2, y: h / 2 }, TrainMode.IDLE);
  ctx.restore();
}
