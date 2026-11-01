import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { QrCode } from "lucide-react";
import { useApp } from "../context/AppContext";
import { mediaUrl } from "../lib/media";

/**
 * QR code marchand Orange Money / Sarali affiché au client pour qu'il paie en scannant.
 * Priorité : photo du QR officiel (autocollant marchand) > contenu texte du QR > rien.
 */
export function OrangeMoneyQr({ size = 190 }: { size?: number }) {
  const { settings } = useApp();
  const [generated, setGenerated] = useState<string | null>(null);
  const imageId = Number(settings.om_qr_image_id || 0) || null;
  const payload = (settings.om_qr_payload ?? "").trim();

  useEffect(() => {
    if (imageId || !payload) return setGenerated(null);
    QRCode.toDataURL(payload, { margin: 1, width: size * 2, errorCorrectionLevel: "M" })
      .then(setGenerated)
      .catch(() => setGenerated(null));
  }, [imageId, payload, size]);

  const src = imageId ? mediaUrl(imageId) : generated;
  return (
    <div className="om-qr" style={{ width: size }}>
      {src ? (
        <img src={src} alt="QR code marchand" style={{ width: size, height: size }} />
      ) : (
        <div className="om-qr-empty" style={{ width: size, height: size }}>
          <QrCode size={40} strokeWidth={1.4} />
          <span>QR marchand non configuré</span>
          <span className="small">Paramètres → Orange Money</span>
        </div>
      )}
      {settings.om_merchant_number && (
        <div className="om-merchant">
          <span>N° marchand</span>
          <strong>{settings.om_merchant_number}</strong>
          {settings.om_merchant_name && <span className="small">{settings.om_merchant_name}</span>}
        </div>
      )}
    </div>
  );
}
