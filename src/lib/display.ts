import { api } from "../api";
import { posteName } from "./transport";

/** Contenu affiché sur l'écran client (2ᵉ écran, TV, projecteur). */
export interface DisplayLine {
  name: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  discount: number;
  image_id: number | null;
}

export interface DisplayState {
  status: "idle" | "cart" | "payment" | "done";
  lines: DisplayLine[];
  items_count: number;
  subtotal: number;
  discount: number;
  total: number;
  customer: string | null;
  /** Paiement en cours */
  method?: string | null;
  paid?: number;
  remaining?: number;
  change?: number;
  show_om_qr?: boolean;
  /** Vente terminée */
  sale_number?: string;
  at: number;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let last = "";

/** Envoie l'état du ticket à l'écran client (regroupe les envois rapprochés). */
export function publishDisplay(state: Omit<DisplayState, "at">) {
  const json = JSON.stringify(state);
  if (json === last) return;
  last = json;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    api.displayUpdate(posteName(), { ...state, at: Date.now() }).catch(() => undefined);
  }, 120);
}

export const IDLE_DISPLAY: Omit<DisplayState, "at"> = {
  status: "idle",
  lines: [],
  items_count: 0,
  subtotal: 0,
  discount: 0,
  total: 0,
  customer: null,
};
