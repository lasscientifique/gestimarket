import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CircleHelp, X, Lightbulb, ListChecks, Target, PlayCircle, BookOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { PAGE_HELP, TIPS } from "../lib/help";
import { tl } from "../lib/i18n";
import { isTauri } from "../lib/transport";
import { ACTION_VIDEOS, helpUrl, manualFile, TIP_VIDEO, videoFile, videosFor, type HelpVideo } from "../lib/videos";

/** Vidéo d'aide : le vrai logiciel filmé, voix de synthèse et sous-titres (en ligne, ou téléchargée sur le serveur). */
export function VideoModal({ video, onClose }: { video: HelpVideo; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop video-backdrop" onMouseDown={onClose}>
      <div className="modal video-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={video.title}>
        <div className="modal-header">
          <h2><PlayCircle size={18} />  {video.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={tl("Fermer")}><X size={18} /></button>
        </div>
        <div className="video-body">
          {failed ? (
            <div className="alert alert-warning">
              {tl("Vidéo indisponible : Internet est nécessaire, ou téléchargez l'aide sur le poste serveur (Paramètres → Développeur Eden Dev → Aide hors ligne).")}
            </div>
          ) : (
            <video src={helpUrl(videoFile(video.id))} controls autoPlay playsInline preload="metadata" onError={() => setFailed(true)} />
          )}
          <p className="muted small">{tl("Voix de synthèse Piper (voix SIWIS et LibriTTS-R, licence CC BY 4.0).")}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Demande d'ouverture du lecteur du manuel (voir ManualHost, monté une fois dans App). */
export const MANUAL_EVENT = "gm-open-manual";

/** Manuel d'utilisation : lecteur intégré, page par page, même sans Internet (manuel rangé dans l'application). */
export function openManual() {
  window.dispatchEvent(new Event(MANUAL_EVENT));
}

/** Manuel d'utilisation (PDF) dans le lecteur de l'appareil : celui du poste s'il est téléchargé, sinon en ligne. */
export async function openManualExternal() {
  const file = manualFile();
  if (isTauri) {
    try {
      await invoke("open_help", { name: file });
      return;
    } catch {
      /* ouverture par le navigateur ci-dessous */
    }
  }
  window.open(helpUrl(file), "_blank", "noopener");
}

/**
 * Petit « ? » à côté d'un bouton ou d'un champ : explique son rôle.
 * S'ouvre au survol ou au clic ; se ferme en cliquant ailleurs.
 */
export function HelpTip({ k, text, side = "bottom" }: { k?: keyof typeof TIPS | string; text?: string; side?: "bottom" | "top" | "left" }) {
  const [open, setOpen] = useState(false);
  const [video, setVideo] = useState<HelpVideo | null>(null);
  const videoId = k ? TIP_VIDEO[k] : undefined;
  const tipVideo = videoId ? ACTION_VIDEOS().find((v) => v.id === videoId) : undefined;
  const ref = useRef<HTMLSpanElement>(null);
  const content = text ?? (k ? TIPS[k] : "");
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  if (!content) return null;
  return (
    <span className="help-tip" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="help-tip-btn"
        aria-label={tl("Aide")}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        ?
      </button>
      {open && (
        <span className={`help-pop ${side}`} role="tooltip">
          {content}
          {tipVideo && (
            <button
              type="button"
              className="help-pop-video"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
                setVideo(tipVideo);
              }}
            >
              <PlayCircle size={14} />  {tl("Voir en vidéo")}
            </button>
          )}
        </span>
      )}
      {video && <VideoModal video={video} onClose={() => setVideo(null)} />}
    </span>
  );
}

/** Bouton « Aide » d'un écran : ouvre un panneau expliquant l'écran et son utilisation. */
export function PageHelpButton({ page }: { page: string }) {
  const [open, setOpen] = useState(false);
  const [video, setVideo] = useState<HelpVideo | null>(null);
  const help = PAGE_HELP[page];
  const videos = videosFor(page);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!help) return null;
  return (
    <>
      <button className="btn btn-help" onClick={() => setOpen(true)} title={tl("Aide sur cet écran")}>
        <CircleHelp size={16} />  {tl("Aide")}</button>
      {open && (
        <div className="help-backdrop" onMouseDown={() => setOpen(false)}>
          <aside className="help-panel" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={tl("Aide : {0}", [help.title])}>
            <div className="help-panel-head">
              <CircleHelp size={20} />
              <h2>{help.title}</h2>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label={tl("Fermer")}><X size={18} /></button>
            </div>
            {videos.length > 0 && (
              <section>
                <h4><PlayCircle size={15} />  {tl("En vidéo")}</h4>
                <div className="help-videos">
                  {videos.map((v) => (
                    <button key={v.id} type="button" className="help-video" onClick={() => setVideo(v)}>
                      <PlayCircle size={18} />
                      <span>{v.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section>
              <h4><Target size={15} />  {tl("À quoi sert cet écran ?")}</h4>
              <p>{help.purpose}</p>
            </section>
            <section>
              <h4><ListChecks size={15} />  {tl("Comment faire")}</h4>
              <ol>{help.steps.map((s) => <li key={s}>{s}</li>)}</ol>
            </section>
            {help.tips && (
              <section>
                <h4><Lightbulb size={15} />  {tl("Astuces")}</h4>
                <ul>{help.tips.map((s) => <li key={s}>{s}</li>)}</ul>
              </section>
            )}
            <p className="muted small">{tl("Les petits boutons")} <span className="help-tip-btn inline">?</span>  {tl("à côté des actions expliquent chaque fonction.")}</p>
            <button type="button" className="btn btn-sm help-manual" onClick={() => void openManual()}><BookOpen size={15} />  {tl("Manuel d'utilisation (PDF)")}</button>
          </aside>
        </div>
      )}
      {video && <VideoModal video={video} onClose={() => setVideo(null)} />}
    </>
  );
}
