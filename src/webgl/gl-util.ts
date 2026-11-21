// WebGL2 通用工具：着色器编译 / 网格构建 / 实例缓冲
import type { Mat4 } from './mat4';

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败:\n' + log + '\n--- 源码 ---\n' + src);
  }
  return sh;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('程序链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
}

/** 由 positions([x,y,z,...]) + normals + indices 建网格 */
export function makeMesh(
  gl: WebGL2RenderingContext,
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint16Array | Uint32Array,
): Mesh {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  bindArrayBuffer(gl, 0, positions, 3);
  bindArrayBuffer(gl, 1, normals, 3);
  const ibo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: indices.length };
}

export function bindArrayBuffer(gl: WebGL2RenderingContext, loc: number, data: Float32Array, size: number): WebGLBuffer {
  const bo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, bo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  return bo;
}

/** 实例属性缓冲（动态更新用） */
export class InstanceBuffer {
  private gl: WebGL2RenderingContext;
  private bo: WebGLBuffer;
  private loc: number;
  private size: number;
  constructor(gl: WebGL2RenderingContext, loc: number, size: number, floatsPerInstance: number) {
    this.gl = gl; this.loc = loc; this.size = size;
    this.bo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bo);
    gl.bufferData(gl.ARRAY_BUFFER, floatsPerInstance * size * 4, gl.DYNAMIC_DRAW);
  }
  update(data: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.enableVertexAttribArray(this.loc);
    gl.vertexAttribPointer(this.loc, this.size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(this.loc, 1);
  }
}

export function setUniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, vals: Record<string, number | number[] | Mat4 | boolean>): void {
  for (const [name, v] of Object.entries(vals)) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc == null) continue;
    if (typeof v === 'number') gl.uniform1f(loc, v);
    else if (typeof v === 'boolean') gl.uniform1i(loc, v ? 1 : 0);
    else if (v.length === 16) gl.uniformMatrix4fv(loc, false, v as Float32Array);
    else if (v.length === 3) gl.uniform3fv(loc, v as number[]);
    else if (v.length === 4) gl.uniform4fv(loc, v as number[]);
    else if (v.length === 2) gl.uniform2fv(loc, v as number[]);
  }
}

/** UV 球（低面数，实例颗粒的基础形体） */
export function makeSphere(gl: WebGL2RenderingContext, stacks = 7, sectors = 10): Mesh {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= stacks; i++) {
    const phi = (i / stacks) * Math.PI;
    for (let j = 0; j <= sectors; j++) {
      const theta = (j / sectors) * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      pos.push(x, y, z); nor.push(x, y, z);
    }
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < sectors; j++) {
      const a = i * (sectors + 1) + j;
      const b = a + sectors + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return makeMesh(gl, new Float32Array(pos), new Float32Array(nor), new Uint16Array(idx));
}

/** 圆柱/圆锥台（侧壁），topR/botR */
export function makeCylinderSide(gl: WebGL2RenderingContext, topR: number, botR: number, h: number, seg = 48): Mesh {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  const slope = (topR - botR) / h;
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const nl = Math.hypot(slope, 1);
    const nx = c / nl, nz = s / nl, ny = -slope / nl;
    pos.push(topR * c, h / 2, topR * s, botR * c, -h / 2, botR * s);
    nor.push(nx, ny, nz, nx, ny, nz);
  }
  for (let j = 0; j < seg; j++) {
    const a = j * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, c, d, b);
  }
  return makeMesh(gl, new Float32Array(pos), new Float32Array(nor), new Uint16Array(idx));
}

/** 圆盘（顶面法线 +y） */
export function makeDisc(gl: WebGL2RenderingContext, seg = 64): Mesh {
  const pos: number[] = [0, 0, 0], nor: number[] = [0, 1, 0], idx: number[] = [];
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2;
    pos.push(Math.cos(a), 0, Math.sin(a));
    nor.push(0, 1, 0);
  }
  for (let j = 1; j <= seg; j++) idx.push(0, j + 1, j);
  return makeMesh(gl, new Float32Array(pos), new Float32Array(nor), new Uint16Array(idx));
}

/** 细圆管（圆环），用圆柱侧面旋转近似太麻烦，直接生成环 */
export function makeTorus(gl: WebGL2RenderingContext, R: number, r: number, seg = 64, tube = 8): Mesh {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2;
    for (let j = 0; j <= tube; j++) {
      const v = (j / tube) * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = r * Math.sin(v);
      const z = (R + r * Math.cos(v)) * Math.sin(u);
      pos.push(x, y, z);
      nor.push(Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u));
    }
  }
  const row = tube + 1;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < tube; j++) {
      const a = i * row + j, b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return makeMesh(gl, new Float32Array(pos), new Float32Array(nor), new Uint16Array(idx));
}
