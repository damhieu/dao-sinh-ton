// Projectile kinematics shared by the bullet simulation and bot aim compensation. Pure module (no three.js).
export const BULLET_G = 9.81;

// Vertical drop (m) after travelling `dist` meters horizontally at `speed` m/s
export function dropAt(speed, dist) {
  const t = dist / speed;
  return 0.5 * BULLET_G * t * t;
}

// Exact constant-gravity step: b = {x,y,z,vx,vy,vz}
export function stepBullet(b, dt) {
  b.x += b.vx * dt;
  b.y += b.vy * dt - 0.5 * BULLET_G * dt * dt;
  b.z += b.vz * dt;
  b.vy -= BULLET_G * dt;
}
