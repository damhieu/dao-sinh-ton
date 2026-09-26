// Analytic two-bone IK (shoulder-elbow-wrist). Works on plain {x,y,z} objects / THREE.Vector3.

// root: joint position, target: desired end position, a/b: bone lengths,
// pole: world direction the middle joint should bend toward. Writes outMid and outEnd.
export function solveTwoBone(root, target, a, b, pole, outMid, outEnd) {
  let dx = target.x - root.x;
  let dy = target.y - root.y;
  let dz = target.z - root.z;
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-5) {
    dx = 0;
    dy = -1;
    dz = 0;
    d = 1e-5;
  }
  dx /= d;
  dy /= d;
  dz /= d;
  const reach = Math.max(Math.abs(a - b) + 1e-3, Math.min(a + b - 1e-3, d));
  const cosA = (a * a + reach * reach - b * b) / (2 * a * reach);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  // bend direction = pole component perpendicular to the root->target axis
  const pd = pole.x * dx + pole.y * dy + pole.z * dz;
  let bx = pole.x - dx * pd;
  let by = pole.y - dy * pd;
  let bz = pole.z - dz * pd;
  const bl = Math.hypot(bx, by, bz) || 1;
  bx /= bl;
  by /= bl;
  bz /= bl;
  outMid.x = root.x + dx * a * cosA + bx * a * sinA;
  outMid.y = root.y + dy * a * cosA + by * a * sinA;
  outMid.z = root.z + dz * a * cosA + bz * a * sinA;
  outEnd.x = root.x + dx * reach;
  outEnd.y = root.y + dy * reach;
  outEnd.z = root.z + dz * reach;
}
