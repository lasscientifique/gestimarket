import { useEffect, useState, type FormEvent } from "react";
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
import { Building2, Code2, Copy, FileText, Mail, MessageCircle, Phone, Star } from "lucide-react";
import { currencyDecimals, currencySymbol, dateTime, isoDate, minorToInput, money, toMinor } from "../lib/format";
import { useLicense } from "../lib/license";
import { Stars } from "../components/CustomerAccount";
import type { BackupStatus, CloudStatus, Settings, TunnelStatus } from "../types";
import { PrinterSettings } from "../components/PrinterSettings";
import { LANGS, tl, tm } from "../lib/i18n";
import { loginId } from "../lib/phone";
import { invoke } from "@tauri-apps/api/core";
import { isMobileApp, isTauri } from "../lib/transport";
import { appCacheDir, join } from "@tauri-apps/api/path";
import { readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { every } from "../lib/visibility";
import { markBackupShared } from "../components/PhoneBanners";
import { OfflineHelpCard } from "../components/OfflineHelp";
import { RestoreBackupModal } from "../components/RestoreBackup";
import { BackupProtectionCard } from "../components/BackupProtection";
import { ArchiveRestore, BookOpen, PlayCircle } from "lucide-react";
import { TermsCard } from "../components/Terms";
import { openManual, openManualExternal } from "../components/Help";

const idOrNull = (v: string | undefined) => (v && Number(v) > 0 ? Number(v) : null);

type TabId = "shop" | "business" | "appearance" | "payments" | "sales" | "security" | "network" | "backup" | "help" | "developer";
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "shop", label: tl("Commerce"), icon: <Store size={17} /> },
  { id: "business", label: tl("Type de commerce"), icon: <Building2 size={17} /> },
  { id: "appearance", label: tl("Apparence"), icon: <Palette size={17} /> },
  { id: "payments", label: tl("Orange Money"), icon: <Smartphone size={17} /> },
  { id: "sales", label: tl("Ventes & ticket"), icon: <Receipt size={17} /> },
  { id: "security", label: tl("Sécurité & PIN"), icon: <Lock size={17} /> },
  { id: "network", label: tl("Réseau & mobile"), icon: <Network size={17} /> },
  { id: "backup", label: tl("Sauvegarde"), icon: <ShieldCheck size={17} /> },
  { id: "help", label: tl("Aide, conditions et licence"), icon: <BookOpen size={17} /> },
  { id: "developer", label: tl("Développeur Eden Dev"), icon: <Code2 size={17} /> },
];

