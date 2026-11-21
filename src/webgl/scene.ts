// 炭焙三维场景：焙窟/炭面/盖灰/焙笼/5000 颗粒实例化渲染、剖面、ID 拾取
import { OrbitCamera, m4Identity, m4Mul, m4Translate, type Mat4 } from './mat4';
import {
  createProgram, makeMesh, makeSphere, makeCylinderSide, makeDisc, makeTorus,
  InstanceBuffer, setUniforms, type Mesh,
} from './gl-util';
import { PELLET_VS, PELLET_FS, HEATDISC_VS, HEATDISC_FS, STANDARD_VS, STANDARD_FS } from './shaders';
import type { SceneAdapter, SceneFrame } from './adapter';
import type { BasketConfig } from '../types';
import { charcoalCenterTemp, radialFactor } from '../sim/temperature';

export interface SceneOptions {
  showHeatmap: boolean;   // 炭面温度分布热力
  showCut: boolean;       // 剖面
  cutHeightM: number;     // 剖面高度（米，床局部 y）
  firePower: number;
  ashCm: number;
  phase: 'roast' | 'cool';
  layerHeats: [number, number, number]; // 上中下平均火功（剖面色带）
}

export interface PickedInfo {
  id: number;
  temp: number;
  heat: number;
}

const NO_CLIP: [number, number, number, number] = [0, 1, 0, 999];

export class RoastScene {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly camera: OrbitCamera;
  private adapter: SceneAdapter;
  private cfg: BasketConfig;

  private pelletProg: WebGLProgram;
  private discProg: WebGLProgram;
  private stdProg: WebGLProgram;
  private sphere: Mesh;
  private inst: {
    off: InstanceBuffer; size: InstanceBuffer; shape: InstanceBuffer;
    state: InstanceBuffer; pick: InstanceBuffer;
  };
  private stateData: Float32Array;
  private pickData: Float32Array;
  private offData: Float32Array;
  private sizeData: Float32Array;
  private shapeData: Float32Array;

  private staticMeshes: { mesh: Mesh; model: Mat4; color: [number, number, number]; kind: number }[] = [];
  private charDisc: Mesh;
  private ashDisc: Mesh;
  private cutDisc: Mesh;
  private charModel: Mat4;
  private ashModel: Mat4;
  private cutModel: Mat4;

  // 拾取离屏缓冲
  private pickFbo: WebGLFramebuffer;
  private pickTex: WebGLTexture;
  private pickRbo: WebGLRenderbuffer;
  private pickW = 0; private pickH = 0;

  opts: SceneOptions = {
    showHeatmap: true, showCut: false, cutHeightM: 0.05,
    firePower: 0.6, ashCm: 3, phase: 'roast',
    layerHeats: [0, 0, 0],
  };

  private turnMix = 1; // 1=静止
  private turnSeed = 0;
  private currentFrame: SceneFrame;
  private detachCam: () => void;
  private raf = 0;
  private disposed = false;
  onPick: ((info: PickedInfo | null) => void) | null = null;
  private downXY: [number, number] | null = null;

