// Miniatures 3D des meubles de la palette : chaque meuble dessiné garni, vu de trois quarts.
import * as THREE from "three";
import type { FixtureType } from "../../types";
import { buildFixture, cellItems, disposeObject, type Item } from "./models";

let renderer: THREE.WebGLRenderer | null = null;
let failed = false;
const cache = new Map<string, string>();
const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

/** Image (data URL) d'un type de meuble, ou null si la 3D n'est pas disponible. */
export function thumbnail(t: FixtureType): string | null {
  const model = t.model || t.code;
  const key = [model, t.width, t.depth, t.height, t.color, t.levels, t.sections].join("|");
  const hit = cache.get(key);
  if (hit) return hit;
  // Un texte au sol n'a pas de dessin : sa pastille de couleur suffit.
  if (failed || model === "texte") return null;
  try {
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(176, 132, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
  } catch {
    failed = true;
    return null;
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#ffffff", "#bdb6aa", 1.5));
  const sun = new THREE.DirectionalLight("#ffffff", 1.3);
  sun.position.set(3, 6, 5);
  scene.add(sun);
  // Murs, pièces : un morceau représentatif.
  const w = t.category === "zone" ? Math.min(t.width, 4) : model === "mur" ? Math.min(t.width, 2.5) : t.width;
  const d = t.category === "zone" ? Math.min(t.depth, 3) : t.depth;
  const built = buildFixture({
    model,
    w,
    d,
    height: t.height,
    color: t.color,
    levels: t.levels,
    sections: t.sections,
    wallHeight: 2.6,
    lowWalls: false,
    label: "",
  });
  scene.add(built.group);
  // Le meuble paraît garni.
  const products = new THREE.Group();
  const geos = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), sphere: new THREE.SphereGeometry(0.5, 10, 8) };
  if (t.storage) {
    const items: { it: Item; color: string }[] = [];
    for (let l = 1; l <= t.levels; l++) {
      for (let s = 1; s <= t.sections; s++) {
        built.cells(l, s).forEach((c, i) => cellItems(c, 2, l * 31 + s * 7 + i).forEach((it) => items.push({ it, color: COLORS[(l * 3 + s) % COLORS.length] })));
      }
    }
    const mats = new Map<string, THREE.MeshStandardMaterial>();
    for (const { it, color } of items) {
      const c = it.material === "carton" ? "#b98b5a" : it.material === "pallet" ? "#c9a46a" : color;
      let m = mats.get(c);
      if (!m) mats.set(c, (m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.6 })));
      const mesh = new THREE.Mesh(geos[it.shape], m);
      mesh.position.set(it.x, it.y, it.z);
      mesh.scale.set(it.sx, it.sy, it.sz);
      products.add(mesh);
    }
    scene.add(products);
  }
  const top = Math.max(0.3, built.top);
  const size = Math.max(w, d, top);
  const camera = new THREE.PerspectiveCamera(30, 176 / 132, 0.05, 100);
  const target = new THREE.Vector3(0, t.category === "zone" ? 0 : top * 0.42, 0);
  const dir = new THREE.Vector3(1, t.category === "zone" ? 1.6 : 0.75, 1.35).normalize();
  camera.position.copy(target).addScaledVector(dir, size * 2.5);
  camera.lookAt(target);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");
  disposeObject(built.group);
  Object.values(geos).forEach((g) => g.dispose());
  products.children.forEach((m) => ((m as THREE.Mesh).material as THREE.Material).dispose());
  cache.set(key, url);
  return url;
}
