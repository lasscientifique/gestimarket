import { useEffect, useState } from "react";
import { Printer, RefreshCw, Save } from "lucide-react";
import { useApp } from "../context/AppContext";
import { Field } from "./ui";
import { drawerEscpos, testPageEscpos } from "../lib/escpos";
import { listPrinters, printerConfig, savePrinterConfig, sendToPrinter, type PrinterConfig } from "../lib/printer";
import { tl } from "../lib/i18n";

/** Paramètres → Ventes : imprimante à tickets de CE poste (chaque caisse a la sienne). */
export function PrinterSettings() {
  const { settings, toast } = useApp();
  const [config, setConfig] = useState<PrinterConfig>({ printer: "", auto_print: true, open_drawer: false });
  const [printers, setPrinters] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPrinters = () => {
    setPrinters(null);
    listPrinters().then(setPrinters).catch((e) => {
      setPrinters([]);
      toast.error(e);
    });
  };
  useEffect(() => {
    printerConfig().then((c) => c && setConfig(c));
    loadPrinters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
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
  const missing = config.printer && printers && !printers.includes(config.printer);

  return (
    <div className="card">
      <h3 className="card-title"><Printer size={18} />  {tl("Imprimante à tickets de ce poste")}</h3>
      <p className="muted">
        {tl("Le ticket sort directement sur l'imprimante thermique, sans fenêtre d'impression, et le papier est coupé. Le tiroir-caisse branché sur l'imprimante peut s'ouvrir tout seul. Ce réglage est propre à ce PC : chaque caisse choisit la sienne.")}
      </p>
      <div className="form-grid">
        <Field label={tl("Imprimante")} span={2}>
          <div className="input-group">
            <select value={config.printer} onChange={(e) => setConfig({ ...config, printer: e.target.value })}>
              <option value="">{tl("Aucune : fenêtre d'impression de Windows")}</option>
              {missing && <option value={config.printer}>{tl("{0} (introuvable)", [config.printer])}</option>}
              {options.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <button className="btn" type="button" onClick={loadPrinters} title={tl("Actualiser la liste")}><RefreshCw size={16} /></button>
          </div>
        </Field>
      </div>
      {printers !== null && printers.length === 0 && (
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
      <p className="muted small" style={{ marginTop: 8 }}>
        {tl("Si la page de test sort avec des caractères bizarres, l'imprimante n'accepte pas l'impression directe : laissez « Aucune » et utilisez la fenêtre d'impression.")}
      </p>
    </div>
  );
}
