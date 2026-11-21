/**
 * QR code interopérable PI-SPI de la BCEAO (0.35) : paiement instantané depuis n'importe quelle banque, microfinance
 * ou portefeuille électronique de l'UEMOA vers l'alias du marchand.
 *
 * Format EMV « présenté par le marchand » (spécification BCEAO, developer.pispi.bceao.int → QR Code PI-SPI) :
 *   00 01 · 36 { 00 int.bceao.pi · 01 alias } · 52 0000 · 53 952 (FCFA) · 54 montant (facultatif) · 58 pays ·
 *   59 X · 60 X · 62 { 05 référence (facultatif) · 11 canal } · 63 CRC16-CCITT.
 * Canal : 000 = QR fixe (avec ou sans montant), 400 = QR unique d'un paiement (référence obligatoire).
 * Le QR se fabrique sans Internet ni API : seul l'alias du compte (36 caractères) est nécessaire.
 * Le payeur voit le nom du titulaire de l'alias dans son application (annuaire de la BCEAO), d'où « X » en 59 et 60.
 */

export const PISPI_GUI = "int.bceao.pi";
/** Code ISO 4217 du franc CFA (XOF). */
export const PISPI_CURRENCY = "952";

/** Alias PI-SPI : identifiant de 36 caractères (UUID), visible dans l'application de la banque ou du portefeuille. */
const ALIAS_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPispiAlias(s: string | null | undefined): boolean {
  return !!s && ALIAS_RE.test(s.trim());
}

/** Champs TLV (identifiant sur 2 chiffres, longueur sur 2 chiffres, valeur). */
function tlv(id: string, value: string): string {
  if (value.length > 99) throw new Error(`PI-SPI : champ ${id} trop long`);
  return id + String(value.length).padStart(2, "0") + value;
}

function parseTlv(s: string): Map<string, string> {
  const out = new Map<string, string>();
  let i = 0;
  while (i + 4 <= s.length) {
    const id = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    if (!/^\d{2}$/.test(s.slice(i + 2, i + 4)) || i + 4 + len > s.length) break;
    out.set(id, s.slice(i + 4, i + 4 + len));
    i += 4 + len;
  }
  return out;
}

/** CRC16-CCITT (polynôme 0x1021, valeur initiale 0xFFFF) sur les octets UTF-8, en 4 chiffres hexadécimaux. */
export function crc16(data: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(data)) {
    crc ^= byte << 8;
    for (let k = 0; k < 8; k++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Alias tiré de ce que la personne colle : l'alias lui-même, ou le texte complet d'un QR PI-SPI
 * (bouton « Copier » ou « Partager » de l'application de la banque ou du portefeuille).
 */
export function pispiAliasFrom(text: string | null | undefined): string | null {
  const t = (text ?? "").trim();
  if (isPispiAlias(t)) return t.toLowerCase();
  if (!t.startsWith("000201")) return null;
  const account = parseTlv(t).get("36");
  if (!account) return null;
  const sub = parseTlv(account);
  const alias = sub.get("01") ?? "";
  return sub.get("00") === PISPI_GUI && isPispiAlias(alias) ? alias.toLowerCase() : null;
}

/** Référence d'un paiement (champ 62-05, 25 caractères au plus) : « GM » + date en base 36 + hasard. */
export function pispiReference(prefix = "GM"): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join("");
  return (prefix + Date.now().toString(36) + rand).toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 25);
}

export interface PispiQrInput {
  alias: string;
  /** Montant en francs CFA (entier). Absent : le payeur saisit le montant. */
  amount?: number | null;
  /** Référence du paiement (lettres et chiffres). Avec une référence, le QR est unique (canal 400). */
  reference?: string | null;
  /** Pays du marchand (ISO 3166, 2 lettres) : ML par défaut. */
  country?: string | null;
}

/** Texte du QR PI-SPI à encoder dans le QR code. */
export function pispiPayload({ alias, amount, reference, country }: PispiQrInput): string {
  const a = alias.trim().toLowerCase();
  if (!isPispiAlias(a)) throw new Error("Alias PI-SPI invalide");
  const ref = (reference ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 25);
  const amt = amount != null && Number.isFinite(amount) && amount > 0 ? String(Math.round(amount)) : "";
  const cc = /^[A-Za-z]{2}$/.test(country ?? "") ? (country as string).toUpperCase() : "ML";
  const body =
    tlv("00", "01") +
    tlv("36", tlv("00", PISPI_GUI) + tlv("01", a)) +
    tlv("52", "0000") +
    tlv("53", PISPI_CURRENCY) +
    (amt ? tlv("54", amt) : "") +
    tlv("58", cc) +
    tlv("59", "X") +
    tlv("60", "X") +
    tlv("62", (ref ? tlv("05", ref) : "") + tlv("11", ref ? "400" : "000")) +
    "6304";
  return body + crc16(body);
}

/** Vérifie le contrôle CRC d'un texte de QR (fin « 6304XXXX »). */
export function pispiCrcOk(payload: string): boolean {
  return /6304[0-9A-F]{4}$/.test(payload) && crc16(payload.slice(0, -4)) === payload.slice(-4);
}
