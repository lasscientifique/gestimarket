/**
 * Opérateurs de mobile money proposés en caisse en plus d'Orange Money (paramètre « mobile_operators »,
 * liste JSON). Le mode de paiement d'un opérateur est « mm:<id> » (ex. « mm:wave »).
 */
export interface MobileOperator {
  id: string;
  name: string;
  /** Numéro marchand (ou code marchand) affiché au client. */
  merchant: string;
  merchant_name: string;
  /** Contenu texte du QR marchand, si connu (sinon photo : qr_image_id). */
  qr_payload: string;
  qr_image_id: number | null;
  /** ID de transaction obligatoire à l'encaissement. */
  require_ref: boolean;
  enabled: boolean;
  color: string;
}

/** Opérateurs courants (Afrique de l'Ouest, centrale et de l'Est) proposés à l'ajout. */
export const OPERATOR_PRESETS: { id: string; name: string; color: string }[] = [
  { id: "wave", name: "Wave", color: "#1dc8f2" },
  { id: "moov", name: "Moov Money", color: "#0063b0" },
  { id: "mtn", name: "MTN MoMo", color: "#f5b800" },
  { id: "airtel", name: "Airtel Money", color: "#e40000" },
  { id: "mpesa", name: "M-Pesa", color: "#4caf50" },
  { id: "free", name: "Free Money", color: "#cd1e25" },
  { id: "mixx", name: "Mixx by Yas", color: "#ffcc00" },
  { id: "tmoney", name: "T-Money", color: "#ffd500" },
  { id: "flooz", name: "Flooz", color: "#00a3e0" },
  { id: "celtiis", name: "Celtiis Cash", color: "#00a859" },
  { id: "telecel", name: "Telecel Money", color: "#d9232e" },
];

export function newOperator(id: string, name: string, color = "#6366f1"): MobileOperator {
  return { id, name, merchant: "", merchant_name: "", qr_payload: "", qr_image_id: null, require_ref: true, enabled: true, color };
}

/** Liste des opérateurs enregistrés (valeurs manquantes complétées). */
export function parseOperators(setting: string | undefined): MobileOperator[] {
  if (!setting?.trim()) return [];
  try {
    const list = JSON.parse(setting);
    if (!Array.isArray(list)) return [];
    return list
      .filter((o) => o && typeof o.id === "string" && typeof o.name === "string")
      .map((o) => ({ ...newOperator(o.id, o.name), ...o, enabled: o.enabled !== false, require_ref: !!o.require_ref }));
  } catch {
    return [];
  }
}

/** Opérateur d'un mode de paiement « mm:<id> ». */
export function operatorOf(method: string | null | undefined, operators: MobileOperator[]): MobileOperator | null {
  if (!method?.startsWith("mm:")) return null;
  const id = method.slice(3);
  return operators.find((o) => o.id === id) ?? null;
}

/** Identifiant libre dérivé du nom (« Orange Money CI » → « orange-money-ci »). */
export function operatorId(name: string, taken: string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 16) || "op";
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}
