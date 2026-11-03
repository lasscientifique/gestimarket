// Matériaux partagés des meubles 3D (métal, verre, bois, peinture…) et textures du sol, dessinées par le code.
import * as THREE from "three";

const cache = new Map<string, THREE.Material>();

function std(params: THREE.MeshStandardMaterialParameters) {
  return new THREE.MeshStandardMaterial(params);
}

/** Couleur éclaircie (k > 0) ou assombrie (k < 0), k entre -1 et 1. */
export function shade(hex: string, k: number): string {
  const c = new THREE.Color(hex);
  const t = k > 0 ? new THREE.Color("#ffffff") : new THREE.Color("#000000");
  c.lerp(t, Math.abs(k));
  return `#${c.getHexString()}`;
}

const BASE: Record<string, () => THREE.Material> = {
  metal: () => std({ color: "#c7ccd3", metalness: 0.65, roughness: 0.35 }),
  metalDark: () => std({ color: "#4b5563", metalness: 0.55, roughness: 0.45 }),
  chrome: () => std({ color: "#eef0f3", metalness: 0.9, roughness: 0.15 }),
  white: () => std({ color: "#f3f4f6", roughness: 0.6 }),
  black: () => std({ color: "#1f2328", roughness: 0.5 }),
  rubber: () => std({ color: "#26282b", roughness: 0.9 }),
  glass: () => std({ color: "#cfe9ff", transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, depthWrite: false }),
  glassFrost: () => std({ color: "#e0f0ff", transparent: true, opacity: 0.4, roughness: 0.2, depthWrite: false }),
  wood: () => std({ color: "#a8754b", roughness: 0.75 }),
  woodLight: () => std({ color: "#d9b88f", roughness: 0.7 }),
  pallet: () => std({ color: "#c9a46a", roughness: 0.9 }),
  cardboard: () => std({ color: "#b98b5a", roughness: 0.9 }),
  light: () => std({ color: "#ffffff", emissive: "#fffbe8", emissiveIntensity: 1 }),
  coldLight: () => std({ color: "#ffffff", emissive: "#e6f4ff", emissiveIntensity: 1 }),
  freezerIn: () => std({ color: "#dbeafe", roughness: 0.4 }),
  screen: () => std({ color: "#0b1220", emissive: "#1d4ed8", emissiveIntensity: 0.6 }),
  rackBlue: () => std({ color: "#1d4ed8", metalness: 0.3, roughness: 0.5 }),
  rackOrange: () => std({ color: "#f97316", metalness: 0.3, roughness: 0.5 }),
  label: () => std({ color: "#fefce8", roughness: 0.6 }),
  wall: () => std({ color: "#ece7df", roughness: 0.85 }),
  wallTop: () => std({ color: "#9a9184", roughness: 0.8 }),
  insulated: () => std({ color: "#f8fafc", roughness: 0.5, metalness: 0.1 }),
};

/**
 * Matériau par clé : « metal », « glass »… ou « paint:#3b82f6 » (peinture de la couleur du meuble),
 * « sign:#3b82f6 » (enseigne lumineuse), « zone:#dbeafe » (sol d'une pièce).
 */
export function material(key: string): THREE.Material {
  let m = cache.get(key);
  if (m) return m;
  const [kind, color] = key.split(":");
  if (kind === "paint") m = std({ color, roughness: 0.55, metalness: 0.1 });
  else if (kind === "sign") m = std({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.4 });
  else if (kind === "zone") m = std({ color, transparent: true, opacity: 0.45, roughness: 0.9, depthWrite: false });
  else if (kind === "solid") m = std({ color, roughness: 0.7 });
  else m = (BASE[kind] ?? BASE.white)();
  cache.set(key, m);
  return m;
}

export const isTransparent = (key: string) => key.startsWith("glass") || key.startsWith("zone:");

// ───────────────────────────── Sols ─────────────────────────────

const floorCache = new Map<string, THREE.CanvasTexture>();