export default function SettingsPage() {
  const { settings, setSettings, toast, askPin } = useApp();
  const [f, setF] = useState<Settings>(settings);
  const [loyalty, setLoyalty] = useState(minorToInput(Number(settings.loyalty_step || 0)));
  const [info, setInfo] = useState<{ version: string; db_path: string; last_auto_backup: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabId>(() => {
    // « ?tab=backup » (rappel de sauvegarde du téléphone) : onglet demandé.
    const asked = new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("tab");
    if (asked) return asked as TabId;
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
  const [backupState, setBackupState] = useState<BackupStatus | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const loadInfo = () => {
    api.appInfo().then(setInfo).catch(() => undefined);
    api.backupStatus().then(setBackupState).catch(() => undefined);
  };
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
      // Sauvegarde protégée par un mot de passe : fichier .gmsave (chiffré).
      const ext = backupState?.protected ? "gmsave" : "db";
      const path = await save({
        title: tl("Sauvegarder la base de données"),
        defaultPath: `gestimarket-sauvegarde-${isoDate()}.${ext}`,
        filters: [{ name: backupState?.protected ? tl("Sauvegarde GestiMarket protégée") : "Base SQLite", extensions: [ext] }],
      });
      if (!path) return;
      if (isMobileApp) {
        // Téléphone et tablette : copie faite dans le cache de l'application, puis écrite dans le fichier
        // choisi (Drive, Fichiers, carte SD…), que seul le module fs sait ouvrir.
        const tmp = await join(await appCacheDir(), `gestimarket-copie-${Date.now()}.${ext}`);
        await api.backupDatabase(tmp);
        try {
          await writeFile(path, await readFile(tmp));
        } finally {
          await remove(tmp).catch(() => undefined);
        }
      } else {
        await api.backupDatabase(path);
      }
      if (isMobileApp) markBackupShared();
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
      {isTauri && <PrinterSettings />}

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
          {/* Anciens points : seulement pour une boutique qui les utilise encore sans le programme client fidèle. */}
          {f.loyalty_enabled !== "1" && Number(settings.loyalty_step || 0) > 0 && (
            <Field label={<>{tl("Fidélité : 1 point par tranche de (")}{currencySymbol()}) <HelpTip k="loyalty" /></>} hint={tl("0 = programme de fidélité désactivé")}>
              <input inputMode="decimal" value={loyalty} onChange={(e) => setLoyalty(e.target.value)} />
            </Field>
          )}
          <label className="check span-2"><input type="checkbox" checked={f.require_cash_session !== "0"} onChange={toggle("require_cash_session")} />  {tl("Obliger l'ouverture d'une session de caisse avant de vendre (recommandé)")} <HelpTip k="require_session" /></label>
          <label className="check span-2"><input type="checkbox" checked={f.allow_negative_stock === "1"} onChange={toggle("allow_negative_stock")} />  {tl("Autoriser la vente de produits en rupture (stock négatif)")} <HelpTip k="allow_negative" /></label>
        </div>
      </div>

      <LoyaltySettings f={f} setF={setF} />

      <div className="card">
        <h3 className="card-title"><CalendarClock size={18} />  {tl("Péremption")}</h3>
        <Field label={tl("Alerter les produits qui périment dans les (jours)")}>
          <input inputMode="numeric" value={f.expiry_alert_days ?? "30"} onChange={set("expiry_alert_days")} style={{ maxWidth: 160 }} />
        </Field>
      </div>

      <div className="card">
        <h3 className="card-title"><Receipt size={18} />  {tl("Retours et avoirs")}</h3>
        <div className="form-grid">
          <Field label={tl("Retour possible pendant (jours après la vente)")}>
            <input inputMode="numeric" value={f.return_days ?? "7"} onChange={set("return_days")} style={{ maxWidth: 160 }} />
          </Field>
          <Field label={tl("Un avoir est valable (jours)")}>
            <input inputMode="numeric" value={f.credit_note_days ?? "90"} onChange={set("credit_note_days")} style={{ maxWidth: 160 }} />
          </Field>
        </div>
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
          {isMobileApp && !isRemote() ? (
            // Tablette en poste unique : ni application du propriétaire, ni adresse Internet (réservées au poste serveur d'un PC).
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                {tl("Cet appareil est un poste unique : l'application mobile du propriétaire et l'adresse Internet se règlent sur le poste serveur d'un PC.")}</p>
            </div>
          ) : (
            <>
              <MobileAppSettings f={f} setF={setF} />
              <InternetAddressSettings />
            </>
          )}
        </>
      )}

      {tab === "backup" && (
        <>
      <div className="card">
        <h3 className="card-title"><ShieldCheck size={18} />  {tl("Sauvegarde des données")} <HelpTip k="auto_backup" /></h3>
        {isRemote() && <div className="alert alert-info">{tl("Ce poste est un client : les sauvegardes sont faites sur le poste serveur, dans le dossier ci-dessous (chemin du serveur).")}</div>}
        <p className="muted">
          {tl("Toutes les données (y compris les photos) sont dans une base locale. Choisissez un dossier de sauvegarde automatique, idéalement sur une clé USB, un disque externe ou un dossier synchronisé (Google Drive, OneDrive) : une copie est faite chaque jour.")}</p>
        {isMobileApp && !isRemote() && (
          <div className="alert alert-warning">
            {tl("Sur téléphone ou tablette, les copies automatiques restent dans l'application : elles sont perdues avec l'appareil. Enregistrez souvent une copie ailleurs (Google Drive, iCloud, ordinateur) avec le bouton « Enregistrer une copie… ».")}</div>
        )}
        {!isMobileApp && (
        <div className="form-grid">
          <Field label={tl("Dossier des sauvegardes automatiques")} span={2}>
            <div className="input-group">
              <input
                value={f.auto_backup_dir ?? ""}
                onChange={set("auto_backup_dir")}
                placeholder={backupState?.default_dir ? tl("Par défaut : {0}", [backupState.default_dir]) : tl("Aucun dossier : sauvegarde automatique désactivée")}
              />
              <button className="btn" type="button" onClick={chooseBackupDir}><FolderOpen size={16} />  {tl("Choisir")}</button>
            </div>
          </Field>
          <Field label={tl("Nombre de sauvegardes conservées")}><input inputMode="numeric" value={f.auto_backup_keep ?? "14"} onChange={set("auto_backup_keep")} /></Field>
        </div>
        )}
        <div className="row-start">
          <button className="btn" onClick={runAuto} disabled={!settings.auto_backup_dir && !backupState?.dir}><DatabaseBackup size={16} />  {tl("Sauvegarder maintenant dans ce dossier")}</button>
          {!isRemote() && (
            <button className="btn" onClick={backup}><DatabaseBackup size={16} />  {isMobileApp ? tl("Enregistrer une copie…") : tl("Copier sur une clé USB ou un autre disque…")}</button>
          )}
        </div>
        {backupState?.error && <div className="alert alert-danger" style={{ marginTop: 12 }}>{tl("La dernière sauvegarde automatique a échoué : {0}", [backupState.error])}</div>}
        {backupState?.is_default && backupState.dir && (
          <p className="muted small" style={{ marginTop: 12 }}>{tl("Aucun dossier choisi : les copies sont faites chaque jour dans {0}, sur ce même PC. Choisissez plutôt une clé USB, un disque externe ou un dossier synchronisé pour être protégé d'une panne du PC.", [backupState.dir])}</p>
        )}
        {info && (
          <p className="muted small" style={{ marginTop: 12 }}>
            {tl("Version")} {info.version}  {tl("· Dernière sauvegarde automatique :")} {info.last_auto_backup ? dateTime(info.last_auto_backup) : tl("jamais")}
            <br />{tl("Base de données :")} <span className="mono">{info.db_path}</span>
          </p>
        )}
      </div>
      <BackupProtectionCard status={backupState} onChange={setBackupState} />
      {isTauri && !isRemote() && (
        <div className="card">
          <h3 className="card-title"><ArchiveRestore size={18} />  {tl("Restaurer une sauvegarde")} <HelpTip k="backup_restore" /></h3>
          <p className="muted">
            {tl("Revenir à une copie : téléphone ou PC changé, erreur à annuler, passage du téléphone au PC. Les données actuelles sont d'abord copiées, puis remplacées par celles de la sauvegarde.")}</p>
          <div className="row-start">
            <button className="btn" onClick={() => setRestoreOpen(true)}><ArchiveRestore size={16} />  {tl("Restaurer une sauvegarde…")}</button>
          </div>
        </div>
      )}
      {restoreOpen && <RestoreBackupModal onClose={() => setRestoreOpen(false)} />}
        </>
      )}

      {tab === "help" && (
        <>
          <div className="card">
            <h3 className="card-title"><BookOpen size={18} />  {tl("Manuel d'utilisation")}</h3>
            <p className="muted">
              {tl("Le manuel complet, en PDF : installation, téléphone serveur et TV, caisse, produits, clients, sauvegarde, et chaque écran expliqué avec sa capture. Il s'ouvre dans GestiMarket, même sans Internet.")}</p>
            <div className="row-start">
              <button className="btn btn-primary" onClick={() => openManual()}><BookOpen size={16} />  {tl("Lire le manuel")}</button>
              <button className="btn" onClick={() => void openManualExternal()}>{tl("Ouvrir dans un lecteur PDF")}</button>
            </div>
            <p className="muted small" style={{ marginTop: 10 }}>
              <PlayCircle size={14} />  {tl("Chaque écran a aussi son bouton « Aide », avec ses vidéos.")}</p>
          </div>
          {isTauri && !isRemote() && <OfflineHelpCard />}
          <TermsCard />
        </>
      )}

      {tab === "developer" && <DeveloperTab version={info?.version} />}
    </div>
  );
}

