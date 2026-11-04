import type { Sale, Settings } from "../types";
import { drawerEscpos, receiptEscpos, toBase64 } from "./escpos";
import { isTauri, local } from "./transport";

/** Imprimante à tickets de ce poste (fichier « imprimante.json » du PC, propre à chaque caisse). */
export interface PrinterConfig {
  /** Vide : fenêtre d'impression habituelle. */
  printer: string;
  auto_print: boolean;
  open_drawer: boolean;
}

export async function printerConfig(): Promise<PrinterConfig | null> {
  if (!isTauri) return null;
  try {
    return await local<PrinterConfig>("printer_get_config");
  } catch {
    return null;
  }
}

export const listPrinters = () => local<string[]>("printer_list");
export const savePrinterConfig = (config: PrinterConfig) => local<void>("printer_save_config", { config });
export const sendToPrinter = (bytes: Uint8Array) => local<void>("printer_send", { data: toBase64(bytes) });

/** Après une vente : ticket imprimé tout seul et tiroir ouvert si des espèces ont été encaissées (selon le réglage). */
export async function afterSalePrint(sale: Sale, settings: Settings): Promise<void> {
  const pc = await printerConfig();
  if (!pc?.printer) return;
  const drawer = pc.open_drawer && sale.payments.some((p) => p.method === "cash");
  if (pc.auto_print) await sendToPrinter(receiptEscpos(sale, settings, { drawer }));
  else if (drawer) await sendToPrinter(drawerEscpos());
}
