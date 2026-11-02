import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Monitor, Server, Laptop, Wifi, CheckCircle2, RotateCw } from "lucide-react";
import { useApp } from "../context/AppContext";
import { getNetwork, local, pingServer, type NetworkConfig } from "../lib/transport";
import { Field } from "./ui";
import { HelpTip } from "./Help";
import { tl } from "../lib/i18n";

const MODES: { id: NetworkConfig["mode"]; title: string; text: string; icon: React.ReactNode }[] = [
  { id: "local", title: tl("Poste unique"), text: tl("Une seule caisse : la base de données est sur ce PC."), icon: <Monitor size={22} /> },
  { id: "server", title: tl("Poste serveur"), text: tl("Ce PC garde la base et la partage aux autres caisses du réseau (Wi-Fi ou câble)."), icon: <Server size={22} /> },
  { id: "client", title: tl("Poste client"), text: tl("Ce PC travaille sur la base du poste serveur."), icon: <Laptop size={22} /> },
];

/** Choix du mode multi-postes. Enregistrer redémarre l'application. */
export function NetworkForm({ onSaved, compact }: { onSaved?: () => void; compact?: boolean }) {
  const { toast, confirm, user, askPin } = useApp();
  const info = getNetwork();
  const [c, setC] = useState<NetworkConfig>(info?.config ?? { mode: "local", poste_name: "Caisse 1", port: 7878, server_url: "" });
  const [test, setTest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (info) setC(info.config);
  }, [info]);

  const testServer = async () => {
    setTest(null);
    try {
      const r = await pingServer(c.server_url);
      setTest(tl("Connecté à « {0} » (version {1}).", [r.shop_name, r.version]));
    } catch (e) {
      toast.error(e);
    }
  };

  const save = async () => {
    if (c.mode === "client" && !c.server_url.trim()) return toast.error(tl("Indiquez l'adresse du poste serveur."));
    if (!(await confirm({ title: tl("Changer le mode réseau"), message: tl("L'application va redémarrer pour appliquer le nouveau mode."), confirmLabel: tl("Enregistrer et redémarrer") }))) return;
    // Poste qui détient la base (serveur / poste unique) : code PIN d'un responsable, sauf administrateur connecté.
    let pin: string | null = null;
    if (user && user.role !== "admin" && info?.config.mode !== "client") {
      pin = await askPin({ title: tl("Modifier le réseau de ce poste"), level: "manager" });
      if (!pin) return;
    }
    setBusy(true);
    try {
      await local("save_network_config", { config: c, pin });
      onSaved?.();
      await local("restart_app");
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const changed = JSON.stringify(c) !== JSON.stringify(info?.config);
  const serverUrls = (info?.local_ips ?? []).map((ip) => `http://${ip}:${c.port}`);

  return (
    <div className="network-form">
      <div className={`mode-grid ${compact ? "compact" : ""}`}>
        {MODES.map((m) => (
          <button key={m.id} type="button" className={`mode-card ${c.mode === m.id ? "active" : ""}`} onClick={() => setC({ ...c, mode: m.id })}>
            {m.icon}
            <strong>{m.title}</strong>
            {!compact && <span>{m.text}</span>}
          </button>
        ))}
      </div>

      <div className="form-grid">
        <Field label={<>{tl("Nom de ce poste")} <HelpTip text={tl("Ex. « Caisse 1 », « Caisse 2 ». Sert à afficher le bon panier sur l'écran client de chaque caisse.")} /></>}>
          <input value={c.poste_name} onChange={(e) => setC({ ...c, poste_name: e.target.value })} />
        </Field>
        {c.mode === "server" && (
          <Field label={tl("Port réseau")} hint={tl("7878 par défaut. Autorisez-le dans le pare-feu Windows si demandé.")}>
            <input inputMode="numeric" value={c.port} onChange={(e) => setC({ ...c, port: Number(e.target.value) || 7878 })} />
          </Field>
        )}
        {c.mode === "client" && (
          <Field label={tl("Adresse du poste serveur")} hint={tl("Affichée sur le poste serveur (Paramètres → Réseau). Ex. 192.168.1.10:7878")}>
            <div className="input-group">
              <input value={c.server_url} onChange={(e) => setC({ ...c, server_url: e.target.value })} placeholder="192.168.1.10:7878" />
              <button className="btn" type="button" onClick={testServer}><Wifi size={16} />  {tl("Tester")}</button>
            </div>
          </Field>
        )}
      </div>
      {test && <div className="alert alert-success"><CheckCircle2 size={15} /> {test}</div>}

      {c.mode === "server" && info?.config.mode === "server" && (
        <div className="alert alert-info">
          <strong>{tl("Adresse à saisir sur les postes clients (PC) :")}</strong>
          <ul>{serverUrls.length ? serverUrls.map((u) => <li key={u} className="mono">{u}</li>) : <li>{tl("Adresse IP introuvable : vérifiez la connexion Wi-Fi / câble.")}</li>}</ul>
          {tl("Fonctionne aussi avec le point d'accès (partage de connexion) d'un téléphone : tous les appareils se connectent à ce point d'accès.")}</div>
      )}
      {c.mode === "server" && info?.config.mode === "server" && (info?.local_ips ?? []).length > 0 && (
        <div className="phone-access">
          <h4 className="section-title">{tl("Téléphones et tablettes : scannez ce QR code")}</h4>
          <div className="phone-qr-list">
            {info!.local_ips.map((ip) => (
              <AddressQr key={ip} url={`https://${ip}:${c.port + 1}`} plain={`http://${ip}:${c.port}`} />
            ))}
          </div>
          <p className="muted small">
            {tl("L'adresse")} <strong>https</strong>  {tl("(port")} {c.port + 1}{tl(") active la caméra du téléphone pour scanner les codes-barres. À la première ouverture, le navigateur affiche « connexion non privée » : touchez « Paramètres avancés » puis « Continuer » (le certificat est créé par ce PC). L'interface s'adapte automatiquement à l'écran du téléphone ou de la tablette.")}</p>
        </div>
      )}

      <div className="row-start">
        <button className="btn btn-primary" disabled={busy || !changed} onClick={save}>
          <RotateCw size={16} />  {tl("Enregistrer et redémarrer")}</button>
      </div>
    </div>
  );
}

/** QR code d'une adresse du serveur, à scanner avec l'appareil photo du téléphone. */
function AddressQr({ url, plain }: { url: string; plain: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 200 }).then(setSrc).catch(() => setSrc(""));
  }, [url]);
  return (
    <div className="phone-qr">
      {src && <img src={src} alt={url} width={150} height={150} />}
      <div>
        <div className="mono"><strong>{url}</strong></div>
        <div className="muted small">{tl("caméra et scanner")}</div>
        <div className="mono small" style={{ marginTop: 6 }}>{plain}</div>
        <div className="muted small">{tl("sans caméra")}</div>
      </div>
    </div>
  );
}
