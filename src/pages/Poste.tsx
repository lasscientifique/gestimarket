import { useEffect, useState } from "react";
import { Globe, Monitor, MonitorSmartphone, Network, Pencil, RefreshCw, Server, Smartphone, Tablet, Laptop, Tv, AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Badge, PageHeader } from "../components/ui";
import { HelpTip } from "../components/Help";
import { NetworkForm } from "../components/NetworkForm";
import { CustomerDisplayPanel } from "../components/CustomerDisplayPanel";
import { getNetwork, isTauri, pingServer, posteName } from "../lib/transport";
import { browserPosteName, deviceLabel, posteId, setBrowserPosteName, usePresence } from "../lib/presence";
import type { CloudStatus, PosteInfo } from "../types";

const MODE_LABELS: Record<string, string> = {
  server: "Poste serveur",
  client: "Poste client",
  local: "Poste unique",
  browser: "Navigateur",
};

export function ConnChip({ compact }: { compact?: boolean }) {
  const p = usePresence();
  const net = getNetwork();
  const isServer = isTauri && net?.config.mode === "server";
  const isLocal = isTauri && net?.config.mode === "local";
  if (p.online === null) return <span className="conn-chip wait"><span className="dot" /><span>Connexion…</span></span>;
  if (!p.online)
    return (
      <span className="conn-chip ko" title={p.error ?? ""}>
        <span className="dot" />
        <span>{compact ? "Hors ligne" : "Serveur injoignable"}</span>
      </span>
    );
  const route = !isServer && !isLocal ? p.route : null;
  const via = route ? (route === "internet" ? " · Internet" : " · Réseau local") : "";
  const label = isServer
    ? `Serveur actif · ${p.postesOnline} poste(s)`
    : isLocal
      ? "Poste unique"
      : `Synchronisé${via}${compact || p.latency == null ? "" : ` · ${p.latency} ms`}`;
  return (
    <span
      className="conn-chip ok"
      data-route={route ?? undefined}
      title={isServer || isLocal ? "" : `Connecté au poste serveur${route === "internet" ? " par Internet" : route ? " sur le réseau local" : ""} : les données sont partagées en temps réel.`}
    >
      <span className="dot" />
      {/* Icône de route : reste visible sur téléphone, où le texte de la pastille est masqué. */}
      {route === "internet" ? <Globe size={13} aria-label="Internet" /> : route ? <Wifi size={13} aria-label="Réseau local" /> : null}
      <span>{label}</span>
    </span>
  );
}

/** Route d'un appareil : même réseau que le serveur, ou Internet (adresse publique). */
export function RouteBadge({ route }: { route: string | null | undefined }) {
  if (!route) return null;
  return route === "internet" ? (
    <Badge tone="info"><Globe size={11} /> Internet</Badge>
  ) : (
    <Badge tone="success"><Wifi size={11} /> Réseau local</Badge>
  );
}

function kindIcon(p: PosteInfo) {
  if (p.kind === "display") return <Tv size={20} />;
  if (p.mode === "server") return <Server size={20} />;
  if (p.kind === "desktop") return <Laptop size={20} />;
  if (/Tablette|iPad/.test(p.device)) return <Tablet size={20} />;
  if (p.kind === "mobile") return <Smartphone size={20} />;
  return <Monitor size={20} />;
}

function ago(s: number) {
  if (s < 15) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  return `il y a ${Math.floor(s / 3600)} h`;
}

