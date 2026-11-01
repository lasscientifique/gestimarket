/**
 * Lecture de codes-barres et QR codes depuis la caméra (téléphone, tablette, webcam).
 *  - BarcodeDetector natif quand le navigateur le propose (Chrome Android : très rapide) ;
 *  - sinon ZXing (JavaScript pur, fonctionne partout, y compris iPhone / iPad).
 */
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from "@zxing/library";

const FORMATS = [
  BarcodeFormat.QR_CODE,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.DATA_MATRIX,
];

let zxing: MultiFormatReader | null = null;
function reader() {
  if (!zxing) {
    zxing = new MultiFormatReader();
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    zxing.setHints(hints);
  }
  return zxing;
}

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
let native: NativeDetector | null | undefined;
async function nativeDetector(): Promise<NativeDetector | null> {
  if (native !== undefined) return native;
  native = null;
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): NativeDetector; getSupportedFormats(): Promise<string[]> } })
    .BarcodeDetector;
  if (BD) {
    try {
      const wanted = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "data_matrix"];
      const supported = await BD.getSupportedFormats();
      const formats = wanted.filter((f) => supported.includes(f));
      if (formats.length) native = new BD({ formats });
    } catch {
      native = null;
    }
  }
  return native;
}

/** Décode le contenu d'un canvas. Retourne null si aucun code n'est lu. */
export async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const det = await nativeDetector();
  if (det) {
    try {
      const r = await det.detect(canvas);
      if (r.length && r[0].rawValue) return r[0].rawValue.trim();
    } catch {
      /* repli sur ZXing */
    }
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const lum = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
  try {
    const result = reader().decodeWithState(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, width, height))));
    return result.getText().trim() || null;
  } catch {
    return null;
  } finally {
    reader().reset();
  }
}

/** Décode une photo (mode « appareil photo » utilisable sans HTTPS). */
export async function decodeImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Image illisible"));
      i.src = url;
    });
    // Plusieurs tailles : un code-barres trop petit ou trop grand se lit mieux à une autre échelle.
    for (const max of [1280, 1920, 800]) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const code = await decodeCanvas(c);
      if (code) return code;
    }
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** La caméra en direct est-elle utilisable ? (le navigateur l'interdit hors HTTPS) */
export function liveCameraAvailable() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
}

/** Bip court + vibration à la lecture d'un code. */
export function scanFeedback() {
  try {
    navigator.vibrate?.(60);
  } catch {
    /* non disponible */
  }
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 1760;
    g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.09);
    o.onended = () => ctx.close();
  } catch {
    /* son non disponible */
  }
}

/** Adresse HTTPS équivalente à la page actuelle (port + 1), pour activer la caméra en direct. */
export function secureUrl(): string | null {
  if (window.location.protocol !== "http:") return null;
  const port = Number(window.location.port || 80);
  return `https://${window.location.hostname}:${port + 1}${window.location.pathname}${window.location.hash}`;
}
