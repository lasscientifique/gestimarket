import { useEffect, useState } from "react";
import { Printer, RefreshCw, Save } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Field } from "./ui";
import { drawerEscpos, testPageEscpos } from "../lib/escpos";
import { listPrinters, printerConfig, savePrinterConfig, sendToPrinter, type PrinterConfig } from "../lib/printer";
import { tl } from "../lib/i18n";
import { isMobileApp } from "../lib/transport";

/** Imprimante réseau (ESC/POS, port 9100) : « 192.168.1.50 », « 192.168.1.50:9100 » ou « tcp://nom:9100 ». */
const NETWORK = /^(tcp:\/\/\S+|\d{1,3}(\.\d{1,3}){3}(:\d{1,5})?)$/;
export const isNetworkPrinter = (p: string) => NETWORK.test(p.trim());
const NET_OPTION = "__reseau__";

/** Paramètres → Ventes : imprimante à tickets de CE poste (chaque caisse a la sienne). */
export function PrinterSettings() {
  const { settings, toast } = useApp();
  const [config, setConfig] = useState<PrinterConfig>({ printer: "", auto_print: true, open_drawer: false });
  const [printers, setPrinters] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Téléphone et tablette : seulement des imprimantes réseau (pas de pilote d'imprimante).
  const [network, setNetwork] = useState(isMobileApp);

  const loadPrinters = () => {
    if (isMobileApp) return setPrinters([]);
    setPrinters(null);
    listPrinters().then(setPrinters).catch((e) => {
      setPrinters([]);
      toast.error(e);
    });
  };
  useEffect(() => {
    printerConfig().then((c) => {
      if (!c) return;
      setConfig(c);
      if (isNetworkPrinter(c.printer)) setNetwork(true);
    });
    loadPrinters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (network && config.printer && !isNetworkPrinter(config.printer)) {
      toast.error(tl("Adresse IP de l'imprimante invalide (ex. 192.168.1.50)."));
      return;
    }
    try {
      await savePrinterConfig(config);
      toast.success(tl("Imprimante de ce poste enregistrée."));
    } catch (e) {
      toast.error(e);
    }
  };

  const run = async (bytes: Uint8Array, done: string) => {
    if (!config.printer) {
      toast.error(tl("Choisissez d'abord l'imprimante à tickets."));
      return;
    }
    setBusy(true);
    try {
      await savePrinterConfig(config);
      await sendToPrinter(bytes);
      toast.success(done);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const options = printers ?? [];
  const missing = config.printer && printers && !printers.includes(config.printer) && !isNetworkPrinter(config.printer);

  return (
    <div className="card">
      <h3 className="card-title"><Printer size={18} />  {tl("Imprimante à tickets de ce poste")}</h3>
      <p className="muted">
        {isMobileApp
          ? tl("Sur téléphone ou tablette, le ticket est envoyé directement à une imprimante thermique réseau (Wi-Fi ou câble, ESC/POS), et le papier est coupé. Ce réglage est propre à cet appareil.")
          : tl("Le ticket sort directement sur l'imprimante thermique, sans fenêtre d'impression, et le papier est coupé. Le tiroir-caisse branché sur l'imprimante peut s'ouvrir tout seul. Ce réglage est propre à ce PC : chaque caisse choisit la sienne.")}
      </p>
      <div className="form-grid">
        {!isMobileApp && (
          <Field label={tl("Imprimante")} span={2}>
            <div className="input-group">
              <select
                value={network ? NET_OPTION : config.printer}
                onChange={(e) => {
                  const v = e.target.value;
                  setNetwork(v === NET_OPTION);
                  setConfig({ ...config, printer: v === NET_OPTION ? (isNetworkPrinter(config.printer) ? config.printer : "") : v });
                }}
              >
                <option value="">{tl("Aucune : fenêtre d'impression de Windows")}</option>
                {missing && !network && <option value={config.printer}>{tl("{0} (introuvable)", [config.printer])}</option>}
                {options.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value={NET_OPTION}>{tl("Imprimante réseau (adresse IP)…")}</option>
              </select>
              <button className="btn" type="button" onClick={loadPrinters} title={tl("Actualiser la liste")}><RefreshCw size={16} /></button>
            </div>
          </Field>
        )}
        {network && (
          <Field
            label={tl("Adresse IP de l'imprimante")}
            span={2}
            hint={tl("Port 9100 par défaut. La plupart des imprimantes impriment leur adresse si l'on garde le bouton FEED appuyé en les allumant.")}
          >
            <input
              value={config.printer}
              inputMode="decimal"
              placeholder="192.168.1.50"
              onChange={(e) => setConfig({ ...config, printer: e.target.value.trim() })}
            />
          </Field>
        )}
      </div>
      {!network && printers !== null && printers.length === 0 && (
        <div className="alert alert-info">{tl("Aucune imprimante trouvée sur ce PC : installez le pilote de l'imprimante à tickets (fourni avec elle), puis actualisez la liste.")}</div>
      )}
      <div className="checks">
        <label className="check">
          <input type="checkbox" checked={config.auto_print} disabled={!config.printer} onChange={(e) => setConfig({ ...config, auto_print: e.target.checked })} />
          {tl("Imprimer le ticket tout seul après chaque vente")}</label>
        <label className="check">
          <input type="checkbox" checked={config.open_drawer} disabled={!config.printer} onChange={(e) => setConfig({ ...config, open_drawer: e.target.checked })} />
          {tl("Ouvrir le tiroir-caisse quand le client paie en espèces")}</label>
      </div>
      <div className="row-start" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={save}><Save size={16} />  {tl("Enregistrer")}</button>
        <button className="btn" disabled={busy || !config.printer} onClick={() => run(testPageEscpos(settings, config.printer, config.open_drawer), tl("Page de test envoyée."))}>
          <Printer size={16} />  {tl("Imprimer une page de test")}</button>
        <button className="btn" disabled={busy || !config.printer} onClick={() => run(drawerEscpos(), tl("Tiroir-caisse ouvert."))}>
          {tl("Ouvrir le tiroir")}</button>
      </div>
      {!isMobileApp && (
        <p className="muted small" style={{ marginTop: 8 }}>
          {tl("Si la page de test sort avec des caractères bizarres, l'imprimante n'accepte pas l'impression directe : laissez « Aucune » et utilisez la fenêtre d'impression.")}
        </p>
      )}
    </div>
  );
}
