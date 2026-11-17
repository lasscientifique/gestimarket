import { useCallback, useEffect, useRef, useState } from "react";
import {
  BadgeCheck, CreditCard, FileKey2, LayoutDashboard, LogOut, Menu, ScrollText, Settings as SettingsIcon, Store, Ticket, Users, X, Download,
} from "lucide-react";
import { APP_VERSION, deviceLabel, deviceToken, errText, isDesktopApp, platform, rpc, sb } from "./lib/sb";
import { ROLE } from "./lib/fmt";
import { DeviceWait, Login, Mfa, NotAdmin } from "./Auth";
import { ErrorBox, Spinner, useToast } from "./ui";
import { Logo } from "./Logo";
import { Dashboard } from "./pages/Dashboard";
import { Stores } from "./pages/Stores";
import { Payments } from "./pages/Payments";
import { Cards } from "./pages/Cards";
import { Licences } from "./pages/Licences";
import { Team } from "./pages/Team";
import { Settings } from "./pages/Settings";
import { Journal } from "./pages/Journal";

export type Me = {
  admin: boolean;
  aal: string;
  role: "direction" | "paiements" | "assistance";
  role_label?: string;
  name: string;
  email: string;
  device?: { id: string; status: "approved" | "pending" | "revoked"; label: string };
  devices_pending?: number;
  bootstrap?: boolean;
  disabled?: boolean;
};

export type Page = "dashboard" | "stores" | "payments" | "cards" | "licences" | "team" | "settings" | "journal";
export type Nav = (page: Page, arg?: string) => void;

type Stage =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "login" }
  | { kind: "mfa"; enroll: boolean }
  | { kind: "not-admin"; email: string; disabled?: boolean }
  | { kind: "device"; label: string; revoked: boolean }
  | { kind: "ready"; me: Me };

const IDLE_MINUTES = 30;

