import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ExternalLink, MonitorSmartphone } from "lucide-react";
import { useApp } from "../context/AppContext";
import { HelpTip } from "./Help";
import { getNetwork, isTauri, local, posteName } from "../lib/transport";
import { useLicense } from "../lib/license";
import { tl } from "../lib/i18n";

/** Adresse de l'écran client de ce poste (TV, projecteur, autre PC, tablette tournée vers le client). */
export function displayUrl(): string | null {
  const net = getNetwork();
  const base = !isTauri
    ? window.location.origin
    : net?.config.mode === "client"
      ? net.config.server_url
      : net?.config.mode === "server" && net.local_ips[0]
        ? `http://${net.local_ips[0]}:${net.config.port}`
        : null;
  return base ? `${base}/#/display?poste=${encodeURIComponent(posteName())}` : null;
}

/** Ouvre l'écran client de ce poste : 2ᵉ écran (application de bureau) ou nouvelle fenêtre (navigateur). */
export async function openCustomerDisplay(monitor: number | null = null): Promise<boolean> {
  if (isTauri) return local<boolean>("toggle_customer_display", { monitor, poste: posteName() });
  const url = `${window.location.origin}${window.location.pathname}#/display?poste=${encodeURIComponent(posteName())}`;
  window.open(url, `gm-display-${posteName()}`, "popup,width=1024,height=640");
  return true;
}

/** Écran client : disponible sur tous les postes (PC serveur, PC client, poste unique, navigateur). */
export function CustomerDisplayPanel() {
  const { toast } = useApp();
  const [monitors, setMonitors] = useState<{ index: number; name: string; width: number; height: number; primary: boolean }[]>([]);
  const [monitor, setMonitor] = useState<number | null>(null);
  const [qr, setQr] = useState("");
  const lic = useLicense();
  const url = displayUrl();

  useEffect(() => {
    if (isTauri) local<typeof monitors>("list_monitors").then(setMonitors).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (url) QRCode.toDataURL(url, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(""));
  }, [url]);

  const open = async () => {
    try {
      await openCustomerDisplay(monitor);
    } catch (e) {
      toast.error(e);
    }
  };

  if (lic && !lic.features.includes("customer_display")) {
    return (
      <div className="card">
        <h3 className="card-title"><MonitorSmartphone size={18} />  {tl("Écran client")}</h3>
        <p className="muted">
          {tl("L'écran client (articles, total et monnaie affichés au client) est inclus à partir de la formule PRO. Formule actuelle :")} {lic.plan_label}.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="card-title"><MonitorSmartphone size={18} />  {tl("Écran client de «")} {posteName()} » <HelpTip k="customer_display" /></h3>
      <p className="muted">{tl("Montre au client ses articles, les prix, le total, le montant reçu et la monnaie, avant qu'il paie.")}</p>
      <h4 className="section-title">{tl("Sur ce poste")}</h4>
      <div className="input-group" style={{ maxWidth: 620, flexWrap: "wrap" }}>
        {isTauri && (
          <select value={monitor ?? ""} onChange={(e) => setMonitor(e.target.value === "" ? null : Number(e.target.value))}>
            <option value="">{tl("Automatique (2ᵉ écran branché)")}</option>
            {monitors.map((m) => (
              <option key={m.index} value={m.index}>
                {m.name} — {m.width}{tl("×")}{m.height}{m.primary ? tl(" (principal)") : ""}
              </option>
            ))}
          </select>
        )}
        <button className="btn btn-primary" onClick={open}>
          {isTauri ? <MonitorSmartphone size={16} /> : <ExternalLink size={16} />} {isTauri ? tl("Ouvrir / fermer l'écran client") : tl("Ouvrir l'écran client (nouvelle fenêtre)")}
        </button>
      </div>
      <p className="muted small">
        {isTauri
          ? monitors.length < 2
            ? tl("Un seul écran détecté : la fenêtre s'ouvrira en mode fenêtré.")
            : tl("La fenêtre s'ouvre en plein écran sur l'écran secondaire.")
          : tl("Faites glisser la fenêtre sur l'écran tourné vers le client, puis plein écran (F11).")}{" "}
        {tl("Raccourci : bouton « Écran client » dans la caisse.")}</p>
      <h4 className="section-title">{tl("Sur une TV, un projecteur, un autre PC ou une tablette")}</h4>
      {url ? (
        <div className="display-link">
          {qr && <img src={qr} alt={tl("QR code de l'écran client")} width={130} height={130} />}
          <div>
            <p className="muted small" style={{ margin: 0 }}>{tl("Ouvrez cette adresse dans le navigateur de l'appareil (ou scannez le QR code), puis plein écran :")}</p>
            <div className="mono" style={{ marginTop: 6, fontSize: 14, wordBreak: "break-all" }}>{url}</div>
          </div>
        </div>
      ) : (
        <p className="muted">{tl("Disponible quand ce poste est en mode")} <strong>serveur</strong> ou <strong>client</strong>.</p>
      )}
    </div>
  );
}
