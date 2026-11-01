import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { api } from "../api";
import { configureCurrency, configurePaymentLabels } from "../lib/format";
import type { Role, SessionUser, Settings } from "../types";
import { PinDialog } from "../components/PinPad";

// ───────────── Notifications (toasts) ─────────────

type ToastKind = "success" | "error" | "info";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

// ───────────── Boîte de confirmation ─────────────

export interface PinOptions {
  title: string;
  message?: ReactNode;
  /** Niveau requis : « cashier » (son propre PIN), « manager » ou « admin ». */
  level?: "cashier" | "manager" | "admin";
  /** Pour une action faite uniquement dans l'interface (ex. suppression d'article) : libellé enregistré
   *  dans le journal. Inutile pour une opération serveur, qui contrôle et trace elle-même le PIN. */
  action?: string;
}

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("gm-theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* stockage indisponible */
  }
  return "light";
}

interface AppContextValue {
  theme: Theme;
  toggleTheme: () => void;
  finderOpen: boolean;
  setFinderOpen: (v: boolean) => void;
  user: SessionUser | null;
  settings: Settings;
  setUser: (u: SessionUser | null) => void;
  refreshSettings: () => Promise<void>;
  setSettings: (s: Settings) => void;
  logout: () => Promise<void>;
  can: (...roles: Role[]) => boolean;
  isManager: boolean;
  toast: { success: (m: string) => void; error: (m: unknown) => void; info: (m: string) => void };
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  /** Demande un code PIN (vérifié). Retourne le code saisi, ou null si annulé. */
  askPin: (o: PinOptions) => Promise<string | null>;
  isAdmin: boolean;
  /** Fonction activée pour ce type de commerce (expiry, brand, sku, packagings, services, decimal). */
  hasFeature: (f: string) => boolean;
}

const Ctx = createContext<AppContextValue | null>(null);

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === "string" ? e : "Une erreur inattendue est survenue.";
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [settings, setSettingsState] = useState<Settings>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const nextId = useRef(1);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [finderOpen, setFinderOpen] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  // Personnalisation du commerce : couleur du thème, style du menu, thème par défaut.
  useEffect(() => {
    const root = document.documentElement;
    const color = (settings.theme_color ?? "").trim();
    if (/^#[0-9a-fA-F]{6}$/.test(color)) root.style.setProperty("--brand", color);
    else root.style.removeProperty("--brand");
    root.dataset.sidebar = settings.sidebar_style || "dark";
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("gm-theme");
    } catch {
      /* stockage indisponible */
    }
    if (!saved && (settings.theme_mode === "dark" || settings.theme_mode === "light")) setTheme(settings.theme_mode);
  }, [settings.theme_color, settings.sidebar_style, settings.theme_mode]);

  // Le choix manuel de l'utilisateur (clair / sombre) est mémorisé sur ce poste.
  const toggleTheme = useCallback(
    () =>
      setTheme((t) => {
        const next = t === "dark" ? "light" : "dark";
        try {
          localStorage.setItem("gm-theme", next);
        } catch {
          /* stockage indisponible */
        }
        return next;
      }),
    [],
  );

  const setSettings = useCallback((s: Settings) => {
    configureCurrency(s.currency_symbol, Number(s.currency_decimals ?? 0));
    configurePaymentLabels(s.om_label);
    setSettingsState(s);
  }, []);

  const refreshSettings = useCallback(async () => {
    setSettings(await api.getSettings());
  }, [setSettings]);

  useEffect(() => {
    refreshSettings().catch(() => undefined);
  }, [refreshSettings]);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  const toast = useMemo(
    () => ({
      success: (m: string) => push("success", m),
      error: (m: unknown) => push("error", errorMessage(m)),
      info: (m: string) => push("info", m),
    }),
    [push],
  );

  const [pinState, setPinState] = useState<(PinOptions & { resolve: (v: string | null) => void }) | null>(null);
  const askPin = useCallback((o: PinOptions) => new Promise<string | null>((resolve) => setPinState({ ...o, resolve })), []);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })),
    [],
  );

  const logout = useCallback(async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const can = useCallback((...roles: Role[]) => !!user && roles.includes(user.role), [user]);

  const value: AppContextValue = {
    theme,
    toggleTheme,
    finderOpen,
    setFinderOpen,
    user,
    settings,
    setUser,
    refreshSettings,
    setSettings,
    logout,
    can,
    isManager: !!user && (user.role === "admin" || user.role === "manager"),
    toast,
    confirm,
    askPin,
    isAdmin: user?.role === "admin",
    hasFeature: (f: string) => (settings.enabled_features ?? "expiry,brand,sku,packagings,decimal").split(",").includes(f),
  };

  const closeConfirm = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirmState(null);
  };

  return (
    <Ctx.Provider value={value}>
      {children}

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === "success" ? <CheckCircle2 size={18} /> : t.kind === "error" ? <AlertTriangle size={18} /> : <Info size={18} />}
            <span>{t.message}</span>
            <button className="icon-btn" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} aria-label="Fermer">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {pinState && (
        <PinDialog
          title={pinState.title}
          message={pinState.message}
          level={pinState.level}
          verify={async (pin) => {
            await api.verifyPin(pin, pinState.level ?? "cashier", pinState.action);
          }}
          onDone={(pin) => {
            pinState.resolve(pin);
            setPinState(null);
          }}
          onCancel={() => {
            pinState.resolve(null);
            setPinState(null);
          }}
        />
      )}

      {confirmState && (
        <div className="modal-backdrop" onMouseDown={() => closeConfirm(false)}>
          <div className="modal" style={{ width: 440 }} onMouseDown={(e) => e.stopPropagation()} role="alertdialog">
            <div className="modal-header">
              <h2>{confirmState.title}</h2>
            </div>
            <div className="modal-body">{confirmState.message}</div>
            <div className="modal-footer">
              <button className="btn" onClick={() => closeConfirm(false)}>
                Annuler
              </button>
              <button
                autoFocus
                className={`btn ${confirmState.danger ? "btn-danger" : "btn-primary"}`}
                onClick={() => closeConfirm(true)}
              >
                {confirmState.confirmLabel ?? "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp doit être utilisé dans <AppProvider>");
  return ctx;
}
