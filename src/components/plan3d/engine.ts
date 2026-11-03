// Moteur de la vue 3D du plan : scène, caméra (vue d'ensemble ou visite), meubles, produits dans les cases,
// sélection, déplacement aimanté, ouverture des portes, recherche d'un produit (meuble qui clignote, chemin au sol).
// Le dessin n'est recalculé que lorsque quelque chose bouge (ordinateurs modestes).
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CellFill, Fixture, Floor } from "../../types";
import { mediaUrl } from "../../lib/media";
import { buildFixture, cellItems, disposeObject, type Built, type FixtureSpec, type Item } from "./models";
import { floorTexture, textTexture } from "./materials";
import { approachPoints, collision, entryPoint, findPath, footprint, frontDir, isFloorItem, snapPosition, type Point } from "./geometry";

export type ViewMode = "orbit" | "walk";
export type Quality = "simple" | "realistic";

export interface EngineOptions {
  quality: Quality;
  products: boolean;
  photos: boolean;
  /** Murs à pleine hauteur en vue d'ensemble (sinon coupés pour voir l'intérieur). */
  highWalls: boolean;
}

export interface EngineCallbacks {
  onSelect: (id: number | null) => void;
  onOpen: (id: number) => void;
  onMove: (id: number, x: number, y: number) => void;
  onBlocked: (by: Fixture) => void;
}

export interface Highlight {
  fixtureId: number;
  level?: number | null;
  section?: number | null;
}

interface Entry {
  fixture: Fixture;
  built: Built;
  group: THREE.Group;
  key: string;
  label: THREE.Sprite | null;
}

interface Anim {
  t0: number;
  ms: number;
  step: (k: number) => void;
  done?: () => void;
}

const EYE = 1.6;
const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const ACCENT = "#2563eb";
const DANGER = "#dc2626";
const FIND = "#f97316";

