import { useCallback, useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft, AtSign, BadgeCheck, CircleOff, Gift, KeyRound, LogIn, LogOut, Mail, MessageCircle, Pencil, Phone, Power, RefreshCw, Smartphone, Store,
  UserCog, WifiOff,
} from "lucide-react";
import { useApp } from "../context/AppContext";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { ChangePasswordModal, ForgotPasswordModal } from "../components/AccountPassword";
import { ChangeEmailModal, ChangePhoneModal, ConfirmCode, StoreInfoModal } from "../components/AccountProfile";
import { loginId, looksLikePhone, showPhone } from "../lib/phone";
import { BrandLogo } from "../components/Brand";
import { Badge, Field, Modal } from "../components/ui";
import { isConfirm, owner, pingShop, sameVersion, type OwnerPayment, type OwnerStore, type OwnerStores } from "../lib/owner";
import { isTauri, remoteShop, setRemoteShop } from "../lib/transport";
import { dateOnly, dateTime } from "../lib/format";
import { tl, tm } from "../lib/i18n";
import type { AccountOptions } from "../types";

type Tab = "shops" | "subscriptions" | "contact";

/** Forme d'un code de carte de bon (exemple dans le champ). */
const VOUCHER_SAMPLE = ["GM", "XXXX", "XXXX", "XXXX"].join("-");

/** Depuis combien de temps : « 5 min », « 3 h », « 2 j ». */
function ago(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "";
  if (seconds < 3600) return tl("{0} min", [Math.max(1, Math.round(seconds / 60))]);
  if (seconds < 86400) return tl("{0} h", [Math.round(seconds / 3600)]);
  return tl("{0} j", [Math.round(seconds / 86400)]);
}

/**
 * Espace propriétaire de l'application installée (ce que faisait l'application FlutterFlow) :
 * compte Eden Dev, boutiques et état de leur poste serveur, ouverture d'une boutique à distance,
 * abonnements et paiements, contact. La liste des boutiques reste lisible sans Internet.
 */
