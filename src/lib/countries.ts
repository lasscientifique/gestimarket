// Pays (ISO 3166) et devises (ISO 4217) : noms, décimales et symboles fournis par le navigateur (Intl),
// dans la langue de l'interface. Seule la devise usuelle de chaque pays est décrite ici.
import { getLang, locale } from "./i18n";

const COUNTRY_CURRENCY =
  "AD:EUR AE:AED AF:AFN AG:XCD AI:XCD AL:ALL AM:AMD AO:AOA AR:ARS AS:USD AT:EUR AU:AUD AW:AWG AX:EUR AZ:AZN BA:BAM BB:BBD " +
  "BD:BDT BE:EUR BF:XOF BG:BGN BH:BHD BI:BIF BJ:XOF BL:EUR BM:BMD BN:BND BO:BOB BQ:USD BR:BRL BS:BSD BT:BTN BW:BWP BY:BYN BZ:BZD " +
  "CA:CAD CC:AUD CD:CDF CF:XAF CG:XAF CH:CHF CI:XOF CK:NZD CL:CLP CM:XAF CN:CNY CO:COP CR:CRC CU:CUP CV:CVE CW:ANG CX:AUD CY:EUR " +
  "CZ:CZK DE:EUR DJ:DJF DK:DKK DM:XCD DO:DOP DZ:DZD EC:USD EE:EUR EG:EGP EH:MAD ER:ERN ES:EUR ET:ETB FI:EUR FJ:FJD FK:FKP FM:USD " +
  "FO:DKK FR:EUR GA:XAF GB:GBP GD:XCD GE:GEL GF:EUR GG:GBP GH:GHS GI:GIP GL:DKK GM:GMD GN:GNF GP:EUR GQ:XAF GR:EUR GT:GTQ GU:USD " +
  "GW:XOF GY:GYD HK:HKD HN:HNL HR:EUR HT:HTG HU:HUF ID:IDR IE:EUR IL:ILS IM:GBP IN:INR IQ:IQD IR:IRR IS:ISK IT:EUR JE:GBP JM:JMD " +
  "JO:JOD JP:JPY KE:KES KG:KGS KH:KHR KI:AUD KM:KMF KN:XCD KP:KPW KR:KRW KW:KWD KY:KYD KZ:KZT LA:LAK LB:LBP LC:XCD LI:CHF LK:LKR " +
  "LR:LRD LS:LSL LT:EUR LU:EUR LV:EUR LY:LYD MA:MAD MC:EUR MD:MDL ME:EUR MF:EUR MG:MGA MH:USD MK:MKD ML:XOF MM:MMK MN:MNT MO:MOP " +
  "MP:USD MQ:EUR MR:MRU MS:XCD MT:EUR MU:MUR MV:MVR MW:MWK MX:MXN MY:MYR MZ:MZN NA:NAD NC:XPF NE:XOF NF:AUD NG:NGN NI:NIO NL:EUR " +
  "NO:NOK NP:NPR NR:AUD NU:NZD NZ:NZD OM:OMR PA:PAB PE:PEN PF:XPF PG:PGK PH:PHP PK:PKR PL:PLN PM:EUR PN:NZD PR:USD PS:ILS PT:EUR " +
  "PW:USD PY:PYG QA:QAR RE:EUR RO:RON RS:RSD RU:RUB RW:RWF SA:SAR SB:SBD SC:SCR SD:SDG SE:SEK SG:SGD SH:SHP SI:EUR SK:EUR SL:SLE " +
  "SM:EUR SN:XOF SO:SOS SR:SRD SS:SSP ST:STN SV:USD SX:ANG SY:SYP SZ:SZL TC:USD TD:XAF TG:XOF TH:THB TJ:TJS TK:NZD TL:USD TM:TMT " +
  "TN:TND TO:TOP TR:TRY TT:TTD TV:AUD TW:TWD TZ:TZS UA:UAH UG:UGX US:USD UY:UYU UZ:UZS VA:EUR VC:XCD VE:VES VG:USD VI:USD VN:VND " +
  "VU:VUV WF:XPF WS:WST XK:EUR YE:YER YT:EUR ZA:ZAR ZM:ZMW ZW:ZWL";

const CURRENCY_OF: Record<string, string> = Object.fromEntries(COUNTRY_CURRENCY.split(" ").map((p) => p.split(":")));

export const COUNTRY_CODES = Object.keys(CURRENCY_OF);

/** Devise usuelle d'un pays (XOF pour le Mali). */
export const currencyOf = (country: string): string => CURRENCY_OF[country] ?? "USD";

function displayNames(type: "region" | "currency") {
  try {
    return new Intl.DisplayNames([getLang()], { type });
  } catch {
    return null;
  }
}

/** Nom d'un pays dans la langue de l'interface (« XX » ou code inconnu : libellé fourni). */
export function countryName(code: string, fallback: string): string {
  if (!/^[A-Z]{2}$/.test(code) || code === "XX") return fallback;
  return displayNames("region")?.of(code) ?? fallback;
}

/** Pays triés par nom dans la langue de l'interface. */
export function countryOptions(): { code: string; label: string }[] {
  const names = displayNames("region");
  return COUNTRY_CODES.map((code) => ({ code, label: names?.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label, getLang()));
}

/** Toutes les devises connues du navigateur, triées par nom. */
export function currencyOptions(): { code: string; label: string }[] {
  const names = displayNames("currency");
  let codes: string[];
  try {
    codes = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("currency") ?? [];
  } catch {
    codes = [];
  }
  if (!codes.length) codes = [...new Set(Object.values(CURRENCY_OF))];
  return codes.map((code) => ({ code, label: `${names?.of(code) ?? code} (${code})` })).sort((a, b) => a.label.localeCompare(b.label, getLang()));
}

/** Décimales usuelles d'une devise (0 pour le FCFA, 2 pour l'euro, 3 pour le dinar koweïtien). */
export function currencyDecimals(code: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Symbole affiché : « FCFA » pour le franc CFA, sinon le symbole court usuel ($, €, ₦, GH₵…). */
export function currencySymbolOf(code: string): string {
  if (code === "XOF" || code === "XAF") return "FCFA";
  try {
    const parts = new Intl.NumberFormat(locale(), { style: "currency", currency: code, currencyDisplay: "narrowSymbol" }).formatToParts(1);
    return parts.find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/** Symbole avant (« $ 12 ») ou après (« 12 FCFA ») le montant, selon l'usage du pays et de la langue. */
export function currencyPositionOf(code: string, country: string): "before" | "after" {
  if (code === "XOF" || code === "XAF") return "after";
  try {
    const parts = new Intl.NumberFormat(`${getLang()}-${country}`, { style: "currency", currency: code }).formatToParts(1);
    const c = parts.findIndex((p) => p.type === "currency");
    const n = parts.findIndex((p) => p.type === "integer");
    return c >= 0 && c < n ? "before" : "after";
  } catch {
    return "after";
  }
}
