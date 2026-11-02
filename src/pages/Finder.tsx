import { PageHeader } from "../components/ui";
import { ProductFinder } from "../components/ProductFinder";
import { tl } from "../lib/i18n";

export default function FinderPage() {
  return (
    <div className="page">
      <PageHeader
        help="finder"
        title={tl("Localiser un produit")}
        subtitle={<>{tl("Retrouvez en quelques secondes le meuble, l'étage et la case d'un produit, sur le plan de la boutique. Raccourci disponible partout :")} <kbd className="kbd">{tl("Ctrl")}</kbd> + <kbd className="kbd">K</kbd></>}
      />
      <div className="card no-pad">
        <ProductFinder />
      </div>
    </div>
  );
}
