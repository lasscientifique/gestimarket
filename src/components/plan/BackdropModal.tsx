import { useEffect, useRef, useState, type MouseEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FileImage, Ruler, Trash2, Upload } from "lucide-react";
import { api } from "../../api";
import { useApp } from "../../context/AppContext";
import { compressImage, mediaUrl } from "../../lib/media";
import { Field, Modal } from "../ui";
import { StoreMap } from "./StoreMap";
import { roomBox } from "./exportPlan";
import type { Backdrop, Fixture, Floor } from "../../types";
import { getLang, tl, tm } from "../../lib/i18n";

const num = (s: string) => Number(s.replace(",", "."));
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace(".", getLang() === "fr" ? "," : ".");

/** Première page d'un PDF en image (pdf.js, chargé seulement ici). */
async function pdfToBlob(file: File): Promise<Blob> {
  // Version « ancienne compatibilité » de pdf.js : elle marche aussi sur les anciens Android et iOS.
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  // Lecteur PDF dans un « worker » regroupé par Vite (fichier .js, servi partout avec le bon type).
  const { default: PdfWorker } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker");
  const worker = new PdfWorker();
  pdfjs.GlobalWorkerOptions.workerPort = worker;
  try {
    return await renderFirstPage(pdfjs, file);
  } finally {
    worker.terminate();
  }
}

async function renderFirstPage(pdfjs: typeof import("pdfjs-dist"), file: File): Promise<Blob> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(4, 2400 / Math.max(base.width, base.height)) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  await doc.destroy();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tl("PDF illisible.")))), "image/png"));
}

/** Taille en pixels d'une image (pour garder ses proportions et la recaler). */
function imageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error(tl("Image illisible.")));
    img.src = src;
  });
}

/**
 * Dessin du bâtiment (photo ou PDF du plan de l'architecte) en fond d'un niveau : il s'ajuste à la salle,
 * se recale par une mesure connue (deux clics sur un mur et sa longueur réelle), se décale et s'éclaircit.
 * On pose ensuite les meubles par-dessus.
 */
