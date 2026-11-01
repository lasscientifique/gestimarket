import { useEffect, useState } from "react";
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
import { BusinessTypeGrid, FeatureToggles, useBusinessProfiles } from "../components/BusinessType";
import { Building2 } from "lucide-react";
import { currencySymbol, dateTime, isoDate, minorToInput, toMinor } from "../lib/format";
import type { CloudStatus, Settings } from "../types";

const idOrNull = (v: string | undefined) => (v && Number(v) > 0 ? Number(v) : null);

type TabId = "shop" | "business" | "appearance" | "payments" | "sales" | "security" | "network" | "backup";
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "shop", label: "Commerce", icon: <Store size={17} /> },
  { id: "business", label: "Type de commerce", icon: <Building2 size={17} /> },
  { id: "appearance", label: "Apparence", icon: <Palette size={17} /> },
  { id: "payments", label: "Orange Money", icon: <Smartphone size={17} /> },
  { id: "sales", label: "Ventes & ticket", icon: <Receipt size={17} /> },
  { id: "security", label: "Sécurité & PIN", icon: <Lock size={17} /> },
  { id: "network", label: "Réseau & mobile", icon: <Network size={17} /> },
  { id: "backup", label: "Sauvegarde", icon: <ShieldCheck size={17} /> },
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
      const pin = await askPin({ title: "Enregistrer les paramètres", level: "admin" });
      if (!pin) return;
      setSettings(await api.updateSettings({ ...f, loyalty_step: String(toMinor(loyalty || "0")) }, pin));
      toast.success("Paramètres enregistrés.");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    try {
      const path = await save({
        title: "Sauvegarder la base de données",
        defaultPath: `gestimarket-sauvegarde-${isoDate()}.db`,
        filters: [{ name: "Base SQLite", extensions: ["db"] }],
      });
      if (!path) return;
      await api.backupDatabase(path);
      toast.success("Sauvegarde réalisée avec succès.");
    } catch (e) {
      toast.error(e);
    }
  };

  const chooseBackupDir = async () => {
    const dir = await open({ directory: true, title: "Dossier des sauvegardes automatiques" });
    if (dir && !Array.isArray(dir)) setF({ ...f, auto_backup_dir: dir });
  };

  const runAuto = async () => {
    try {
      const p = await api.runAutoBackup();
      toast.success(`Sauvegarde créée : ${p}`);
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
        title="Paramètres"
        subtitle="Réservé à l'administrateur. Les modifications sont confirmées par votre code PIN."
        actions={<button className="btn btn-primary" disabled={busy || !dirty} onClick={submit}><Save size={16} /> {dirty ? "Enregistrer les modifications" : "Enregistré"}</button>}
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
        <h3 className="card-title"><Store size={18} /> Commerce</h3>
        <div className="settings-split">
          <ImageField label="Logo (tickets et menu)" value={idOrNull(f.shop_logo_id)} onChange={setImage("shop_logo_id")} size={110} keepPng maxSize={400} />
          <div className="form-grid">
            <Field label="Nom du commerce *" span={2}><input value={f.shop_name ?? ""} onChange={set("shop_name")} /></Field>
            <Field label="Adresse" span={2}><input value={f.shop_address ?? ""} onChange={set("shop_address")} /></Field>
            <Field label="Téléphone"><input value={f.shop_phone ?? ""} onChange={set("shop_phone")} /></Field>
            <Field label="E-mail"><input value={f.shop_email ?? ""} onChange={set("shop_email")} /></Field>
            <Field label="Identifiants légaux (NIF, RCCM…)" span={2}><input value={f.shop_tax_id ?? ""} onChange={set("shop_tax_id")} /></Field>
          </div>
        </div>
      </div>

        </>
      )}

      {tab === "appearance" && <AppearanceTab f={f} setF={setF} setImage={setImage} />}

      {tab === "payments" && (
        <>
      <div className="card om-card">
        <h3 className="card-title"><Smartphone size={18} /> Orange Money / Sarali</h3>
        <label className="check" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={f.om_enabled !== "0"} onChange={toggle("om_enabled")} /> Proposer ce moyen de paiement en caisse
        </label>
        <div className="settings-split">
          <div className="om-preview">
            <OrangeMoneyQr size={150} />
          </div>
          <div className="form-grid">
            <Field label="Libellé affiché"><input value={f.om_label ?? ""} onChange={set("om_label")} /></Field>
            <Field label="Numéro marchand"><input value={f.om_merchant_number ?? ""} onChange={set("om_merchant_number")} placeholder="Ex. 70 00 00 00" /></Field>
            <Field label="Nom du compte marchand" span={2}><input value={f.om_merchant_name ?? ""} onChange={set("om_merchant_name")} /></Field>
            <div className="span-2">
              <ImageField
                label={<>Photo du QR code marchand (autocollant fourni par l'opérateur) <HelpTip k="om_qr" /></>}
                value={idOrNull(f.om_qr_image_id)}
                onChange={setImage("om_qr_image_id")}
                size={90}
                keepPng
                maxSize={800}
              />
            </div>
            <Field label="…ou contenu texte du QR code (si vous le connaissez)" span={2} hint="Laissez vide si vous avez ajouté la photo du QR code.">
              <input className="mono" value={f.om_qr_payload ?? ""} onChange={set("om_qr_payload")} />
            </Field>
            <label className="check span-2">
              <input type="checkbox" checked={f.om_require_reference !== "0"} onChange={toggle("om_require_reference")} />
              Exiger l'ID de transaction (recommandé : empêche les fraudes et facilite le rapprochement)
            </label>
          </div>
        </div>
        <p className="muted small">
          En caisse, le client scanne ce QR code (ou paie au numéro marchand), puis le caissier saisit ou scanne l'ID de transaction reçu par SMS.
          Un même ID ne peut jamais être utilisé deux fois. Le rapprochement se fait dans « Paiements mobiles ».
        </p>
      </div>

        </>
      )}

      {tab === "sales" && (
        <>
      <div className="card">
        <h3 className="card-title"><Receipt size={18} /> Ticket de caisse</h3>
        <div className="form-grid">
          <Field label="Message en bas du ticket" span={2}><input value={f.receipt_footer ?? ""} onChange={set("receipt_footer")} /></Field>
          <Field label="Largeur du ticket">
            <select value={f.receipt_width ?? "80"} onChange={set("receipt_width")}>
              <option value="80">Imprimante thermique 80 mm</option>
              <option value="58">Imprimante thermique 58 mm</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><Coins size={18} /> Devise, taxes et ventes</h3>
        <div className="form-grid">
          <Field label="Symbole de la devise"><input value={f.currency_symbol ?? ""} onChange={set("currency_symbol")} /></Field>
          <Field label="Nombre de décimales" hint="Non modifiable une fois des produits créés">
            <select value={f.currency_decimals ?? "0"} onChange={set("currency_decimals")}>
              <option value="0">0 (ex. FCFA)</option>
              <option value="2">2 (ex. euro)</option>
              <option value="3">3</option>
            </select>
          </Field>
          <Field label="TVA par défaut des nouveaux produits (%)"><input inputMode="decimal" value={f.default_tax_rate ?? "0"} onChange={set("default_tax_rate")} /></Field>
          <Field label={<>Fidélité : 1 point par tranche de ({currencySymbol()}) <HelpTip k="loyalty" /></>} hint="0 = programme de fidélité désactivé">
            <input inputMode="decimal" value={loyalty} onChange={(e) => setLoyalty(e.target.value)} />
          </Field>
          <label className="check span-2"><input type="checkbox" checked={f.require_cash_session !== "0"} onChange={toggle("require_cash_session")} /> Obliger l'ouverture d'une session de caisse avant de vendre (recommandé) <HelpTip k="require_session" /></label>
          <label className="check span-2"><input type="checkbox" checked={f.allow_negative_stock === "1"} onChange={toggle("allow_negative_stock")} /> Autoriser la vente de produits en rupture (stock négatif) <HelpTip k="allow_negative" /></label>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><CalendarClock size={18} /> Péremption</h3>
        <Field label="Alerter les produits qui périment dans les (jours)">
          <input inputMode="numeric" value={f.expiry_alert_days ?? "30"} onChange={set("expiry_alert_days")} style={{ maxWidth: 160 }} />
        </Field>
      </div>
        </>
      )}

      {tab === "security" && <SecurityTab f={f} setF={setF} />}

      {tab === "network" && (
        <>
          <div className="card">
            <h3 className="card-title"><Network size={18} /> Réseau, postes et écran client</h3>
            <p className="muted">
              Le rôle de chaque PC (serveur / client), la liste des appareils connectés et l'écran client se règlent depuis chaque poste, dans{" "}
              <Link to="/poste">Poste &amp; réseau</Link> (menu de gauche, accessible à tous).
            </p>
          </div>
          <MobileAppSettings f={f} setF={setF} />
        </>
      )}

      {tab === "backup" && (
        <>
      <div className="card">
        <h3 className="card-title"><ShieldCheck size={18} /> Sauvegarde des données <HelpTip k="auto_backup" /></h3>
        {isRemote() && <div className="alert alert-info">Ce poste est un client : les sauvegardes sont faites sur le poste serveur, dans le dossier ci-dessous (chemin du serveur).</div>}
        <p className="muted">
          Toutes les données (y compris les photos) sont dans une base locale. Choisissez un dossier de sauvegarde automatique, idéalement sur une
          clé USB, un disque externe ou un dossier synchronisé (Google Drive, OneDrive) : une copie est faite chaque jour.
        </p>
        <div className="form-grid">
          <Field label="Dossier des sauvegardes automatiques" span={2}>
            <div className="input-group">
              <input value={f.auto_backup_dir ?? ""} onChange={set("auto_backup_dir")} placeholder="Aucun dossier : sauvegarde automatique désactivée" />
              <button className="btn" type="button" onClick={chooseBackupDir}><FolderOpen size={16} /> Choisir</button>
            </div>
          </Field>
          <Field label="Nombre de sauvegardes conservées"><input inputMode="numeric" value={f.auto_backup_keep ?? "14"} onChange={set("auto_backup_keep")} /></Field>
        </div>
        <div className="row-start">
          <button className="btn" onClick={runAuto} disabled={!settings.auto_backup_dir}><DatabaseBackup size={16} /> Sauvegarder maintenant dans ce dossier</button>
          {!isRemote() && <button className="btn" onClick={backup}><DatabaseBackup size={16} /> Sauvegarder vers un fichier…</button>}
        </div>
        {info && (
          <p className="muted small" style={{ marginTop: 12 }}>
            Version {info.version} · Dernière sauvegarde automatique : {info.last_auto_backup ? dateTime(info.last_auto_backup) : "jamais"}
            <br />Base de données : <span className="mono">{info.db_path}</span>
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
  { name: "Émeraude (par défaut)", color: "" },
  { name: "Bleu royal", color: "#2563eb" },
  { name: "Orange", color: "#ea580c" },
  { name: "Rouge", color: "#dc2626" },
  { name: "Bordeaux", color: "#9f1239" },
  { name: "Violet", color: "#7c3aed" },
  { name: "Vert forêt", color: "#15803d" },
  { name: "Or", color: "#b45309" },
  { name: "Ardoise", color: "#334155" },
];

/** Apparence : logo, nom, couleur du thème, style du menu et thème clair / sombre par défaut. */
function AppearanceTab({ f, setF, setImage }: { f: Settings; setF: (s: Settings) => void; setImage: (k: string) => (id: number | null) => void }) {
  const color = f.theme_color ?? "";
  const valid = /^#[0-9a-fA-F]{6}$/.test(color);
  return (
    <>
      <div className="card">
        <h3 className="card-title"><Palette size={18} /> Identité du magasin</h3>
        <div className="settings-split">
          <ImageField label="Logo" value={idOrNull(f.shop_logo_id)} onChange={setImage("shop_logo_id")} size={120} keepPng maxSize={400} />
          <div className="form-grid one">
            <Field label="Nom affiché en haut du menu, sur les tickets et l'écran client">
              <input value={f.shop_name ?? ""} onChange={(e) => setF({ ...f, shop_name: e.target.value })} />
            </Field>
            <div className={`brand-preview sb-${f.sidebar_style || "dark"}`} style={valid ? ({ ["--brand" as string]: color } as React.CSSProperties) : undefined}>
              <BrandLogo size={44} />
              <div>
                <strong>{f.shop_name || "Mon magasin"}</strong>
                <span>Aperçu du haut du menu</span>
              </div>
            </div>
            <p className="muted small">Sans logo ni couleur, GestiMarket garde son thème par défaut. L'aperçu du logo s'applique après enregistrement.</p>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><Palette size={18} /> Couleur du thème</h3>
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
            <span>Couleur personnalisée…</span>
          </label>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title"><PanelLeft size={18} /> Menu et thème</h3>
        <div className="form-grid">
          <Field label="Style du menu latéral">
            <div className="segmented">
              {[["dark", "Sombre"], ["brand", "Couleur du thème"], ["light", "Clair"]].map(([id, label]) => (
                <button key={id} type="button" className={(f.sidebar_style || "dark") === id ? "active" : ""} onClick={() => setF({ ...f, sidebar_style: id })}>{label}</button>
              ))}
            </div>
          </Field>
          <Field label="Thème par défaut des postes" hint="Chaque poste peut ensuite basculer avec l'icône soleil / lune du menu.">
            <div className="segmented">
              <button type="button" className={(f.theme_mode || "light") === "light" ? "active" : ""} onClick={() => setF({ ...f, theme_mode: "light" })}><Sun size={14} /> Clair</button>
              <button type="button" className={f.theme_mode === "dark" ? "active" : ""} onClick={() => setF({ ...f, theme_mode: "dark" })}><Moon size={14} /> Sombre</button>
            </div>
          </Field>
        </div>
      </div>
    </>
  );
}

const LEVELS = [
  ["cashier", "Le caissier lui-même (son propre PIN)"],
  ["manager", "Un gestionnaire ou l'administrateur"],
  ["admin", "L'administrateur uniquement"],
];

/** Sécurité : qui doit confirmer les actions sensibles de la caisse. */
function SecurityTab({ f, setF }: { f: Settings; setF: (s: Settings) => void }) {
  return (
    <>
      <div className="card">
        <h3 className="card-title"><Lock size={18} /> Confirmation par code PIN en caisse</h3>
        <div className="form-grid">
          <Field label="Retirer un article, diminuer une quantité, vider le ticket">
            <select value={f.pin_void_level || "cashier"} onChange={(e) => setF({ ...f, pin_void_level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Accorder une remise (article ou ticket)">
            <select value={f.pin_discount_level || "cashier"} onChange={(e) => setF({ ...f, pin_discount_level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted small">Si un responsable doit confirmer, il tape son propre PIN sur la caisse : l'action est tracée à son nom dans le journal d'activité.</p>
      </div>
      <div className="card">
        <h3 className="card-title"><ShieldCheck size={18} /> Actions toujours confirmées par PIN</h3>
        <table className="table compact">
          <thead><tr><th>Action</th><th>Code PIN demandé</th></tr></thead>
          <tbody>
            <tr><td>Annulation d'une vente</td><td>Administrateur</td></tr>
            <tr><td>Modification d'un prix, archivage d'un produit, import, ajustement de stock</td><td>Gestionnaire ou administrateur</td></tr>
            <tr><td>Suppression de catégorie, d'emplacement, archivage de fournisseur</td><td>Gestionnaire ou administrateur</td></tr>
            <tr><td>Clôture de caisse, entrée / sortie d'espèces</td><td>Caissier (son propre PIN)</td></tr>
            <tr><td>Utilisateurs, paramètres, archivage de client</td><td>Administrateur</td></tr>
          </tbody>
        </table>
        <p className="muted small">Après 5 codes erronés, la saisie est bloquée 1 minute. Les codes sont chiffrés (Argon2) : personne, pas même l'administrateur, ne peut les lire.</p>
      </div>
    </>
  );
}

/** Onglet « Type de commerce » : le logiciel s'adapte (catégories proposées, fonctions affichées). */
function BusinessTab() {
  const { settings, setSettings, toast, askPin } = useApp();
  const data = useBusinessProfiles();
  const [type, setType] = useState(settings.business_type ?? "");
  const [features, setFeatures] = useState<string[]>((settings.enabled_features ?? "").split(",").filter(Boolean));
  const [seed, setSeed] = useState(false);
  const [busy, setBusy] = useState(false);
  const current = data?.profiles.find((p) => p.id === settings.business_type);
  const dirty = type !== (settings.business_type ?? "") || features.slice().sort().join(",") !== (settings.enabled_features ?? "").split(",").filter(Boolean).sort().join(",") || seed;

  const apply = async () => {
    if (!type) return toast.error("Choisissez un type de commerce.");
    setBusy(true);
    try {
      const pin = await askPin({ title: "Changer le type de commerce", level: "admin" });
      if (!pin) return;
      const r = await api.setBusinessType(type, features, seed, pin);
      setSettings(r.settings);
      setSeed(false);
      toast.success(seed ? `Type de commerce enregistré — ${r.created} catégorie(s) ajoutée(s).` : "Type de commerce enregistré.");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="card muted">Chargement…</div>;
  return (
    <>
      <div className="card">
        <h3 className="card-title"><Building2 size={18} /> Votre type de commerce <HelpTip k="business_type" /></h3>
        <p className="muted">
          {current ? <>Actuellement : <strong>{current.label}</strong>. </> : <>Aucun type choisi : toutes les fonctions sont affichées. </>}
          GestiMarket adapte les catégories proposées et les champs affichés. Les catégories restent libres : vous pouvez en ajouter, masquer ou supprimer à tout moment.
        </p>
        <BusinessTypeGrid
          profiles={data.profiles}
          value={type}
          onChange={(p) => {
            setType(p.id);
            setFeatures(p.features);
          }}
        />
      </div>
      <div className="card">
        <h3 className="card-title">Fonctions activées</h3>
        <p className="muted small">Pré-réglées selon le type choisi ; ajustez-les selon vos besoins.</p>
        <FeatureToggles value={features} onChange={setFeatures} />
        <label className="check" style={{ marginTop: 14 }}>
          <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
          Ajouter aussi les catégories recommandées pour ce type (sans doublon)
        </label>
        <div className="row-end" style={{ marginTop: 12 }}>
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={apply}><Check size={16} /> Appliquer</button>
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
      toast.success("Adresse publiée sur Supabase.");
    } catch (e) {
      toast.error(e);
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title"><Smartphone size={18} /> Application mobile (Supabase) <HelpTip k="mobile_app" /></h3>
      <p className="muted">
        Le poste serveur publie toutes les 30 secondes son état (actif / arrêté) et ses adresses sur votre projet Supabase. L'application mobile
        (FlutterFlow, widget WebView) lit l'adresse avec le <strong>code du commerce</strong> et ouvre GestiMarket directement. Exécutez une fois le
        script <span className="mono">supabase/gestimarket_mobile.sql</span> dans Supabase (SQL Editor).
      </p>
      <label className="check" style={{ margin: "8px 0 12px" }}>
        <input type="checkbox" checked={f.supabase_enabled === "1"} onChange={(e) => setF({ ...f, supabase_enabled: e.target.checked ? "1" : "0" })} />
        Publier l'adresse du poste serveur sur Supabase
      </label>
      <div className="form-grid">
        <Field label="URL du projet Supabase" hint="Supabase → Project Settings → API (ex. https://abcd.supabase.co)">
          <input value={f.supabase_url ?? ""} onChange={set("supabase_url")} placeholder="https://xxxxxxxx.supabase.co" />
        </Field>
        <Field label="Clé publique (anon / publishable)" hint="Jamais la clé « service_role » : elle donnerait tous les droits.">
          <input className="mono" value={f.supabase_key ?? ""} onChange={set("supabase_key")} placeholder="eyJhbGciOi… ou sb_publishable_…" />
        </Field>
        <Field label="Code du commerce" hint="Créé automatiquement à la première publication. À saisir ou scanner une fois dans l'application.">
          <input className="mono" value={f.shop_code ?? ""} onChange={(e) => setF({ ...f, shop_code: e.target.value.toUpperCase() })} placeholder="GM-XXXXXX (automatique)" />
        </Field>
        <Field label="Adresse publique (facultatif)" hint="Seulement si le serveur est joignable depuis Internet (redirection de port, tunnel).">
          <input value={f.public_url ?? ""} onChange={set("public_url")} placeholder="https://magasin.exemple.com" />
        </Field>
      </div>
      {(f.supabase_key ?? "").includes("service_role") && <div className="alert alert-danger">Cette clé semble être la clé « service_role » : utilisez la clé publique (anon).</div>}

      <h4 className="section-title">État de la publication</h4>
      <div className="display-link">
        {qr && <img src={qr} alt="QR code du code commerce" width={130} height={130} />}
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="kv"><span>Code du commerce</span><strong className="mono">{code || "— (après la 1ʳᵉ publication)"}</strong></div>
          <div className="kv">
            <span>Poste serveur</span>
            <span>{status?.running ? <Badge tone="success">publie toutes les 30 s</Badge> : <Badge>ce réseau n'a pas de poste serveur actif</Badge>}</span>
          </div>
          <div className="kv"><span>Dernière publication réussie</span><span>{status?.last_ok_at ? dateTime(status.last_ok_at) : "jamais"}</span></div>
          {status?.last_error && <div className="alert alert-danger small">{status.last_error}</div>}
          <div className="row-end" style={{ marginTop: 8 }}>
            <button className="btn" disabled={busy} onClick={publish}><RotateCw size={15} /> Publier maintenant</button>
          </div>
          <p className="muted small">Enregistrez d'abord les modifications (bouton en haut), puis « Publier maintenant » pour tester.</p>
        </div>
      </div>
    </div>
  );
}
