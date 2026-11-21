// 列主序 mat4（WebGL 约定），只实现本项目用到的变换
export type Mat4 = Float32Array;

export function m4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function m4Mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function m4Perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function m4LookAt(eye: [number, number, number], center: [number, number, number], up: [number, number, number]): Mat4 {
  const [ex, ey, ez] = eye;
  let zx = ex - center[0], zy = ey - center[1], zz = ez - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * ex + xy * ey + xz * ez);
  m[13] = -(yx * ex + yy * ey + yz * ez);
  m[14] = -(zx * ex + zy * ey + zz * ez);
  m[15] = 1;
  return m;
}

export function m4Translate(x: number, y: number, z: number): Mat4 {
  const m = m4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function m4Scale(s: number): Mat4 {
  const m = m4Identity();
  m[0] = m[5] = m[10] = s;
  return m;
}

export function m4RotateY(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  const m = m4Identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}

export function m4RotateX(rad: number): Mat4 {
  const c = Math.cos(rad), s = Math.sin(rad);
  const m = m4Identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}

/** 轨道相机 */
export class OrbitCamera {
  yaw = 0.7;
  pitch = 0.55;
  distance = 2.6;
  target: [number, number, number] = [0, 0.05, 0];
  fovy = Math.PI / 4;
  near = 0.05;
  far = 30;

  eye(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  view(): Mat4 {
    return m4LookAt(this.eye(), this.target, [0, 1, 0]);
  }

  proj(aspect: number): Mat4 {
    return m4Perspective(this.fovy, aspect, this.near, this.far);
  }

  vp(aspect: number): Mat4 {
    return m4Mul(this.proj(aspect), this.view());
  }

  /** 绑定鼠标/触控拖拽与滚轮，返回解绑函数 */
  attach(canvas: HTMLCanvasElement): () => void {
    let dragging = false;
    let lx = 0, ly = 0;
    const down = (x: number, y: number) => { dragging = true; lx = x; ly = y; };
    const move = (x: number, y: number) => {
      if (!dragging) return;
      this.yaw -= (x - lx) * 0.008;
      this.pitch = Math.max(0.08, Math.min(1.45, this.pitch + (y - ly) * 0.008));
      lx = x; ly = y;
    };
    const up = () => { dragging = false; };
    const md = (e: MouseEvent) => down(e.clientX, e.clientY);
    const mm = (e: MouseEvent) => move(e.clientX, e.clientY);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.distance = Math.max(0.5, Math.min(8, this.distance * (1 + Math.sign(e.deltaY) * 0.08)));
    };
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY);
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
    };
    canvas.addEventListener('mousedown', md);
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('touchstart', ts);
    canvas.addEventListener('touchmove', tm);
    canvas.addEventListener('touchend', up);
    return () => {
      canvas.removeEventListener('mousedown', md);
      window.removeEventListener('mousemove', mm);
      window.removeEventListener('mouseup', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('touchstart', ts);
      canvas.removeEventListener('touchmove', tm);
      canvas.removeEventListener('touchend', up);
    };
  }
}
