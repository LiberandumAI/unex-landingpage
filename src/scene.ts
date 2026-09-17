import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * One coin, one fixed canvas.
 *
 * Motion model — two layers, so scroll never moves the coin directly:
 *  1. `target` is set by the scroll timeline (main.ts): where the coin should be.
 *  2. `pose` chases `target` every frame with damped smoothing, and the coin spins
 *     on its own axis continuously (time-based), faster while the page is
 *     scrolling. When `spin` drops to 0 the angle settles on the front face.
 *
 * `x`/`y` are viewport fractions (-1..1 = left/right, bottom/top edge at the
 * coin's depth) so poses survive any aspect ratio.
 */
export interface CoinState {
  x: number;
  y: number;
  rx: number; // tilt toward the camera (0 = face-on / lying flat under a top-down camera)
  rz: number; // roll
  s: number; // scale; 1 ≈ coin diameter is 58% of viewport height
  shadow: number; // contact-shadow opacity 0..1 (surfaces: desk, hands)
  spin: number; // 0..1 — self-rotation speed multiplier; 0 = settle face-up
  yaw: number; // extra turn on top of the self-spin; PI shows the reverse (ETH) side
  idle: number; // 1 = breathing/rock/pointer allowed, 0 = frozen (e.g. resting in the hands)
}

export const HERO_STATE: CoinState = {
  x: 0.55,
  y: -0.24,
  rx: 0,
  rz: -0.35,
  s: 1.02,
  shadow: 1,
  spin: 0,
  yaw: 0,
  idle: 1,
};

const CAMERA_Z = 3.2;
const CAMERA_FOV = 30;
const BASE_SPIN = 0.55; // rad/s at spin = 1
const TWO_PI = Math.PI * 2;

export class CoinScene {
  /** Where the scroll timeline wants the coin. Tweened by GSAP. */
  readonly target: CoinState = { ...HERO_STATE };
  /** Smoothed pose actually rendered. */
  readonly pose: CoinState = { ...HERO_STATE };
  readonly isMobile: boolean;

  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private pivot = new THREE.Group();
  private shadowCatcher: THREE.Mesh<THREE.PlaneGeometry, THREE.ShadowMaterial>;
  private pointer = new THREE.Vector2();
  private pointerTarget = new THREE.Vector2();
  private reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private ready = false;
  private canvas: HTMLCanvasElement;
  private spinAngle = 0;
  private scrollBoost = 0;
  private lastTime = 0;
  private glow: HTMLElement | null = document.querySelector('[data-glow]');
  private softShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null = null;
  private frameParity = 0;
  private lastGlow = { x: -1, y: -1 };
  private projected = new THREE.Vector3();
  /** Resolves once the GLB is on stage — used by the page loader. */
  ready$: Promise<void>;
  private resolveReady!: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ready$ = new Promise<void>((r) => (this.resolveReady = r));
    this.isMobile = window.matchMedia('(max-width: 768px)').matches;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    // Shadow maps double the draw cost; phones get a soft disc under the coin instead.
    this.renderer.shadowMap.enabled = !this.isMobile;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 20);
    this.camera.position.set(0, 0, CAMERA_Z);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(this.pivot);
    this.buildLights();
    this.scene.environment = this.buildEnvironment();

    this.shadowCatcher = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.55, transparent: true }),
    );
    this.shadowCatcher.position.z = -0.06;
    this.shadowCatcher.receiveShadow = true;
    this.shadowCatcher.visible = !this.isMobile;
    this.scene.add(this.shadowCatcher);

    if (this.isMobile) {
      this.softShadow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({
        map: CoinScene.softDiscTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0,
      }));
      this.softShadow.position.z = -0.07;
      this.scene.add(this.softShadow);
    }

    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (!this.isMobile) {
      window.addEventListener('pointermove', (e) => {
        this.pointerTarget.set((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
      });
    }
  }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);

    // The delivery keeps LODs in separate scenes. The full mesh is used everywhere:
    // vertex count is not what limits phones, fill rate is — and the LOD's baked
    // beads/reeding look soft at hero size. The LOD stays for very weak devices.
    const weak = this.isMobile && (navigator.hardwareConcurrency ?? 8) <= 4;
    const name = weak ? 'Coin_LOD1' : 'Coin';
    const sceneIndex = weak ? 1 : 0;
    const coin =
      gltf.scenes[sceneIndex]?.getObjectByName(name) ?? gltf.scenes[0].getObjectByName('Coin');
    if (!coin) throw new Error(`Coin mesh "${name}" not found in ${url}`);

    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    coin.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        const m = o as THREE.Mesh;
        m.castShadow = !this.isMobile;
        const mat = m.material as THREE.MeshStandardMaterial;
        mat.envMapIntensity = 1.2; // v2 ships baked gold; only the environment strength is ours
        for (const t of [mat.map, mat.normalMap, mat.roughnessMap, mat.metalnessMap, mat.aoMap]) {
          if (t) t.anisotropy = aniso; // keeps the relief crisp when the coin is tilted
        }
        mat.needsUpdate = true;
      }
    });

    // The face must look at the camera (+Z). v1 exported +Y-up (thin axis Y),
    // v2 keeps Blender's Z-up (thin axis Z) — detect instead of assuming.
    const size = new THREE.Box3().setFromObject(coin).getSize(new THREE.Vector3());
    if (size.y < size.z) coin.rotation.x = Math.PI / 2;
    this.pivot.add(coin);
    this.ready = true;
    this.resolveReady();
  }

  /** Feed Lenis' velocity so fast scrolling visibly spins the coin. */
  setScrollVelocity(v: number): void {
    this.scrollBoost = THREE.MathUtils.clamp(Math.abs(v) * 0.03, 0, 2.4);
  }

  /** Dev helper: projected coin diameter in CSS pixels at the current pose. */
  measure(): { diameterPx: number; scale: number; aspect: number } {
    const { halfH } = this.visibleHalfExtents();
    const pxPerUnit = (this.canvas.clientHeight || innerHeight) / (halfH * 2);
    return { diameterPx: this.pivot.scale.x * pxPerUnit, scale: this.pivot.scale.x, aspect: this.camera.aspect };
  }

  /** Phones switch the scene off once the coin has left the hero. */
  active = true;
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    this.canvas.classList.toggle('is-off', !on);
  }

  /** Called every frame from gsap.ticker (time in seconds). */
  render(time: number): void {
    if (!this.ready || !this.active) return;
    // Phones: draw at half the display rate. Scrolling stays at 60, the coin at 30 —
    // far better than both stuttering together.
    if (this.isMobile && (this.frameParity ^= 1) === 1) return;
    const dt = Math.min(0.08, Math.max(0.001, time - this.lastTime));
    this.lastTime = time;

    // 1. Chase the target. One time constant for every channel keeps motion coherent.
    const k = 1 - Math.exp(-dt * 4.5);
    const p = this.pose;
    const t = this.target;
    (Object.keys(p) as (keyof CoinState)[]).forEach((key) => {
      p[key] += (t[key] - p[key]) * k;
    });

    // 2. Self rotation: continuous while spin > 0, settles on the front face as it dies.
    const idle = this.reduceMotion ? 0 : 1;
    const speed = (BASE_SPIN * p.spin + this.scrollBoost * Math.max(p.spin, 0.15)) * idle;
    this.spinAngle += speed * dt;
    this.scrollBoost *= Math.exp(-dt * 2.2);
    if (p.spin < 0.25) {
      const settle = (1 - p.spin / 0.25) * (1 - Math.exp(-dt * 3.5));
      const nearest = Math.round(this.spinAngle / TWO_PI) * TWO_PI;
      this.spinAngle += (nearest - this.spinAngle) * settle;
    }

    // 3. Compose. While the coin rests (spin ≈ 0) it still breathes: a slow rock
    //    and a shallow yaw sweep keep the light moving over the relief.
    this.pointer.lerp(this.pointerTarget, 0.05);
    const { halfW, halfH } = this.visibleHalfExtents();
    // Landscape: scale relative to height (keyframes are tuned for 16:10).
    // Portrait: scale relative to width, so `s = 1` ≈ 58% of the screen width.
    const aspect = this.camera.aspect;
    const aspectFactor = aspect < 1 ? aspect : THREE.MathUtils.clamp(aspect / 1.6, 0.55, 1);
    const rest = (1 - Math.min(1, p.spin * 2)) * idle * p.idle;
    const hover = p.spin * Math.sin(time * 0.9) * 0.02 * idle * p.idle + rest * Math.sin(time * 0.7) * 0.006;
    const rockX = rest * Math.sin(time * 0.45) * 0.07;
    const rockZ = rest * Math.sin(time * 0.31 + 1.2) * 0.05;
    const sweep = rest * Math.sin(time * 0.27) * 0.16;

    this.pivot.position.set(p.x * halfW, p.y * halfH + hover, 0);
    this.pivot.rotation.set(
      p.rx + rockX + this.pointer.y * -0.06 * idle * p.idle,
      this.spinAngle + p.yaw + sweep + this.pointer.x * 0.08 * idle * p.idle * Math.max(p.spin, 0.35),
      p.rz + rockZ,
    );
    this.pivot.scale.setScalar(p.s * aspectFactor);

    if (this.softShadow) {
      const sc = p.s * aspectFactor;
      this.softShadow.position.set(this.pivot.position.x - 0.06 * sc, this.pivot.position.y - 0.08 * sc, -0.07);
      this.softShadow.scale.setScalar(sc);
      this.softShadow.material.opacity = 0.6 * p.shadow;
      this.softShadow.visible = p.shadow > 0.01;
    } else {
      this.shadowCatcher.material.opacity = 0.55 * p.shadow;
      this.shadowCatcher.visible = p.shadow > 0.01;
    }

    // Warm glow follows the coin on the page layer beneath the canvas. Repainting a
    // full-screen gradient is not free: only update when it actually moved.
    if (this.glow && !this.isMobile) {
      this.projected.copy(this.pivot.position).project(this.camera);
      const gx = Math.round(((this.projected.x + 1) / 2) * 200) / 2;
      const gy = Math.round(((1 - this.projected.y) / 2) * 200) / 2;
      if (gx !== this.lastGlow.x || gy !== this.lastGlow.y) {
        this.lastGlow = { x: gx, y: gy };
        this.glow.style.setProperty('--gx', `${gx}%`);
        this.glow.style.setProperty('--gy', `${gy}%`);
        this.glow.style.setProperty('--gr', `${(28 + 22 * p.s * aspectFactor).toFixed(0)}vmax`);
        this.glow.style.opacity = p.shadow > 0.5 ? '0.35' : '1';
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** Radial soft disc used as the phone's contact shadow. */
  private static softDiscTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
    g.addColorStop(0, 'rgba(0,0,0,0.9)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  private visibleHalfExtents(): { halfW: number; halfH: number } {
    const halfH = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * CAMERA_Z;
    return { halfW: halfH * this.camera.aspect, halfH };
  }

  private resize(): void {
    const w = this.canvas.clientWidth || innerWidth;
    const h = this.canvas.clientHeight || innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private buildLights(): void {
    // One warm key from the upper right — the reference's single light.
    const key = new THREE.DirectionalLight(0xffd7a8, 2.6);
    key.position.set(2.2, 2.6, 2.4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 10;
    key.shadow.camera.left = key.shadow.camera.bottom = -2;
    key.shadow.camera.right = key.shadow.camera.top = 2;
    key.shadow.bias = -0.0005;
    key.shadow.radius = 4;
    this.scene.add(key);

    // Cool rim from behind-left: separates the gold from the walnut void.
    const rim = new THREE.DirectionalLight(0x9fb4d6, 1.1);
    rim.position.set(-2.5, 1.2, -1.5);
    this.scene.add(rim);

    // Faint fill so the shadow side keeps its form.
    const fill = new THREE.DirectionalLight(0x8fa3c0, 0.25);
    fill.position.set(-3, 0.4, 1.5);
    this.scene.add(fill);

    if (this.isMobile) {
      // No shadow pass on phones, and some mobile GPUs give a weak environment:
      // a hemisphere light keeps the gold reading as gold regardless.
      this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3d2515, 0.9));
      key.intensity = 3.2;
    }
  }

  /**
   * Metals need an environment to read as metal. Instead of a neutral studio
   * HDRI (which the reference forbids: "no studio reflections") we build a
   * tiny dark room with one warm soft light panel, a cool rim and a floor bounce.
   */
  private buildEnvironment(): THREE.Texture {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x100904);

    const panel = (color: number, intensity: number, size: [number, number], pos: THREE.Vector3) => {
      const mat = new THREE.MeshBasicMaterial({ color });
      mat.color.multiplyScalar(intensity);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
      mesh.position.copy(pos);
      mesh.lookAt(0, 0, 0);
      env.add(mesh);
    };

    panel(0xffd7a8, 7, [3, 2.2], new THREE.Vector3(3, 3.5, 2)); // warm key, upper right
    panel(0xffe9c9, 1.2, [1.2, 6], new THREE.Vector3(1.5, 0, 4)); // thin front strip: specular line on the rim
    panel(0x9fb4d6, 1.4, [2, 3], new THREE.Vector3(-4, 1, -2)); // cool rim, behind left
    panel(0x6b4a2a, 0.4, [6, 6], new THREE.Vector3(0, -4, 0)); // warm floor bounce

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const texture = pmrem.fromScene(env, 0.04).texture;
    pmrem.dispose();
    return texture;
  }
}
