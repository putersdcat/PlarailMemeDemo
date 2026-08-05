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
 * Top-down white train: airplane-style rounded nose (+x), black cockpit.
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
  // Nose: slight inward waist, then semicircle rounds it off
  const tipR = R * 0.9;
  const tipCx = nose - tipR;
  const pinchX = tipCx - R * 0.28; // start of inward bend
  const pinchR = R * 0.78; // waist half-width before the dome

  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(1.5, 3.5, L * 0.46, R * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  const bodyPath = () => {
    // Parallel fuselage → slight inward pinch → semicircle nose
    ctx.beginPath();
    ctx.moveTo(tail + 6, -R);
    ctx.lineTo(pinchX - R * 0.35, -R);
    // Inward bend into the waist, then up to dome start
    ctx.quadraticCurveTo(pinchX + R * 0.05, -R, tipCx, -tipR);
    ctx.arc(tipCx, 0, tipR, -Math.PI / 2, Math.PI / 2, false);
    ctx.quadraticCurveTo(pinchX + R * 0.05, R, pinchX - R * 0.35, R);
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

  // Blue side stripe along fuselage (stops before the pinch)
  ctx.strokeStyle = "#3a7ec4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(tail + 14, -R * 0.72);
  ctx.lineTo(pinchX - 4, -R * 0.72);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tail + 14, R * 0.72);
  ctx.lineTo(pinchX - 4, R * 0.72);
  ctx.stroke();

  // Windshield: fatter crescent (more length along train), rounded edge forward
  const glassFront = tipCx - tipR * 0.05; // near dome, still slightly set back
  const glassRear = tipCx - tipR * 1.45; // deeper toward body → fatter lengthwise
  const glassHalfH = R * 0.58;
  const tipJoin = glassRear + tipR * 0.35; // crescent tips sit further aft
  const crescentPath = () => {
    ctx.beginPath();
    // Top tip of crescent
    ctx.moveTo(tipJoin, -glassHalfH);
    // Outer arc — convex / rounded edge toward the nose (+x)
    ctx.bezierCurveTo(
      glassFront + tipR * 0.55,
      -glassHalfH * 0.5,
      glassFront + tipR * 0.55,
      glassHalfH * 0.5,
      tipJoin,
      glassHalfH
    );
    // Inner arc — concave scoop toward the rear (−x), deeper for thickness
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
  ctx.strokeStyle = "rgba(30, 40, 50, 0.85)";
  ctx.lineWidth = 0.85;
  crescentPath();
  ctx.stroke();

  // Headlights on the rounded nose tip
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

  // Bogie shadows at physics axle positions
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