/** Texture du sol (carrelage, béton, parquet, lino) ; un motif couvre `size` mètres. */
export function floorTexture(style: string): { texture: THREE.CanvasTexture; size: number } {
  const size = style === "wood" ? 2.4 : style === "tiles" ? 1.2 : 2;
  let tex = floorCache.get(style);
  if (!tex) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d")!;
    const rand = mulberry(7);
    if (style === "tiles") {
      // 2 × 2 carreaux de 60 cm, joints gris clair.
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const v = 236 + Math.floor(rand() * 10);
          g.fillStyle = `rgb(${v},${v - 2},${v - 6})`;
          g.fillRect(i * 128, j * 128, 128, 128);
          for (let k = 0; k < 160; k++) {
            const s = 225 + Math.floor(rand() * 25);
            g.fillStyle = `rgba(${s},${s},${s - 4},0.5)`;
            g.fillRect(i * 128 + rand() * 128, j * 128 + rand() * 128, 2, 2);
          }
        }
      }
      g.strokeStyle = "#c9c4bb";
      g.lineWidth = 3;
      for (let k = 0; k <= 2; k++) {
        g.beginPath();
        g.moveTo(k * 128, 0);
        g.lineTo(k * 128, 256);
        g.moveTo(0, k * 128);
        g.lineTo(256, k * 128);
        g.stroke();
      }
    } else if (style === "wood") {
      // Lames de parquet décalées.
      const plank = 256 / 8;
      for (let r = 0; r < 8; r++) {
        let x = -rand() * 200;
        while (x < 256) {
          const len = 120 + rand() * 120;
          const t = 150 + Math.floor(rand() * 40);
          g.fillStyle = `rgb(${t + 40},${t},${t - 50})`;
          g.fillRect(x, r * plank, len, plank);
          g.strokeStyle = "rgba(60,35,15,0.35)";
          g.strokeRect(x, r * plank, len, plank);
          for (let k = 0; k < 6; k++) {
            g.strokeStyle = `rgba(90,55,25,${0.08 + rand() * 0.1})`;
            g.beginPath();
            const yy = r * plank + rand() * plank;
            g.moveTo(x, yy);
            g.lineTo(x + len, yy + (rand() - 0.5) * 4);
            g.stroke();
          }
          x += len;
        }
      }
    } else if (style === "concrete") {
      g.fillStyle = "#b8b6b1";
      g.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 4000; k++) {
        const s = 150 + Math.floor(rand() * 70);
        g.fillStyle = `rgba(${s},${s},${s - 3},0.35)`;
        g.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
      }
    } else {
      // Lino clair moucheté.
      g.fillStyle = "#e7e1d6";
      g.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 1800; k++) {
        const s = 190 + Math.floor(rand() * 50);
        g.fillStyle = `rgba(${s},${s - 6},${s - 14},0.5)`;
        g.fillRect(rand() * 256, rand() * 256, 2, 2);
      }
    }
    tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    floorCache.set(style, tex);
  }
  return { texture: tex, size };
}

/** Générateur pseudo-aléatoire reproductible (mêmes dessins à chaque affichage). */
export function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Étiquette (texte sur fond) dessinée sur un canevas, pour un panneau ou un repère au sol. */
export function textTexture(text: string, opts: { color?: string; background?: string; bold?: boolean; height?: number } = {}): {
  texture: THREE.CanvasTexture;
  aspect: number;
} {
  const h = opts.height ?? 64;
  const c = document.createElement("canvas");
  const g = c.getContext("2d")!;
  const font = `${opts.bold === false ? 500 : 700} ${Math.round(h * 0.62)}px "Inter Variable", "Segoe UI", Arial, sans-serif`;
  g.font = font;
  const w = Math.min(1024, Math.ceil(g.measureText(text).width + h * 0.6));
  c.width = w;
  c.height = h;
  if (opts.background) {
    g.fillStyle = opts.background;
    const r = h * 0.22;
    g.beginPath();
    g.moveTo(r, 0);
    g.arcTo(w, 0, w, h, r);
    g.arcTo(w, h, 0, h, r);
    g.arcTo(0, h, 0, 0, r);
    g.arcTo(0, 0, w, 0, r);
    g.fill();
  }
  g.font = font;
  g.fillStyle = opts.color ?? "#111827";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + 1, w - h * 0.3);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: w / h };
}
