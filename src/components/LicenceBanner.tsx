import { useState } from "react";
import { NavLink } from "react-router-dom";
import { AlertTriangle, X } from "lucide-react";
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
          {lic.phase === "none" ? tl("Activer") : lic.phase === "expired" || lic.level !== "ok" ? tl("Renouveler") : tl("Abonnement & licence")}
        </NavLink>
      )}
      {!lic.read_only && (
        <button className="icon-btn" onClick={() => setHidden(true)} aria-label={tl("Masquer ce rappel")}><X size={16} /></button>
      )}
    </div>
  );
}