export class StoreEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.05, 800);
  private controls: OrbitControls;
  private sun = new THREE.DirectionalLight("#fff6e8", 1.7);
  private fixturesRoot = new THREE.Group();
  private productsRoot = new THREE.Group();
  private overlay = new THREE.Group();
  private floorGroup = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  private entries = new Map<number, Entry>();
  private floor: Floor | null = null;
  private fixtures: Fixture[] = [];
  private fill: CellFill[] = [];
  private editable = false;
  private selectedId: number | null = null;
  private highlight: Highlight | null = null;
  private showPath = false;
  private mode: ViewMode = "orbit";
  private opts: EngineOptions;
  private anims: Anim[] = [];
  private frame = 0;
  private dampUntil = 0;
  private openId: number | null = null;
  private pendingReset = false;
  /** Meuble en cours de déplacement : ses produits sont masqués jusqu'au dépôt. */
  private hiddenFixture: number | null = null;
  private selectionBox: THREE.LineSegments | null = null;
  private findBits: { box: THREE.Mesh | null; arrow: THREE.Mesh; outline: THREE.LineSegments } | null = null;
  private down: { x: number; y: number; moved: boolean } | null = null;
  private drag: { id: number; orig: Point; offset: Point; pos: Point; moved: boolean; blocked: Fixture | null } | null = null;
  private look: { x: number; y: number; yaw: number; pitch: number } | null = null;
  private walk = { x: 0, z: 0, yaw: 0, pitch: -0.05, forward: 0, turn: 0 };
  private keys = new Set<string>();
  private lastTick = 0;
  private resize: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private textureLoader = new THREE.TextureLoader();
  private photoCache = new Map<number, THREE.Texture>();

  constructor(
    private container: HTMLElement,
    private cb: EngineCallbacks,
    options: EngineOptions,
  ) {
    this.opts = { ...options };
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.applyQuality();
    const canvas = this.renderer.domElement;
    canvas.className = "plan3d-canvas";
    canvas.tabIndex = 0;
    container.appendChild(canvas);

    this.scene.background = new THREE.Color("#dde5ee");
    this.scene.add(new THREE.HemisphereLight("#ffffff", "#c9c2b6", 1.25));
    const fill = new THREE.DirectionalLight("#dbeafe", 0.35);
    fill.position.set(-10, 8, -6);
    this.scene.add(fill);
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.floorGroup, this.fixturesRoot, this.productsRoot, this.overlay);
    this.textureLoader.setCrossOrigin("anonymous");

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
    this.controls.minDistance = 1.2;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener("change", this.render);
    this.controls.addEventListener("start", () => (this.dampUntil = Infinity));
    this.controls.addEventListener("end", () => {
      this.dampUntil = performance.now() + 900;
      this.render();
    });

    canvas.addEventListener("pointerdown", this.onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("dblclick", this.onDblClick);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    canvas.addEventListener("keydown", this.onKey);
    canvas.addEventListener("keyup", this.onKey);
    canvas.addEventListener("blur", () => this.keys.clear());
    this.resize = new ResizeObserver(() => this.onResize());
    this.resize.observe(container);
    this.onResize();
  }

  // ───────────────────────────── Données ─────────────────────────────

  setFloor(floor: Floor) {
    const changed = !this.floor || this.floor.id !== floor.id;
    const restyle = changed || this.floor!.floor_style !== floor.floor_style || this.floor!.width !== floor.width || this.floor!.depth !== floor.depth;
    const walls = !!this.floor && this.floor.wall_height !== floor.wall_height;
    this.floor = floor;
    if (restyle) this.buildFloor();
    if (walls) this.setFixtures(this.fixtures);
    if (changed) {
      this.pendingReset = true;
      this.resetView(false);
      if (this.mode === "walk") this.startWalk();
    }
    this.render();
  }

  setFixtures(list: Fixture[]) {
    this.fixtures = list;
    const seen = new Set<number>();
    for (const f of list) {
      seen.add(f.id);
      const spec = this.specOf(f);
      const key = JSON.stringify(spec);
      let e = this.entries.get(f.id);
      if (!e || e.key !== key) {
        if (e) this.removeEntry(e);
        e = this.createEntry(f, spec, key);
      }
      e.fixture = f;
      if (!this.drag || this.drag.id !== f.id) this.place(e, f.x, f.y);
    }
    for (const [id, e] of this.entries) if (!seen.has(id)) this.removeEntry(e);
    this.fixturesRoot.updateMatrixWorld(true);
    this.buildProducts();
    if (this.pendingReset && list.length) {
      this.pendingReset = false;
      this.resetView(false);
    }
    this.updateSelection();
    this.updateFind();
    this.render();
  }

  setFill(cells: CellFill[]) {
    this.fill = cells;
    this.buildProducts();
    this.render();
  }

  setEditable(on: boolean) {
    this.editable = on;
    if (this.grid) this.grid.visible = on;
    this.render();
  }

  setSelected(id: number | null) {
    this.selectedId = id;
    this.updateSelection();
    this.render();
  }

  setHighlight(h: Highlight | null, path: boolean) {
    const same = h && this.highlight && h.fixtureId === this.highlight.fixtureId && h.level === this.highlight.level && h.section === this.highlight.section;
    this.highlight = h;
    this.showPath = path;
    this.updateFind();
    if (h && !same) this.flyTo(h.fixtureId);
    this.render();
  }

  setOptions(o: Partial<EngineOptions>) {
    const prev = this.opts;
    this.opts = { ...prev, ...o };
    if (prev.quality !== this.opts.quality) {
      this.applyQuality();
      this.onResize();
    }
    if (prev.highWalls !== this.opts.highWalls) this.setFixtures(this.fixtures);
    else if (prev.products !== this.opts.products || prev.photos !== this.opts.photos) this.buildProducts();
    this.render();
  }

  setMode(mode: ViewMode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.controls.enabled = mode === "orbit";
    this.keys.clear();
    this.walk.forward = this.walk.turn = 0;
    // Les murs sont à pleine hauteur pendant la visite.
    this.setFixtures(this.fixtures);
    if (mode === "walk") this.startWalk();
    else this.resetView(true);
    this.render();
  }

  /** Commandes de la visite (boutons à l'écran) : avancer / reculer, tourner. */
  setWalkInput(forward: number, turn: number) {
    this.walk.forward = forward;
    this.walk.turn = turn;
    this.lastTick = performance.now();
    this.render();
  }

  // ───────────────────────────── Caméra ─────────────────────────────

  /** Vue d'ensemble de tout le niveau, de trois quarts depuis l'entrée. */
  resetView(animate = true) {
    if (!this.floor) return;
    if (this.mode === "walk") return this.startWalk();
    const { width: W, depth: D } = this.floor;
    const size = Math.max(W, D);
    const target = new THREE.Vector3(W / 2, 0, D / 2);
    const entry = entryPoint(this.fixtures, this.floor);
    const dir = new THREE.Vector3(entry.x - W / 2, 0, entry.y - D / 2);
    if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
    dir.normalize();
    const pos = target.clone().addScaledVector(dir, size * 0.75).add(new THREE.Vector3(0, size * 0.8, 0));
    this.controls.maxDistance = size * 3 + 10;
    this.moveCamera(pos, target, animate);
  }

  /** La caméra se place devant un meuble. */
  flyTo(id: number) {
    const e = this.entries.get(id);
    if (!e) return;
    const f = e.fixture;
    const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
    const fd = frontDir(f.rotation);
    if (this.mode === "walk") {
      const dist = f.h / 2 + 1.7;
      const p = { x: c.x + fd.x * dist, y: c.y + fd.y * dist };
      const yaw = Math.atan2(-(c.x - p.x), -(c.y - p.y));
      const from = { ...this.walk };
      this.animate(700, (k) => {
        this.walk.x = from.x + (p.x - from.x) * k;
        this.walk.z = from.z + (p.y - from.z) * k;
        this.walk.yaw = from.yaw + shortAngle(yaw - from.yaw) * k;
        this.walk.pitch = from.pitch + (-0.12 - from.pitch) * k;
        this.applyWalkCamera();
      });
      return;
    }
    const top = Math.min(e.built.top, 2.4);
    const target = new THREE.Vector3(c.x, top * 0.5, c.y);
    const dist = Math.min(9, Math.max(2.4, Math.max(f.w, top) * 1.5));
    // Au-dessus des meubles voisins si la caméra doit passer par-dessus (allées étroites).
    let over = 0;
    for (let k = f.h / 2 + 0.2; k <= dist; k += 0.15) {
      const p = { x: c.x + fd.x * k, y: c.y + fd.y * k };
      for (const o of this.entries.values()) {
        if (o === e || isFloorItem(o.fixture) || o.fixture.model === "porte") continue;
        const r = footprint(o.fixture);
        if (p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h) over = Math.max(over, o.built.top);
      }
    }
    const lift = Math.max(dist * 0.45, over ? over + 0.7 - target.y : 0);
    const pos = target.clone().add(new THREE.Vector3(fd.x * dist, lift, fd.y * dist));
    this.moveCamera(pos, target, true);
  }

  /** Ouvre un meuble : la caméra s'approche, les portes s'ouvrent, puis la vue de face s'affiche. */
  open(id: number) {
    const e = this.entries.get(id);
    if (!e) return;
    this.flyTo(id);
    this.openId = id;
    if (e.built.doors.length) {
      this.animate(550, (k) => e.built.doors.forEach((d) => (d.pivot.rotation.y = d.open * k)), () => this.cb.onOpen(id));
    } else {
      window.setTimeout(() => this.cb.onOpen(id), 450);
    }
  }

  closeDoors() {
    const e = this.openId ? this.entries.get(this.openId) : null;
    this.openId = null;
    if (!e || !e.built.doors.length) return;
    const from = e.built.doors.map((d) => d.pivot.rotation.y);
    this.animate(400, (k) => e.built.doors.forEach((d, i) => (d.pivot.rotation.y = from[i] * (1 - k))));
  }

  /** Point du sol (mètres du plan) sous le pointeur (dépôt d'un meuble de la palette). */
  floorPointAt(clientX: number, clientY: number): Point | null {
    const p = this.groundHit(clientX, clientY);
    return p ? { x: p.x, y: p.y } : null;
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onPointerDown, { capture: true });
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
    canvas.removeEventListener("dblclick", this.onDblClick);
    canvas.removeEventListener("wheel", this.onWheel);
    canvas.removeEventListener("keydown", this.onKey);
    canvas.removeEventListener("keyup", this.onKey);
    for (const e of this.entries.values()) disposeObject(e.group);
    this.clearGroup(this.productsRoot);
    this.clearGroup(this.overlay);
    this.clearGroup(this.floorGroup);
    this.photoCache.forEach((t) => t.dispose());
    this.renderer.dispose();
    canvas.remove();
  }

  // ───────────────────────────── Construction de la scène ─────────────────────────────

  private applyQuality() {
    const fine = this.opts.quality === "realistic";
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, fine ? 2 : 1));
    this.sun.castShadow = fine;
  }

  private specOf(f: Fixture): FixtureSpec {
    return {
      model: f.model || f.type_code,
      w: f.w,
      d: f.h,
      height: f.height,
      color: f.color,
      levels: f.levels,
      sections: f.sections,
      wallHeight: this.floor?.wall_height ?? 3,
      lowWalls: this.mode === "orbit" && !this.opts.highWalls,
      label: f.storage ? "" : f.name,
    };
  }

  private createEntry(f: Fixture, spec: FixtureSpec, key: string): Entry {
    const built = buildFixture(spec);
    const group = built.group;
    group.userData.fixtureId = f.id;
    let label: THREE.Sprite | null = null;
    if (f.storage) {
      const { texture, aspect } = textTexture(f.code, { background: "rgba(255,255,255,0.92)", color: "#0f172a", height: 64 });
      label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
      label.scale.set(0.24 * aspect, 0.24, 1);
      label.position.set(0, built.top + 0.28, 0);
      label.renderOrder = 20;
      label.raycast = () => undefined;
      group.add(label);
    }
    const e: Entry = { fixture: f, built, group, key, label };
    this.entries.set(f.id, e);
    this.fixturesRoot.add(group);
    return e;
  }

  private removeEntry(e: Entry) {
    this.fixturesRoot.remove(e.group);
    disposeObject(e.group);
    this.entries.delete(e.fixture.id);
    if (this.selectionBox && this.selectionBox.parent === e.group) this.selectionBox = null;
  }

  /** Position d'un meuble : coin (x, y) du plan → centre de la scène, rotation autour de la verticale. */
  private place(e: Entry, x: number, y: number) {
    const f = e.fixture;
    e.group.position.set(x + f.w / 2, 0, y + f.h / 2);
    e.group.rotation.y = (-f.rotation * Math.PI) / 180;
  }

  private buildFloor() {
    this.clearGroup(this.floorGroup);
    if (!this.floor) return;
    const { width: W, depth: D } = this.floor;
    const { texture, size: motif } = floorTexture(this.floor.floor_style);
    const tex = texture.clone();
    tex.needsUpdate = true;
    tex.repeat.set(W / motif, D / motif);
    const floorMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(W / 2, 0, D / 2);
    plane.receiveShadow = true;
    plane.userData.ground = true;
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(W * 4 + 40, D * 4 + 40), new THREE.MeshStandardMaterial({ color: "#c9d1da", roughness: 1 }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.set(W / 2, -0.01, D / 2);
    outside.receiveShadow = true;
    outside.userData.ground = true;
    this.floorGroup.add(plane, outside);
    this.grid = new THREE.GridHelper(Math.ceil(Math.max(W, D)), Math.ceil(Math.max(W, D)), "#94a3b8", "#cbd5e1");
    this.grid.position.set(Math.ceil(Math.max(W, D)) / 2, 0.002, Math.ceil(Math.max(W, D)) / 2);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.35;
    this.grid.visible = this.editable;
    this.floorGroup.add(this.grid);
    // Soleil au-dessus du niveau : les ombres couvrent tout le plan.
    const size = Math.max(W, D);
    this.sun.position.set(W / 2 + size * 0.35, size * 0.9 + 6, D / 2 + size * 0.25);
    this.sun.target.position.set(W / 2, 0, D / 2);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -size * 0.8;
    cam.right = cam.top = size * 0.8;
    cam.near = 1;
    cam.far = size * 3 + 20;
    cam.updateProjectionMatrix();
  }

  /** Produits dans les cases : quelques maillages « instanciés » pour des milliers d'articles. */
  private buildProducts() {
    this.clearGroup(this.productsRoot, true);
    if (!this.opts.products) return;
    const shapes: Record<Item["shape"], { m: THREE.Matrix4; c: THREE.Color }[]> = { box: [], cyl: [], sphere: [] };
    const photos: { e: Entry; x: number; y: number; z: number; size: number; facing: number; image: number }[] = [];
    const base = new THREE.Color();
    const carton = new THREE.Color("#b98b5a");
    const pallet = new THREE.Color("#c9a46a");
    const q = new THREE.Quaternion();
    for (const cell of this.fill) {
      const e = this.entries.get(cell.fixture_id);
      if (!e || cell.fixture_id === this.hiddenFixture) continue;
      const boxes = e.built.cells(cell.level, cell.section);
      const colour = cell.color ?? e.fixture.color;
      boxes.forEach((b, bi) => {
        const items = cellItems(b, cell.products, cell.fixture_id * 977 + cell.level * 131 + cell.section * 17 + bi);
        for (const it of items) {
          base.set(colour);
          let c: THREE.Color;
          if (it.material === "carton") c = carton.clone().offsetHSL(0, 0, it.tint * 0.15);
          else if (it.material === "pallet") c = pallet.clone();
          else c = base.clone().offsetHSL(it.tint * 0.04, 0, it.tint * 0.18);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.sx, it.sy, it.sz));
          m.premultiply(e.group.matrixWorld);
          shapes[it.shape].push({ m, c });
        }
        if (this.opts.photos && cell.image_id && b.kind !== "tag" && b.kind !== "heap" && b.kind !== "hanger" && photos.length < 300) {
          const size = Math.min(b.w * 0.9, b.h * 0.75, 0.3);
          photos.push({ e, x: b.x, y: b.y - b.h / 2 + size / 2 + 0.01, z: b.z + b.facing * (b.d / 2 + 0.012), size, facing: b.facing, image: cell.image_id });
        }
      });
    }
    const geos: Record<Item["shape"], THREE.BufferGeometry> = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
      sphere: new THREE.SphereGeometry(0.5, 14, 10),
    };
    for (const shape of Object.keys(shapes) as Item["shape"][]) {
      const list = shapes[shape];
      if (!list.length) {
        geos[shape].dispose();
        continue;
      }
      const mesh = new THREE.InstancedMesh(geos[shape], new THREE.MeshStandardMaterial({ roughness: shape === "cyl" ? 0.3 : 0.65, metalness: 0.02 }), list.length);
      list.forEach((it, i) => {
        mesh.setMatrixAt(i, it.m);
        mesh.setColorAt(i, it.c);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true;
      mesh.raycast = () => undefined;
      this.productsRoot.add(mesh);
    }
    // Photos des produits sur la façade des cases.
    for (const p of photos) {
      const url = mediaUrl(p.image);
      if (!url) continue;
      let tex = this.photoCache.get(p.image);
      if (!tex) {
        tex = this.textureLoader.load(url, () => this.render());
        tex.colorSpace = THREE.SRGBColorSpace;
        this.photoCache.set(p.image, tex);
      }
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      mat.userData.own = false;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(p.size, p.size), mat);
      plane.position.set(p.x, p.y, p.z);
      if (p.facing < 0) plane.rotation.y = Math.PI;
      plane.applyMatrix4(p.e.group.matrixWorld);
      plane.raycast = () => undefined;
      this.productsRoot.add(plane);
    }
  }

  private updateSelection() {
    if (this.selectionBox) {
      this.selectionBox.parent?.remove(this.selectionBox);
      this.selectionBox.geometry.dispose();
      (this.selectionBox.material as THREE.Material).dispose();
      this.selectionBox = null;
    }
    const e = this.selectedId ? this.entries.get(this.selectedId) : null;
    if (!e) return;
    this.selectionBox = this.outline(e, ACCENT);
    e.group.add(this.selectionBox);
  }

  private outline(e: Entry, color: string): THREE.LineSegments {
    const top = Math.max(0.05, e.built.top);
    const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(e.fixture.w + 0.08, top + 0.06, e.fixture.h + 0.08));
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
    line.position.y = (top + 0.06) / 2;
    line.renderOrder = 15;
    line.raycast = () => undefined;
    return line;
  }

  /** Recherche d'un produit : meuble entouré, case qui clignote, flèche au-dessus, chemin au sol. */
  private updateFind() {
    if (this.findBits) {
      const { box, arrow, outline } = this.findBits;
      for (const o of [box, arrow, outline]) {
        if (!o) continue;
        o.parent?.remove(o);
        (o as THREE.Mesh).geometry.dispose();
        ((o as THREE.Mesh).material as THREE.Material).dispose();
      }
      this.findBits = null;
    }
    this.clearGroup(this.overlay, true);
    const h = this.highlight;
    const e = h ? this.entries.get(h.fixtureId) : null;
    if (!h || !e) return;
    const outline = this.outline(e, FIND);
    e.group.add(outline);
    let box: THREE.Mesh | null = null;
    const cell = h.level && h.section ? e.built.cells(h.level, h.section)[0] : null;
    if (cell) {
      box = new THREE.Mesh(
        new THREE.BoxGeometry(cell.w + 0.04, cell.h + 0.04, cell.d + 0.04),
        new THREE.MeshBasicMaterial({ color: FIND, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      box.position.set(cell.x, cell.y, cell.z);
      box.renderOrder = 12;
      box.raycast = () => undefined;
      e.group.add(box);
    }
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.38, 20), new THREE.MeshStandardMaterial({ color: FIND, emissive: FIND, emissiveIntensity: 0.4 }));
    arrow.rotation.x = Math.PI;
    arrow.position.set(0, e.built.top + 0.75, 0);
    arrow.raycast = () => undefined;
    e.group.add(arrow);
    this.findBits = { box, arrow, outline };
    if (this.showPath && this.floor) this.drawPath(e.fixture);
  }

  private drawPath(target: Fixture) {
    if (!this.floor) return;
    const obstacles = this.fixtures.filter((f) => f.id !== target.id && !isFloorItem(f) && f.model !== "porte").map((f) => footprint(f));
    const from = entryPoint(this.fixtures, this.floor);
    let best: Point[] | null = null;
    let bestLen = Infinity;
    for (const goal of approachPoints(target)) {
      const path = findPath(from, goal, obstacles, this.floor);
      if (!path) continue;
      const len = path.reduce((s, p, i) => (i ? s + Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y) : 0), 0);
      if (len < bestLen) {
        best = path;
        bestLen = len;
      }
    }
    if (!best || best.length < 2) return;
    // Chevrons verts tous les 50 cm.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.16);
    shape.lineTo(0.16, -0.06);
    shape.lineTo(0.08, -0.06);
    shape.lineTo(0, 0.05);
    shape.lineTo(-0.08, -0.06);
    shape.lineTo(-0.16, -0.06);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: "#16a34a", transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 1; i < best.length; i++) {
      const a = best[i - 1];
      const b = best[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const yaw = Math.atan2(b.x - a.x, b.y - a.y);
      for (let s = 0.25; s < len; s += 0.5) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(a.x + ((b.x - a.x) * s) / len, 0.015, a.y + ((b.y - a.y) * s) / len);
        // Pointe du chevron (vers -Z du dessin) tournée vers b.
        m.rotation.y = yaw + Math.PI;
        m.raycast = () => undefined;
        this.overlay.add(m);
      }
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 32), new THREE.MeshBasicMaterial({ color: "#16a34a", transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const end = best[best.length - 1];
    ring.position.set(end.x, 0.016, end.y);
    this.overlay.add(ring);
    const start = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshBasicMaterial({ color: "#16a34a" }));
    start.rotation.x = -Math.PI / 2;
    start.position.set(best[0].x, 0.016, best[0].y);
    this.overlay.add(start);
  }

  private clearGroup(g: THREE.Group, disposeMaterials = false) {
    for (const child of [...g.children]) {
      g.remove(child);
      child.traverse((n) => {
        const m = n as THREE.Mesh;
        m.geometry?.dispose();
        if (disposeMaterials && m.material) (m.material as THREE.Material).dispose();
      });
    }
  }

  // ───────────────────────────── Rendu ─────────────────────────────

  private render = () => {
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  };

  private tick = (now: number) => {
    this.frame = 0;
    let more = false;
    if (this.anims.length) {
      this.anims = this.anims.filter((a) => {
        const k = Math.min(1, (now - a.t0) / a.ms);
        a.step(ease(k));
        if (k >= 1) a.done?.();
        return k < 1;
      });
      more = true;
    }
    if (this.mode === "orbit" && this.controls.enabled) {
      if (this.controls.update() || now < this.dampUntil) more = true;
    }
    if (this.mode === "walk") {
      const dt = Math.min(0.05, (now - (this.lastTick || now)) / 1000);
      this.lastTick = now;
      const fwd = this.walk.forward + (this.keys.has("f") ? 1 : 0) - (this.keys.has("b") ? 1 : 0);
      const turn = this.walk.turn + (this.keys.has("l") ? 1 : 0) - (this.keys.has("r") ? 1 : 0);
      if (fwd || turn) {
        this.walk.yaw += turn * 1.6 * dt;
        this.stepWalk(fwd * 2.2 * dt);
        more = true;
      }
    }
    if (this.findBits) {
      const t = now / 1000;
      this.findBits.arrow.position.y = (this.entries.get(this.highlight!.fixtureId)?.built.top ?? 1) + 0.7 + Math.sin(t * 4) * 0.08;
      if (this.findBits.box) ((this.findBits.box.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * 6)));
      more = true;
    }
    // Étiquettes masquées tout près de la caméra (elles cacheraient le meuble regardé).
    const wp = new THREE.Vector3();
    for (const e of this.entries.values()) {
      if (!e.label) continue;
      e.label.getWorldPosition(wp);
      e.label.visible = wp.distanceTo(this.camera.position) > 3.2;
    }
    this.renderer.render(this.scene, this.camera);
    if (more) this.render();
  };

  /** Image PNG de la vue actuelle (export du plan) ; vide si le navigateur la refuse (photos d'une autre origine). */
  snapshot(): string | null {
    try {
      this.renderer.render(this.scene, this.camera);
      return this.renderer.domElement.toDataURL("image/png");
    } catch {
      return null;
    }
  }

  private animate(ms: number, step: (k: number) => void, done?: () => void) {
    this.anims.push({ t0: performance.now(), ms, step, done });
    this.render();
  }

  private moveCamera(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!animate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.render();
      return;
    }
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    this.animate(700, (k) => {
      this.camera.position.lerpVectors(p0, pos, k);
      this.controls.target.lerpVectors(t0, target, k);
      this.camera.lookAt(this.controls.target);
    });
  }

  private onResize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  // ───────────────────────────── Visite ─────────────────────────────

  private startWalk() {
    if (!this.floor) return;
    const p = entryPoint(this.fixtures, this.floor);
    const c = { x: this.floor.width / 2, y: this.floor.depth / 2 };
    this.walk.x = p.x;
    this.walk.z = p.y;
    this.walk.yaw = Math.atan2(-(c.x - p.x), -(c.y - p.y));
    this.walk.pitch = -0.05;
    this.applyWalkCamera();
  }

  private applyWalkCamera() {
    this.camera.position.set(this.walk.x, EYE, this.walk.z);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.walk.pitch, this.walk.yaw, 0);
  }

  /** Avance (ou recule) en glissant le long des meubles et des murs. */
  private stepWalk(dist: number) {
    const dx = -Math.sin(this.walk.yaw) * dist;
    const dz = -Math.cos(this.walk.yaw) * dist;
    const blocked = (x: number, z: number) => {
      if (this.floor && (x < 0.2 || z < 0.2 || x > this.floor.width - 0.2 || z > this.floor.depth - 0.2)) return true;
      return this.fixtures.some((f) => {
        if (isFloorItem(f) || f.model === "porte") return false;
        const r = footprint(f);
        return x > r.x - 0.25 && x < r.x + r.w + 0.25 && z > r.y - 0.25 && z < r.y + r.h + 0.25;
      });
    };
    if (!blocked(this.walk.x + dx, this.walk.z + dz)) {
      this.walk.x += dx;
      this.walk.z += dz;
    } else if (!blocked(this.walk.x + dx, this.walk.z)) this.walk.x += dx;
    else if (!blocked(this.walk.x, this.walk.z + dz)) this.walk.z += dz;
    this.applyWalkCamera();
  }

  // ───────────────────────────── Souris, doigt, clavier ─────────────────────────────

  private ndc(clientX: number, clientY: number) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  }

  private pick(clientX: number, clientY: number): Entry | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hits = this.raycaster.intersectObjects(this.fixturesRoot.children, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.fixtureId === undefined) o = o.parent;
      if (o) return this.entries.get(o.userData.fixtureId as number) ?? null;
    }
    return null;
  }

  private groundHit(clientX: number, clientY: number): Point | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? { x: p.x, y: p.z } : null;
  }

  private onPointerDown = (ev: PointerEvent) => {
    this.renderer.domElement.focus({ preventScroll: true });
    if (ev.button !== 0) return;
    this.down = { x: ev.clientX, y: ev.clientY, moved: false };
    const hit = this.pick(ev.clientX, ev.clientY);
    if (this.mode === "orbit" && this.editable && hit) {
      // Une pièce (grande surface au sol) ne se déplace qu'une fois sélectionnée : sinon, on tourne autour.
      const f = hit.fixture;
      if (f.category !== "zone" || this.selectedId === f.id) {
        const p = this.groundHit(ev.clientX, ev.clientY);
        if (p) {
          this.controls.enabled = false;
          this.drag = {
            id: f.id,
            orig: { x: f.x, y: f.y },
            offset: { x: p.x - (f.x + f.w / 2), y: p.y - (f.y + f.h / 2) },
            pos: { x: f.x, y: f.y },
            moved: false,
            blocked: null,
          };
          this.renderer.domElement.setPointerCapture(ev.pointerId);
          if (this.selectedId !== f.id) this.cb.onSelect(f.id);
          return;
        }
      }
    }
    if (this.mode === "walk" && !hit) {
      this.look = { x: ev.clientX, y: ev.clientY, yaw: this.walk.yaw, pitch: this.walk.pitch };
      this.renderer.domElement.setPointerCapture(ev.pointerId);
    }
  };

  private onPointerMove = (ev: PointerEvent) => {
    if (this.down && Math.hypot(ev.clientX - this.down.x, ev.clientY - this.down.y) > 5) this.down.moved = true;
    const canvas = this.renderer.domElement;
    if (this.drag && this.floor) {
      const p = this.groundHit(ev.clientX, ev.clientY);
      const e = this.entries.get(this.drag.id);
      if (!p || !e) return;
      const f = e.fixture;
      const raw = { x: p.x - this.drag.offset.x - f.w / 2, y: p.y - this.drag.offset.y - f.h / 2 };
      const others = this.fixtures.filter((o) => o.id !== f.id);
      const s = snapPosition(f, raw.x, raw.y, others, this.floor);
      if (!this.drag.moved && Math.hypot(s.x - this.drag.orig.x, s.y - this.drag.orig.y) > 0.02) {
        this.drag.moved = true;
        this.hiddenFixture = f.id;
        this.buildProducts();
      }
      this.drag.pos = s;
      this.place(e, s.x, s.y);
      this.drag.blocked = collision(f, footprint({ ...f, x: s.x, y: s.y }), others);
      if (this.selectionBox) (this.selectionBox.material as THREE.LineBasicMaterial).color.set(this.drag.blocked ? DANGER : ACCENT);
      canvas.style.cursor = "grabbing";
      this.render();
      return;
    }
    if (this.look) {
      this.walk.yaw = this.look.yaw - (ev.clientX - this.look.x) * 0.004;
      this.walk.pitch = Math.max(-0.7, Math.min(0.5, this.look.pitch - (ev.clientY - this.look.y) * 0.003));
      this.applyWalkCamera();
      this.render();
      return;
    }
    if (ev.pointerType === "mouse" && !ev.buttons) {
      const hit = this.pick(ev.clientX, ev.clientY);
      canvas.style.cursor = hit ? (this.editable && this.mode === "orbit" && hit.fixture.category !== "zone" ? "grab" : "pointer") : "";
    }
  };

  private onPointerUp = (ev: PointerEvent) => {
    const canvas = this.renderer.domElement;
    if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      this.hiddenFixture = null;
      this.controls.enabled = this.mode === "orbit";
      canvas.style.cursor = "";
      const e = this.entries.get(d.id);
      if (e && d.moved) {
        if (d.blocked) {
          const from = { ...d.pos };
          this.animate(
            250,
            (k) => this.place(e, from.x + (d.orig.x - from.x) * k, from.y + (d.orig.y - from.y) * k),
            () => {
              this.updateSelection();
              this.fixturesRoot.updateMatrixWorld(true);
              this.buildProducts();
            },
          );
          this.cb.onBlocked(d.blocked);
        } else {
          this.cb.onMove(d.id, d.pos.x, d.pos.y);
        }
      }
      if (this.selectionBox) (this.selectionBox.material as THREE.LineBasicMaterial).color.set(ACCENT);
      this.down = null;
      this.render();
      return;
    }
    this.look = null;
    // Simple clic (sans faire tourner la vue) : sélection.
    if (this.down && !this.down.moved && ev.button === 0) {
      const hit = this.pick(ev.clientX, ev.clientY);
      this.cb.onSelect(hit ? hit.fixture.id : null);
    }
    this.down = null;
  };

  private onDblClick = (ev: MouseEvent) => {
    const hit = this.pick(ev.clientX, ev.clientY);
    if (hit && hit.fixture.storage) this.open(hit.fixture.id);
  };

  private onWheel = (ev: WheelEvent) => {
    if (this.mode !== "walk") return;
    ev.preventDefault();
    this.stepWalk(ev.deltaY < 0 ? 0.5 : -0.5);
    this.render();
  };

  private onKey = (ev: KeyboardEvent) => {
    if (this.mode !== "walk") return;
    const map: Record<string, string> = { ArrowUp: "f", z: "f", w: "f", ArrowDown: "b", s: "b", ArrowLeft: "l", q: "l", a: "l", ArrowRight: "r", d: "r" };
    const k = map[ev.key] ?? map[ev.key.toLowerCase()];
    if (!k) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.type === "keydown") this.keys.add(k);
    else this.keys.delete(k);
    this.lastTick = performance.now();
    this.render();
  };
}

/** Écart d'angle ramené entre -π et π. */
function shortAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

