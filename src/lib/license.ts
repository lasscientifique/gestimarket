import { useEffect, useState } from "react";
import { api } from "../api";
import type { LicenseFeature, LicenseStatus, PlanInfo } from "../types";
import { locale, tl } from "./i18n";

/**
 * État de la licence du poste serveur (ou de ce PC), partagé par le bandeau et les pages.
 * Rafraîchi toutes les minutes tant qu'un composant l'utilise.
 */
let current: LicenseStatus | null = null;
const listeners = new Set<(s: LicenseStatus | null) => void>();
let timer: number | null = null;

function publish(s: LicenseStatus | null) {
  current = s;
  listeners.forEach((l) => l(s));
}

export async function refreshLicense(): Promise<LicenseStatus | null> {
  try {
    publish(await api.licenseStatus());
  } catch {
    // Serveur injoignable ou pas encore connecté : on garde le dernier état connu.
  }
  return current;
}

/** Après une synchronisation ou un import : met à jour tous les écrans. */
export function setLicense(s: LicenseStatus) {
  publish(s);
}

export function useLicense(): LicenseStatus | null {
  const [s, setS] = useState<LicenseStatus | null>(current);
  useEffect(() => {
    listeners.add(setS);
    if (listeners.size === 1) {
      refreshLicense();
      timer = window.setInterval(refreshLicense, 60_000);
    } else {
      setS(current);
    }
    return () => {
      listeners.delete(setS);
      if (listeners.size === 0 && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return s;
}

export const FEATURE_LABELS: Record<LicenseFeature, string> = {
  write: tl("Ventes, achats et modifications"),
  server: tl("Postes clients : autres PC, téléphones, tablettes"),
  internet: tl("Accès par Internet (tunnel)"),
  customer_display: tl("Écran client"),
  logo: tl("Logo personnalisé"),
};

/** Date ISO (licence) → « 16/11/2026 08:47 ». */
export function isoDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString(locale(), { dateStyle: "short", timeStyle: "short" });
}

export function fcfa(n: number): string {
  return `${n.toLocaleString(locale())} FCFA`;
}

/** Montant d'abonnement : « 5 000 FCFA », « 8 € », « 9 $US ». */
export function price(n: number, currency?: string | null): string {
  if (!currency || currency === "XOF" || currency === "XAF") return fcfa(n);
  try {
    return new Intl.NumberFormat(locale(), { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toLocaleString(locale())} ${currency}`;
  }
}

/** Prix mensuel d'une formule dans la devise demandée si Eden Dev l'a fixé, sinon en FCFA. */
export function planPrice(p: PlanInfo, currency?: string | null): { amount: number; currency: string } {
  const amount = currency ? p.prices?.[currency] : undefined;
  return amount != null ? { amount, currency: currency! } : { amount: p.price_month, currency: "XOF" };
}
