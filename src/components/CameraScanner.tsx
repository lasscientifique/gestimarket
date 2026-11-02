import { useEffect, useRef, useState } from "react";
import { Camera, Check, Flashlight, ImageUp, Lock, ScanLine, SwitchCamera } from "lucide-react";
import { decodeCanvas, decodeImageFile, liveCameraAvailable, scanFeedback, secureUrl } from "../lib/scanner";
import { Modal } from "./ui";
import { hasNativeScanner, onNativeCode, requestNativeScan } from "../lib/native";
import { tl } from "../lib/i18n";

/**
 * Scanner de codes-barres et QR codes par la caméra (téléphone, tablette, webcam).
 * `continuous` : la fenêtre reste ouverte pour scanner plusieurs articles à la suite (caisse).
 * `onCode` retourne false si le code n'a pas été accepté (produit inconnu…).
 */
export function CameraScanner({
  title = "Scanner un code",
  hint,
  continuous,
  onCode,
  onClose,
}: {
  title?: string;
  hint?: string;
  continuous?: boolean;
  onCode: (code: string) => boolean | void | Promise<boolean | void>;
  onClose: () => void;
}) {
  // Application mobile avec scanner natif : on l'utilise à la place de la caméra du navigateur.
  const native = hasNativeScanner();
  const live = !native && liveCameraAvailable();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busy = useRef(false);
  const last = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [error, setError] = useState("");
  const [status, setStatus] = useState<{ code: string; ok: boolean } | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const accept = async (code: string) => {
    const now = Date.now();
    // Même code relu dans la seconde et demie : ignoré (évite les doublons involontaires).
    if (code === last.current.code && now - last.current.at < 1500) return;
    last.current = { code, at: now };
    scanFeedback();
    const r = await onCode(code);
    const ok = r !== false;
    setStatus({ code, ok });
    if (ok) setCount((c) => c + 1);
    if (ok && !continuous) onClose();
  };

  // Scanner natif de l'application mobile
  useEffect(() => {
    if (!native) return;
    const off = onNativeCode((c) => accept(c));
    requestNativeScan(title);
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native]);

  // Caméra en direct
  useEffect(() => {
    if (!live) return;
    let stop = false;
    let timer = 0;
    const canvas = document.createElement("canvas");
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (stop) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorch(caps.torch ? false : null);
        const v = videoRef.current!;
        v.srcObject = stream;
        await v.play().catch(() => undefined);
        navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === "videoinput"))).catch(() => undefined);
        const tick = async () => {
          if (stop) return;
          if (!busy.current && v.readyState >= 2 && v.videoWidth) {
            busy.current = true;
            // Zone centrale (là où l'on vise), réduite pour aller vite.
            const sw = v.videoWidth * 0.8;
            const sh = v.videoHeight * 0.6;
            const scale = Math.min(1, 900 / sw);
            canvas.width = Math.round(sw * scale);
            canvas.height = Math.round(sh * scale);
            canvas.getContext("2d", { willReadFrequently: true })!.drawImage(v, (v.videoWidth - sw) / 2, (v.videoHeight - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
            const code = await decodeCanvas(canvas);
            if (code && !stop) await accept(code);
            busy.current = false;
          }
          timer = window.setTimeout(tick, 180);
        };
        tick();
      } catch (e) {
        const name = (e as { name?: string }).name;
        setError(
          name === "NotAllowedError"
            ? tl("Accès à la caméra refusé. Autorisez la caméra pour ce site dans les réglages du navigateur.")
            : name === "NotFoundError"
              ? tl("Aucune caméra trouvée sur cet appareil.")
              : tl("Impossible de démarrer la caméra."),
        );
      }
    })();
    return () => {
      stop = true;
      window.clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, deviceId]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
      setTorch(!torch);
    } catch {
      setTorch(null);
    }
  };

  const nextCamera = () => {
    if (devices.length < 2) return;
    const i = devices.findIndex((d) => d.deviceId === deviceId);
    setDeviceId(devices[(i + 1) % devices.length].deviceId);
  };

  const onPhoto = async (f: File | undefined) => {
    if (!f) return;
    setPhotoBusy(true);
    setError("");
    try {
      const code = await decodeImageFile(f);
      if (code) await accept(code);
      else setError(tl("Aucun code lu sur la photo. Rapprochez-vous, évitez les reflets et gardez le code bien net."));
    } finally {
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const https = secureUrl();

  return (
    <Modal
      title={<><ScanLine size={18} /> {title}</>}
      onClose={onClose}
      width={520}
      footer={
        <>
          {continuous && count > 0 && <span className="muted small" style={{ marginRight: "auto" }}>{count}  {tl("code(s) lu(s)")}</span>}
          <button className="btn btn-primary" onClick={onClose}>{continuous ? tl("Terminer") : tl("Fermer")}</button>
        </>
      }
    >
      {native ? (
        <div className="scanner-photo">
          <ScanLine size={42} strokeWidth={1.4} />
          <p>{tl("Le scanner de l'application est ouvert. Visez le code-barres ou le QR code.")}</p>
          <button className="btn btn-primary" onClick={() => requestNativeScan(title)}><Camera size={16} /> {count ? tl("Scanner un autre article") : tl("Rouvrir le scanner")}</button>
        </div>
      ) : live && !error ? (
        <div className="scanner-view">
          <video ref={videoRef} playsInline muted />
          <div className="scanner-frame"><span /></div>
          <div className="scanner-tools">
            {torch !== null && (
              <button className={`icon-btn round ${torch ? "on" : ""}`} onClick={toggleTorch} title={tl("Lampe")}><Flashlight size={18} /></button>
            )}
            {devices.length > 1 && (
              <button className="icon-btn round" onClick={nextCamera} title={tl("Changer de caméra")}><SwitchCamera size={18} /></button>
            )}
          </div>
        </div>
      ) : (
        <div className="scanner-photo">
          <Camera size={42} strokeWidth={1.4} />
          <p>
            {tl("Prenez le code-barres ou le QR code en photo, bien net et centré : il sera lu automatiquement.")}</p>
          {!live && https && (
            <div className="alert alert-info small">
              <Lock size={14} />  {tl("Pour scanner")} <strong>{tl("en direct")}</strong>  {tl("(vidéo), ouvrez l'adresse sécurisée")}{" "}
              <a href={https}>{https.replace(/\/#.*$/, "")}</a>  {tl("puis acceptez l'avertissement de sécurité la première fois.")}</div>
          )}
        </div>
      )}
      {hint && <p className="muted small center">{hint}</p>}
      {error && <div className="alert alert-danger">{error}</div>}
      {status && (
        <div className={`alert ${status.ok ? "alert-success" : "alert-danger"} scan-status`}>
          {status.ok ? <Check size={16} /> : null} <span className="mono">{status.code}</span>
          {status.ok ? (continuous ? tl(" — ajouté") : "") : tl(" — non reconnu")}
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
      <button className="btn btn-block" style={{ marginTop: 10 }} disabled={photoBusy} onClick={() => fileRef.current?.click()}>
        <ImageUp size={16} /> {photoBusy ? tl("Lecture de la photo…") : live ? tl("Ou prendre / choisir une photo") : tl("Prendre une photo du code")}
      </button>
    </Modal>
  );
}