// Coordonnées d'Eden Dev, éditeur de GestiMarket (mêmes adresses que la commande Rust « open_contact »).
const EDEN_EMAIL = "lasscientifique@gmail.com";
const EDEN_WHATSAPP = "@edendeveloppeur";
const EDEN_PHONE = "+223 76 59 36 76";
const EDEN_NAME = "Eden Dev";
const EDEN_LINKS = {
  email: `mailto:${EDEN_EMAIL}`,
  whatsapp: "https://wa.me/22376593676",
  phone: "tel:+22376593676",
} as const;

/** Paramètres → Développeur Eden Dev : contacter l'éditeur du logiciel (e-mail, WhatsApp, téléphone). */
function DeveloperTab({ version }: { version?: string }) {
  const { toast } = useApp();
  // Fenêtre GestiMarket du PC : programme par défaut de Windows. Navigateur ou application mobile : lien normal.
  const openLink = (kind: keyof typeof EDEN_LINKS) => async (e: React.MouseEvent) => {
    if (!isTauri) return;
    e.preventDefault();
    try {
      await invoke("open_contact", { kind });
    } catch (err) {
      toast.error(err);
    }
  };
  const rows: { kind: keyof typeof EDEN_LINKS; icon: React.ReactNode; label: string; value: string; action: string }[] = [
    { kind: "email", icon: <Mail size={20} />, label: tl("E-mail"), value: EDEN_EMAIL, action: tl("Écrire un e-mail") },
    { kind: "whatsapp", icon: <MessageCircle size={20} />, label: tl("WhatsApp"), value: EDEN_WHATSAPP, action: tl("Ouvrir WhatsApp") },
    { kind: "phone", icon: <Phone size={20} />, label: tl("Téléphone"), value: EDEN_PHONE, action: tl("Appeler") },
  ];
  return (
    <div className="card">
      <h3 className="card-title"><Code2 size={18} />  {tl("Développeur Eden Dev")}</h3>
      <p className="muted">
        {tl("GestiMarket est conçu et maintenu par {0}. Pour une question, une panne, une formation ou une nouvelle fonction, contactez-nous.", [EDEN_NAME])}
      </p>
      <div className="contact-list">
        {rows.map((r) => (
          <div className="contact-row" key={r.kind}>
            <span className="contact-icon">{r.icon}</span>
            <span className="contact-text">
              <span className="muted small">{r.label}</span>
              <strong className="mono">{r.value}</strong>
            </span>
            <a className="btn" href={EDEN_LINKS[r.kind]} target="_blank" rel="noreferrer" onClick={openLink(r.kind)}>{r.action}</a>
          </div>
        ))}
      </div>
      {isTauri && <JournalCard openWhatsApp={openLink("whatsapp")} />}
      {version && <p className="muted small" style={{ marginTop: 12 }}>{tl("GestiMarket version {0}", [version])}</p>}
    </div>
  );
}

