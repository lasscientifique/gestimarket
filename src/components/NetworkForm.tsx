import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Monitor, Server, Laptop, Wifi, CheckCircle2, RotateCw, ScanLine, BatteryCharging, Radio } from "lucide-react";
import { useApp } from "../context/AppContext";
import { getNetwork, isMobileApp, local, pingServer, type NetworkConfig } from "../lib/transport";
import { hasNativeScanner, onNativeCode, requestNativeScan } from "../lib/native";
import { askBatteryExemption, askNotifications, batteryRestricted, hasAndroidBridge, openHotspotSettings, serverService } from "../lib/android";
import { Field } from "./ui";
import { HelpTip } from "./Help";
import { tl } from "../lib/i18n";

/** Téléphone ou tablette Android : peut être le serveur de la boutique (service permanent). iPhone : non. */
const androidApp = isMobileApp && typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

const MODES: { id: NetworkConfig["mode"]; title: string; text: string; icon: React.ReactNode }[] = isMobileApp
  ? [
      ...(androidApp
        ? [{ id: "server" as const, title: tl("Serveur de la boutique"), text: tl("Ce téléphone garde la base et la partage à la TV (écran client) et aux autres caisses, par le partage de connexion ou le Wi-Fi, même sans Internet. Gardez-le branché."), icon: <Server size={22} /> }]
        : []),
      { id: "client", title: tl("Poste client"), text: tl("Cet appareil travaille sur la base du poste serveur de la boutique (Wi-Fi ou adresse Internet)."), icon: <Laptop size={22} /> },
      { id: "local", title: tl("Poste unique"), text: tl("Toute la boutique sur cet appareil, même sans Internet. Pensez à enregistrer des sauvegardes ailleurs."), icon: <Monitor size={22} /> },
    ]
  : [
      { id: "local", title: tl("Poste unique"), text: tl("Une seule caisse : la base de données est sur ce PC."), icon: <Monitor size={22} /> },
      { id: "server", title: tl("Poste serveur"), text: tl("Ce PC garde la base et la partage aux autres caisses du réseau (Wi-Fi ou câble)."), icon: <Server size={22} /> },
      { id: "client", title: tl("Poste client"), text: tl("Ce PC travaille sur la base du poste serveur."), icon: <Laptop size={22} /> },
    ];

/**
 * Adresse lue dans le QR code du poste serveur. Le QR donne l'adresse https (port + 1, certificat du PC,
 * refusé par l'application) : on garde l'adresse http du même PC. Une adresse Internet https reste telle quelle.
 */