export default function OwnerHubPage() {
  const { toast } = useApp();
  const [connected, setConnected] = useState<boolean | null>(null);
  const [data, setData] = useState<OwnerStores | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>(() => (window.location.hash.includes("tab=contact") ? "contact" : "shops"));
  const [selected, setSelected] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  // E-mail et numéro WhatsApp du compte (Mon compte), lus à l'ouverture.
  const [ids, setIds] = useState<{ email: string; phone: string } | null>(null);
  // Connexion par WhatsApp ouverte par Eden Dev (gm_config.whatsapp_enabled).
  const [wa, setWa] = useState(false);

  useEffect(() => {
    if (isTauri) owner.options().then((o) => setWa(!!o.whatsapp)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!accountOpen) return;
    setIds(null);
    owner.account().then(setIds).catch(() => setIds({ email: data?.email.includes("@") ? data.email : "", phone: "" }));
  }, [accountOpen, data?.email]);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const d = await owner.stores();
      setData(d);
      setConnected(true);
    } catch (e) {
      const status = await owner.status().catch(() => ({ connected: false }));
      setConnected(status.connected);
      if (status.connected) toast.error(e);
    } finally {
      setBusy(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!isTauri) {
      setConnected(false);
      return;
    }
    owner
      .status()
      .then((s) => {
        setConnected(s.connected);
        if (s.connected) void load();
      })
      .catch(() => setConnected(false));
  }, [load]);

  const back = () => {
    // Retour à la boutique de cet appareil (ou à l'écran de démarrage).
    if (remoteShop()) setRemoteShop(null, "#/");
    else window.location.hash = "#/";
  };

  const logout = async () => {
    await owner.logout().catch(() => undefined);
    setData(null);
    setConnected(false);
  };

  return (
    <div className="owner-page">
      <header className="owner-head">
        <button className="icon-btn light" onClick={back} aria-label={tl("Retour")} title={tl("Ma boutique sur ce téléphone")}><ArrowLeft size={18} /></button>
        <BrandLogo size={30} />
        <div className="owner-title">
          <strong>{tl("Espace propriétaire")}</strong>
          {data?.email && <span>{data.email.includes("@") ? data.email : showPhone(data.email)}</span>}
        </div>
        <LanguageSwitch />
      </header>

      {connected && (
        <nav className="owner-tabs">
          <button className={tab === "shops" ? "active" : ""} onClick={() => setTab("shops")}><Store size={16} />  {tl("Mes boutiques")}</button>
          <button className={tab === "subscriptions" ? "active" : ""} onClick={() => setTab("subscriptions")}><BadgeCheck size={16} />  {tl("Abonnements")}</button>
          <button className={tab === "contact" ? "active" : ""} onClick={() => setTab("contact")}><MessageCircle size={16} />  {tl("Contact")}</button>
          <button onClick={() => setAccountOpen(true)}><UserCog size={16} />  {tl("Mon compte")}</button>
          <button onClick={logout}><LogOut size={16} />  {tl("Se déconnecter")}</button>
        </nav>
      )}
      {accountOpen && (
        <Modal title={<><UserCog size={18} />  {tl("Mon compte")}</>} onClose={() => setAccountOpen(false)} width={440}>
          <div className="stack account-ids">
            <p className="muted">{tl("Compte Eden Dev de vos boutiques :")}</p>
            <div className="row-between">
              <span><AtSign size={15} />  {ids === null ? "…" : ids.email || tl("aucun e-mail")}</span>
              <button className="btn btn-sm" onClick={() => { setAccountOpen(false); setEmailOpen(true); }}>
                {ids?.email ? tl("Changer") : tl("Ajouter")}</button>
            </div>
            {(wa || !!ids?.phone) && (
              <div className="row-between">
                <span><MessageCircle size={15} />  {ids === null ? "…" : ids.phone ? showPhone(ids.phone) : tl("aucun numéro WhatsApp")}</span>
                <button className="btn btn-sm" onClick={() => { setAccountOpen(false); setPhoneOpen(true); }}>
                  {ids?.phone ? tl("Changer") : tl("Ajouter")}</button>
              </div>
            )}
            <button className="btn btn-block" onClick={() => { setAccountOpen(false); setPasswordOpen(true); }}><KeyRound size={16} />  {tl("Changer le mot de passe")}</button>
            <p className="muted small">{tl("Téléphone, ville et adresse d'une boutique : bouton « Informations » dans « Mes boutiques ».")}</p>
          </div>
        </Modal>
      )}
      {passwordOpen && <ChangePasswordModal email={data?.email} onClose={() => setPasswordOpen(false)} />}
      {emailOpen && data && <ChangeEmailModal email={data.email} onClose={() => setEmailOpen(false)} onDone={() => void load()} />}
      {phoneOpen && data && <ChangePhoneModal login={data.email} onClose={() => setPhoneOpen(false)} onDone={() => void load()} />}

      <main className="owner-body">
        {connected === null && <div className="muted owner-loading">{tl("Chargement…")}</div>}
        {connected === false && tab !== "contact" && <OwnerLogin wa={wa} onDone={(d) => { setData(d); setConnected(true); }} onContact={() => setTab("contact")} />}
        {connected && tab === "shops" && (
          <ShopsTab data={data} busy={busy} reload={load} onSubscription={(code) => { setSelected(code); setTab("subscriptions"); }} />
        )}
        {connected && tab === "subscriptions" && data && <SubscriptionsTab data={data} selected={selected} setSelected={setSelected} />}
        {tab === "contact" && <ContactCard />}
        {connected === false && tab === "contact" && (
          <div className="row-start"><button className="btn" onClick={() => setTab("shops")}><LogIn size={16} />  {tl("Se connecter")}</button></div>
        )}
      </main>
    </div>
  );
}

