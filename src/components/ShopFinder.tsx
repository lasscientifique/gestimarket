import { useCallback, useEffect, useState } from "react";
import { Laptop, Loader2, RefreshCw, ScanLine, Smartphone, Store, Wifi } from "lucide-react";
import { discoverServers, pingShop, type FoundShop } from "../lib/owner";
import { hasNativeScanner, onNativeCode, requestNativeScan } from "../lib/native";
import { serverFromQr } from "./NetworkForm";
import { useApp } from "../context/AppContext";
import { getNetwork, local } from "../lib/transport";
import { tl } from "../lib/i18n";

/**
 * Relie cet appareil (poste client) au serveur de la boutique choisi. Libre pour un appareil neuf ou déjà
 * poste client ; l'interface se recharge ensuite dans ce mode.
 */
export async function joinShop(shop: FoundShop, posteName: string) {
  const current = getNetwork()?.config;
  await local("save_network_config", {
    config: { mode: "client", server_url: shop.url, poste_name: posteName || current?.poste_name || "Caisse", port: current?.port ?? 7878 },
    pin: null,
  });
}

/**
 * Boutiques GestiMarket du Wi-Fi ou du partage de connexion : trouvées toutes seules (téléphone serveur,
 * PC serveur), ou par le QR code du serveur, ou par son adresse. Utilisé par « Rejoindre une boutique »
 * (téléphone, tablette) et par la TV (écran client).
 */
export function ShopFinder({ onPick, tv, autoRetry }: { onPick: (shop: FoundShop) => void; tv?: boolean; autoRetry?: boolean }) {
  const { toast } = useApp();
  const [list, setList] = useState<FoundShop[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [address, setAddress] = useState("");

  const scan = useCallback(async () => {
    setBusy(true);
    try {
      setList(await discoverServers());
    } catch (e) {
      toast.error(e);
      setList([]);
    } finally {
      setBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    void scan();
  }, [scan]);

  // TV : nouvelle recherche toute seule tant qu'aucune boutique n'est trouvée (serveur allumé après la TV).
  useEffect(() => {
    if (!autoRetry || busy || (list && list.length > 0)) return;
    const t = setTimeout(scan, 15_000);
    return () => clearTimeout(t);
  }, [autoRetry, busy, list, scan]);

  const byAddress = async (raw: string) => {
    const url = serverFromQr(raw) ?? serverFromQr(`http://${raw.trim()}`);
    if (!url) return toast.error(tl("Adresse invalide. Exemple : 192.168.43.1:7878"));
    const v = await pingShop(url, 6000);
    if (!v) return toast.error(tl("Aucune boutique GestiMarket ne répond à cette adresse."));
    onPick({ url, shop_name: v.shop_name, version: v.version });
  };

  // QR code du serveur (téléphone ou PC) lu avec la caméra.
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    if (!scanning) return;
    const off = onNativeCode((code) => {
      setScanning(false);
      void byAddress(code);
    });
    requestNativeScan(tl("QR code du serveur de la boutique"));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  return (
    <div className={`shop-finder ${tv ? "tv" : ""}`}>
      <div className="shop-finder-head">
        <span className="muted">
          {busy ? (
            <><Loader2 size={15} className="spin" />  {tl("Recherche des boutiques sur le Wi-Fi et le partage de connexion…")}</>
          ) : (
            tl("{0} boutique(s) trouvée(s) sur ce réseau.", [list?.length ?? 0])
          )}
        </span>
        <button type="button" className="btn btn-sm" onClick={scan} disabled={busy}><RefreshCw size={14} />  {tl("Rechercher")}</button>
      </div>
      <div className="shop-finder-list">
        {(list ?? []).map((s) => (
          <button key={s.url} type="button" className="shop-card" onClick={() => onPick(s)}>
            <span className="shop-card-icon">{s.device === "phone" ? <Smartphone size={22} /> : s.device === "pc" ? <Laptop size={22} /> : <Store size={22} />}</span>
            <span className="shop-card-text">
              <strong>{s.shop_name || tl("Boutique")}</strong>
              <span className="muted small">{[s.poste, s.url.replace(/^https?:\/\//, ""), s.version && tl("version {0}", [s.version])].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
        ))}
        {list && list.length === 0 && !busy && (
          <div className="alert alert-info">
            {tl("Aucune boutique trouvée. Vérifiez que cet appareil est sur le même Wi-Fi (ou le partage de connexion) que le serveur de la boutique, et que GestiMarket y est ouvert en « Serveur de la boutique ».")}
          </div>
        )}
      </div>
      {!tv && (
        <div className="shop-finder-manual">
          <div className="input-group">
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.43.1:7878" inputMode="url" />
            <button type="button" className="btn" onClick={() => byAddress(address)} disabled={!address.trim()}><Wifi size={16} />  {tl("Relier")}</button>
            {hasNativeScanner() && (
              <button type="button" className="btn" onClick={() => setScanning(true)} title={tl("Scanner le QR code du serveur")}><ScanLine size={16} /></button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
