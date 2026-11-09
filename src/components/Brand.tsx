import { Store } from "lucide-react";
import { useApp } from "../context/AppContext";
import { mediaUrl } from "../lib/media";

/** Logo du commerce (ou icône par défaut si aucun logo n'est défini). */
export function BrandLogo({ size = 40, className = "" }: { size?: number; className?: string }) {
  const { settings } = useApp();
  const logo = mediaUrl(Number(settings.shop_logo_id || 0) || null, 160);
  return (
    <div className={`brand-mark ${logo ? "has-logo" : ""} ${className}`} style={{ width: size, height: size, borderRadius: size * 0.28 }}>
      {logo ? <img src={logo} alt="" /> : <Store size={size * 0.5} />}
    </div>
  );
}
