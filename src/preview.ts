import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { RGB } from './color';
import type { ModelResult } from './model';

export type PreviewMode = 'printed' | 'painted';

export interface PaintLookup {
  /** Paint colour of the pixel at model coordinates (x, y), if any. */
  colourAt(x: number, y: number): RGB | undefined;
  edge: RGB;
  /** z above which a face counts as a pixel top. */
  topZ: number;
  /** Faces entirely below this are the back and magnet pocket, left unpainted. */
  backZ: number;
}

const PRINTED = new THREE.Color().setRGB(0.82, 0.82, 0.8, THREE.SRGBColorSpace);

export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  private controls: OrbitControls;
  private mesh?: THREE.Mesh;
  private lastFitKey = '';

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-1, 1.5, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(1, -1, -1);
    this.scene.add(rim);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  setBackground(css: string) {
    this.scene.background = new THREE.Color(css);
  }

  setModel(result: ModelResult, mode: PreviewMode, paint?: PaintLookup) {
    // Flat shading: one normal per triangle, so expand the index buffer.
    const triCount = result.indices.length / 3;
    const positions = new Float32Array(triCount * 9);
    const colours = new Float32Array(triCount * 9);
    const colour = new THREE.Color();
    for (let t = 0; t < triCount; t++) {
      let cx = 0;
      let cy = 0;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = result.indices[t * 3 + k] * 3;
        positions.set([result.positions[v], result.positions[v + 1], result.positions[v + 2]], t * 9 + k * 3);
        cx += result.positions[v] / 3;
        cy += result.positions[v + 1] / 3;
        minZ = Math.min(minZ, result.positions[v + 2]);
        maxZ = Math.max(maxZ, result.positions[v + 2]);
      }
      colour.copy(PRINTED);
      if (mode === 'painted' && paint && maxZ > paint.backZ) {
        const isTop = minZ > paint.topZ && maxZ - minZ < 1e-4;
        const rgb = (isTop && paint.colourAt(cx, cy)) || paint.edge;
        colour.setRGB(rgb.r / 255, rgb.g / 255, rgb.b / 255, THREE.SRGBColorSpace);
      }
      for (let k = 0; k < 3; k++) colours.set([colour.r, colour.g, colour.b], t * 9 + k * 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geometry.computeVertexNormals();

    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = geometry;
    } else {
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
      this.mesh = new THREE.Mesh(geometry, material);
      this.scene.add(this.mesh);
    }

    // Only reframe when the model's footprint changes, so tweaking settings
    // doesn't keep throwing the camera around.
    const fitKey = [...result.min, ...result.max].map((v) => v.toFixed(0)).join(',');
    if (fitKey !== this.lastFitKey) {
      this.lastFitKey = fitKey;
      this.frame(result);
    }
  }

  /** Front-on view, slightly tilted so the relief reads. */
  frame(result: ModelResult) {
    const centre = new THREE.Vector3(
      (result.min[0] + result.max[0]) / 2,
      (result.min[1] + result.max[1]) / 2,
      (result.min[2] + result.max[2]) / 2,
    );
    const size = Math.max(result.max[0] - result.min[0], result.max[1] - result.min[1]);
    const distance = size / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.35;
    this.camera.position.copy(centre).add(new THREE.Vector3(0, -0.45, 1).normalize().multiplyScalar(distance));
    this.camera.up.set(0, 1, 0);
    this.controls.target.copy(centre);
    this.controls.update();
  }

  /** Show the back, so the magnet pocket is visible. */
  showBack() {
    const target = this.controls.target;
    const distance = this.camera.position.distanceTo(target);
    // Oblique, so the depth of the magnet pocket is visible.
    this.camera.position.copy(target).add(new THREE.Vector3(0, -0.8, -1).normalize().multiplyScalar(distance));
    this.controls.update();
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