export function serverFromQr(text: string): string | null {
  const m = text.trim().match(/^(https?):\/\/([^/:#?\s]+)(?::(\d+))?/i);
  if (!m) return null;
  const [, scheme, host, port] = m;
  const privateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  if (scheme.toLowerCase() === "https" && privateIp) return `http://${host}:${port ? Number(port) - 1 : 7878}`;
  return `${scheme.toLowerCase()}://${host}${port ? `:${port}` : ""}`;
}

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

  // Application installée : l'adresse du serveur se lit dans le QR code affiché sur le poste serveur.
  const [scanQr, setScanQr] = useState(false);
  useEffect(() => {
    if (!scanQr) return;
    const off = onNativeCode((code) => {
      setScanQr(false);
      const url = serverFromQr(code);
      if (url) setC((prev) => ({ ...prev, server_url: url }));
      else toast.error(tl("Ce QR code ne contient pas l'adresse d'un poste serveur GestiMarket."));
    });
    requestNativeScan(tl("Adresse du poste serveur"));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanQr]);

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
    if (isMobileApp && !androidApp && c.mode === "server") return toast.error(tl("Un iPhone ou un iPad ne peut pas être poste serveur."));
    // Poste qui détient la base (serveur / poste unique) : code PIN d'un responsable, sauf administrateur connecté.
    let pin: string | null = null;
    if (user && user.role !== "admin" && info?.config.mode !== "client") {
      pin = await askPin({ title: tl("Modifier le réseau de ce poste"), level: "manager" });
      if (!pin) return;
    }
    setBusy(true);
    try {
      await local("save_network_config", { config: c, pin });
      // Téléphone serveur : service permanent (notification), notifications et batterie autorisées.
      if (androidApp && hasAndroidBridge()) {
        serverService(c.mode === "server");
        if (c.mode === "server") {
          askNotifications();
          if (batteryRestricted()) askBatteryExemption();
        }
      }
      onSaved?.();
      // Téléphone et tablette : rien à relancer côté Rust, l'interface se recharge dans le nouveau mode.
      if (isMobileApp) window.location.reload();
      else await local("restart_app");
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  const changed = JSON.stringify(c) !== JSON.stringify(info?.config);
  // La première adresse est celle que les autres appareils joignent (Wi-Fi, câble, point d'accès). Les
  // suivantes (VirtualBox, Hyper-V, VPN, prise débranchée…) sont repliées : avant, elles passaient devant.
  const [mainIp, ...otherIps] = info?.local_ips ?? [];
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
              {isMobileApp && hasNativeScanner() && (
                <button className="btn" type="button" onClick={() => setScanQr(true)} title={tl("Scanner le QR code du poste serveur")}><ScanLine size={16} /></button>
              )}
              <button className="btn" type="button" onClick={testServer}><Wifi size={16} />  {tl("Tester")}</button>
            </div>
          </Field>
        )}
      </div>
      {test && <div className="alert alert-success"><CheckCircle2 size={15} /> {test}</div>}

      {c.mode === "server" && info?.config.mode === "server" && (
        <div className="alert alert-info">
          <strong>{tl("Adresse à saisir sur les postes clients (PC) :")}</strong>
          <ul>{serverUrls.length ? <li className="mono">{serverUrls[0]}</li> : <li>{tl("Adresse IP introuvable : vérifiez la connexion Wi-Fi / câble.")}</li>}</ul>
          {serverUrls.length > 1 && (
            <details className="other-addresses">
              <summary>{tl("Autres adresses de ce PC ({0})", [String(serverUrls.length - 1)])}</summary>
              <p className="muted small">{tl("Cartes réseau virtuelles, VPN ou prise débranchée : à essayer seulement si la première adresse ne marche pas.")}</p>
              <ul>{serverUrls.slice(1).map((u) => <li key={u} className="mono">{u}</li>)}</ul>
            </details>
          )}
          {tl("Fonctionne aussi avec le point d'accès (partage de connexion) d'un téléphone : tous les appareils se connectent à ce point d'accès.")}</div>
      )}
      {androidApp && c.mode === "server" && (
        <div className="card phone-server-guide">
          <h4 className="section-title"><Radio size={16} />  {tl("Boutique sans ordinateur : ce téléphone est le serveur")}</h4>
          <ol>
            <li>{tl("Activez le partage de connexion (point d'accès mobile) de ce téléphone. Il marche même sans forfait Internet : les appareils se parlent entre eux.")}</li>
            <li>{tl("Sur la TV Android et les autres téléphones, connectez le Wi-Fi à ce point d'accès. Si Android dit « Pas d'accès à Internet », choisissez « Rester connecté ».")}</li>
            <li>{tl("Ouvrez GestiMarket sur la TV : elle trouve la boutique toute seule. Sur un autre téléphone : « Rejoindre une boutique ». Sur un iPhone : scannez le QR code ci-dessous avec l'appareil photo.")}</li>
            <li>{tl("Laissez ce téléphone branché au chargeur pendant les heures d'ouverture. Le serveur continue quand l'écran est verrouillé.")}</li>
          </ol>
          <div className="row-start">
            <button type="button" className="btn" onClick={openHotspotSettings}><Wifi size={16} />  {tl("Ouvrir le partage de connexion")}</button>
            {batteryRestricted() && (
              <button type="button" className="btn" onClick={askBatteryExemption}><BatteryCharging size={16} />  {tl("Autoriser en arrière-plan")}</button>
            )}
          </div>
        </div>
      )}
      {c.mode === "server" && info?.config.mode === "server" && mainIp && (
        <div className="phone-access">
          <h4 className="section-title">{tl("Téléphones et tablettes : scannez ce QR code")}</h4>
          <div className="phone-qr-list">
            <AddressQr url={`https://${mainIp}:${c.port + 1}`} plain={`http://${mainIp}:${c.port}`} />
          </div>
          <p className="muted small">{tl("Le téléphone doit être connecté au même Wi-Fi que ce PC (ou au point d'accès qu'il partage), pas aux données mobiles.")}</p>
          {otherIps.length > 0 && (
            <details className="other-addresses">
              <summary>{tl("Autres adresses de ce PC ({0})", [String(otherIps.length)])}</summary>
              <p className="muted small">{tl("Cartes réseau virtuelles, VPN ou prise débranchée : à essayer seulement si la première adresse ne marche pas.")}</p>
              <div className="phone-qr-list">
                {otherIps.map((ip) => (
                  <AddressQr key={ip} url={`https://${ip}:${c.port + 1}`} plain={`http://${ip}:${c.port}`} />
                ))}
              </div>
            </details>
          )}
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
