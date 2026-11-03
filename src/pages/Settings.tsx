import { useEffect, useState } from "react";
import { MobileOperatorsEditor } from "../components/MobileOperators";
import { countryOptions, currencyOptions, currencyPositionOf, currencySymbolOf } from "../lib/countries";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Save, DatabaseBackup, FolderOpen, Smartphone, Store, Receipt, Coins, ShieldCheck, CalendarClock } from "lucide-react";
import { api } from "../api";
import { useApp } from "../context/AppContext";
import { HelpTip } from "../components/Help";
import { Field, ImageField, PageHeader } from "../components/ui";
import { OrangeMoneyQr } from "../components/OrangeMoneyQr";
import { isRemote } from "../lib/transport";
import { Network, Palette, Lock, Check, Sun, Moon, PanelLeft, RotateCw } from "lucide-react";
import { BrandLogo } from "../components/Brand";
import { Link } from "react-router-dom";
import QRCode from "qrcode";
import { Badge } from "../components/ui";
import { activitiesOf, BusinessTypeGrid, featuresOf, FeatureToggles, useBusinessProfiles } from "../components/BusinessType";
import { Building2 } from "lucide-react";
import { currencySymbol, dateTime, isoDate, minorToInput, toMinor } from "../lib/format";
import type { CloudStatus, Settings } from "../types";
import { LANGS, tl, tm } from "../lib/i18n";

const idOrNull = (v: string | undefined) => (v && Number(v) > 0 ? Number(v) : null);

type TabId = "shop" | "business" | "appearance" | "payments" | "sales" | "security" | "network" | "backup";
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "shop", label: tl("Commerce"), icon: <Store size={17} /> },
  { id: "business", label: tl("Type de commerce"), icon: <Building2 size={17} /> },
  { id: "appearance", label: tl("Apparence"), icon: <Palette size={17} /> },
  { id: "payments", label: tl("Orange Money"), icon: <Smartphone size={17} /> },
  { id: "sales", label: tl("Ventes & ticket"), icon: <Receipt size={17} /> },
  { id: "security", label: tl("Sécurité & PIN"), icon: <Lock size={17} /> },
  { id: "network", label: tl("Réseau & mobile"), icon: <Network size={17} /> },
  { id: "backup", label: tl("Sauvegarde"), icon: <ShieldCheck size={17} /> },
];