export function BackdropModal({ floor, fixtures, onClose, onSaved }: { floor: Floor; fixtures: Fixture[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const room = roomBox(floor, fixtures);
  const [mediaId, setMediaId] = useState<number | null>(floor.backdrop_id);
  const [src, setSrc] = useState<string | null>(null);
  const [px, setPx] = useState<{ w: number; h: number } | null>(null);
  const [frame, setFrame] = useState<Backdrop>(floor.backdrop ?? { x: room.x, y: room.y, w: room.w, h: room.h, opacity: 0.6 });
  const [lock, setLock] = useState(true);
  const [tab, setTab] = useState<"frame" | "measure">("frame");
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [length, setLength] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const url = mediaUrl(mediaId);
    setSrc(url ?? null);
    if (url) imageSize(url).then(setPx).catch(() => setPx(null));
  }, [mediaId]);

  const ratio = px ? px.h / px.w : null;

  /** Ajuste le dessin à la salle en gardant ses proportions. */
  const fit = (r: number | null) => {
    if (!r) return setFrame({ ...frame, x: room.x, y: room.y, w: room.w, h: room.h });
    let w = room.w;
    let h = w * r;
    if (h > room.h) {
      h = room.h;
      w = h / r;
    }
    setFrame({ ...frame, x: room.x + (room.w - w) / 2, y: room.y + (room.h - h) / 2, w, h });
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfToBlob(file) : file;
      const { mime, data } = await compressImage(blob, 2400);
      const id = await api.uploadImage(mime, data);
      const size = await imageSize(`data:${mime};base64,${data}`);
      setMediaId(id);
      setPx(size);
      setPoints([]);
      const r = size.h / size.w;
      let w = room.w;
      let h = w * r;
      if (h > room.h) {
        h = room.h;
        w = h / r;
      }
      setFrame({ x: room.x + (room.w - w) / 2, y: room.y + (room.h - h) / 2, w, h, opacity: 0.6 });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const setWidth = (w: number) => setFrame({ ...frame, w, h: lock && ratio ? w * ratio : frame.h });
  const setHeight = (h: number) => setFrame({ ...frame, h, w: lock && ratio ? h / ratio : frame.w });
  const nudge = (dx: number, dy: number) => setFrame({ ...frame, x: frame.x + dx, y: frame.y + dy });

  // Mesure : deux clics sur le dessin (pixels de l'image), puis la longueur réelle.
  const click = (e: MouseEvent<HTMLImageElement>) => {
    if (!px) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p = { x: ((e.clientX - r.left) / r.width) * px.w, y: ((e.clientY - r.top) / r.height) * px.h };
    setPoints(points.length >= 2 ? [p] : [...points, p]);
  };
  const measured = points.length === 2 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0;
  const applyMeasure = () => {
    const L = num(length);
    if (!px || measured < 5 || !(L > 0)) return;
    const metresPerPx = L / measured;
    setFrame({ ...frame, w: px.w * metresPerPx, h: px.h * metresPerPx });
    setTab("frame");
    toast.success(tl("Dessin recalé : {0} m de large.", [fmt(px.w * metresPerPx)]));
  };

  const saveFrame = async () => {
    if (!mediaId) return;
    setBusy(true);
    try {
      await api.planSetBackdrop({ floor_id: floor.id, media_id: mediaId, ...frame });
      toast.success(tl("Dessin du bâtiment enregistré."));
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.planSetBackdrop({ floor_id: floor.id, media_id: null });
      toast.success(tl("Dessin retiré."));
      onSaved();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const preview: Floor = { ...floor, backdrop_id: mediaId, backdrop: mediaId ? frame : null };

  return (
    <Modal
      title={tl("Dessin du bâtiment — {0}", [tm(floor.name)])}
      onClose={onClose}
      width={980}
      footer={
        <>
          {floor.backdrop_id && <button className="btn btn-danger-outline" disabled={busy} onClick={remove}><Trash2 size={15} />  {tl("Retirer le dessin")}</button>}
          <button className="btn" onClick={onClose}>{tl("Annuler")}</button>
          <button className="btn btn-primary" disabled={busy || !mediaId} onClick={saveFrame}>{tl("Enregistrer")}</button>
        </>
      }
    >
      <div className="backdrop-grid">
        <div className="backdrop-side">
          <p className="muted small" style={{ marginTop: 0 }}>
            {tl("Importez la photo ou le PDF du plan du bâtiment : il s'affiche sous le plan, à l'échelle de la salle. Posez ensuite les meubles par-dessus (vue Dessus, Modifier le plan).")}
          </p>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.pdf" hidden onChange={(e) => choose(e.target.files?.[0])} />
          <button className="btn btn-block" disabled={busy} onClick={() => fileRef.current?.click()}>
            {mediaId ? <FileImage size={16} /> : <Upload size={16} />}  {busy ? tl("Chargement…") : mediaId ? tl("Changer de dessin (photo ou PDF)") : tl("Importer une photo ou un PDF")}
          </button>
          {mediaId && (
            <>
              <div className="segmented" style={{ margin: "12px 0 8px" }}>
                <button className={tab === "frame" ? "active" : ""} onClick={() => setTab("frame")}>{tl("Taille et position")}</button>
                <button className={tab === "measure" ? "active" : ""} onClick={() => setTab("measure")}><Ruler size={14} />  {tl("Recaler par une mesure")}</button>
              </div>
              {tab === "frame" ? (
                <div className="form-grid">
                  <Field label={tl("Largeur du dessin (m)")}>
                    <input type="number" min={0.5} step={0.1} value={Math.round(frame.w * 100) / 100} onChange={(e) => Number(e.target.value) > 0 && setWidth(Number(e.target.value))} />
                  </Field>
                  <Field label={tl("Hauteur du dessin (m)")}>
                    <input type="number" min={0.5} step={0.1} value={Math.round(frame.h * 100) / 100} onChange={(e) => Number(e.target.value) > 0 && setHeight(Number(e.target.value))} />
                  </Field>
                  <label className="check span-2">
                    <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
                    {tl("Garder les proportions du dessin")}
                  </label>
                  <div className="span-2 backdrop-nudge">
                    <span className="field-label">{tl("Décaler de 10 cm")}</span>
                    <div className="row-gap">
                      <button className="icon-btn" title={tl("Gauche")} onClick={() => nudge(-0.1, 0)}><ArrowLeft size={16} /></button>
                      <button className="icon-btn" title={tl("Haut")} onClick={() => nudge(0, -0.1)}><ArrowUp size={16} /></button>
                      <button className="icon-btn" title={tl("Bas")} onClick={() => nudge(0, 0.1)}><ArrowDown size={16} /></button>
                      <button className="icon-btn" title={tl("Droite")} onClick={() => nudge(0.1, 0)}><ArrowRight size={16} /></button>
                      <button className="btn btn-sm" onClick={() => fit(ratio)}>{tl("Ajuster à la salle")}</button>
                    </div>
                  </div>
                  <Field label={tl("Visibilité : {0} %", [Math.round(frame.opacity * 100)])} span={2}>
                    <input type="range" min={10} max={100} step={5} value={Math.round(frame.opacity * 100)} onChange={(e) => setFrame({ ...frame, opacity: Number(e.target.value) / 100 })} />
                  </Field>
                </div>
              ) : (
                <div className="backdrop-measure">
                  <p className="muted small">{tl("Cliquez sur les deux extrémités d'un mur dont vous connaissez la longueur, puis tapez-la.")}</p>
                  {src && px && (
                    <div className="backdrop-measure-img">
                      <img src={src} alt="" onClick={click} draggable={false} />
                      <svg viewBox={`0 0 ${px.w} ${px.h}`} preserveAspectRatio="none">
                        {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={Math.max(px.w, px.h) / 120} className="measure-dot" />)}
                        {points.length === 2 && <line x1={points[0].x} y1={points[0].y} x2={points[1].x} y2={points[1].y} className="measure-line" strokeWidth={Math.max(px.w, px.h) / 300} />}
                      </svg>
                    </div>
                  )}
                  <div className="input-with-btn">
                    <input inputMode="decimal" value={length} onChange={(e) => setLength(e.target.value)} placeholder={tl("Longueur réelle (m)")} disabled={points.length < 2} />
                    <button className="btn btn-primary" disabled={points.length < 2 || !(num(length) > 0)} onClick={applyMeasure}>{tl("Recaler")}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <div className="backdrop-preview">
          <StoreMap floor={preview} fixtures={fixtures} height={440} />
        </div>
      </div>
    </Modal>
  );
}
