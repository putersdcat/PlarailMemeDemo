/**
 * Top-down white bullet / Shinkansen train drawing.
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
 * Top-down white bullet train: blunt rounded nose = front (+x), black cockpit.
 */
export function drawTrain(ctx, train) {
  const { x, y, ang, mode } = train;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);

  // Body half-width = TRAIN_RADIUS; length uses TRAIN_LENGTH
  const L = TRAIN_LENGTH;
  const R = TRAIN_RADIUS;
  const nose = L * 0.5;
  const tail = -L * 0.5;
  // Rounded tip radius at the nose vertex
  const tipR = Math.min(R * 0.55, L * 0.08);

  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(1.5, 3.5, L * 0.46, R * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyPath = () => {
    // Soft bullet: sides taper, tip is a rounded cap (not a sharp point)
    ctx.beginPath();
    ctx.moveTo(tail + 6, -R);
    ctx.lineTo(L * 0.1, -R);
    ctx.quadraticCurveTo(L * 0.26, -R * 0.98, L * 0.36, -R * 0.72);
    ctx.quadraticCurveTo(L * 0.44, -R * 0.42, nose - tipR * 0.35, -tipR * 0.85);
    // Rounded vertex through the nose tip
    ctx.quadraticCurveTo(nose + tipR * 0.15, -tipR * 0.35, nose + tipR * 0.25, 0);
    ctx.quadraticCurveTo(nose + tipR * 0.15, tipR * 0.35, nose - tipR * 0.35, tipR * 0.85);
    ctx.quadraticCurveTo(L * 0.44, R * 0.42, L * 0.36, R * 0.72);
    ctx.quadraticCurveTo(L * 0.26, R * 0.98, L * 0.1, R);
    ctx.lineTo(tail + 6, R);
    ctx.quadraticCurveTo(tail - 1, R * 0.7, tail - 1, 0);
    ctx.quadraticCurveTo(tail - 1, -R * 0.7, tail + 6, -R);
    ctx.closePath();
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
  ctx.fillStyle = "rgba(120, 130, 140, 0.55)";
  roundRect(ctx, tail + 14, -1.5, L * 0.12, 3, 1.2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "#2a6cb0";
  ctx.beginPath();
  ctx.moveTo(L * 0.2, R * 0.52);
  ctx.quadraticCurveTo(L * 0.34, R * 0.7, L * 0.4, R * 0.32);
  ctx.quadraticCurveTo(L * 0.46, R * 0.12, nose - tipR * 0.4, R * 0.08);
  ctx.quadraticCurveTo(L * 0.42, R * 0.18, L * 0.32, R * 0.58);
  ctx.quadraticCurveTo(L * 0.24, R * 0.68, L * 0.2, R * 0.52);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#3a7ec4";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(L * 0.16, -R * 0.72);
  ctx.quadraticCurveTo(L * 0.3, -R * 0.88, L * 0.38, -R * 0.32);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(L * 0.16, R * 0.72);
  ctx.quadraticCurveTo(L * 0.3, R * 0.88, L * 0.38, R * 0.32);
  ctx.stroke();

  // Cockpit glass — follows rounded nose
  ctx.fillStyle = "#1a1e24";
  ctx.beginPath();
  ctx.moveTo(L * 0.14, -R * 0.4);
  ctx.lineTo(L * 0.28, -R * 0.48);
  ctx.quadraticCurveTo(L * 0.36, -R * 0.18, L * 0.38, 0);
  ctx.quadraticCurveTo(L * 0.36, R * 0.18, L * 0.28, R * 0.48);
  ctx.lineTo(L * 0.14, R * 0.4);
  ctx.quadraticCurveTo(L * 0.12, 0, L * 0.14, -R * 0.4);
  ctx.closePath();
  ctx.fill();
  const glassG = ctx.createLinearGradient(L * 0.16, -R * 0.3, L * 0.34, R * 0.3);
  glassG.addColorStop(0, "rgba(90, 140, 180, 0.35)");
  glassG.addColorStop(0.5, "rgba(40, 50, 60, 0.1)");
  glassG.addColorStop(1, "rgba(20, 25, 30, 0.4)");
  ctx.fillStyle = glassG;
  ctx.fill();
  ctx.strokeStyle = "rgba(30, 40, 50, 0.85)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  ctx.fillStyle = "#f0f4f8";
  ctx.beginPath();
  ctx.arc(nose - tipR * 0.6, -2.4, 1.3, 0, Math.PI * 2);
  ctx.arc(nose - tipR * 0.6, 2.4, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 230, 120, 0.85)";
  ctx.beginPath();
  ctx.arc(nose - tipR * 0.55, -2.4, 0.7, 0, Math.PI * 2);
  ctx.arc(nose - tipR * 0.55, 2.4, 0.7, 0, Math.PI * 2);
  ctx.fill();

  // Bogie shadows at virtual axle positions
  ctx.fillStyle = "rgba(55, 70, 85, 0.32)";
  const bogieXs = [FRONT_AXLE_OFFSET, REAR_AXLE_OFFSET];
  for (const wx of bogieXs) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(wx, side * R * 0.58, 5.5, 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Subtle stop tint only — no selection/off-rail orange rings
  if (mode === TrainMode.STOPPED) {
    ctx.strokeStyle = "rgba(226,85,85,0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.48, R + 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
