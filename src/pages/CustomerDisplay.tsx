import { useEffect, useRef, useState } from "react";
import { ShoppingBasket, Store, Heart } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { Thumb } from "../components/ui";
import { OrangeMoneyQr } from "../components/OrangeMoneyQr";
import { mediaUrl } from "../lib/media";
import { money, paymentLabel, qty } from "../lib/format";
import { posteName } from "../lib/transport";
import type { DisplayState } from "../lib/display";

/**
 * Écran client : affiché sur un 2ᵉ écran tourné vers le client, une TV ou un projecteur.
 * Montre les articles scannés, les prix, le total, le montant reçu et la monnaie à rendre.
 * Fonctionne sans connexion utilisateur (lecture seule).
 */
export default function CustomerDisplayPage() {
  const { settings } = useApp();
  const [state, setState] = useState<DisplayState | null>(null);
  const [now, setNow] = useState(new Date());
  const [error, setError] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const poste = posteName();

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.displayState<DisplayState>(poste);
        if (!stop) {
          setState(s);
          setError(false);
        }
      } catch {
        if (!stop) setError(true);
      }
      if (!stop) setTimeout(tick, 400);
    };
    tick();
    const clock = setInterval(() => setNow(new Date()), 1000);
    return () => {
      stop = true;
      clearInterval(clock);
    };
  }, [poste]);

  // Fait défiler jusqu'au dernier article scanné.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [state?.lines.length]);

  // Retour à l'accueil quelques secondes après la fin de la vente.
  const doneExpired = state?.status === "done" && Date.now() - state.at > 12000;
  const status = !state || doneExpired ? "idle" : state.status;
  const logo = mediaUrl(Number(settings.shop_logo_id || 0) || null);

  return (
    <div className="cd">
      <header className="cd-head">
        <div className="cd-brand">
          <div className="cd-logo">{logo ? <img src={logo} alt="" /> : <Store size={30} />}</div>
          <div>
            <div className="cd-shop">{settings.shop_name || "GestiMarket"}</div>
            {settings.shop_phone && <div className="cd-sub">{settings.shop_phone}</div>}
          </div>
        </div>
        <div className="cd-clock">
          <strong>{now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</strong>
          <span>{now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
        </div>
      </header>

      {status === "idle" && (
        <div className="cd-idle">
          <div className="cd-idle-logo">{logo ? <img src={logo} alt="" /> : <ShoppingBasket size={90} strokeWidth={1.3} />}</div>
          <h1>Bienvenue</h1>
          <p>{settings.shop_name}</p>
          {error && <p className="cd-error">Connexion à la caisse « {poste} » en cours…</p>}
        </div>
      )}

      {status === "done" && state && (
        <div className="cd-done">
          <Heart size={70} />
          <h1>Merci pour vos achats !</h1>
          <div className="cd-done-grid">
            <div><span>Total payé</span><strong>{money(state.total)}</strong></div>
            {(state.change ?? 0) > 0 && <div className="cd-change"><span>Votre monnaie</span><strong>{money(state.change ?? 0)}</strong></div>}
          </div>
          <p>{settings.receipt_footer}</p>
        </div>
      )}

      {(status === "cart" || status === "payment") && state && (
        <div className="cd-main">
          <div className="cd-lines" ref={listRef}>
            {state.lines.map((l, i) => (
              <div key={i} className={`cd-line ${i === state.lines.length - 1 ? "last" : ""}`}>
                <Thumb imageId={l.image_id} name={l.name} size={64} rounded={12} />
                <div className="cd-line-main">
                  <strong>{l.name}</strong>
                  <span>
                    {qty(l.quantity)} {l.unit} × {money(l.unit_price)}
                    {l.discount > 0 && <em> · remise {money(l.discount)}</em>}
                  </span>
                </div>
                <div className="cd-line-total">{money(l.total)}</div>
              </div>
            ))}
          </div>
          <aside className="cd-side">
            {state.customer && <div className="cd-customer">Client : <strong>{state.customer}</strong></div>}
            <div className="cd-kv"><span>Articles</span><span>{qty(state.items_count)}</span></div>
            {state.discount > 0 && (
              <>
                <div className="cd-kv"><span>Sous-total</span><span>{money(state.subtotal)}</span></div>
                <div className="cd-kv cd-discount"><span>Remise</span><span>-{money(state.discount)}</span></div>
              </>
            )}
            <div className="cd-total">
              <span>Total à payer</span>
              <strong>{money(state.total)}</strong>
            </div>
            {status === "payment" && (
              <div className="cd-pay">
                {state.method && <div className="cd-kv"><span>Paiement</span><span>{paymentLabel(state.method)}</span></div>}
                {(state.paid ?? 0) > 0 && <div className="cd-kv"><span>Reçu</span><span>{money(state.paid ?? 0)}</span></div>}
                {(state.remaining ?? 0) > 0 && <div className="cd-kv cd-remaining"><span>Reste à payer</span><span>{money(state.remaining ?? 0)}</span></div>}
                {(state.change ?? 0) > 0 && (
                  <div className="cd-change-box"><span>Monnaie à rendre</span><strong>{money(state.change ?? 0)}</strong></div>
                )}
                {state.show_om_qr && (
                  <div className="cd-om">
                    <span>Payez avec {paymentLabel("orange_money")}</span>
                    <OrangeMoneyQr size={210} />
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
