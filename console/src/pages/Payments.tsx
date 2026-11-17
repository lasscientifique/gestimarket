import { useState } from "react";
import { Check, FileDown, RefreshCw, Search, Store, TriangleAlert, X } from "lucide-react";
import type { Me, Nav } from "../App";
import { rpc, saveText } from "../lib/sb";
import { dateTime, METHOD, money, PAY_STATUS, toCsv } from "../lib/fmt";
import { ActionModal, Badge, Empty, ErrorBox, Spinner, useLoad, useToast } from "../ui";

export type PaymentRow = {
  id: string; created_at: string; validated_at: string | null; method: string; amount: number; currency: string; status: string; reference: string;
  payer_phone: string; note: string; provider_ref: string; store_id: string; store_code: string; store_name: string; owner_name: string;
  store_phone: string; plan: string; plan_label: string; months: number; starts_at: string | null; ends_at: string | null; dup_ref: boolean; test: boolean;
};

export function Payments({ me, nav }: { me: Me; nav: Nav }) {
  const toast = useToast();
  const [status, setStatus] = useState("declared");
  const [method, setMethod] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [refuse, setRefuse] = useState<PaymentRow | null>(null);
  const [busyId, setBusyId] = useState("");
  const { data, error, busy, reload } = useLoad(
    () => rpc<PaymentRow[]>("gm_console_payments", { p_status: status, p_method: method, p_search: search, p_from: from || null, p_to: to || null }),
    [status, method, search, from, to],
  );
  const canDecide = me.role !== "assistance";

  const validate = async (p: PaymentRow) => {
    if (!window.confirm(`Valider ${money(p.amount)} ${METHOD[p.method] ?? p.method} (réf. ${p.reference}) de ${p.store_name} ?\n\nVérifiez d'abord que l'argent est bien arrivé (SMS de l'opérateur).`)) return;
    setBusyId(p.id);
    try {
      await rpc("gm_console_payment_decide", { p_payment_id: p.id, p_decision: "validate", p_reason: "" });
      toast.ok(`Paiement de ${p.store_name} validé : la licence part toute seule.`);
      reload();
    } catch (e) {
      toast.fail(e);
    } finally {
      setBusyId("");
    }
  };

  const exportCsv = async () => {
    if (!data?.length) return;
    const rows = data.map((p) => ({ ...p, method: METHOD[p.method] ?? p.method, status: PAY_STATUS[p.status]?.[0] ?? p.status, created_at: dateTime(p.created_at), validated_at: dateTime(p.validated_at), test: p.test ? "oui" : "" }));
    const csv = toCsv(rows, [
      ["created_at", "Date"], ["store_code", "Boutique"], ["store_name", "Nom"], ["plan_label", "Formule"], ["months", "Mois"], ["method", "Moyen"],
      ["amount", "Montant"], ["currency", "Devise"], ["reference", "Référence"], ["payer_phone", "Numéro payeur"], ["status", "État"],
      ["validated_at", "Validé le"], ["note", "Note"], ["test", "Essai"],
    ]);
    try {
      const path = await saveText(`paiements-gestimarket-${new Date().toISOString().slice(0, 10)}.csv`, csv, [{ name: "CSV", extensions: ["csv"] }]);
      if (path) toast.ok("Fichier CSV enregistré.");
    } catch (e) {
      toast.fail(e);
    }
  };

  const total = (data ?? []).filter((p) => p.status === "validated" && !p.test).reduce((s, p) => s + Number(p.amount), 0);

  return (
    <div className="stack-lg">
      <div className="chips">
        {[["declared", "À valider"], ["validated", "Validés"], ["refused", "Refusés"], ["pending", "Carte en cours"], ["", "Tous"]].map(([k, l]) => (
          <button key={k} className={`chip-btn${status === k ? " active" : ""}`} onClick={() => setStatus(k)}>
            {l}
          </button>
        ))}
      </div>
      <form className="toolbar wrap" onSubmit={(e) => (e.preventDefault(), setSearch(q))}>
        <div className="search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Boutique, référence, numéro" />
        </div>
        <select value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Moyen de paiement">
          <option value="">Tous les moyens</option>
          {Object.entries(METHOD).filter(([k]) => k !== "offert").map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Du" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Au" />
        <button className="btn">Chercher</button>
        <button type="button" className="btn" onClick={reload} disabled={busy} aria-label="Actualiser">
          <RefreshCw size={15} />
        </button>
        <button type="button" className="btn" onClick={exportCsv} disabled={!data?.length}>
          <FileDown size={15} /> CSV
        </button>
      </form>
      {status === "declared" && (
        <p className="muted small">
          Avant de valider : vérifiez sur le téléphone marchand (SMS Orange Money, Wave ou Moov) que le montant est bien arrivé avec cette
          référence. La validation envoie la licence toute seule.
        </p>
      )}
      {error && <ErrorBox error={error} retry={reload} />}
      {!data ? (
        <Spinner />
      ) : !data.length ? (
        <Empty>{status === "declared" ? "Aucun paiement à valider." : "Aucun paiement."}</Empty>
      ) : (
        <>
          {status !== "declared" && <p className="muted small">{data.length} paiement(s) · validés (hors TEST) : {money(total)}</p>}
          <div className="pay-list">
            {data.map((p) => (
              <article key={p.id} className={`pay-card${p.dup_ref ? " pay-dup" : ""}`}>
                <div className="pay-main">
                  <div>
                    <strong>{money(p.amount, p.currency)}</strong> · {METHOD[p.method] ?? p.method}{" "}
                    <Badge tone={PAY_STATUS[p.status]?.[1]}>{PAY_STATUS[p.status]?.[0] ?? p.status}</Badge> {p.test && <Badge>TEST</Badge>}
                  </div>
                  <div>
                    {p.plan_label} · {p.months} mois — <button className="link-btn" onClick={() => nav("stores", p.store_id)}><Store size={13} /> {p.store_name} ({p.store_code})</button>
                  </div>
                  <div className="muted small">
                    Réf. <span className="mono">{p.reference || "—"}</span>
                    {p.payer_phone && ` · payé par ${p.payer_phone}`} · {dateTime(p.created_at)}
                    {p.validated_at && ` · validé ${dateTime(p.validated_at)}`}
                  </div>
                  {p.note && <div className="muted small">{p.note}</div>}
                  {p.dup_ref && (
                    <div className="alert alert-danger small">
                      <TriangleAlert size={15} /> Cette référence apparaît dans un autre paiement : vérifiez avant de valider.
                    </div>
                  )}
                </div>
                {p.status === "declared" && canDecide && (
                  <div className="pay-actions">
                    <button className="btn btn-primary" disabled={busyId === p.id} onClick={() => validate(p)}>
                      <Check size={16} /> Valider
                    </button>
                    <button className="btn btn-danger-outline" disabled={busyId === p.id} onClick={() => setRefuse(p)}>
                      <X size={16} /> Refuser
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {refuse && (
        <ActionModal
          title={`Refuser le paiement de ${refuse.store_name}`}
          intro={`${money(refuse.amount)} ${METHOD[refuse.method] ?? refuse.method}, réf. ${refuse.reference}. Le motif est affiché à la boutique dans « Mes paiements ».`}
          reasonLabel="Motif visible par la boutique *"
          confirm="Refuser"
          danger
          onClose={() => setRefuse(null)}
          onSubmit={async (_v, reason) => {
            await rpc("gm_console_payment_decide", { p_payment_id: refuse.id, p_decision: "refuse", p_reason: reason });
            toast.ok("Paiement refusé.");
            reload();
          }}
        />
      )}
    </div>
  );
}
