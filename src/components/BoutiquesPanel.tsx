import { useEffect, useState } from "react";
import { ExternalLink, Plus, RefreshCw, Store } from "lucide-react";
import { api } from "../api";
import { errorMessage, useApp } from "../context/AppContext";
import { Badge } from "./ui";
import { isMobileApp, isTauri } from "../lib/transport";
import type { BoutiquesInfo } from "../types";
import { tl } from "../lib/i18n";

/**
 * Plusieurs boutiques sur ce PC (5 au maximum) : chacune s'ouvre dans sa propre fenêtre,
 * avec sa base, ses utilisateurs et sa connexion. Utile à un opérateur qui gère plusieurs commerces.
 */
export function BoutiquesPanel({ compact }: { compact?: boolean }) {
  const { toast, user } = useApp();
  const [info, setInfo] = useState<BoutiquesInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.listBoutiques().then(setInfo).catch(() => undefined);
  useEffect(() => {
    // Téléphone et tablette : une seule boutique par application.
    if (!isTauri || isMobileApp) return;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  if (!isTauri || isMobileApp || !info) return null;

  const open = async (slot: number) => {
    try {
      toast.success(await api.openBoutique(slot));
      setTimeout(load, 2500);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const create = async () => {
    if (!window.confirm(tl("Créer une nouvelle boutique sur ce PC ? Elle s'ouvrira dans une nouvelle fenêtre pour sa première configuration (nom, administrateur…). Maximum {0}.", [info.max]))) return;
    setBusy(true);
    try {
      const slot = await api.createBoutique();
      toast.success(tl("Boutique {0} créée : configurez-la dans la nouvelle fenêtre.", [slot]));
      setTimeout(load, 2500);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const list = (
    <div className="boutique-list">
      {info.boutiques.map((b) => (
        <div key={b.slot} className={`boutique-row ${b.current ? "current" : ""}`}>
          <Store size={18} />
          <div className="boutique-main">
            <strong>{b.name}</strong>
            <span className="small muted">{tl("Boutique")} {b.slot}</span>
          </div>
          {b.current ? (
            <Badge tone="info">{tl("cette fenêtre")}</Badge>
          ) : b.open ? (
            <Badge tone="success">ouverte</Badge>
          ) : (
            <button className="btn btn-sm" onClick={() => open(b.slot)}>
              <ExternalLink size={14} />  {tl("Ouvrir")}</button>
          )}
        </div>
      ))}
    </div>
  );

  if (compact) {
    // Écran de connexion : seulement s'il y a d'autres boutiques à ouvrir.
    if (info.boutiques.length < 2) return null;
    return (
      <div className="boutiques-compact">
        <div className="small muted">{tl("Autres boutiques de ce PC")}</div>
        {list}
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="card-title">
        <Store size={18} />  {tl("Mes boutiques sur ce PC")} <Badge>{info.boutiques.length} / {info.max}</Badge>
        <button className="icon-btn" onClick={load} title={tl("Actualiser")} style={{ marginLeft: "auto" }}><RefreshCw size={14} /></button>
      </h3>
      <p className="muted small">
        {tl("Chaque boutique a sa propre base (produits, stock, ventes, utilisateurs), son propre code PIN et sa fenêtre. Vous pouvez en ouvrir plusieurs en même temps, jusqu'à")} {info.max}{tl(". En mode serveur, chacune utilise son port : 7878, 7888, 7898…")}</p>
      {list}
      {user?.role === "admin" && (
        <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy || !info.can_create} onClick={create}>
          <Plus size={16} /> {info.can_create ? tl("Nouvelle boutique") : tl("Maximum atteint ({0})", [info.max])}
        </button>
      )}
    </div>
  );
}