/** Ce poste, son mode réseau, l'écran client et la liste des postes connectés au serveur. */
export default function PostePage() {
  const { toast } = useApp();
  const presence = usePresence();
  const net = getNetwork();
  const mode = isTauri ? net?.config.mode ?? "local" : "browser";
  const [postes, setPostes] = useState<PosteInfo[]>([]);
  const [online, setOnline] = useState(0);
  const [name, setName] = useState(browserPosteName());
  const [editName, setEditName] = useState(false);
  // Poste serveur : on vérifie que le service réseau répond vraiment (port ouvert).
  const [serverOk, setServerOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!(isTauri && net?.config.mode === "server")) return;
    const check = () => pingServer(`127.0.0.1:${net.config.port}`).then(() => setServerOk(true)).catch(() => setServerOk(false));
    check();
    const t = setInterval(check, 10_000);
    return () => clearInterval(t);
  }, [net]);

  const load = () =>
    api
      .listPostes()
      .then((r) => {
        setPostes(r.postes);
        setOnline(r.online);
      })
      .catch(() => undefined);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  // Poste serveur : l'adresse publique (tunnel) répond-elle ? Test fait par le serveur toutes les 30 s.
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  useEffect(() => {
    if (mode !== "server") return;
    const l = () => api.cloudStatus().then(setCloud).catch(() => undefined);
    l();
    const t = setInterval(l, 15_000);
    return () => clearInterval(t);
  }, [mode]);

  const me = posteId();
  const serverUrl = mode === "client" ? net?.config.server_url : mode === "browser" ? window.location.origin : null;

  return (
    <div className="page">
      <PageHeader
        help="poste"
        title="Poste & réseau"
        subtitle="Ce poste, sa liaison avec le serveur, l'écran client et tous les appareils connectés."
        actions={<button className="btn" onClick={load}><RefreshCw size={16} /> Actualiser</button>}
      />

      {/* État de la liaison */}
      {mode === "server" ? (
        <div className={`server-banner ${serverOk === false ? "ko" : "ok"}`}>
          <Server size={28} />
          <div style={{ flex: 1 }}>
            <div className="big">
              {serverOk === false ? `Serveur inactif : le port ${net?.config.port} ne répond pas (pare-feu ou port déjà utilisé)` : "Serveur actif"}
            </div>
            <div>
              {online} appareil(s) connecté(s) en ce moment · port {net?.config.port} (http) et {(net?.config.port ?? 7878) + 1} (https, caméra)
            </div>
            <div className="small" style={{ marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Badge tone={serverOk === false ? "danger" : "success"}><Wifi size={11} /> Réseau local {serverOk === false ? "indisponible" : "disponible"}</Badge>
              {cloud?.public_url ? (
                cloud.public_ok ? (
                  <Badge tone="success"><Globe size={11} /> Internet disponible{cloud.public_ms != null ? ` · ${cloud.public_ms} ms` : ""}</Badge>
                ) : (
                  <Badge tone="danger"><Globe size={11} /> Internet indisponible</Badge>
                )
              ) : (
                <Badge><Globe size={11} /> Internet non configuré</Badge>
              )}
              {cloud?.public_url && cloud.public_ok && serverOk !== false && <span className="muted">Les deux routes sont actives.</span>}
              {cloud?.public_url && !cloud.public_ok && cloud.public_error && <span className="muted">{cloud.public_error}</span>}
            </div>
          </div>
        </div>
      ) : mode === "local" ? (
        <div className="server-banner info">
          <Monitor size={28} />
          <div style={{ flex: 1 }}>
            <div className="big">Poste unique</div>
            <div>La base est sur ce PC et n'est pas partagée. Passez en « Poste serveur » pour connecter d'autres caisses, tablettes ou téléphones.</div>
          </div>
        </div>
      ) : (
        <div className={`server-banner ${presence.online ? "ok" : presence.online === false ? "ko" : "info"}`}>
          {presence.online === false ? <WifiOff size={28} /> : <Wifi size={28} />}
          <div style={{ flex: 1 }}>
            <div className="big">
              {presence.online ? "Connecté au serveur — synchronisé en temps réel" : presence.online === false ? "Serveur injoignable — pas de synchronisation" : "Connexion au serveur…"}
            </div>
            <div className="mono small">{serverUrl}</div>
            {presence.online && (
              <div className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <RouteBadge route={presence.route} />
                <span>Latence {presence.latency} ms · {presence.postesOnline} appareil(s) connecté(s)</span>
                {presence.route === "local" && presence.internetOk === true && <span className="muted">Internet aussi disponible (secours automatique)</span>}
                {presence.route === "internet" && <span className="muted">Hors du réseau du magasin</span>}
              </div>
            )}
            {presence.online === false && <div className="small">{presence.error}</div>}
          </div>
        </div>
      )}

      {/* Ce poste */}
      <div className="card">
        <h3 className="card-title"><Monitor size={18} /> Ce poste</h3>
        <div className="kv-grid">
          <div>
            <span>Nom du poste</span>
            {isTauri ? (
              <strong>{posteName()}</strong>
            ) : editName ? (
              <span className="input-group">
                <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    if (!name.trim()) return;
                    setBrowserPosteName(name);
                    setEditName(false);
                    toast.success("Nom du poste enregistré.");
                  }}
                >
                  OK
                </button>
              </span>
            ) : (
              <strong>
                {name}{" "}
                <button className="icon-btn" onClick={() => setEditName(true)} title="Renommer cet appareil"><Pencil size={13} /></button>
              </strong>
            )}
          </div>
          <div><span>Appareil</span><strong>{deviceLabel()}</strong></div>
          <div><span>Mode</span><strong>{MODE_LABELS[mode] ?? mode}</strong></div>
          <div><span>Version</span><strong>{__APP_VERSION__}</strong></div>
        </div>
        {!isTauri && (
          <p className="muted small">Donnez un nom unique à chaque tablette ou téléphone (ex. « Tablette caisse 3 ») : l'écran client et la liste des postes l'utilisent.</p>
        )}
      </div>

      {/* Mode réseau : modifiable depuis chaque poste de bureau */}
      {isTauri && (
        <div className="card">
          <h3 className="card-title"><Network size={18} /> Mode réseau de ce poste <HelpTip k="network" /></h3>
          <p className="muted small">
            Chaque PC choisit son rôle : poste serveur (garde la base), poste client (travaille sur la base du serveur) ou poste unique. Sur le serveur
            ou un poste unique, la modification demande le code PIN d'un gestionnaire ou de l'administrateur.
          </p>
          <NetworkForm />
        </div>
      )}

      <CustomerDisplayPanel />

      {/* Appareils connectés */}
      <div className="card">
        <h3 className="card-title"><MonitorSmartphone size={18} /> Appareils connectés au serveur <Badge tone="success">{online} en ligne</Badge></h3>
        {postes.length === 0 ? (
          <p className="muted">Aucun appareil pour l'instant.</p>
        ) : (
          <div className="poste-grid">
            {postes.map((p) => (
              <div key={p.id} className={`poste-card ${p.online ? "" : "off"} ${p.id === me ? "me" : ""}`}>
                <span className="poste-icon">{kindIcon(p)}</span>
                <div className="poste-main">
                  <strong title={p.name}>
                    {p.name} {p.id === me && <Badge tone="info">ce poste</Badge>} {p.mode === "server" && <Badge>serveur</Badge>}
                    {p.kind === "display" && <Badge>écran client</Badge>}
                  </strong>
                  <span className="muted small">{p.device} · {p.ip}</span>
                  {p.mode !== "server" && <span className="small"><RouteBadge route={p.route} /></span>}
                  {p.user && <span className="small">Connecté : <strong>{p.user}</strong></span>}
                  <span className="small">
                    {p.online ? <Badge tone="success">Synchronisé</Badge> : <Badge tone="danger">Déconnecté</Badge>} <span className="muted">{ago(p.seen_ago)}</span>
                  </span>
                  {p.duplicate_name && (
                    <span className="small text-danger"><AlertTriangle size={12} /> Même nom qu'un autre poste : renommez-le.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 10 }}>
          « Synchronisé » : l'appareil travaille en direct sur la base du poste serveur (ventes et stock partagés instantanément). Un appareil qui ne
          s'est pas signalé depuis 25 secondes est indiqué « Déconnecté ».
        </p>
      </div>
    </div>
  );
}
