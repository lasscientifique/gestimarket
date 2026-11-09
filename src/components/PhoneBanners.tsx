import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { BatteryCharging, DatabaseBackup, Globe, X } from "lucide-react";
import { useApp } from "../context/AppContext";
import { askBatteryExemption, batteryRestricted, hasAndroidBridge } from "../lib/android";
import { getNetwork, isMobileApp, isRemote, remoteShop, setRemoteShop } from "../lib/transport";
import { tl } from "../lib/i18n";

const SHARED_KEY = "gm-backup-shared";
const WEEK = 7 * 24 * 3600 * 1000;

/** Copie de la sauvegarde envoyée hors du téléphone (Paramètres → Sauvegarde → « Enregistrer une copie… »). */
export function markBackupShared() {
  try {
    localStorage.setItem(SHARED_KEY, String(Date.now()));
  } catch {
    /* stockage indisponible */
  }
}

function lastShared(): number {
  try {
    const v = Number(localStorage.getItem(SHARED_KEY));
    if (v > 0) return v;
    // Première ouverture : premier rappel dans une semaine.
    localStorage.setItem(SHARED_KEY, String(Date.now()));
  } catch {
    /* stockage indisponible */
  }
  return Date.now();
}

/**
 * Bandeaux propres à l'application installée :
 *  - boutique ouverte à distance (Espace propriétaire) : son nom, « Changer de boutique » ;
 *  - téléphone serveur : l'économie de batterie d'Android pourrait arrêter le serveur ;
 *  - boutique sur ce téléphone : rappel chaque semaine d'envoyer une copie de la sauvegarde ailleurs
 *    (un téléphone se perd ou se casse).
 */
export function PhoneBanners() {
  const { user } = useApp();
  const shop = isMobileApp ? remoteShop() : null;
  const server = isMobileApp && getNetwork()?.config.mode === "server";
  const [battery, setBattery] = useState(false);
  const [backupDue, setBackupDue] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!isMobileApp) return;
    if (server && hasAndroidBridge()) setBattery(batteryRestricted());
    if (!isRemote() && user?.role === "admin") setBackupDue(Date.now() - lastShared() > WEEK);
  }, [server, user?.role]);

  if (!isMobileApp) return null;
  return (
    <>
      {shop && (
        <div className="licence-banner info" role="status">
          <Globe size={18} />
          <span className="licence-banner-text">{tl("Boutique ouverte à distance : {0}", [shop.name])}</span>
          <button className="btn btn-sm" onClick={() => setRemoteShop(null, "#/proprietaire")}>{tl("Changer de boutique")}</button>
        </div>
      )}
      {battery && (
        <div className="licence-banner warning" role="status">
          <BatteryCharging size={18} />
          <span className="licence-banner-text">{tl("Ce téléphone est le serveur de la boutique : autorisez GestiMarket à fonctionner en arrière-plan, sinon Android peut l'arrêter et la TV et les caisses perdent la liaison.")}</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              askBatteryExemption();
              setBattery(false);
            }}
          >
            {tl("Autoriser")}
          </button>
        </div>
      )}
      {backupDue && !hidden && (
        <div className="licence-banner warning" role="status">
          <DatabaseBackup size={18} />
          <span className="licence-banner-text">{tl("Les données de la boutique sont sur ce téléphone : envoyez une copie de la sauvegarde ailleurs (WhatsApp, Google Drive, ordinateur), au moins une fois par semaine.")}</span>
          <NavLink to="/settings?tab=backup" className="btn btn-sm">{tl("Sauvegarder")}</NavLink>
          <button className="icon-btn" onClick={() => setHidden(true)} aria-label={tl("Masquer ce rappel")}><X size={16} /></button>
        </div>
      )}
    </>
  );
}