/** Journal de ce PC (erreurs, démarrages, sauvegardes, tunnel) : à envoyer à Eden Dev en cas de problème. */
function JournalCard({ openWhatsApp }: { openWhatsApp: (e: React.MouseEvent) => void }) {
  const { toast } = useApp();
  const [saved, setSaved] = useState<string | null>(null);
  const exportJournal = async () => {
    try {
      setSaved(await invoke<string>("journal_export"));
    } catch (err) {
      toast.error(err);
    }
  };
  const copyJournal = async () => {
    try {
      const text = await invoke<string>("journal_text");
      await navigator.clipboard.writeText(text || tl("Journal vide."));
      toast.success(tl("Journal copié : collez-le dans la discussion WhatsApp ou dans un e-mail."));
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="journal-card">
      <h4>{tl("En cas de problème : envoyer le journal")}</h4>
      <p className="muted small">
        {tl("GestiMarket note ses démarrages et ses erreurs (sauvegarde, réseau, adresse Internet, licence) pendant 14 jours. Envoyez ce journal à Eden Dev : il aide à comprendre la panne.")}
      </p>
      <div className="row-start">
        {!isMobileApp && <button className="btn btn-primary" onClick={exportJournal}><FileText size={16} />  {tl("Enregistrer le journal")}</button>}
        <button className={isMobileApp ? "btn btn-primary" : "btn"} onClick={copyJournal}><Copy size={16} />  {tl("Copier les dernières lignes")}</button>
        <a className="btn" href={EDEN_LINKS.whatsapp} target="_blank" rel="noreferrer" onClick={openWhatsApp}><MessageCircle size={16} />  {tl("Ouvrir WhatsApp")}</a>
      </div>
      {saved && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {tl("Fichier prêt : {0}. Glissez-le dans la discussion WhatsApp d'Eden Dev ou joignez-le à un e-mail.", [saved])}
        </p>
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
        <h3 className="card-title"><Lock size={18} />  {tl("Pannes du programme")}</h3>
        <label className="check">
          <input type="checkbox" checked={f.error_reports !== "0"} onChange={(e) => setF({ ...f, error_reports: e.target.checked ? "1" : "0" })} />
          {"  "}{tl("Envoyer les pannes du programme à Eden Dev, pour qu'elles soient corrigées")}
        </label>
        <p className="muted small">{tl("Seuls partent le message de la panne, l'écran, la version et le modèle d'appareil. Jamais de ventes, produits, clients ni montants.")}</p>
      </div>
      <div className="card">
        <h3 className="card-title"><Lock size={18} />  {tl("Confirmation par code PIN en caisse")}</h3>
        <div className="form-grid">
          <Field label={tl("Retirer un article, diminuer une quantité, vider le ticket")}>
            <select value={f.pin_void_level || "cashier"} onChange={(e) => setF({ ...f, pin_void_level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label={tl("Remise maximale sans validation (% du ticket)")}>
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={f.discount_free_percent ?? "5"}
              onChange={(e) => setF({ ...f, discount_free_percent: String(Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0)))) })}
            />
          </Field>
          <Field label={tl("Au-delà, la remise est validée par")}>
            <select value={f.pin_discount_level || "manager"} onChange={(e) => setF({ ...f, pin_discount_level: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <p className="muted small">{tl("Si un responsable doit confirmer, il tape son propre PIN sur la caisse : l'action est tracée à son nom dans le journal d'activité.")}</p>
        <p className="muted small">{tl("Remises : le serveur vérifie lui-même le seuil et le code PIN, quel que soit l'appareil qui encaisse. Chaque remise est inscrite au journal, et le rapport des ventes les montre par caissier.")}</p>
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
    return every(15_000, load);
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
        {tl("Le poste serveur publie toutes les 30 secondes son état (actif / arrêté) et ses adresses. L'application mobile GestiMarket ouvre la boutique avec le compte boutique de la propriétaire, ou avec le")} <strong>{tl("code du commerce")}</strong>  {tl("pour le personnel. Laissez l'URL et la clé vides pour utiliser le service d'Eden Dev.")}</p>
      <label className="check" style={{ margin: "8px 0 12px" }}>
        <input type="checkbox" checked={f.supabase_enabled === "1"} onChange={(e) => setF({ ...f, supabase_enabled: e.target.checked ? "1" : "0" })} />
        {tl("Publier l'adresse du poste serveur sur Supabase")}</label>
      <div className="form-grid">
        <Field label={tl("URL du projet Supabase")} hint={tl("Vide : service d'Eden Dev (application GestiMarket). Sinon : votre projet (ex. https://abcd.supabase.co).")}>
          <input value={f.supabase_url ?? ""} onChange={set("supabase_url")} placeholder="https://xxxxxxxx.supabase.co" />
        </Field>
        <Field label={tl("Clé publique (anon / publishable)")} hint={tl("Jamais la clé « service_role » : elle donnerait tous les droits.")}>
          <input className="mono" value={f.supabase_key ?? ""} onChange={set("supabase_key")} placeholder={tl("eyJhbGciOi… ou sb_publishable_…")} />
        </Field>
        <Field label={tl("Code du commerce")} hint={tl("Créé automatiquement à la première publication. À saisir ou scanner une fois dans l'application.")}>
          <input className="mono" value={f.shop_code ?? ""} onChange={(e) => setF({ ...f, shop_code: e.target.value.toUpperCase() })} placeholder={tl("GM-XXXXXX (automatique)")} />
        </Field>
        <Field label={tl("Adresse publique (facultatif)")} hint={tl("Remplie par l'adresse Internet automatique ci-dessous ; sinon votre propre tunnel ou redirection de port.")}>
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

/** Commande d'installation de cloudflared (une fois, sur le PC serveur). */
const WINGET_CLOUDFLARED = "winget install --id Cloudflare.cloudflared";

/** Adresse Internet automatique : tunnel Cloudflare créé par Eden Dev pour la boutique (PRO, BUSINESS). */
function InternetAddressSettings() {
  const { toast } = useApp();
  const [st, setSt] = useState<TunnelStatus | null>(null);
  const [asking, setAsking] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api.tunnelStatus().then(setSt).catch(() => undefined);
  useEffect(() => {
    load();
    return every(15_000, load);
  }, []);

  const setup = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const s = await api.tunnelSetup(loginId(email), password);
      setSt(s);
      setAsking(false);
      setPassword("");
      toast.success(tl("Adresse Internet de la boutique : {0}", [s.url]));
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(tl("Retirer l'adresse Internet de ce PC ? Les téléphones ne joindront plus la boutique depuis Internet (l'adresse reste réservée à la boutique)."))) return;
    try {
      setSt(await api.tunnelRemove());
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="card">
      <h3 className="card-title"><Network size={18} />  {tl("Adresse Internet de la boutique")}</h3>
      <p className="muted">{tl("Eden Dev donne à la boutique une adresse fixe en HTTPS (ex. https://gm-000123.gestimarket.com) qui mène à ce poste serveur, sans redirection de port ni réglage de la box. Les téléphones autorisés retrouvent GestiMarket depuis n'importe où. Formules PRO et BUSINESS.")}</p>
      {st?.configured ? (
        <>
          <div className="kv"><span>{tl("Adresse")}</span><strong className="mono">{st.url}</strong></div>
          <div className="kv">
            <span>{tl("Tunnel")}</span>
            <span>{st.running ? <Badge tone="success">{tl("en marche")}</Badge> : <Badge tone="danger">{tl("arrêté")}</Badge>}</span>
          </div>
        </>
      ) : (
        <p className="small">{tl("Pas encore d'adresse Internet sur ce PC.")}</p>
      )}
      {st && !st.cloudflared && (
        <div className="alert alert-warning small">
          {tl("cloudflared n'est pas installé sur ce PC. Ouvrez une invite de commandes, tapez la commande ci-dessous, puis redémarrez GestiMarket :")}
          <div className="mono" style={{ marginTop: 6 }}>{WINGET_CLOUDFLARED}</div>
        </div>
      )}
      {st?.error && <div className="alert alert-danger small">{st.error}</div>}
      {isRemote() ? (
        <p className="muted small">{tl("À régler sur le PC serveur de la boutique.")}</p>
      ) : asking ? (
        <form onSubmit={setup} className="form-grid" style={{ marginTop: 10 }}>
          <Field label={tl("E-mail ou numéro WhatsApp du compte boutique")}>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus />
          </Field>
          <Field label={tl("Mot de passe du compte boutique")}>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <div className="row-end" style={{ gridColumn: "1 / -1" }}>
            <button type="button" className="btn" onClick={() => setAsking(false)}>{tl("Annuler")}</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? tl("Création…") : tl("Créer l'adresse")}</button>
          </div>
        </form>
      ) : (
        <div className="row-end" style={{ marginTop: 10 }}>
          {st?.configured && <button className="btn" onClick={remove}>{tl("Retirer de ce PC")}</button>}
          <button className="btn btn-primary" onClick={() => setAsking(true)}>
            {st?.configured ? tl("Redemander l'adresse") : tl("Créer l'adresse Internet")}</button>
        </div>
      )}
    </div>
  );
}

/** Paramètres → Ventes : programme client fidèle (étoiles et bonus), formules PRO et BUSINESS. */
function LoyaltySettings({ f, setF }: { f: Settings; setF: (s: Settings) => void }) {
  const { toast, confirm } = useApp();
  const lic = useLicense();
  const allowed = !lic || lic.plan === "pro" || lic.plan === "business";
  const on = f.loyalty_enabled === "1";
  const [minPurchase, setMinPurchase] = useState(minorToInput(Number(f.loyalty_min_purchase ?? "500")));
  const [perPoint, setPerPoint] = useState(minorToInput(1));
  const set = (k: string) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const rate = (v: string | undefined, d: number) => {
    const n = Number(String(v ?? "").replace(",", "."));
    return Number.isFinite(n) ? n : d;
  };
  const rMin = rate(f.loyalty_rate_min, 0.5);
  const rMax = rate(f.loyalty_rate_max, 1);
  const steps = String(f.loyalty_star_steps ?? "3,10,25,50,100").split(",").map((x) => x.trim());
  const convert = async () => {
    const value = toMinor(perPoint || "0");
    if (value <= 0) return toast.error(tl("Indiquez la valeur d'un point."));
    if (!(await confirm({ title: tl("Convertir les anciens points"), message: tl("Chaque point de fidélité devient {0} de bonus, puis les points sont remis à zéro.", [money(value)]), confirmLabel: tl("Convertir") }))) return;
    try {
      const n = await api.loyaltyConvertPoints(value);
      toast.success(tl("{0} client(s) : points convertis en bonus.", [n]));
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="card">
      <h3 className="card-title"><Star size={18} />  {tl("Programme client fidèle")} <HelpTip k="loyalty_program" /></h3>
      {!allowed && <div className="alert alert-info">{tl("Le programme client fidèle est inclus à partir de la formule PRO : voir « Abonnement & licence ».")}</div>}
      <label className="check">
        <input type="checkbox" checked={on} disabled={!allowed && !on} onChange={(e) => setF({ ...f, loyalty_enabled: e.target.checked ? "1" : "0" })} />
        {tl("Activer : étoiles de 0 à 5 et bonus utilisable en caisse")}
      </label>
      {on && (
        <>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label={tl("Bonus à 0 étoile (% de l'achat)")}><input inputMode="decimal" value={f.loyalty_rate_min ?? "0.5"} onChange={set("loyalty_rate_min")} /></Field>
            <Field label={tl("Bonus à 5 étoiles (% de l'achat)")}><input inputMode="decimal" value={f.loyalty_rate_max ?? "1"} onChange={set("loyalty_rate_max")} /></Field>
            <Field label={tl("Achats sur 12 mois pour 1, 2, 3, 4 et 5 étoiles")} hint={tl("5 nombres croissants séparés par des virgules")}>
              <input value={f.loyalty_star_steps ?? "3,10,25,50,100"} onChange={set("loyalty_star_steps")} />
            </Field>
            <Field label={tl("Achat minimum pour compter une étoile ({0})", [currencySymbol()])}>
              <input
                inputMode="decimal"
                value={minPurchase}
                onChange={(e) => setMinPurchase(e.target.value)}
                onBlur={() => setF({ ...f, loyalty_min_purchase: String(toMinor(minPurchase || "0")) })}
              />
            </Field>
            <Field label={tl("Le bonus expire après (mois sans achat)")} hint={tl("0 : n'expire jamais")}>
              <input inputMode="numeric" value={f.loyalty_bonus_months ?? "12"} onChange={set("loyalty_bonus_months")} />
            </Field>
          </div>
          <table className="table compact" style={{ maxWidth: 520 }}>
            <thead><tr><th>{tl("Étoiles")}</th><th className="num">{tl("Achats sur 12 mois")}</th><th className="num">{tl("Bonus")}</th><th className="num">{tl("Pour un achat de {0}", [money(10000 * 10 ** currencyDecimals())])}</th></tr></thead>
            <tbody>
              {[0, 1, 2, 3, 4, 5].map((n) => {
                const r = rMin + ((rMax - rMin) * n) / 5;
                return (
                  <tr key={n}>
                    <td><Stars value={n} /></td>
                    <td className="num">{n === 0 ? "—" : tl("dès {0}", [steps[n - 1] ?? "?"])}</td>
                    <td className="num">{`${r.toFixed(2).replace(/\.?0+$/, "")} %`}</td>
                    <td className="num">{money(Math.floor((10000 * 10 ** currencyDecimals() * r) / 100))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <h4 className="section-title">{tl("Anciens points de fidélité")}</h4>
          <p className="muted small">{tl("Les points gagnés avant le programme client fidèle ne servaient pas en caisse. Convertissez-les en bonus : chaque point vaut la somme choisie.")}</p>
          <div className="input-group" style={{ maxWidth: 420 }}>
            <input inputMode="decimal" value={perPoint} onChange={(e) => setPerPoint(e.target.value)} aria-label={tl("Valeur d'un point")} />
            <button className="btn" type="button" onClick={convert}>{tl("Convertir les points en bonus")}</button>
          </div>
        </>
      )}
    </div>
  );
}
