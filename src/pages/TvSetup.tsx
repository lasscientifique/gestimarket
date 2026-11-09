import { useEffect, useState } from "react";
import { ArrowLeft, Monitor, Tv } from "lucide-react";
import { ShopFinder, joinShop } from "../components/ShopFinder";
import { useApp } from "../context/AppContext";
import { keepScreenOn } from "../lib/android";
import { tl } from "../lib/i18n";
import type { FoundShop } from "../lib/owner";
import { displayHash, rememberTv } from "../lib/start";

/** Caisses connues du serveur choisi (sans connexion : seulement leurs noms). */
async function postesOf(url: string): Promise<string[]> {
  try {
    const r = await fetch(`${url.replace(/\/+$/, "")}/rpc/display_postes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const d = await r.json();
    return Array.isArray(d?.ok?.postes) ? d.ok.postes : [];
  } catch {
    return [];
  }
}

/**
 * TV Android : l'application s'ouvre en écran client. On choisit la boutique (trouvée toute seule sur le
 * Wi-Fi ou le partage de connexion du téléphone serveur), puis la caisse à afficher. Le choix est gardé :
 * la TV rouvre ensuite directement l'écran client et se reconnecte seule après une coupure.
 */
export default function TvSetupPage() {
  const { toast } = useApp();
  const [shop, setShop] = useState<FoundShop | null>(null);
  const [postes, setPostes] = useState<string[] | null>(null);

  useEffect(() => keepScreenOn(true), []);

  const pickShop = async (s: FoundShop) => {
    setShop(s);
    setPostes(null);
    const list = await postesOf(s.url);
    setPostes(list.length ? list : ["Caisse 1"]);
  };

  const pickPoste = async (poste: string) => {
    if (!shop) return;
    try {
      await joinShop(shop, tl("Écran client — {0}", [poste]));
      rememberTv(poste, shop.shop_name);
      window.location.hash = displayHash(poste);
      window.location.reload();
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="tv-setup">
      <div className="tv-setup-card">
        <div className="tv-title"><Tv size={34} /> <h1>{tl("Écran client")}</h1></div>
        {!shop ? (
          <>
            <p>{tl("Choisissez la boutique. La TV et le serveur de la boutique (téléphone ou PC) doivent être sur le même Wi-Fi ou le même partage de connexion.")}</p>
            <ShopFinder onPick={pickShop} tv autoRetry />
          </>
        ) : (
          <>
            <p>{tl("« {0} » : quelle caisse cette TV affiche-t-elle ?", [shop.shop_name])}</p>
            {postes === null ? (
              <div className="muted">{tl("Chargement…")}</div>
            ) : (
              <div className="tv-postes">
                {postes.map((p, i) => (
                  <button key={p} type="button" className="shop-card" autoFocus={i === 0} onClick={() => pickPoste(p)}>
                    <span className="shop-card-icon"><Monitor size={22} /></span>
                    <span className="shop-card-text"><strong>{p}</strong></span>
                  </button>
                ))}
              </div>
            )}
            <div className="row-start">
              <button type="button" className="btn" onClick={() => setShop(null)}><ArrowLeft size={16} />  {tl("Autre boutique")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