function OwnerLogin({ wa, onDone, onContact }: { wa: boolean; onDone: (d: OwnerStores) => void; onContact: () => void }) {
  const { toast } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  // Code à taper : compte pas encore confirmé, ou connexion par code WhatsApp (`signIn`).
  const [confirming, setConfirming] = useState<{ login: string; signIn: boolean } | null>(null);
  // E-mail, ou numéro WhatsApp tapé avec ou sans indicatif (celui du Mali par défaut).
  const login = loginId(email);
  const attempt = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      const r = await owner.login(login, password);
      if (isConfirm(r)) setConfirming({ login: r.email, signIn: false });
      else onDone(r);
    });
  };
  const byCode = () =>
    attempt(async () => {
      await owner.otpSend(login);
      setConfirming({ login, signIn: true });
    });
  if (confirming) {
    return (
      <div className="card owner-login">
        <h2>{confirming.signIn ? tl("Connexion par WhatsApp") : confirming.login.includes("@") ? tl("Confirmez l'adresse de votre compte") : tl("Confirmez le numéro de votre compte")}</h2>
        <ConfirmCode
          email={confirming.login}
          signIn={confirming.signIn}
          confirm={async (code) => onDone(await owner.confirmSignup(confirming.login, code))}
          resend={() => (confirming.signIn ? owner.otpSend(confirming.login) : owner.resendSignup(confirming.login))}
          onBack={() => setConfirming(null)}
        />
      </div>
    );
  }
  return (
    <form className="card owner-login" onSubmit={submit}>
      <h2>{tl("Connectez-vous avec le compte de votre boutique")}</h2>
      <p className="muted">
        {wa
          ? tl("Le compte Eden Dev créé à l'installation de GestiMarket (e-mail ou numéro WhatsApp, et mot de passe). Internet est nécessaire pour cette étape.")
          : tl("Le compte Eden Dev créé à l'installation de GestiMarket (e-mail et mot de passe). Internet est nécessaire pour cette étape.")}
      </p>
      <Field label={wa ? tl("E-mail ou numéro WhatsApp") : tl("E-mail")}>
        <input type={wa ? "text" : "email"} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label={tl("Mot de passe")}>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      <button className="btn btn-primary btn-block" disabled={busy}><LogIn size={16} />  {busy ? tl("Connexion…") : tl("Se connecter")}</button>
      {wa && looksLikePhone(email) && (
        <button type="button" className="btn btn-block wa-code-btn" disabled={busy} onClick={() => void byCode()}>
          <MessageCircle size={16} />  {tl("Recevoir un code sur WhatsApp")}</button>
      )}
      <button type="button" className="link-btn small" onClick={() => setForgot(true)}>{tl("Mot de passe oublié ?")}</button>
      {forgot && (
        <ForgotPasswordModal
          email={email}
          login
          onClose={() => setForgot(false)}
          onDone={() => void owner.stores().then(onDone).catch((e) => toast.error(e))}
        />
      )}
      <p className="muted small">
        {tl("Pas encore de compte ? Il se crée avec « Ma boutique sur ce téléphone » ou sur le PC de la boutique.")}{" "}
        <button type="button" className="link-btn" onClick={onContact}>{tl("Contacter Eden Dev")}</button>
      </p>
    </form>
  );
}

