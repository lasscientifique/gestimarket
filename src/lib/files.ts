import { save } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { tl } from "./i18n";

/** Demande un emplacement à l'utilisateur puis enregistre un fichier CSV. Retourne false si annulé. */
export async function exportCsv(defaultName: string, contents: string): Promise<boolean> {
  const path = await save({
    title: tl("Exporter en CSV"),
    defaultPath: defaultName,
    filters: [{ name: "Fichier CSV (Excel)", extensions: ["csv"] }],
  });
  if (!path) return false;
  await api.saveTextFile(path, contents);
  return true;
}
