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
 */
export function drawTrainCar(ctx, car, mode = TrainMode.IDLE) {
  const { x, y, ang } = car;
  const kind = car.kind || (car.role === "mid" ? "mid" : "engine");
  const isMid = kind === "mid";
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);

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
          },
        ];
  // Draw trail first so lead paints on top
  for (let i = cars.length - 1; i >= 0; i--) {
    drawTrainCar(ctx, cars[i], train.mode);
  }
}

/** Green dome / ceramic pot freestanding obstacle. */
export function drawPot(ctx, pot) {
  if (!pot) return;
  const r = pot.r || 22;
  ctx.save();
  ctx.translate(pot.x, pot.y);
  ctx.rotate(pot.ang || 0);
  // Shadow
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(2, 3, r * 0.95, r * 0.55, 0, 0, Math.PI * 2);
  ctx.fill();
  // Dome body
  const col = pot.color || "#5aaf3a";
  const grd = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.1, 0, 0, r);
  grd.addColorStop(0, pot.knocked ? "#c4d86a" : "#8fd45a");
  grd.addColorStop(0.55, col);
  grd.addColorStop(1, pot.knocked ? "#4a6b28" : "#2f6b1e");
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.strokeStyle = "rgba(30,60,20,0.55)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Tunnel mouth (green dome vibe)
  if (pot.kind === "dome" || pot.kind === "tunnel") {
    ctx.fillStyle = "rgba(20, 30, 25, 0.85)";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.15, r * 0.42, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Pot rim
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -r * 0.15, r * 0.45, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (pot.knocked) {
    ctx.strokeStyle = "rgba(255, 200, 80, 0.7)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

