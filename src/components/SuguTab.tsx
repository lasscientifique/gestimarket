import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, ExternalLink, RefreshCw, ShoppingBag, Store } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { isTauri } from "../lib/transport";
import { tl } from "../lib/i18n";
import { dateTime } from "../lib/format";
import { Badge, Field } from "./ui";
import { PhoneInput } from "./AccountProfile";
import type { SuguStatus } from "../types";

/**
 * Paramètres → Sugu Eden : la place de marché d'Eden Dev. La boutique choisit ses produits (fiche produit, ou
 * sélection dans la liste des produits) ; le PC qui garde la base les publie tout seul. Les acheteurs voient la
 * boutique, sa ville et ses produits, et commandent par WhatsApp ou par téléphone, directement à la boutique.
 */
export function SuguTab() {
  const { toast, confirm, user, settings } = useApp();
  const [s, setS] = useState<SuguStatus | null>(null);
  const [form, setForm] = useState({ whatsapp: "", description: "", stock_mode: "available", stock_margin: 1 });
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const admin = user?.role === "admin";

  const load = useCallback(async () => {
    try {
      const st = await api.suguStatus();
      setS(st);
      setForm({ whatsapp: st.whatsapp, description: st.description, stock_mode: st.stock_mode, stock_margin: st.stock_margin });
    } catch (e) {
      toast.error(e);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  // Publication en cours : l'état se met à jour tout seul.
  useEffect(() => {
    if (!s?.enabled) return;
    const t = setInterval(() => api.suguStatus().then(setS).catch(() => {}), s.busy || s.pending > 0 ? 5000 : 30000);
    return () => clearInterval(t);
  }, [s?.enabled, s?.busy, s?.pending]);

  const save = async (patch: Parameters<typeof api.suguSettings>[0]) => {
    setBusy(true);
    try {
      setS(await api.suguSettings({ ...form, ...patch }));
      toast.success(tl("Réglages Sugu Eden enregistrés."));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    const ok = await confirm({
      title: tl("Retirer la boutique de Sugu Eden"),
      message: tl("La boutique et tous ses produits ne seront plus visibles sur Sugu Eden. Vous pourrez la publier de nouveau plus tard."),
      confirmLabel: tl("Retirer"),
      danger: true,
    });
    if (ok) await save({ enabled: false });
  };

  const openShop = async () => {
    if (!s?.shop_url) return;
    try {
      if (isTauri) await invoke("open_contact", { kind: "sugu", number: s.shop_url });
      else window.open(s.shop_url, "_blank", "noopener");
    } catch (e) {
      toast.error(e);
    }
  };

  if (!s) return <div className="card"><p className="muted">{tl("Chargement…")}</p></div>;

  const blocked = !s.allowed
    ? tl("Sugu Eden est inclus dans les formules PRO et BUSINESS.")
    : !s.linked
      ? tl("Ce PC n'est pas encore relié au compte de la boutique.")
      : null;

  return (
    <>
      <div className="card sugu-card">
        <h3 className="card-title"><ShoppingBag size={18} />  {tl("Sugu Eden, la place de marché d'Eden Dev")}</h3>
        <p className="muted">
          {tl("Montrez vos produits à tous les acheteurs de votre ville et de votre pays. Ils voient la photo, le prix et la disponibilité, puis commandent par WhatsApp ou par téléphone, directement à votre boutique. Vous choisissez les produits publiés ; les prix et le stock se mettent à jour tout seuls.")}
        </p>
        {blocked && (
          <div className="alert alert-warning">
            {blocked}{" "}
            <Link to="/licence">{tl("Abonnement & licence")}</Link>
          </div>
        )}
        {!s.here && (
          <div className="alert alert-info">{tl("La publication se fait depuis le poste serveur de la boutique (le PC qui garde la base).")}</div>
        )}
        {s.enabled ? (
          <div className="sugu-state">
            <Badge tone={s.last_error ? "warning" : "success"}>{s.last_error ? tl("Publication à reprendre") : tl("Boutique publiée")}</Badge>
            <span>{tl("{0} produit(s) choisi(s), {1} en ligne", [s.chosen, s.online])}{s.pending > 0 ? ` · ${tl("{0} à envoyer", [s.pending])}` : ""}</span>
            {s.last_ok_at && <span className="muted small">{tl("Dernier envoi : {0}", [dateTime(s.last_ok_at)])}</span>}
          </div>
        ) : (
          <p><Badge>{tl("Pas encore publiée")}</Badge></p>
        )}
        {s.enabled && s.last_error && <div className="alert alert-warning small">{s.last_error}</div>}
        <div className="row-start">
          {s.shop_url && (
            <button type="button" className="btn" onClick={openShop}><ExternalLink size={16} />  {tl("Voir ma boutique sur Sugu Eden")}</button>
          )}
          <Link to="/products" className="btn"><Store size={16} />  {tl("Choisir les produits")}</Link>
          {s.enabled && admin && (
            <button type="button" className="btn" disabled={s.busy} onClick={() => api.suguSyncNow().then(load).catch(toast.error)}>
              <RefreshCw size={16} className={s.busy ? "spin" : ""} />  {tl("Envoyer maintenant")}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">{tl("Votre boutique sur Sugu Eden")}</h3>
        <p className="muted small">
          {tl("Nom, pays, ville et adresse : ceux du compte de la boutique (Abonnement & licence → Informations de la boutique). Logo : celui de Paramètres → Apparence.")}
        </p>
        <div className="form-grid">
          <Field label={tl("Numéro WhatsApp des commandes *")} hint={tl("Les acheteurs écrivent à ce numéro depuis Sugu Eden.")}>
            {admin ? (
              <PhoneInput key={s.whatsapp} country={settings.country} onChange={(whatsapp) => setForm({ ...form, whatsapp })} />
            ) : (
              <input value={form.whatsapp} disabled />
            )}
            {form.whatsapp && <div className="muted small mono">{form.whatsapp}</div>}
          </Field>
          <Field label={tl("Stock montré aux acheteurs")}>
            <select value={form.stock_mode} onChange={(e) => setForm({ ...form, stock_mode: e.target.value })} disabled={!admin}>
              <option value="available">{tl("« En stock » ou « Épuisé » seulement")}</option>
              <option value="quantity">{tl("La quantité disponible")}</option>
            </select>
          </Field>
          <Field label={tl("Marge de sécurité")} hint={tl("Retirée du stock montré : avec 1, le dernier article reste pour la boutique.")}>
            <input
              type="number"
              min={0}
              value={form.stock_margin}
              onChange={(e) => setForm({ ...form, stock_margin: Math.max(0, Number(e.target.value) || 0) })}
              disabled={!admin}
            />
          </Field>
          <Field label={tl("Présentation de la boutique")} span={2} hint={tl("Ce que vous vendez, vos horaires, la livraison… (600 caractères au plus)")}>
            <textarea rows={3} maxLength={600} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={!admin} />
          </Field>
        </div>
        {admin && !s.enabled && !s.accepted_at && (
          <label className="sugu-accept">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span>
              {tl("J'accepte que le nom de la boutique, sa ville, son adresse, son numéro WhatsApp, sa présentation et les produits choisis (photo, nom, prix, disponibilité) soient publiés sur Sugu Eden et visibles par tous. Je peux tout retirer à tout moment.")}
            </span>
          </label>
        )}
        {admin ? (
          <div className="row-start">
            {s.enabled ? (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save({})}><CheckCircle2 size={16} />  {tl("Enregistrer")}</button>
                <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={turnOff}>{tl("Retirer la boutique de Sugu Eden")}</button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !!blocked || !form.whatsapp || (!s.accepted_at && !accept)}
                onClick={() => save({ enabled: true, accept: accept || undefined })}
              >
                <ShoppingBag size={16} />  {tl("Publier ma boutique sur Sugu Eden")}
              </button>
            )}
          </div>
        ) : (
          <p className="muted small">{tl("Seul l'administrateur règle Sugu Eden.")}</p>
        )}
      </div>
    </>
  );
}
