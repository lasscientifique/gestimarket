// Alertes de la console (Console 1.1) : la base les calcule chaque minute (gm_alertes_scan) ; la console les lit
// toutes les 30 secondes et sonne :
//   - critique : bip répété toutes les 5 secondes jusqu'à « Vu », bandeau rouge, notification Windows ;
//   - attention : un bip et une notification à l'arrivée ;
//   - info : pastille seulement.
// Le son se règle sur cet appareil (Alertes → Son). Sur le téléphone, les bips ne sonnent que console ouverte.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { rpc } from "./sb";

export type Level = "critique" | "attention" | "info";

export type Alert = {
  id: number;
  at: string;
  level: Level;
  rule: string;
  title: string;
  detail: Record<string, unknown>;
  login: string;
  ip: string | null;
  store_code: string | null;
  store_name?: string | null;
  seen_at?: string | null;
  seen_email?: string;
  seen_note?: string;
  resolved_at?: string | null;
};

/** bips : comme décrit plus haut ; discret : un seul bip court ; nuit : muet de 22 h à 6 h ; muet : aucun son. */
export type SoundMode = "bips" | "discret" | "nuit" | "muet";
const SOUND_KEY = "console-son-alertes";

export function soundMode(): SoundMode {
  try {
    const v = localStorage.getItem(SOUND_KEY);
    return v === "discret" || v === "nuit" || v === "muet" ? v : "bips";
  } catch {
    return "bips";
  }
}

export function setSoundMode(m: SoundMode) {
  try {
    localStorage.setItem(SOUND_KEY, m);
  } catch {
    // stockage indisponible : réglage gardé jusqu'à la fermeture
  }
}

function silentNow(mode: SoundMode): boolean {
  if (mode === "muet") return true;
  const h = new Date().getHours();
  return mode === "nuit" && (h >= 22 || h < 6);
}

// ───────────────────────────── Son ─────────────────────────────

let audio: AudioContext | null = null;

function ctx(): AudioContext | null {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    return audio;
  } catch {
    return null;
  }
}

// Les navigateurs ne laissent sonner qu'après un geste de la personne : le son est préparé au premier clic.
if (typeof window !== "undefined") {
  const unlock = () => {
    ctx();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

/** Bips : critique = 3 bips aigus, attention = 1 bip, test = 1 bip. */
export function beep(level: Level | "test", force = false) {
  const mode = soundMode();
  if (!force && silentNow(mode)) return;
  const a = ctx();
  if (!a) return;
  const n = level === "critique" && mode !== "discret" ? 3 : 1;
  const freq = level === "critique" ? 1046 : 784;
  const dur = mode === "discret" && !force ? 0.08 : 0.16;
  for (let i = 0; i < n; i++) {
    const t = a.currentTime + i * 0.22;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}

// ───────────────────────────── Notification du système ─────────────────────────────

export async function askNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") return true;
  try {
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body });
  } catch {
    // notification impossible : le bandeau et les bips suffisent
  }
}

// ───────────────────────────── Lecture toutes les 30 secondes ─────────────────────────────

type AlertsState = {
  open: Alert[];
  error: string;
  reload: () => void;
  seen: (ids: number[], note?: string) => Promise<void>;
};

const Ctx = createContext<AlertsState>({ open: [], error: "", reload: () => undefined, seen: async () => undefined });

export function AlertsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Alert[]>([]);
  const [error, setError] = useState("");
  const known = useRef<Set<number> | null>(null);

  const reload = useCallback(() => {
    rpc<{ open: Alert[] }>("gm_console_alerts")
      .then((r) => {
        const list = r.open ?? [];
        // Première lecture : rien ne sonne pour les alertes déjà là (sauf le rappel des critiques ci-dessous).
        if (known.current) {
          const fresh = list.filter((a) => !known.current?.has(a.id));
          const crit = fresh.filter((a) => a.level === "critique");
          const warn = fresh.filter((a) => a.level === "attention");
          if (crit.length) {
            beep("critique");
            notify(`Alerte critique (${crit.length}) — Console Eden Dev`, crit[0].title);
          } else if (warn.length) {
            beep("attention");
            notify(`Attention — Console Eden Dev`, warn.length === 1 ? warn[0].title : `${warn.length} nouvelles alertes`);
          }
        }
        known.current = new Set(list.map((a) => a.id));
        setOpen(list);
        setError("");
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  useEffect(() => {
    void askNotifications();
    reload();
    const t = window.setInterval(reload, 30_000);
    return () => window.clearInterval(t);
  }, [reload]);

  // Critique non vue : bip répété toutes les 5 secondes (réglage « bips » ou « nuit » de jour).
  const critical = open.some((a) => a.level === "critique");
  useEffect(() => {
    if (!critical) return;
    const t = window.setInterval(() => {
      if (soundMode() === "bips" || soundMode() === "nuit") beep("critique");
    }, 5_000);
    return () => window.clearInterval(t);
  }, [critical]);

  const seen = useCallback(
    async (ids: number[], note = "") => {
      if (!ids.length) return;
      await rpc("gm_console_alert_seen", { p_ids: ids, p_note: note });
      setOpen((l) => l.filter((a) => !ids.includes(a.id)));
      reload();
    },
    [reload],
  );

  return <Ctx.Provider value={{ open, error, reload, seen }}>{children}</Ctx.Provider>;
}

export const useAlerts = () => useContext(Ctx);

export const LEVEL: Record<Level, [string, "danger" | "warning" | "info"]> = {
  critique: ["Critique", "danger"],
  attention: ["Attention", "warning"],
  info: ["Info", "info"],
};