export default function App() {
  const [stage, setStage] = useState<Stage>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) return setStage({ kind: "login" });
      const { data: aal } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      const label = await deviceLabel();
      const me = await rpc<Me>("gm_console_me", { p_label: label, p_platform: platform(), p_version: APP_VERSION });
      if (!me.admin && !me.bootstrap) return setStage({ kind: "not-admin", email: me.email, disabled: me.disabled });
      if (aal?.currentLevel !== "aal2" || me.aal !== "aal2") return setStage({ kind: "mfa", enroll: aal?.nextLevel !== "aal2" });
      if (me.device?.status !== "approved") return setStage({ kind: "device", label: me.device?.label ?? label, revoked: me.device?.status === "revoked" });
      setStage({ kind: "ready", me });
    } catch (e) {
      setStage({ kind: "error", error: errText(e) });
    }
  }, []);

  useEffect(() => {
    deviceToken();
    refresh();
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setStage({ kind: "login" });
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async () => {
    await sb.auth.signOut().catch(() => undefined);
    setStage({ kind: "login" });
  }, []);

  // Déconnexion après 30 minutes sans activité.
  const last = useRef(Date.now());
  useEffect(() => {
    const touch = () => (last.current = Date.now());
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = window.setInterval(() => {
      if (stage.kind === "ready" && Date.now() - last.current > IDLE_MINUTES * 60_000) signOut();
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      window.clearInterval(timer);
    };
  }, [stage.kind, signOut]);

  switch (stage.kind) {
    case "loading":
      return (
        <div className="auth">
          <Spinner label="Ouverture de la console…" />
        </div>
      );
    case "error":
      return (
        <div className="auth">
          <div className="auth-card stack">
            <ErrorBox error={stage.error} retry={refresh} />
            <button className="link-btn" onClick={signOut}>
              Se déconnecter
            </button>
          </div>
        </div>
      );
    case "login":
      return <Login onDone={refresh} />;
    case "mfa":
      return <Mfa enroll={stage.enroll} onDone={refresh} onSignOut={signOut} />;
    case "not-admin":
      return <NotAdmin email={stage.email} disabled={stage.disabled} onRetry={refresh} onSignOut={signOut} />;
    case "device":
      return <DeviceWait label={stage.label} revoked={stage.revoked} onRetry={refresh} onSignOut={signOut} />;
    case "ready":
      return <Shell me={stage.me} onSignOut={signOut} />;
  }
}

const NAV: { page: Page; label: string; icon: typeof Store; direction?: boolean }[] = [
  { page: "dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { page: "stores", label: "Boutiques", icon: Store },
  { page: "payments", label: "Paiements", icon: CreditCard },
  { page: "cards", label: "Cartes de bon", icon: Ticket },
  { page: "licences", label: "Licences", icon: FileKey2 },
  { page: "team", label: "Équipe et appareils", icon: Users },
  { page: "settings", label: "Réglages", icon: SettingsIcon },
  { page: "journal", label: "Journal", icon: ScrollText },
];

function Shell({ me, onSignOut }: { me: Me; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>("dashboard");
  const [arg, setArg] = useState<string | undefined>();
  const [menu, setMenu] = useState(false);
  const nav: Nav = useCallback((p, a) => {
    setPage(p);
    setArg(a);
    setMenu(false);
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="shell">
      <aside className={`side${menu ? " open" : ""}`}>
        <div className="side-brand">
          <Logo size={34} />
          <div>
            <strong>Console Eden Dev</strong>
            <span>GestiMarket</span>
          </div>
          <button className="icon-btn side-close" aria-label="Fermer le menu" onClick={() => setMenu(false)}>
            <X size={20} />
          </button>
        </div>
        <nav>
          {NAV.map(({ page: p, label, icon: Icon }) => (
            <button key={p} className={page === p ? "active" : ""} onClick={() => nav(p)}>
              <Icon size={18} />
              <span>{label}</span>
              {p === "team" && me.role === "direction" && (me.devices_pending ?? 0) > 0 && <em className="dot">{me.devices_pending}</em>}
            </button>
          ))}
        </nav>
        <div className="side-me">
          <BadgeCheck size={16} />
          <div>
            <strong>{me.email}</strong>
            <span>
              {ROLE[me.role] ?? me.role} · {me.device?.label}
            </span>
          </div>
        </div>
        <button className="side-out" onClick={onSignOut}>
          <LogOut size={16} /> Se déconnecter
        </button>
        <div className="side-version">Version {APP_VERSION}</div>
      </aside>
      {menu && <div className="side-back" onClick={() => setMenu(false)} />}
      <main className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Menu" onClick={() => setMenu(true)}>
            <Menu size={22} />
          </button>
          <strong>{NAV.find((n) => n.page === page)?.label}</strong>
        </header>
        <UpdateBanner />
        <div className="content">
          {page === "dashboard" && <Dashboard me={me} nav={nav} />}
          {page === "stores" && <Stores me={me} nav={nav} storeId={arg} />}
          {page === "payments" && <Payments me={me} nav={nav} />}
          {page === "cards" && <Cards me={me} nav={nav} tab={arg} />}
          {page === "licences" && <Licences me={me} nav={nav} />}
          {page === "team" && <Team me={me} />}
          {page === "settings" && <Settings me={me} />}
          {page === "journal" && <Journal me={me} />}
        </div>
      </main>
    </div>
  );
}

/** PC : nouvelle version de la console (signée par Eden Dev), installée en un clic. */
function UpdateBanner() {
  const toast = useToast();
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isDesktopApp) return;
    import("@tauri-apps/plugin-updater")
      .then(({ check }) => check())
      .then((u) => u && setVersion(u.version))
      .catch(() => undefined);
  }, []);
  if (!version) return null;
  const install = async () => {
    setBusy(true);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const u = await check();
      if (!u) return setVersion("");
      await u.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      toast.fail(e);
      setBusy(false);
    }
  };
  return (
    <div className="update-banner">
      <Download size={18} />
      <span>Nouvelle version de la console : {version}.</span>
      <button className="btn btn-sm btn-primary" onClick={install} disabled={busy}>
        {busy ? "Installation…" : "Installer et redémarrer"}
      </button>
    </div>
  );
}
