// Pont vers Android (application GestiMarket installée) : window.GestiMarketAndroid, ajouté par
// MainActivity (scripts/mobile/android-init.sh). Absent sur PC, iPhone et dans un navigateur.

interface AndroidBridge {
  startServer(): void;
  stopServer(): void;
  isTv(): boolean;
  keepScreenOn(on: boolean): void;
  batteryRestricted(): boolean;
  askBatteryExemption(): void;
  askNotifications(): void;
  openHotspotSettings(): void;
}

function bridge(): AndroidBridge | null {
  const b = (window as unknown as { GestiMarketAndroid?: AndroidBridge }).GestiMarketAndroid;
  return b ?? null;
}

/** Application Android avec son pont (téléphone, tablette, TV). */
export const hasAndroidBridge = () => bridge() !== null;

/** TV Android (ou essai forcé par `localStorage["gm-force-tv"] = "1"`). */
export function isTv(): boolean {
  try {
    if (localStorage.getItem("gm-force-tv") === "1") return true;
  } catch {
    /* stockage indisponible */
  }
  try {
    return bridge()?.isTv() ?? false;
  } catch {
    return false;
  }
}

/** Téléphone serveur : service permanent (notification) pour que le serveur continue écran verrouillé. */
export function serverService(on: boolean) {
  try {
    if (on) bridge()?.startServer();
    else bridge()?.stopServer();
  } catch {
    /* pont indisponible */
  }
}

export function keepScreenOn(on: boolean) {
  try {
    bridge()?.keepScreenOn(on);
  } catch {
    /* pont indisponible */
  }
}

/** L'économie de batterie peut-elle encore arrêter GestiMarket ? */
export function batteryRestricted(): boolean {
  try {
    return bridge()?.batteryRestricted() ?? false;
  } catch {
    return false;
  }
}

export function askBatteryExemption() {
  try {
    bridge()?.askBatteryExemption();
  } catch {
    /* pont indisponible */
  }
}

export function askNotifications() {
  try {
    bridge()?.askNotifications();
  } catch {
    /* pont indisponible */
  }
}

export function openHotspotSettings() {
  try {
    bridge()?.openHotspotSettings();
  } catch {
    /* pont indisponible */
  }
}
