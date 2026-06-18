/** URDF roll-pitch-yaw (fixed axis X-Y-Z) to quaternion [x, y, z, w]. */
export function rpyToQuaternion(rpy: [number, number, number]): [number, number, number, number] {
  const [roll, pitch, yaw] = rpy;
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);

  return [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ];
}

export interface Transform3D {
  xyz: [number, number, number];
  quat: [number, number, number, number];
}

export function composeTransforms(
  parent: Transform3D,
  local: { xyz: [number, number, number]; rpy: [number, number, number] },
): Transform3D {
  const localQuat = rpyToQuaternion(local.rpy);
  const rotatedOffset = rotateVectorByQuat(local.xyz, parent.quat);

  return {
    xyz: [
      parent.xyz[0] + rotatedOffset[0],
      parent.xyz[1] + rotatedOffset[1],
      parent.xyz[2] + rotatedOffset[2],
    ],
    quat: multiplyQuaternions(parent.quat, localQuat),
  };
}

export function rotateVectorByQuat(
  v: [number, number, number],
  q: [number, number, number, number],
): [number, number, number] {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;

  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;

  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

function multiplyQuaternions(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function rapierRotation(quat: [number, number, number, number]): {
  x: number;
  y: number;
  z: number;
  w: number;
} {
  return { x: quat[0], y: quat[1], z: quat[2], w: quat[3] };
}
