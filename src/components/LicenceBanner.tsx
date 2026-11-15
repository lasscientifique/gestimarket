import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { AlertTriangle, Download, X } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { useLicense } from "../lib/license";
import { tl, tm } from "../lib/i18n";

/** Bandeau d'abonnement : J-7, J-3, J-1, jour J, lecture seule, horloge du PC faussée. */
export function LicenceBanner() {
  const lic = useLicense();
  const { user } = useApp();
  const [hidden, setHidden] = useState(false);
  if (!lic) return null;
  const text = [lic.warning, lic.clock_warning].filter(Boolean).map((m) => tm(m)).join(" ");
  // Lecture seule : toujours visible. Simple rappel : peut être masqué jusqu'au prochain démarrage.
  if (!text || (hidden && !lic.read_only)) return null;
  const tone = lic.read_only || lic.level === "danger" ? "danger" : "warning";
  return (
    <div className={`licence-banner ${tone}`} role="status">
      <AlertTriangle size={18} />
      <span className="licence-banner-text">
        {text}
        {user?.role !== "admin" && tl(" Prévenez l'administrateur.")}
      </span>
      {user?.role === "admin" && (
        <NavLink to="/licence" className="btn btn-sm">
          {lic.phase === "none" || lic.phase === "trial" || lic.phase === "trial_over"
            ? tl("Créer le compte")
            : lic.phase === "expired" || lic.level !== "ok"
              ? tl("Renouveler")
              : tl("Abonnement & licence")}
        </NavLink>
      )}
      {!lic.read_only && (
        <button className="icon-btn" onClick={() => setHidden(true)} aria-label={tl("Masquer ce rappel")}><X size={16} /></button>
      )}
    </div>
  );
}

const DISMISSED = "gm-update-dismissed";
let checked: { latest: string | null; newer: boolean } | null = null;

/**
 * Nouvelle version de GestiMarket publiée : bandeau pour l'administrateur, qui ouvre Paramètres → Mise à jour.
 * Vérifié une fois par session ; « Plus tard » le cache jusqu'à la version suivante.
 */
export function UpdateBanner() {
  const { user } = useApp();
  const [info, setInfo] = useState(checked);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISSED);
    } catch {
      return null;
    }
  });
  const admin = user?.role === "admin";
  useEffect(() => {
    if (!admin || checked) return;
    // Après le démarrage, pour ne pas ralentir l'ouverture.
    const t = setTimeout(() => {
      api
        .updateStatus()
        .then((r) => {
          checked = r;
          setInfo(r);
        })
        .catch(() => undefined);
    }, 4000);
    return () => clearTimeout(t);
  }, [admin]);
  if (!admin || !info?.newer || !info.latest || dismissed === info.latest) return null;
  const latest = info.latest;
  const later = () => {
    try {
      localStorage.setItem(DISMISSED, latest);
    } catch {
      /* stockage indisponible : le bandeau reviendra au prochain démarrage */
    }
    setDismissed(latest);
  };
  return (
    <div className="licence-banner info" role="status">
      <Download size={18} />
      <span className="licence-banner-text">{tl("GestiMarket {0} est disponible (vous avez la {1}).", [latest, __APP_VERSION__])}</span>
      <NavLink to="/settings?tab=update" className="btn btn-sm">{tl("Voir la mise à jour")}</NavLink>
      <button className="icon-btn" onClick={later} aria-label={tl("Plus tard")} title={tl("Plus tard")}><X size={16} /></button>
    </div>
  );
}
