/**
 * Top-down white bullet / Shinkansen train drawing.
 */
import { TRAIN_LENGTH, TRAIN_RADIUS, TrainMode } from "../train.js";

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
 * Top-down white bullet train: pointed nose = front (+x), black cockpit.
 */
export function drawTrain(ctx, train) {
  const { x, y, ang, mode } = train;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);

  const L = TRAIN_LENGTH * 1.12;
  const R = TRAIN_RADIUS * 0.92;
  const nose = L * 0.52;
  const tail = -L * 0.48;

  if (train.selected) {
    ctx.strokeStyle = "rgba(240, 192, 64, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.52, R + 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(1.5, 3.5, L * 0.46, R * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyPath = () => {
    ctx.beginPath();
    ctx.moveTo(tail + 6, -R);
    ctx.lineTo(L * 0.12, -R);
    ctx.quadraticCurveTo(L * 0.28, -R * 0.95, L * 0.38, -R * 0.55);
    ctx.quadraticCurveTo(L * 0.46, -R * 0.2, nose, 0);
    ctx.quadraticCurveTo(L * 0.46, R * 0.2, L * 0.38, R * 0.55);
    ctx.quadraticCurveTo(L * 0.28, R * 0.95, L * 0.12, R);
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
  ctx.moveTo(L * 0.22, R * 0.55);
  ctx.quadraticCurveTo(L * 0.36, R * 0.75, L * 0.42, R * 0.35);
  ctx.quadraticCurveTo(L * 0.48, R * 0.1, nose - 1, 0);
  ctx.quadraticCurveTo(L * 0.44, R * 0.15, L * 0.34, R * 0.62);
  ctx.quadraticCurveTo(L * 0.26, R * 0.72, L * 0.22, R * 0.55);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#3a7ec4";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(L * 0.18, -R * 0.75);
  ctx.quadraticCurveTo(L * 0.32, -R * 0.9, L * 0.4, -R * 0.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(L * 0.18, R * 0.75);
  ctx.quadraticCurveTo(L * 0.32, R * 0.9, L * 0.4, R * 0.35);
  ctx.stroke();

  ctx.fillStyle = "#1a1e24";
  ctx.beginPath();
  ctx.moveTo(L * 0.16, -R * 0.42);
  ctx.lineTo(L * 0.3, -R * 0.5);
  ctx.quadraticCurveTo(L * 0.38, -R * 0.15, L * 0.4, 0);
  ctx.quadraticCurveTo(L * 0.38, R * 0.15, L * 0.3, R * 0.5);
  ctx.lineTo(L * 0.16, R * 0.42);
  ctx.quadraticCurveTo(L * 0.14, 0, L * 0.16, -R * 0.42);
  ctx.closePath();
  ctx.fill();
  const glassG = ctx.createLinearGradient(L * 0.18, -R * 0.3, L * 0.36, R * 0.3);
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
  ctx.arc(nose - 3.5, -2.2, 1.3, 0, Math.PI * 2);
  ctx.arc(nose - 3.5, 2.2, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 230, 120, 0.85)";
  ctx.beginPath();
  ctx.arc(nose - 3.2, -2.2, 0.7, 0, Math.PI * 2);
  ctx.arc(nose - 3.2, 2.2, 0.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(55, 70, 85, 0.35)";
  for (let i = 0; i < 4; i++) {
    const wx = tail + 12 + i * 7.5;
    ctx.beginPath();
    ctx.ellipse(wx, -R * 0.55, 2.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(wx, R * 0.55, 2.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (mode === TrainMode.OFF_RAIL) {
    ctx.strokeStyle = "rgba(230,162,60,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R + 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mode === TrainMode.STOPPED) {
    ctx.strokeStyle = "rgba(226,85,85,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}