  constructor(canvas: HTMLCanvasElement, adapter: SceneAdapter, cfg: BasketConfig) {
    this.canvas = canvas;
    this.adapter = adapter;
    this.cfg = cfg;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.camera = new OrbitCamera();
    this.camera.target = [0, 0.02, 0];

    this.pelletProg = createProgram(gl, PELLET_VS, PELLET_FS);
    this.discProg = createProgram(gl, HEATDISC_VS, HEATDISC_FS);
    this.stdProg = createProgram(gl, STANDARD_VS, STANDARD_FS);
    this.sphere = makeSphere(gl);

    const n = adapter.count;
    this.offData = new Float32Array(n * 3);
    this.sizeData = new Float32Array(n);
    this.shapeData = new Float32Array(n);
    this.stateData = new Float32Array(n * 2);
    this.pickData = new Float32Array(n);
    gl.bindVertexArray(this.sphere.vao);
    this.inst = {
      off: new InstanceBuffer(gl, 2, 3, n * 3),
      size: new InstanceBuffer(gl, 3, 1, n),
      shape: new InstanceBuffer(gl, 4, 1, n),
      state: new InstanceBuffer(gl, 5, 2, n * 2),
      pick: new InstanceBuffer(gl, 6, 1, n),
    };
    gl.bindVertexArray(null);

    this.buildStatic();
    this.charDisc = makeDisc(gl);
    this.ashDisc = makeDisc(gl);
    this.cutDisc = makeDisc(gl);
    const r = cfg.pitDiameterCm / 200;
    this.charModel = m4Translate(0, -cfg.pitDepthCm / 100 + 0.012, 0);
    this.ashModel = m4Translate(0, -cfg.pitDepthCm / 100 + 0.018, 0);
    this.cutModel = m4Identity();

    const fbo = gl.createFramebuffer()!;
    const tex = gl.createTexture()!;
    const rbo = gl.createRenderbuffer()!;
    this.pickFbo = fbo; this.pickTex = tex; this.pickRbo = rbo;

    this.currentFrame = adapter.initial();
    this.detachCam = this.camera.attach(canvas);
    canvas.addEventListener('mousedown', this.handleDown);
    canvas.addEventListener('mouseup', this.handleUp);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0.075, 0.066, 0.058, 1);

