import { useEffect, useState, type CSSProperties } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { useApp } from "../context/AppContext";
import { mediaUrl } from "../lib/media";
import { tl } from "../lib/i18n";
import { operatorOf, parseOperators } from "../lib/mobile";

/**
 * QR code marchand affiché au client pour qu'il paie en scannant.
 * Priorité : photo du QR officiel (autocollant marchand) > contenu texte du QR > rien.
 */
export function MerchantQr({
  size = 190,
  imageId,
  payload,
  merchant,
  merchantName,
  hint,
}: {
  size?: number;
  imageId: number | null;
  payload: string;
  merchant: string;
  merchantName: string;
  hint: string;
}) {
  const [generated, setGenerated] = useState<string | null>(null);
  const text = payload.trim();

  useEffect(() => {
    if (imageId || !text) return setGenerated(null);
    QRCode.toDataURL(text, { margin: 1, width: size * 2, errorCorrectionLevel: "M" })
      .then(setGenerated)
      .catch(() => setGenerated(null));
  }, [imageId, text, size]);

  const src = imageId ? mediaUrl(imageId) : generated;
  return (
    <div className="om-qr" style={{ width: size }}>
      {src ? (
        <img src={src} alt={tl("QR code marchand")} style={{ width: size, height: size }} />
      ) : (
        <div className="om-qr-empty" style={{ width: size, height: size }}>
          <QrCode size={40} strokeWidth={1.4} />
          <span>{tl("QR marchand non configuré")}</span>
          <span className="small">{hint}</span>
        </div>
      )}
      {merchant && (
        <div className="om-merchant">
          <span>{tl("N° marchand")}</span>
          <strong>{merchant}</strong>
          {merchantName && <span className="small">{merchantName}</span>}
        </div>
      )}
    </div>
  );
}

/** QR code marchand Orange Money / Sarali (Paramètres → Paiements). */
export function OrangeMoneyQr({ size = 190 }: { size?: number }) {
  const { settings } = useApp();
  return (
    <MerchantQr
      size={size}
      imageId={Number(settings.om_qr_image_id || 0) || null}
      payload={settings.om_qr_payload ?? ""}
      merchant={settings.om_merchant_number ?? ""}
      merchantName={settings.om_merchant_name ?? ""}
      hint={tl("Paramètres → Orange Money")}
    />
  );
}

/** QR code du moyen de paiement choisi : Orange Money ou un opérateur configuré (« mm:<id> »). */
export function PaymentQr({ method, size = 190 }: { method: string; size?: number }) {
  const { settings } = useApp();
  if (method === "orange_money") return <OrangeMoneyQr size={size} />;
  const op = operatorOf(method, parseOperators(settings.mobile_operators));
  if (!op) return null;
  return (
    <MerchantQr
      size={size}
      imageId={op.qr_image_id}
      payload={op.qr_payload}
      merchant={op.merchant}
      merchantName={op.merchant_name}
      hint={tl("Paramètres → Paiements")}
    />
  );
}

/** Couleurs du panneau de paiement : orange pour Orange Money, couleur de l'opérateur sinon. */
export function operatorTheme(color: string | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    "--om": color,
    "--om-soft": `color-mix(in srgb, ${color} 12%, var(--surface))`,
    "--om-text": `color-mix(in srgb, ${color} 60%, var(--text))`,
  } as CSSProperties;
}
