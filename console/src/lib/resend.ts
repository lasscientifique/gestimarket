// « Renvoyer le code » (Console 1.1, comme GestiMarket 0.34) : 30 secondes entre deux envois, 5 renvois au plus, puis 1 heure d'attente.
// Gardé sur cet appareil, pour chaque adresse ou numéro. Eden Dev limite aussi les codes WhatsApp elle-même
// (6 par heure et par numéro, même depuis un autre appareil) ; Supabase impose son propre délai entre deux e-mails.

const KEY = "console-renvois-codes";
export const RESEND_COOLDOWN_MS = 30_000;
export const RESEND_MAX = 5;
export const RESEND_BLOCK_MS = 60 * 60_000;

/** Identifiant → heures des envois (le premier compris), remis à zéro une heure après le dernier envoi. */
type Sends = Record<string, number[]>;

function load(): Sends {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Sends) : {};
  } catch {
    return {};
  }
}

function save(s: Sends) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // stockage indisponible (navigation privée) : le compte à rebours repart à chaque écran
  }
}

const norm = (login: string) => login.trim().toLowerCase();

function recent(list: number[] | undefined, now: number): number[] {
  if (!list?.length) return [];
  return now - list[list.length - 1] >= RESEND_BLOCK_MS ? [] : list;
}

/** Un code vient de partir vers cet identifiant (premier envoi ou renvoi réussi). */
export function noteSent(login: string, now = Date.now()) {
  if (!login.trim()) return;
  const all = load();
  for (const k of Object.keys(all)) {
    if (!recent(all[k], now).length) delete all[k];
  }
  const list = recent(all[norm(login)], now);
  all[norm(login)] = [...list, now].slice(-(RESEND_MAX + 2));
  save(all);
}

/** Premier code parti juste avant cet écran : noté s'il n'y a pas d'envoi dans la dernière minute. */
export function noteFirstSend(login: string, now = Date.now()) {
  const list = recent(load()[norm(login)], now);
  if (!list.length || now - list[list.length - 1] > 60_000) noteSent(login, now);
}

export interface ResendState {
  /** Millisecondes avant le prochain renvoi permis (0 : tout de suite). */
  wait: number;
  /** 5 renvois faits : attendre 1 heure après le dernier envoi. */
  blocked: boolean;
  /** Renvois encore permis. */
  left: number;
}

export function resendState(login: string, now = Date.now()): ResendState {
  const list = recent(load()[norm(login)], now);
  if (!list.length) return { wait: 0, blocked: false, left: RESEND_MAX };
  const last = list[list.length - 1];
  const resends = list.length - 1;
  if (resends >= RESEND_MAX) return { wait: Math.max(0, last + RESEND_BLOCK_MS - now), blocked: true, left: 0 };
  return { wait: Math.max(0, last + RESEND_COOLDOWN_MS - now), blocked: false, left: RESEND_MAX - resends };
}
