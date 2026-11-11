import { useState } from "react";
import { ArchiveRestore, ArrowLeft, MessageCircle, Smartphone, Store, UserRound, Wifi } from "lucide-react";
import { RestoreBackupModal } from "../components/RestoreBackup";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { ShopFinder, joinShop } from "../components/ShopFinder";
import { useApp } from "../context/AppContext";
import { deviceLabel } from "../lib/device";
import { tl } from "../lib/i18n";
import type { FoundShop } from "../lib/owner";
import { rememberStart as remember } from "../lib/start";

/**
 * Premier démarrage de l'application installée : trois façons de travailler.
 *  1. Ma boutique sur ce téléphone : la base est ici, sans PC et même sans Internet (la TV et d'autres
 *     caisses peuvent s'y relier ensuite, en faisant de ce téléphone le serveur de la boutique).
 *  2. Rejoindre une boutique : relier ce téléphone au serveur de la boutique (téléphone ou PC) par le Wi-Fi
 *     ou le partage de connexion.
 *  3. Espace propriétaire : les boutiques du compte Eden Dev, à distance (Internet nécessaire).
 */
export default function MobileStartPage({ onLocal }: { onLocal: () => void }) {
  const { toast } = useApp();
  const [join, setJoin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const pick = async (shop: FoundShop) => {
    setBusy(true);
    try {
      await joinShop(shop, deviceLabel());
      remember("join");
      window.location.hash = "#/";
      window.location.reload();
    } catch (e) {
      toast.error(e);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-lang"><LanguageSwitch /></div>
      <div className="auth-card wide start-card">
        <div className="auth-logo"><Store size={28} /></div>
        <h1>{tl("Bienvenue dans GestiMarket")}</h1>
        {!join ? (
          <>
            <p className="muted">{tl("Comment ce téléphone va-t-il servir ? Vous pourrez changer plus tard.")}</p>
            <div className="start-choices">
              <button
                type="button"
                className="start-choice"
                onClick={() => {
                  remember("local");
                  onLocal();
                }}
              >
                <Smartphone size={26} />
                <strong>{tl("Ma boutique sur ce téléphone")}</strong>
                <span>{tl("Sans ordinateur, même sans Internet : ventes, stock et clients sont gardés ici. La TV (écran client) et d'autres caisses peuvent s'y relier par le partage de connexion.")}</span>
              </button>
              <button type="button" className="start-choice" onClick={() => setJoin(true)}>
                <Wifi size={26} />
                <strong>{tl("Rejoindre une boutique")}</strong>
                <span>{tl("Une caisse de plus : ce téléphone se relie au serveur de la boutique (téléphone ou PC) par le Wi-Fi ou le partage de connexion.")}</span>
              </button>
              <button
                type="button"
                className="start-choice"
                onClick={() => {
                  remember("owner");
                  window.location.hash = "#/proprietaire";
                }}
              >
                <UserRound size={26} />
                <strong>{tl("Espace propriétaire")}</strong>
                <span>{tl("Vos boutiques à distance : serveur allumé ou éteint, ventes, abonnements. Internet nécessaire.")}</span>
              </button>
              <button type="button" className="start-choice" onClick={() => setRestoreOpen(true)}>
                <ArchiveRestore size={26} />
                <strong>{tl("J'ai une sauvegarde")}</strong>
                <span>{tl("Téléphone changé, cassé ou réinitialisé : retrouvez la boutique (produits, clients, dettes, ventes, codes PIN) à partir de son fichier de sauvegarde.")}</span>
              </button>
            </div>
            <p className="muted small start-contact">
              <button type="button" className="link-btn" onClick={() => (window.location.hash = "#/proprietaire?tab=contact")}>
                <MessageCircle size={14} />  {tl("Contacter Eden Dev")}
              </button>
            </p>
          </>
        ) : (
          <>
            <p className="muted">{tl("Choisissez la boutique. Le serveur de la boutique (téléphone ou PC) doit être allumé, sur le même Wi-Fi ou le même partage de connexion que ce téléphone.")}</p>
            {busy ? <div className="muted">{tl("Connexion…")}</div> : <ShopFinder onPick={pick} />}
            <div className="row-start">
              <button type="button" className="btn" onClick={() => setJoin(false)}><ArrowLeft size={16} />  {tl("Retour")}</button>
            </div>
          </>
        )}
      </div>
      {restoreOpen && <RestoreBackupModal fresh onClose={() => setRestoreOpen(false)} onRestored={() => remember("local")} />}
    </div>
  );
}