    const loop = () => {
      if (this.disposed) return;
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.detachCam();
    this.canvas.removeEventListener('mousedown', this.handleDown);
    this.canvas.removeEventListener('mouseup', this.handleUp);
    const gl = this.gl;
    gl.deleteProgram(this.pelletProg); gl.deleteProgram(this.discProg); gl.deleteProgram(this.stdProg);
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  /** 由外部（播放循环）推送当前帧 */
  pushFrame(frame: SceneFrame, turnAnim?: { active: boolean; mix: number; seed: number }): void {
    this.currentFrame = frame;
    if (turnAnim) {
      this.turnMix = turnAnim.active ? turnAnim.mix : 1;
      this.turnSeed = turnAnim.seed;
    }
  }

  private buildStatic(): void {
    const gl = this.gl;
    const c = this.cfg;
    const pitR = c.pitDiameterCm / 200;
    const pitH = c.pitDepthCm / 100;
    const basR = c.basketDiameterCm / 200;
    const basH = c.basketHeightCm / 100;
    const gap = c.gapToCharcoalCm / 100;
    const basketBaseY = gap - pitH; // 笼箅相对床底（y=0 为床底）的偏移基准：床底=笼箅上方
    // 本场景约定：y=0 为笼箅（床底），炭面在 -(pitH-gap) 一带
    const grateY = 0;
    const pitTopY = basketBaseY + basH * 0.15;

    // 焙窟砖壁（略外张的锥台），顶面与地面齐平
    const pitWall = makeCylinderSide(gl, pitR * 1.02, pitR * 0.82, pitH, 56);
    this.staticMeshes.push({ mesh: pitWall, model: m4Translate(0, -pitH / 2, 0), color: [0.36, 0.2, 0.14], kind: 3 });
    // 地面
    const ground = makeDisc(gl, 72);
    this.staticMeshes.push({
      mesh: ground,
      model: m4Mul(m4Translate(0, pitTopY, 0), (() => { const m = new Float32Array(16); m[0]=1;m[5]=-1;m[10]=1;m[15]=1; return m; })()),
      color: [0.2, 0.18, 0.15], kind: 2,
    });
    // 焙笼竹壁（上略大下略小的锥台）
    const basketWall = makeCylinderSide(gl, basR * 1.04, basR * 0.92, basH, 56);
    this.staticMeshes.push({
      mesh: basketWall,
      model: m4Translate(0, grateY + basH / 2, 0),
      color: [0.62, 0.48, 0.26], kind: 1,
    });
    // 笼口圈、笼底圈、腰箍
    const rimTop = makeTorus(gl, basR * 1.04, 0.012);
    const rimBot = makeTorus(gl, basR * 0.92, 0.01);
    const rimMid = makeTorus(gl, basR * 0.98, 0.007);
    this.staticMeshes.push({ mesh: rimTop, model: m4Translate(0, grateY + basH, 0), color: [0.55, 0.4, 0.2], kind: 1 });
    this.staticMeshes.push({ mesh: rimBot, model: m4Translate(0, grateY + 0.01, 0), color: [0.5, 0.36, 0.18], kind: 1 });
    this.staticMeshes.push({ mesh: rimMid, model: m4Translate(0, grateY + basH * 0.45, 0), color: [0.5, 0.36, 0.18], kind: 1 });
    // 笼箅（带栅条 shader 的圆盘）
    const grate = makeDisc(gl, 64);
    this.staticMeshes.push({ mesh: grate, model: m4Translate(0, grateY, 0), color: [0.58, 0.44, 0.24], kind: 4 });
  }

  // ---------- 拾取 ----------
  private handleDown = (e: MouseEvent) => { this.downXY = [e.clientX, e.clientY]; };
  private handleUp = (e: MouseEvent) => {
    if (!this.downXY) return;
    const moved = Math.hypot(e.clientX - this.downXY[0], e.clientY - this.downXY[1]);
    this.downXY = null;
    if (moved > 5) return; // 拖拽视角，不当作点选
    const encoded = this.pickAt(e.clientX, e.clientY);
    if (encoded == null || encoded - 1 >= this.adapter.count || encoded < 1) { this.onPick?.(null); return; }
    const id = encoded - 1; // 着色器里存的是 id+1（0 留给背景）
    const h = this.adapter.historyAt(id, this.currentFrame.t);
    this.onPick?.({ id, temp: h.temp, heat: h.heat });
  };

  private ensurePickTarget(w: number, h: number): void {
    const gl = this.gl;
    if (this.pickW === w && this.pickH === h) return;
    this.pickW = w; this.pickH = h;
    gl.bindTexture(gl.TEXTURE_2D, this.pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickRbo);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.pickRbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private pickAt(clientX: number, clientY: number): number | null {
    const gl = this.gl;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = this.canvas.width / rect.width;
    const px = Math.floor((clientX - rect.left) * dpr);
    const py = Math.floor((rect.bottom - clientY) * dpr);
    this.ensurePickTarget(this.canvas.width, this.canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.viewport(0, 0, this.pickW, this.pickH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawPellets(true);
    const pixel = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0.075, 0.066, 0.058, 1);
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (pixel[3] === 0 && pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0) return null;
    return pixel[0] + pixel[1] * 256 + pixel[2] * 65536;
  }

  // ---------- 渲染 ----------
  private render(): void {
    const gl = this.gl;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const aspect = this.canvas.width / this.canvas.height;
    const vp = this.camera.vp(aspect);

    this.drawDiscs(vp);
    this.drawStatic(vp);
    this.drawPellets(false, vp);
    if (this.opts.showCut) this.drawCut(vp);
  }

  private clipPlane(): [number, number, number, number] {
    if (!this.opts.showCut) return NO_CLIP;
    // 水平切面 y >= cutHeight 保留（去掉上半部分，露出下层）
    return [0, 1, 0, -this.opts.cutHeightM];
  }

  private drawPellets(picking: boolean, vp?: Mat4): void {
    const gl = this.gl;
    const f = this.currentFrame;
    const n = this.adapter.count;
    for (let id = 0; id < n; id++) {
      this.offData[id * 3] = f.x[id];
      this.offData[id * 3 + 1] = f.y[id];
      this.offData[id * 3 + 2] = f.z[id];
      this.sizeData[id] = this.adapter.sizes[id];
      this.shapeData[id] = this.adapter.shapes[id];
      this.stateData[id * 2] = f.heat[id];
      this.stateData[id * 2 + 1] = f.scorch[id];
      this.pickData[id] = id + 1; // 0 留给背景
    }
    this.inst.off.update(this.offData);
    this.inst.size.update(this.sizeData);
    this.inst.shape.update(this.shapeData);
    this.inst.state.update(this.stateData);
    this.inst.pick.update(this.pickData);

    gl.useProgram(this.pelletProg);
    const aspect = this.canvas.width / this.canvas.height;
    setUniforms(gl, this.pelletProg, {
      uVP: vp ?? this.camera.vp(aspect),
      uCamPos: this.camera.eye(),
      uPicking: picking,
      uTurnMix: this.turnMix >= 1 ? 1 : this.turnMix,
      uTurnSeed: this.turnSeed,
      uClipPlane: this.clipPlane(),
    });
    gl.bindVertexArray(this.sphere.vao);
    gl.drawElementsInstanced(gl.TRIANGLES, this.sphere.count, gl.UNSIGNED_SHORT, 0, n);
    gl.bindVertexArray(null);
  }

  private drawDiscs(vp: Mat4): void {
    const gl = this.gl;
    const o = this.opts;
    const radius = this.cfg.pitDiameterCm / 200;
    gl.useProgram(this.discProg);
    // 炭面热力
    const fire = { firePower: o.firePower, ashCm: o.ashCm, phase: o.phase };
    const center = charcoalCenterTemp(fire);
    const edge = (() => {
      const f = radialFactor(1, o.ashCm);
      return 28 + (center - 28) * (0.55 + 0.05 * o.ashCm + (0.45 - 0.05 * o.ashCm) * f);
    })();
    if (o.showHeatmap) {
      setUniforms(gl, this.discProg, {
        uVP: vp, uModel: this.charModel, uRadius: radius,
        uCenterTemp: center, uEdgeTemp: edge, uAsh: o.ashCm, uMode: 0, uHeatMax: 1,
      });
      gl.bindVertexArray(this.charDisc.vao);
      gl.drawElements(gl.TRIANGLES, this.charDisc.count, gl.UNSIGNED_SHORT, 0);
    }
    // 灰层
    setUniforms(gl, this.discProg, {
      uVP: vp, uModel: this.ashModel, uRadius: radius * 0.98,
      uCenterTemp: center, uEdgeTemp: edge, uAsh: o.ashCm, uMode: 1, uHeatMax: 1,
    });
    gl.bindVertexArray(this.ashDisc.vao);
    gl.drawElements(gl.TRIANGLES, this.ashDisc.count, gl.UNSIGNED_SHORT, 0);
  }

  private drawStatic(vp: Mat4): void {
    const gl = this.gl;
    gl.useProgram(this.stdProg);
    for (const s of this.staticMeshes) {
      setUniforms(gl, this.stdProg, {
        uVP: vp, uModel: s.model, uColor: s.color, uKind: s.kind, uCamPos: this.camera.eye(),
      });
      gl.bindVertexArray(s.mesh.vao);
      gl.drawElements(gl.TRIANGLES, s.mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }

  private drawCut(vp: Mat4): void {
    const gl = this.gl;
    const r = this.cfg.basketDiameterCm / 200 * 0.97;
    // 切面圆盘放在 cutHeight，关闭背面剔除让它双面可见，按层火功画三段色带
    const model = m4Translate(0, this.opts.cutHeightM + 0.001, 0);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.discProg);
    const maxH = Math.max(0.2, ...this.opts.layerHeats);
    setUniforms(gl, this.discProg, {
      uVP: vp, uModel: model, uRadius: r,
      uCenterTemp: 0, uEdgeTemp: 0, uAsh: 0, uMode: 2, uHeatMax: maxH,
    });
    gl.bindVertexArray(this.cutDisc.vao);
    gl.drawElements(gl.TRIANGLES, this.cutDisc.count, gl.UNSIGNED_SHORT, 0);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
  }

  /** 焙窟配置变化时重建静态几何 */
  updateConfig(cfg: BasketConfig): void {
    // 简化处理：页面内配置编辑走重建场景
    this.cfg = cfg;
  }
}
