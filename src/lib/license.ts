import { useEffect, useState } from "react";
import { api } from "../api";
import type { LicenseFeature, LicenseStatus } from "../types";

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
  write: "Ventes, achats et modifications",
  server: "Postes clients : autres PC, téléphones, tablettes",
  internet: "Accès par Internet (tunnel)",
  customer_display: "Écran client",
  logo: "Logo personnalisé",
};

/** Date ISO (licence) → « 16/11/2026 08:47 ». */
export function isoDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export function fcfa(n: number): string {
  return `${n.toLocaleString("fr-FR")} FCFA`;
}