function ShopsTab({ data, busy, reload, onSubscription }: { data: OwnerStores | null; busy: boolean; reload: () => void; onSubscription: (code: string) => void }) {
  const [off, setOff] = useState<OwnerStore | null>(null);
  const [other, setOther] = useState<{ store: OwnerStore; url: string; version: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [editing, setEditing] = useState<OwnerStore | null>(null);

  const open = async (s: OwnerStore) => {
    const url = s.server.public_url || s.server.url;
    if (!url) return setOff(s);
    setOpening(s.code);
    const v = await pingShop(url);
    setOpening(null);
    if (!v) return setOff(s);
    if (!sameVersion(v.version, __APP_VERSION__)) return setOther({ store: s, url, version: v.version });
    setRemoteShop({ url, code: s.code, name: s.name });
  };

  return (
    <>
      <div className="row-between">
        <h2 className="owner-h2">{tl("Mes boutiques")}</h2>
        <button className="btn btn-sm" onClick={reload} disabled={busy}><RefreshCw size={14} className={busy ? "spin" : ""} />  {tl("Actualiser")}</button>
      </div>
      {data?.offline && (
        <div className="alert alert-warning"><WifiOff size={15} />  {tl("Pas d'Internet : liste du {0}. Une boutique s'ouvre à distance seulement avec Internet ; dans le magasin, reliez-vous par le Wi-Fi.", [dateTime(data.at)])}</div>
      )}
      {data && data.stores.length === 0 && <div className="alert alert-info">{tl("Aucune boutique sur ce compte.")}</div>}
      <div className="owner-shops">
        {(data?.stores ?? []).map((s) => {
          const srv = s.server;
          const expired = !s.ends_at || new Date(s.ends_at).getTime() < Date.now();
          return (
            <div key={s.code} className="card owner-shop">
              <div className="owner-shop-head">
                <Store size={22} />
                <div>
                  <strong>{s.name}</strong>
                  <div className="muted small mono">{s.code}{s.city ? ` · ${s.city}` : ""}</div>
                </div>
              </div>
              <div className="owner-shop-state">
                {srv.active ? (
                  <Badge tone="success"><Power size={12} />  {tl("Serveur allumé")}</Badge>
                ) : srv.found ? (
                  <Badge tone="danger"><CircleOff size={12} />  {srv.seconds_ago ? tl("Serveur éteint depuis {0}", [ago(srv.seconds_ago)]) : tl("Serveur éteint")}</Badge>
                ) : (
                  <Badge tone="warning">{tl("Serveur jamais relié à Internet")}</Badge>
                )}
                <Badge tone={expired ? "danger" : s.trial ? "info" : "default"}>
                  {expired ? tl("Abonnement expiré") : tl("{0} jusqu'au {1}", [s.plan_label ?? "", dateOnly(s.ends_at)])}
                </Badge>
              </div>
              <div className="row-start">
                <button className="btn btn-primary" disabled={data?.offline || opening === s.code} onClick={() => open(s)}>
                  {opening === s.code ? tl("Ouverture…") : tl("Ouvrir")}
                </button>
                <button className="btn" onClick={() => onSubscription(s.code)}><BadgeCheck size={16} />  {tl("Abonnement")}</button>
                <button className="btn" disabled={data?.offline} onClick={() => setEditing(s)}><Pencil size={16} />  {tl("Informations")}</button>
              </div>
            </div>
          );
        })}
      </div>
      {editing && data && (
        <StoreInfoModal code={editing.code} name={editing.name} email={data.email} initial={editing} onClose={() => setEditing(null)} onSaved={reload} />
      )}
      {off && (
        <Modal
          title={<><CircleOff size={18} />  {tl("Serveur éteint")}</>}
          onClose={() => setOff(null)}
          width={460}
          footer={
            <>
              <button className="btn" onClick={() => setOff(null)}>{tl("Changer de boutique")}</button>
              <button className="btn btn-primary" onClick={() => { const s = off; setOff(null); void open(s); }}><RefreshCw size={16} />  {tl("Réessayer")}</button>
            </>
          }
        >
          <p>{tl("Le PC serveur de « {0} » est éteint ou hors ligne. Rallumez-le, ou vérifiez sa connexion à Internet, puis réessayez.", [off.name])}</p>
          {off.server.last_seen && <p className="muted small">{tl("Dernier signal : {0}", [dateTime(off.server.last_seen)])}</p>}
          {off.server.error && <p className="muted small">{tm(off.server.error)}</p>}
        </Modal>
      )}
      {other && (
        <Modal
          title={tl("Versions différentes")}
          onClose={() => setOther(null)}
          width={480}
          footer={
            <>
              <button className="btn" onClick={() => setOther(null)}>{tl("Annuler")}</button>
              <button className="btn btn-primary" onClick={() => { window.location.href = other.url; }}>{tl("Ouvrir la page de la boutique")}</button>
            </>
          }
        >
          <p>{tl("La boutique « {0} » a GestiMarket {1}, cette application la {2}. Mettez à jour le PC de la boutique ou cette application.", [other.store.name, other.version, __APP_VERSION__])}</p>
          <p className="muted small">{tl("En attendant, la page de la boutique peut s'ouvrir directement (plus lente : tout passe par Internet). Revenez avec le bouton retour.")}</p>
        </Modal>
      )}
    </>
  );
}

const METHOD_LABEL = (m: string) =>
  ({ carte_bon: tl("Carte de bon"), orange_money: tl("Orange Money"), moov_money: tl("Moov Money"), carte_visa: tl("Carte Visa") } as Record<string, string>)[m] ?? m;

const STATUS = (p: OwnerPayment): [string, "success" | "warning" | "danger" | "default"] => {
  if (p.status === "validated") return [tl("Validé"), "success"];
  if (p.status === "refused") return [tl("Refusé"), "danger"];
  if (p.abandoned) return [tl("Abandonné"), "default"];
  return [tl("En attente de validation"), "warning"];
};

function SubscriptionsTab({ data, selected, setSelected }: { data: OwnerStores; selected: string | null; setSelected: (c: string) => void }) {
  const { toast } = useApp();
  const code = selected ?? data.stores[0]?.code ?? "";
  const store = data.stores.find((s) => s.code === code) ?? null;
  const [payments, setPayments] = useState<OwnerPayment[] | null>(null);
  const [options, setOptions] = useState<AccountOptions | null>(null);
  const [voucher, setVoucher] = useState("");
  const [om, setOm] = useState({ plan: "pro", months: 1, method: "orange_money", reference: "", phone: "" });
  const [busy, setBusy] = useState(false);

  const loadPayments = useCallback(() => {
    if (!code) return;
    owner.payments(code).then(setPayments).catch((e) => { setPayments([]); toast.error(e); });
  }, [code, toast]);
  useEffect(loadPayments, [loadPayments]);
  useEffect(() => {
    owner.options().then(setOptions).catch(() => undefined);
  }, []);

  const redeem = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await owner.redeem(code, voucher);
      setVoucher("");
      toast.success(tl("Carte de bon acceptée : l'abonnement est activé. Le PC de la boutique reçoit sa licence à sa prochaine connexion."));
      loadPayments();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const declare = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await owner.declare({ store_code: code, ...om });
      setOm({ ...om, reference: "" });
      toast.success(tl("Paiement déclaré ({0}, {1} mois) : Eden Dev le valide, puis l'abonnement est activé.", [r.plan_label, r.months]));
      loadPayments();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const plans = (options?.plans ?? []).filter((p) => p.code !== "free");
  return (
    <>
      <h2 className="owner-h2">{tl("Abonnements")}</h2>
      {data.stores.length > 1 && (
        <div className="segmented owner-store-select">
          {data.stores.map((s) => (
            <button key={s.code} className={s.code === code ? "active" : ""} onClick={() => setSelected(s.code)}>{s.name}</button>
          ))}
        </div>
      )}
      {store && (
        <div className="card">
          <h3 className="card-title"><Store size={18} />  {store.name}</h3>
          <p>
            {store.ends_at && new Date(store.ends_at).getTime() > Date.now()
              ? tl("Formule {0} jusqu'au {1}.", [store.plan_label ?? "", dateOnly(store.ends_at)])
              : tl("Aucun abonnement en cours : la boutique est en lecture seule.")}
          </p>
          <h4 className="section-title">{tl("Derniers paiements")}</h4>
          {payments === null ? (
            <div className="muted">{tl("Chargement…")}</div>
          ) : payments.length === 0 ? (
            <div className="muted">{tl("Aucun paiement.")}</div>
          ) : (
            <div className="owner-payments">
              {payments.map((p) => {
                const [label, tone] = STATUS(p);
                return (
                  <div key={p.id} className="owner-payment">
                    <div>
                      <strong>{p.plan_label}</strong> · {p.months ?? "?"} {tl("mois")} · {p.amount.toLocaleString()} {p.currency}
                      <div className="muted small">{dateTime(p.created_at)} · {METHOD_LABEL(p.method)}{p.ends_at && p.status === "validated" ? ` · ${tl("jusqu'au {0}", [dateOnly(p.ends_at)])}` : ""}</div>
                    </div>
                    <Badge tone={tone}>{label}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {store && (
        <form className="card" onSubmit={redeem}>
          <h3 className="card-title"><Gift size={18} />  {tl("Carte de bon")}</h3>
          <p className="muted small">{tl("Code imprimé sur la carte achetée chez un revendeur Eden Dev : l'abonnement est activé tout de suite.")}</p>
          <div className="input-group">
            <input value={voucher} onChange={(e) => setVoucher(e.target.value.toUpperCase())} placeholder={VOUCHER_SAMPLE} autoCapitalize="characters" />
            <button className="btn btn-primary" disabled={busy || voucher.trim().length < 6}>{tl("Activer")}</button>
          </div>
        </form>
      )}
      {store && (
        <form className="card" onSubmit={declare}>
          <h3 className="card-title"><Smartphone size={18} />  {tl("Orange Money ou Moov Money")}</h3>
          <p className="muted small">
            {options?.payment?.om_merchant_code
              ? tl("Payez au code marchand {0} ({1}), puis saisissez la référence reçue par SMS.", [options.payment.om_merchant_code, options.payment.om_merchant_name])
              : tl("Payez Eden Dev, puis saisissez la référence de la transaction reçue par SMS.")}
          </p>
          <div className="form-grid">
            <Field label={tl("Formule")}>
              <select value={om.plan} onChange={(e) => setOm({ ...om, plan: e.target.value })}>
                {plans.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </Field>
            <Field label={tl("Durée")}>
              <select value={om.months} onChange={(e) => setOm({ ...om, months: Number(e.target.value) })}>
                {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{tl("{0} mois", [m])}</option>)}
              </select>
            </Field>
            <Field label={tl("Moyen de paiement")}>
              <select value={om.method} onChange={(e) => setOm({ ...om, method: e.target.value })}>
                <option value="orange_money">{tl("Orange Money")}</option>
                <option value="moov_money">{tl("Moov Money")}</option>
              </select>
            </Field>
            <Field label={tl("Référence de la transaction (SMS)")}>
              <input value={om.reference} onChange={(e) => setOm({ ...om, reference: e.target.value })} />
            </Field>
            <Field label={tl("Numéro qui a payé")}>
              <input inputMode="tel" value={om.phone} onChange={(e) => setOm({ ...om, phone: e.target.value })} />
            </Field>
          </div>
          <button className="btn btn-primary" disabled={busy || om.reference.trim().length < 4}>{tl("Déclarer le paiement")}</button>
          <p className="muted small">{tl("Carte Visa : depuis le PC de la boutique (Abonnement & licence).")}</p>
        </form>
      )}
    </>
  );
}

const EDEN = {
  email: { href: "mailto:lasscientifique@gmail.com", value: "lasscientifique@gmail.com" },
  whatsapp: { href: "https://wa.me/22376593676", value: "@edendeveloppeur" },
  phone: { href: "tel:+22376593676", value: "+223 76 59 36 76" },
} as const;

/** Contact Eden Dev (même adresses que Paramètres → Développeur Eden Dev). */
export function ContactCard() {
  const { toast } = useApp();
  const open = (kind: keyof typeof EDEN) => async (e: React.MouseEvent) => {
    if (!isTauri) return;
    e.preventDefault();
    try {
      await invoke("open_contact", { kind });
    } catch (err) {
      toast.error(err);
    }
  };
  const rows: { kind: keyof typeof EDEN; icon: React.ReactNode; label: string; action: string }[] = [
    { kind: "whatsapp", icon: <MessageCircle size={20} />, label: tl("WhatsApp"), action: tl("Ouvrir WhatsApp") },
    { kind: "phone", icon: <Phone size={20} />, label: tl("Téléphone"), action: tl("Appeler") },
    { kind: "email", icon: <Mail size={20} />, label: tl("E-mail"), action: tl("Écrire un e-mail") },
  ];
  return (
    <div className="card">
      <h3 className="card-title"><MessageCircle size={18} />  {tl("Contact Eden Dev")}</h3>
      <p className="muted">{tl("Éditeur de GestiMarket : une question, une panne, une formation ou une nouvelle fonction ? Contactez-nous.")}</p>
      <div className="contact-list">
        {rows.map((r) => (
          <div className="contact-row" key={r.kind}>
            <span className="contact-icon">{r.icon}</span>
            <span className="contact-text">
              <span className="muted small">{r.label}</span>
              <strong className="mono">{EDEN[r.kind].value}</strong>
            </span>
            <a className="btn" href={EDEN[r.kind].href} target="_blank" rel="noreferrer" onClick={open(r.kind)}>{r.action}</a>
          </div>
        ))}
      </div>
    </div>
  );
}
