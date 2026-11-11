import { useEffect, useRef, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, ZoomIn, ZoomOut } from "lucide-react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { getLang, tl, type Lang } from "../lib/i18n";
import { helpUrl, manualFile } from "../lib/videos";
import { openManualExternal } from "./Help";
import { Modal } from "./ui";

/**
 * Lecteur du manuel d'utilisation (PDF) dans GestiMarket, page par page, sans Internet : le manuel est rangé
 * dans l'application (dossier « manuel »), sinon dans l'aide hors ligne de ce poste ou du poste serveur.
 * À défaut, il s'ouvre en ligne dans le lecteur PDF de l'appareil.
 */
async function loadManual(lang: Lang): Promise<ArrayBuffer | null> {
  const file = manualFile(lang);
  for (const url of [`/manuel/${file}`, helpUrl(file)]) {
    if (/^https:\/\/github\.com\//.test(url)) continue; // en ligne : bouton « Ouvrir dans un lecteur PDF »
    try {
      const r = await fetch(url);
      if (!r.ok) continue;
      const buf = await r.arrayBuffer();
      // Fichier absent : le serveur peut répondre par la page de l'application.
      if (new TextDecoder().decode(new Uint8Array(buf.slice(0, 5))) === "%PDF-") return buf;
    } catch {
      /* source suivante */
    }
  }
  return null;
}

/** pdf.js (version compatible avec les anciens Android et iOS) et son « worker », propre à ce lecteur. */
async function pdfjs(): Promise<{ lib: typeof import("pdfjs-dist"); worker: Worker }> {
  const lib = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const { default: PdfWorker } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker");
  const worker = new PdfWorker();
  lib.GlobalWorkerOptions.workerPort = worker;
  return { lib, worker };
}

export default function ManualViewer({ onClose }: { onClose: () => void }) {
  const lang: Lang = getLang() === "en" ? "en" : "fr";
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [missing, setMissing] = useState(false);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    let worker: Worker | null = null;
    let loaded: PDFDocumentProxy | null = null;
    (async () => {
      const data = await loadManual(lang);
      if (!data) return alive && setMissing(true);
      const pdf = await pdfjs();
      worker = pdf.worker;
      loaded = await pdf.lib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
      if (alive) setDoc(loaded);
    })().catch(() => alive && setMissing(true));
    return () => {
      alive = false;
      void loaded?.destroy();
      worker?.terminate();
    };
  }, [lang]);

  // Page à la largeur de la fenêtre (netteté selon l'écran), puis zoom.
  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled || !canvas.current || !box.current) return;
      const base = p.getViewport({ scale: 1 });
      const css = (Math.max(280, box.current.clientWidth - 8) / base.width) * zoom;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = p.getViewport({ scale: css * ratio });
      const c = canvas.current;
      c.width = Math.floor(viewport.width);
      c.height = Math.floor(viewport.height);
      c.style.width = `${Math.floor(viewport.width / ratio)}px`;
      c.style.height = `${Math.floor(viewport.height / ratio)}px`;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      task = p.render({ canvasContext: ctx, viewport });
      await task.promise.catch(() => undefined);
      box.current?.scrollTo({ top: 0 });
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, page, zoom]);

  const pages = doc?.numPages ?? 0;
  const go = (n: number) => setPage(Math.min(Math.max(1, n), pages || 1));

  return (
    <Modal title={<><BookOpen size={18} />  {tl("Manuel d'utilisation")}</>} onClose={onClose} width={900}>
      <div className="manual-viewer">
        <div className="manual-bar">
          <button type="button" className="btn btn-sm" onClick={() => go(page - 1)} disabled={!doc || page <= 1} aria-label={tl("Page précédente")}><ChevronLeft size={16} /></button>
          <span className="manual-page">{doc ? tl("Page {0} / {1}", [page, pages]) : missing ? "" : tl("Chargement…")}</span>
          <button type="button" className="btn btn-sm" onClick={() => go(page + 1)} disabled={!doc || page >= pages} aria-label={tl("Page suivante")}><ChevronRight size={16} /></button>
          <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} disabled={!doc} aria-label={tl("Réduire")}><ZoomOut size={16} /></button>
          <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.min(2.4, z + 0.2))} disabled={!doc} aria-label={tl("Agrandir")}><ZoomIn size={16} /></button>
          <button type="button" className="btn btn-sm manual-external" onClick={() => void openManualExternal()}><ExternalLink size={15} />  {tl("Ouvrir dans un lecteur PDF")}</button>
        </div>
        {missing ? (
          <div className="alert alert-info">
            {tl("Le manuel n'est pas encore sur cet appareil. Ouvrez-le en ligne, ou téléchargez l'aide hors ligne (Paramètres → Aide, conditions et licence).")}
          </div>
        ) : (
          <div className="manual-canvas" ref={box}>
            <canvas ref={canvas} />
          </div>
        )}
      </div>
    </Modal>
  );
}