export default function SettingsPage() {
  const { settings, setSettings, toast, askPin } = useApp();
  const [f, setF] = useState<Settings>(settings);
  const [loyalty, setLoyalty] = useState(minorToInput(Number(settings.loyalty_step || 0)));
  const [info, setInfo] = useState<{ version: string; db_path: string; last_auto_backup: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>(() => {
    try {
      return (sessionStorage.getItem("gm-settings-tab") as TabId) || "shop";
    } catch {
      return "shop";
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem("gm-settings-tab", tab);
    } catch {
      /* stockage indisponible */
    }
  }, [tab]);

  useEffect(() => {
    setF(settings);
    setLoyalty(minorToInput(Number(settings.loyalty_step || 0)));
  }, [settings]);
  const loadInfo = () => api.appInfo().then(setInfo).catch(() => undefined);
  useEffect(() => {
    loadInfo();
  }, []);

  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const toggle = (k: string) => (e: { target: { checked: boolean } }) => setF({ ...f, [k]: e.target.checked ? "1" : "0" });
  const setImage = (k: string) => (id: number | null) => setF({ ...f, [k]: id ? String(id) : "" });

  const submit = async () => {
    setBusy(true);
    try {
      const pin = await askPin({ title: tl("Enregistrer les paramètres"), level: "admin" });
      if (!pin) return;
      setSettings(await api.updateSettings({ ...f, loyalty_step: String(toMinor(loyalty || "0")) }, pin));
      toast.success(tl("Paramètres enregistrés."));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    try {
      const path = await save({
        title: tl("Sauvegarder la base de données"),
        defaultPath: `gestimarket-sauvegarde-${isoDate()}.db`,
        filters: [{ name: "Base SQLite", extensions: ["db"] }],
      });
      if (!path) return;
      await api.backupDatabase(path);
      toast.success(tl("Sauvegarde réalisée avec succès."));
    } catch (e) {
      toast.error(e);
    }
  };

  const chooseBackupDir = async () => {
    const dir = await open({ directory: true, title: tl("Dossier des sauvegardes automatiques") });
    if (dir && !Array.isArray(dir)) setF({ ...f, auto_backup_dir: dir });
  };

  const runAuto = async () => {
    try {
      const p = await api.runAutoBackup();
      toast.success(tl("Sauvegarde créée : {0}", [p]));
      loadInfo();
    } catch (e) {
      toast.error(e);
    }
  };

  const dirty = JSON.stringify(f) !== JSON.stringify(settings) || toMinor(loyalty || "0") !== Number(settings.loyalty_step || 0);

  return (
    <div className="page settings-page">
      <PageHeader
        help="settings"
        title={tl("Paramètres")}
        subtitle={tl("Réservé à l'administrateur. Les modifications sont confirmées par votre code PIN.")}
        actions={<button className="btn btn-primary" disabled={busy || !dirty} onClick={submit}><Save size={16} /> {dirty ? tl("Enregistrer les modifications") : tl("Enregistré")}</button>}
      />

      <div className="tabbar" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className={`tab-item ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {tab === "business" && <BusinessTab />}

      {tab === "shop" && (
        <>
      <div className="card">
        <h3 className="card-title"><Store size={18} />  {tl("Commerce")}</h3>
        <div className="settings-split">
          <ImageField label={tl("Logo (tickets et menu)")} value={idOrNull(f.shop_logo_id)} onChange={setImage("shop_logo_id")} size={110} keepPng maxSize={400} />
          <div className="form-grid">
            <Field label={tl("Nom du commerce *")} span={2}><input value={f.shop_name ?? ""} onChange={set("shop_name")} /></Field>
            <Field label={tl("Adresse")} span={2}><input value={f.shop_address ?? ""} onChange={set("shop_address")} /></Field>
            <Field label={tl("Téléphone")}><input value={f.shop_phone ?? ""} onChange={set("shop_phone")} /></Field>
            <Field label={tl("E-mail")}><input value={f.shop_email ?? ""} onChange={set("shop_email")} /></Field>
            <Field label={tl("Identifiants légaux (NIF, RCCM…)")} span={2} hint={tl("Une ligne par identifiant ; imprimés sur le ticket.")}>
              <textarea rows={2} value={f.shop_tax_id ?? ""} onChange={set("shop_tax_id")} />
            </Field>
            <Field label={tl("Pays")}>
              <select value={f.country ?? "ML"} onChange={set("country")}>
                {countryOptions().map((c) => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
            </Field>
            <Field label={tl("Langue des tickets et de l'écran client")} hint={tl("Chaque utilisateur choisit sa propre langue d'affichage (menu, icône langue).")}>
              <select value={f.shop_lang ?? "fr"} onChange={set("shop_lang")}>
                {LANGS.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>
      </div>

        </>
      )}

      {tab === "appearance" && <AppearanceTab f={f} setF={setF} setImage={setImage} />}

      {tab === "payments" && (
        <>
      <div className="card om-card">
        <h3 className="card-title"><Smartphone size={18} />  {tl("Orange Money / Sarali")}</h3>
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={f.om_enabled !== "0"} onChange={toggle("om_enabled")} />  {tl("Proposer ce moyen de paiement en caisse")}</label>
        <div className="settings-split">
          <div className="om-preview">
            <OrangeMoneyQr size={150} />
          </div>
          <div className="form-grid">
            <Field label={tl("Libellé affiché")}><input value={f.om_label ?? ""} onChange={set("om_label")} /></Field>
            <Field label={tl("Numéro marchand")}><input value={f.om_merchant_number ?? ""} onChange={set("om_merchant_number")} placeholder={tl("Ex. 70 00 00 00")} /></Field>
            <Field label={tl("Nom du compte marchand")} span={2}><input value={f.om_merchant_name ?? ""} onChange={set("om_merchant_name")} /></Field>
            <div className="span-2">
              <ImageField
                label={<>{tl("Photo du QR code marchand (autocollant fourni par l'opérateur)")} <HelpTip k="om_qr" /></>}
                value={idOrNull(f.om_qr_image_id)}
                onChange={setImage("om_qr_image_id")}
                size={90}
                keepPng
                maxSize={800}
              />
            </div>
            <Field label={tl("…ou contenu texte du QR code (si vous le connaissez)")} span={2} hint={tl("Laissez vide si vous avez ajouté la photo du QR code.")}>
              <input className="mono" value={f.om_qr_payload ?? ""} onChange={set("om_qr_payload")} />
            </Field>
            <label className="check span-2">
              <input type="checkbox" checked={f.om_require_reference !== "0"} onChange={toggle("om_require_reference")} />
              {tl("Exiger l'ID de transaction (recommandé : empêche les fraudes et facilite le rapprochement)")}</label>
          </div>
        </div>
        <p className="muted small">
          {tl("En caisse, le client scanne ce QR code (ou paie au numéro marchand), puis le caissier saisit ou scanne l'ID de transaction reçu par SMS. Un même ID ne peut jamais être utilisé deux fois. Le rapprochement se fait dans « Paiements mobiles ».")}</p>
      </div>
      <MobileOperatorsEditor value={f.mobile_operators} onChange={(v) => setF({ ...f, mobile_operators: v })} />

        </>
      )}

      {tab === "sales" && (
        <>
      <div className="card">
        <h3 className="card-title"><Receipt size={18} />  {tl("Ticket de caisse")}</h3>
        <div className="form-grid">
          <Field label={tl("Message en bas du ticket")} span={2}><input value={f.receipt_footer ?? ""} onChange={set("receipt_footer")} /></Field>
          <Field label={tl("Largeur du ticket")}>
            <select value={f.receipt_width ?? "80"} onChange={set("receipt_width")}>
              <option value="80">{tl("Imprimante thermique 80 mm")}</option>
              <option value="58">{tl("Imprimante thermique 58 mm")}</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><Coins size={18} />  {tl("Devise, taxes et ventes")}</h3>
        <div className="form-grid">
          <Field label={tl("Devise")}>
            <select
              value={f.currency_code ?? "XOF"}
              onChange={(e) => {
                const code = e.target.value;
                setF({ ...f, currency_code: code, currency_symbol: currencySymbolOf(code), currency_position: currencyPositionOf(code, f.country ?? "ML") });
              }}
            >
              {currencyOptions().map((c) => (
                <option key={c.code} value={c.code}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label={tl("Symbole de la devise")}><input value={f.currency_symbol ?? ""} onChange={set("currency_symbol")} /></Field>
          <Field label={tl("Place du symbole")}>
            <select value={f.currency_position ?? "after"} onChange={set("currency_position")}>
              <option value="after">{tl("Après le montant (1 500 FCFA)")}</option>
              <option value="before">{tl("Avant le montant ($ 1,500)")}</option>
            </select>
          </Field>
          <Field label={tl("Nombre de décimales")} hint={tl("Non modifiable une fois des produits créés")}>
            <select value={f.currency_decimals ?? "0"} onChange={set("currency_decimals")}>
              <option value="0">{tl("0 (ex. FCFA)")}</option>
              <option value="2">{tl("2 (ex. euro)")}</option>
              <option value="3">3</option>
            </select>
          </Field>
          <Field label={tl("Prix de vente saisis")}>
            <select value={f.prices_include_tax ?? "1"} onChange={set("prices_include_tax")}>
              <option value="1">{tl("TTC : taxe comprise (prix affiché = prix payé)")}</option>
              <option value="0">{tl("HT : la taxe s'ajoute au prix")}</option>
            </select>
          </Field>
          <Field label={tl("TVA par défaut des nouveaux produits (%)")}><input inputMode="decimal" value={f.default_tax_rate ?? "0"} onChange={set("default_tax_rate")} /></Field>
          <Field label={tl("Taux de taxe proposés")} span={2} hint={tl("Une ligne par taux, « Nom=taux ». Ex. TVA 18 %=18, TVA réduite=5, Exonéré=0.")}>
            <textarea rows={3} value={f.tax_rates ?? ""} onChange={set("tax_rates")} placeholder={tl("TVA 18 %=18\nExonéré=0")} />
          </Field>
          <Field label={<>{tl("Fidélité : 1 point par tranche de (")}{currencySymbol()}) <HelpTip k="loyalty" /></>} hint={tl("0 = programme de fidélité désactivé")}>
            <input inputMode="decimal" value={loyalty} onChange={(e) => setLoyalty(e.target.value)} />
          </Field>
          <label className="check span-2"><input type="checkbox" checked={f.require_cash_session !== "0"} onChange={toggle("require_cash_session")} />  {tl("Obliger l'ouverture d'une session de caisse avant de vendre (recommandé)")} <HelpTip k="require_session" /></label>
          <label className="check span-2"><input type="checkbox" checked={f.allow_negative_stock === "1"} onChange={toggle("allow_negative_stock")} />  {tl("Autoriser la vente de produits en rupture (stock négatif)")} <HelpTip k="allow_negative" /></label>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><CalendarClock size={18} />  {tl("Péremption")}</h3>
        <Field label={tl("Alerter les produits qui périment dans les (jours)")}>
          <input inputMode="numeric" value={f.expiry_alert_days ?? "30"} onChange={set("expiry_alert_days")} style={{ maxWidth: 160 }} />
        </Field>
      </div>
        </>
      )}

      {tab === "security" && <SecurityTab f={f} setF={setF} />}

      {tab === "network" && (
        <>
          <div className="card">
            <h3 className="card-title"><Network size={18} />  {tl("Réseau, postes et écran client")}</h3>
            <p className="muted">
              {tl("Le rôle de chaque PC (serveur / client), la liste des appareils connectés et l'écran client se règlent depuis chaque poste, dans")}{" "}
              <Link to="/poste">{tl("Poste & réseau")}</Link>  {tl("(menu de gauche, accessible à tous).")}</p>
          </div>
          <MobileAppSettings f={f} setF={setF} />
        </>
      )}

      {tab === "backup" && (
        <>
      <div className="card">
        <h3 className="card-title"><ShieldCheck size={18} />  {tl("Sauvegarde des données")} <HelpTip k="auto_backup" /></h3>
        {isRemote() && <div className="alert alert-info">{tl("Ce poste est un client : les sauvegardes sont faites sur le poste serveur, dans le dossier ci-dessous (chemin du serveur).")}</div>}
        <p className="muted">
          {tl("Toutes les données (y compris les photos) sont dans une base locale. Choisissez un dossier de sauvegarde automatique, idéalement sur une clé USB, un disque externe ou un dossier synchronisé (Google Drive, OneDrive) : une copie est faite chaque jour.")}</p>
        <div className="form-grid">
          <Field label={tl("Dossier des sauvegardes automatiques")} span={2}>
            <div className="input-group">
              <input value={f.auto_backup_dir ?? ""} onChange={set("auto_backup_dir")} placeholder={tl("Aucun dossier : sauvegarde automatique désactivée")} />
              <button className="btn" type="button" onClick={chooseBackupDir}><FolderOpen size={16} />  {tl("Choisir")}</button>
            </div>
          </Field>
          <Field label={tl("Nombre de sauvegardes conservées")}><input inputMode="numeric" value={f.auto_backup_keep ?? "14"} onChange={set("auto_backup_keep")} /></Field>
        </div>
        <div className="row-start">
          <button className="btn" onClick={runAuto} disabled={!settings.auto_backup_dir}><DatabaseBackup size={16} />  {tl("Sauvegarder maintenant dans ce dossier")}</button>
          {!isRemote() && <button className="btn" onClick={backup}><DatabaseBackup size={16} />  {tl("Sauvegarder vers un fichier…")}</button>}
        </div>
        {info && (
          <p className="muted small" style={{ marginTop: 12 }}>
            {tl("Version")} {info.version}  {tl("· Dernière sauvegarde automatique :")} {info.last_auto_backup ? dateTime(info.last_auto_backup) : tl("jamais")}
            <br />{tl("Base de données :")} <span className="mono">{info.db_path}</span>
          </p>
        )}
      </div>
        </>
      )}
    </div>
  );
}

/** Écran client : 2ᵉ moniteur branché sur la caisse, ou TV / PC du réseau via un navigateur. */

const PRESETS = [
  { name: tl("Émeraude (par défaut)"), color: "" },
  { name: tl("Bleu royal"), color: "#2563eb" },
  { name: tl("Orange"), color: "#ea580c" },
  { name: tl("Rouge"), color: "#dc2626" },
  { name: tl("Bordeaux"), color: "#9f1239" },
  { name: tl("Violet"), color: "#7c3aed" },
  { name: tl("Vert forêt"), color: "#15803d" },
  { name: tl("Or"), color: "#b45309" },
  { name: tl("Ardoise"), color: "#334155" },
];

/** Apparence : logo, nom, couleur du thème, style du menu et thème clair / sombre par défaut. */
function AppearanceTab({ f, setF, setImage }: { f: Settings; setF: (s: Settings) => void; setImage: (k: string) => (id: number | null) => void }) {
  const color = f.theme_color ?? "";
  const valid = /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <>
      <div className="card">
        <h3 className="card-title"><Palette size={18} />  {tl("Identité du magasin")}</h3>
        <div className="settings-split">
          <ImageField label={tl("Logo")} value={idOrNull(f.shop_logo_id)} onChange={setImage("shop_logo_id")} size={120} keepPng maxSize={400} />
          <div className="form-grid one">
            <Field label={tl("Nom affiché en haut du menu, sur les tickets et l'écran client")}>
              <input value={f.shop_name ?? ""} onChange={(e) => setF({ ...f, shop_name: e.target.value })} />
            </Field>
            <div className={`brand-preview sb-${f.sidebar_style || "dark"}`} style={valid ? ({ ["--brand" as string]: color } as React.CSSProperties) : undefined}>
              <BrandLogo size={44} />
              <div>
                <strong>{f.shop_name || tl("Mon magasin")}</strong>
                <span>{tl("Aperçu du haut du menu")}</span>
              </div>
            </div>
            <p className="muted small">{tl("Sans logo ni couleur, GestiMarket garde son thème par défaut. L'aperçu du logo s'applique après enregistrement.")}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><Palette size={18} />  {tl("Couleur du thème")}</h3>
        <div className="swatch-grid">
          {PRESETS.map((p) => {
            const active = (p.color || "") === (color || "");
            return (
              <button key={p.name} type="button" className={`theme-swatch ${active ? "active" : ""}`} onClick={() => setF({ ...f, theme_color: p.color })}>
                <span className="theme-swatch-color" style={{ background: p.color || "#0d9488" }}>{active && <Check size={16} />}</span>
                <span>{p.name}</span>
              </button>
            );
          })}
          <label className={`theme-swatch custom ${valid && !PRESETS.some((p) => p.color === color) ? "active" : ""}`}>
            <input type="color" value={valid ? color : "#0d9488"} onChange={(e) => setF({ ...f, theme_color: e.target.value })} />
            <span>{tl("Couleur personnalisée…")}</span>
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><PanelLeft size={18} />  {tl("Menu et thème")}</h3>
        <div className="form-grid">
          <Field label={tl("Style du menu latéral")}>
            <div className="segmented">
              {[["dark", tl("Sombre")], ["brand", tl("Couleur du thème")], ["light", tl("Clair")]].map(([id, label]) => (
                <button key={id} type="button" className={(f.sidebar_style || "dark") === id ? "active" : ""} onClick={() => setF({ ...f, sidebar_style: id })}>{label}</button>
              ))}
            </div>
          </Field>
          <Field label={tl("Thème par défaut des postes")} hint={tl("Chaque poste peut ensuite basculer avec l'icône soleil / lune du menu.")}>
            <div className="segmented">
              <button type="button" className={(f.theme_mode || "light") === "light" ? "active" : ""} onClick={() => setF({ ...f, theme_mode: "light" })}><Sun size={14} />  {tl("Clair")}</button>
              <button type="button" className={f.theme_mode === "dark" ? "active" : ""} onClick={() => setF({ ...f, theme_mode: "dark" })}><Moon size={14} />  {tl("Sombre")}</button>
            </div>
          </Field>
        </div>
      </div>
    </>
  );
}

const LEVELS = [
  ["cashier", tl("Le caissier lui-même (son propre PIN)")],
  ["manager", tl("Un gestionnaire ou l'administrateur")],
  ["admin", tl("L'administrateur uniquement")],
];

/** Sécurité : qui doit confirmer les actions sensibles de la caisse. */
function SecurityTab({ f, setF }: { f: Settings; setF: (s: Settings) => void }) {
  return (
    <>
      <div className="card">
        <h3 className="card-title"><Lock size={18} />  {tl("Confirmation par code PIN en caisse")}</h3>
        <div className="form-grid">
          <Field label={tl("Retirer un article, diminuer une quantité, vider le ticket")}>
            <select value={f.pin_void_level || "cashier"} onChange={(e) => setF({ ...f, pin_void_level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label={tl("Accorder une remise (article ou ticket)")}>
            <select value={f.pin_discount_level || "cashier"} onChange={(e) => setF({ ...f, pin_discount_level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted small">{tl("Si un responsable doit confirmer, il tape son propre PIN sur la caisse : l'action est tracée à son nom dans le journal d'activité.")}</p>
      </div>
      <div className="card">
        <h3 className="card-title"><ShieldCheck size={18} />  {tl("Actions toujours confirmées par PIN")}</h3>
        <table className="table compact">
          <thead><tr><th>{tl("Action")}</th><th>{tl("Code PIN demandé")}</th></tr></thead>
          <tbody>
            <tr><td>{tl("Annulation d'une vente")}</td><td>{tl("Administrateur")}</td></tr>
            <tr><td>{tl("Modification d'un prix, archivage d'un produit, import, ajustement de stock")}</td><td>{tl("Gestionnaire ou administrateur")}</td></tr>
            <tr><td>{tl("Suppression de catégorie, d'emplacement, archivage de fournisseur")}</td><td>{tl("Gestionnaire ou administrateur")}</td></tr>
            <tr><td>{tl("Clôture de caisse, entrée / sortie d'espèces")}</td><td>{tl("Caissier (son propre PIN)")}</td></tr>
            <tr><td>{tl("Personnel, paramètres, archivage de client")}</td><td>{tl("Administrateur")}</td></tr>
          </tbody>
        </table>
        <p className="muted small">{tl("Si la personne connectée n'a pas le droit, elle touche le nom du responsable, qui tape son propre code PIN. Après 5 codes faux, le compte est bloqué 1 minute (puis 5, puis 30). Les codes sont chiffrés (Argon2) : personne, pas même l'administrateur, ne peut les lire.")}</p>
      </div>
    </>
  );
}

/** Onglet « Type de commerce » : le logiciel s'adapte (catégories proposées, fonctions affichées). */
function BusinessTab() {
  const { settings, setSettings, toast, askPin } = useApp();
  const data = useBusinessProfiles();
  const [types, setTypes] = useState<string[]>(activitiesOf(settings));
  const [features, setFeatures] = useState<string[]>((settings.enabled_features ?? "").split(",").filter(Boolean));
  const [seed, setSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = activitiesOf(settings).map((id) => data?.profiles.find((p) => p.id === id)).filter((p) => !!p);
  const dirty = types.join(",") !== activitiesOf(settings).join(",") || features.slice().sort().join(",") !== (settings.enabled_features ?? "").split(",").filter(Boolean).sort().join(",") || seed;

  const apply = async () => {
    if (types.length === 0) return toast.error(tl("Choisissez un type de commerce."));
    setBusy(true);
    try {
      const pin = await askPin({ title: tl("Changer le type de commerce"), level: "admin" });
      if (!pin) return;
      const r = await api.setBusinessType(types, features, seed, pin);
      setSettings(r.settings);
      setSeed(false);
      toast.success(seed ? tl("Type de commerce enregistré — {0} catégorie(s) ajoutée(s).", [r.created]) : tl("Type de commerce enregistré."));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="card muted">{tl("Chargement…")}</div>;
  return (
    <>
      <div className="card">
        <h3 className="card-title"><Building2 size={18} />  {tl("Votre type de commerce")} <HelpTip k="business_type" /></h3>
        <p className="muted">
          {current.length > 0 ? <>{tl("Actuellement :")} <strong>{current.map((p) => tm(p!.label)).join(" + ")}</strong>. </> : <>{tl("Aucun type choisi : toutes les fonctions sont affichées.")} </>}
          {tl("GestiMarket adapte les catégories proposées, les champs affichés et le plan de départ. Une boutique peut combiner jusqu'à 3 activités : touchez la principale, puis les autres. Les catégories restent libres : vous pouvez en ajouter, masquer ou supprimer à tout moment.")}</p>
        <BusinessTypeGrid
          profiles={data.profiles}
          value={types}
          onChange={(ids) => {
            setTypes(ids);
            setFeatures(featuresOf(data.profiles, ids));
          }}
        />
      </div>
      <div className="card">
        <h3 className="card-title">{tl("Fonctions activées")}</h3>
        <p className="muted small">{tl("Pré-réglées selon le type choisi ; ajustez-les selon vos besoins.")}</p>
        <FeatureToggles value={features} onChange={setFeatures} />
        <label className="check" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
          {tl("Ajouter aussi les catégories recommandées pour ce type (sans doublon)")}</label>
        <div className="row-end" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={apply}><Check size={16} />  {tl("Appliquer")}</button>
        </div>
      </div>
    </>
  );
}

/** Application mobile (FlutterFlow + WebView) : le poste serveur publie son adresse sur Supabase. */
function MobileAppSettings({ f, setF }: { f: Settings; setF: (s: Settings) => void }) {
  const { toast } = useApp();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [qr, setQr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const load = () => api.cloudStatus().then(setStatus).catch(() => undefined);
  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);
  const code = status?.shop_code || f.shop_code || "";
  useEffect(() => {
    if (code) QRCode.toDataURL(`gestimarket:${code}`, { margin: 1, width: 180 }).then(setQr).catch(() => setQr(""));
  }, [code]);

  const publish = async () => {
    setBusy(true);
    try {
      setStatus(await api.cloudPublishNow());
      toast.success(tl("Adresse publiée sur Supabase."));
    } catch (e) {
      toast.error(e);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title"><Smartphone size={18} />  {tl("Application mobile (Supabase)")} <HelpTip k="mobile_app" /></h3>
      <p className="muted">
        {tl("Le poste serveur publie toutes les 30 secondes son état (actif / arrêté) et ses adresses sur votre projet Supabase. L'application mobile (FlutterFlow, widget WebView) lit l'adresse avec le")} <strong>{tl("code du commerce")}</strong>  {tl("et ouvre GestiMarket directement. Exécutez une fois le script")} <span className="mono">{tl("supabase/gestimarket_mobile.sql")}</span>  {tl("dans Supabase (SQL Editor).")}</p>
      <label className="check" style={{ margin: "8px 0 12px" }}>
        <input type="checkbox" checked={f.supabase_enabled === "1"} onChange={(e) => setF({ ...f, supabase_enabled: e.target.checked ? "1" : "0" })} />
        {tl("Publier l'adresse du poste serveur sur Supabase")}</label>
      <div className="form-grid">
        <Field label={tl("URL du projet Supabase")} hint={tl("Supabase → Project Settings → API (ex. https://abcd.supabase.co)")}>
          <input value={f.supabase_url ?? ""} onChange={set("supabase_url")} placeholder="https://xxxxxxxx.supabase.co" />
        </Field>
        <Field label={tl("Clé publique (anon / publishable)")} hint={tl("Jamais la clé « service_role » : elle donnerait tous les droits.")}>
          <input className="mono" value={f.supabase_key ?? ""} onChange={set("supabase_key")} placeholder={tl("eyJhbGciOi… ou sb_publishable_…")} />
        </Field>
        <Field label={tl("Code du commerce")} hint={tl("Créé automatiquement à la première publication. À saisir ou scanner une fois dans l'application.")}>
          <input className="mono" value={f.shop_code ?? ""} onChange={(e) => setF({ ...f, shop_code: e.target.value.toUpperCase() })} placeholder={tl("GM-XXXXXX (automatique)")} />
        </Field>
        <Field label={tl("Adresse publique (facultatif)")} hint={tl("Seulement si le serveur est joignable depuis Internet (redirection de port, tunnel).")}>
          <input value={f.public_url ?? ""} onChange={set("public_url")} placeholder="https://magasin.exemple.com" />
        </Field>
      </div>
      {(f.supabase_key ?? "").includes("service_role") && <div className="alert alert-danger">{tl("Cette clé semble être la clé « service_role » : utilisez la clé publique (anon).")}</div>}

      <h4 className="section-title">{tl("État de la publication")}</h4>
      <div className="display-link">
        {qr && <img src={qr} alt={tl("QR code du code commerce")} width={130} height={130} />}
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="kv"><span>{tl("Code du commerce")}</span><strong className="mono">{code || tl("— (après la 1ʳᵉ publication)")}</strong></div>
          <div className="kv">
            <span>{tl("Poste serveur")}</span>
            <span>{status?.running ? <Badge tone="success">{tl("publie toutes les 30 s")}</Badge> : <Badge>{tl("ce réseau n'a pas de poste serveur actif")}</Badge>}</span>
          </div>
          <div className="kv"><span>{tl("Dernière publication réussie")}</span><span>{status?.last_ok_at ? dateTime(status.last_ok_at) : tl("jamais")}</span></div>
          {status?.last_error && <div className="alert alert-danger small">{status.last_error}</div>}
          <div className="row-end" style={{ marginTop: 8 }}>
            <button className="btn" disabled={busy} onClick={publish}><RotateCw size={15} />  {tl("Publier maintenant")}</button>
          </div>
          <p className="muted small">{tl("Enregistrez d'abord les modifications (bouton en haut), puis « Publier maintenant » pour tester.")}</p>
        </div>
      </div>
    </div>
  );
}
