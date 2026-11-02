import { tl } from "./i18n";
/** Textes d'aide affichés par les boutons « ? » (écrans et actions). */

export interface PageHelp {
  title: string;
  purpose: string;
  steps: string[];
  tips?: string[];
}

export const PAGE_HELP: Record<string, PageHelp> = {
  dashboard: {
    title: tl("Tableau de bord"),
    purpose: tl("Vue d'ensemble de l'activité du jour et du mois : chiffre d'affaires, marge, alertes de stock et de péremption, créances clients et encaissements par moyen de paiement."),
    steps: [
      tl("Consultez chaque matin les alertes : produits en rupture, sous le seuil ou bientôt périmés."),
      tl("Comparez le chiffre d'affaires du jour à celui de la veille (flèche verte ou rouge)."),
      tl("Cliquez sur « Voir tout » ou « Gérer le stock » pour agir directement."),
    ],
    tips: [tl("Les chiffres se mettent à jour automatiquement toutes les minutes ; « Actualiser » force la mise à jour.")],
  },
  pos: {
    title: tl("Caisse"),
    purpose: tl("Encaisser les clients rapidement : scan des articles, remises, client, paiement (espèces, Orange Money / Sarali, carte, crédit) et ticket."),
    steps: [
      tl("Ouvrez la caisse en début de journée en déclarant le fond de caisse."),
      tl("Scannez les articles avec la douchette, avec la caméra du téléphone / de la tablette (bouton appareil photo), ou touchez les vignettes. Tapez « 3*code » pour en ajouter 3 d'un coup."),
      tl("F4 : associer un client (obligatoire pour une vente à crédit)."),
      tl("F9 : encaisser. Choisissez le moyen de paiement ; « Paiement partiel » permet de combiner plusieurs moyens."),
      tl("Imprimez le ticket, puis « Nouvelle vente »."),
    ],
    tips: [
      tl("F2 : revenir à la recherche · F8 : tickets en attente · Ctrl+K : où se trouve un produit ?"),
      tl("Retirer un article, diminuer une quantité, vider le ticket ou faire une remise demande un code PIN (réglable dans Paramètres → Sécurité)."),
      tl("Le pavé numérique de l'encaissement permet de tout faire au doigt sur un écran tactile."),
      tl("Le bouton « Écran client » affiche le panier et le total sur un 2ᵉ écran tourné vers le client."),
      tl("Touchez une ligne du ticket pour modifier la quantité (décimales pour les produits au kg) ou faire une remise."),
    ],
  },
  finder: {
    title: tl("Localiser un produit"),
    purpose: tl("Retrouver immédiatement où se trouve un produit : le meuble clignote sur le plan de la boutique, la vue de face montre l'étage et la case."),
    steps: [
      tl("Tapez le nom, la catégorie, ou scannez le code-barres."),
      tl("Lisez le meuble, l'étage et la case en grand ; le meuble clignote sur le plan. Ses autres emplacements (réserve, frigo) sont listés."),
    ],
    tips: [tl("Disponible depuis n'importe quel écran avec Ctrl+K, même pour les caissiers."), tl("Scannez l'étiquette d'une case pour voir son contenu.")],
  },

  sales: {
    title: tl("Historique des ventes"),
    purpose: tl("Retrouver une vente, la consulter, réimprimer son ticket ou l'annuler (gérant)."),
    steps: [tl("Choisissez la période."), tl("Cherchez par n° de ticket, nom de client, ID de transaction Orange Money ou téléphone."), tl("Double-cliquez sur une vente pour le détail.")],
    tips: [tl("Un caissier ne voit que ses propres ventes."), tl("L'annulation remet les articles en stock et annule la dette du client ; le motif est obligatoire et tracé.")],
  },
  cash: {
    title: tl("Sessions de caisse"),
    purpose: tl("Contrôler l'argent du tiroir : fond de caisse, entrées et sorties d'espèces, clôture avec comptage et calcul de l'écart. Seuls les caissiers ont une caisse ; l'administrateur peut clôturer la caisse d'un caissier absent."),
    steps: [
      tl("Ouvrir : déclarez les espèces présentes dans le tiroir."),
      tl("Pendant la journée : enregistrez chaque sortie (dépense, versement banque) ou entrée (appoint de monnaie)."),
      tl("Clôturer : comptez les billets et pièces ; le logiciel calcule l'excédent ou le manquant."),
    ],
    tips: [tl("Les paiements Orange Money et carte n'entrent pas dans le tiroir : ils sont détaillés à part.")],
  },
  customers: {
    title: tl("Clients"),
    purpose: tl("Suivre les clients réguliers : achats, dettes (crédit), règlements et points de fidélité."),
    steps: [tl("Créez le client (nom, téléphone)."), tl("Un gérant fixe son plafond de crédit (0 = crédit interdit)."), tl("Encaissez ses règlements avec le bouton « main avec pièces ».")],
    tips: [tl("Le relevé de compte liste tous les achats et règlements.")],
  },
  products: {
    title: tl("Produits"),
    purpose: tl("Gérer le catalogue : code-barres obligatoire, photos, catégories, marque, référence, prix, conditionnements (carton, sac…), stock, emplacement et péremption."),
    steps: [
      tl("Créez d'abord vos catégories (bouton « Catégories ») ou chargez le catalogue prédéfini."),
      tl("Créez les produits ou importez votre fichier Excel (« Importer »). Chaque produit a un code-barres : scannez l'emballage ou gardez le code interne proposé."),
      tl("Conditionnements : ajoutez « Carton de 12 » ou « Sac de 50 kg » avec leur propre code-barres et prix ; la caisse décompte le stock automatiquement."),
      tl("Cochez des produits pour imprimer leurs étiquettes ou les ranger en une fois dans un emplacement."),
    ],
    tips: [tl("Le stock ne se modifie pas ici : utilisez « Achats / réceptions » ou « Stock & inventaire » pour garder la traçabilité.")],
  },
  locations: {
    title: tl("Plan de la boutique"),
    purpose:
      tl("Dessiner la boutique comme un plan d'architecte (pièces, murs, portes, rayons, frigos, congélateurs, vitrines, réserve…) et y ranger les produits : il suffit ensuite de regarder le plan pour trouver un produit."),
    steps: [
      tl("« Modifier le plan » : prenez un meuble dans la palette et posez-le sur le plan (glisser, ou cliquer pour le poser à une place libre)."),
      tl("Déplacez-le, agrandissez-le par son coin, tournez-le (R), donnez-lui un nom, un nombre d'étages et de cases."),
      tl("Double-cliquez sur un meuble : vue de face. Glissez les produits dans les cases (poser), d'une case à l'autre (déplacer), ✕ pour les retirer (prendre)."),
      tl("Un produit peut avoir plusieurs emplacements (rayon, réserve, frigo) : ★ choisit l'emplacement principal."),
    ],
    tips: [
      tl("Créez vos propres meubles (« Meuble personnalisé ») : vous n'êtes pas limité à la palette."),
      tl("Plusieurs niveaux : rez-de-chaussée, étage, entrepôt…"),
      tl("Imprimez les étiquettes des cases (vue de face) : leur QR code se scanne dans « Localiser un produit »."),
    ],
  },

  stock: {
    title: tl("Stock & inventaire"),
    purpose: tl("Surveiller les niveaux de stock, les dates de péremption et l'historique de tous les mouvements."),
    steps: [tl("Onglet Alertes : produits à réapprovisionner."), tl("Onglet Péremption : produits à vendre en priorité ou à retirer."), tl("« Ajuster / inventorier » : saisir la quantité comptée, une perte ou un retour.")],
    tips: [tl("Chaque ajustement est tracé (qui, quand, pourquoi) dans les mouvements et le journal d'activité.")],
  },
  purchases: {
    title: tl("Achats / réceptions"),
    purpose: tl("Enregistrer les livraisons des fournisseurs : le stock augmente et les coûts d'achat se mettent à jour."),
    steps: [tl("Choisissez le fournisseur."), tl("Scannez les produits reçus ; indiquez quantités, coûts, date de péremption."), tl("Validez la réception.")],
    tips: [tl("Le coût d'achat est recalculé au coût moyen pondéré (CMUP) pour une marge juste.")],
  },
  suppliers: {
    title: tl("Fournisseurs"),
    purpose: tl("Carnet d'adresses des fournisseurs et total des achats réalisés chez chacun."),
    steps: [tl("Créez le fournisseur."), tl("Associez-le aux produits (fiche produit) et aux réceptions.")],
  },
  reports: {
    title: tl("Rapports"),
    purpose: tl("Analyser l'activité sur une période : ventes, marge, TVA, moyens de paiement, catégories, caissiers, meilleurs produits."),
    steps: [tl("Choisissez une période (boutons rapides ou dates)."), tl("Imprimez ou exportez vers Excel.")],
  },
  payments: {
    title: tl("Paiements mobiles"),
    purpose: tl("Rapprocher les encaissements Orange Money / Sarali, mobile money et carte avec le relevé de votre opérateur."),
    steps: [tl("Choisissez la période et le moyen de paiement."), tl("Comparez chaque ID de transaction avec votre relevé Orange."), tl("Exportez la liste vers Excel si besoin.")],
    tips: [tl("Les lignes « ID manquant » sont à vérifier en priorité.")],
  },
  users: {
    title: tl("Utilisateurs"),
    purpose: tl("Créer les comptes du personnel et définir leurs droits."),
    steps: [
      tl("Caissier / caissière : le SEUL rôle qui vend (caisse, clients, ses ventes, sa session de caisse, son tableau de bord)."),
      tl("Gestionnaire : les produits (ajout, modification, suppression), catégories, emplacements, stock, achats, fournisseurs."),
      tl("Administrateur : contrôle total — tableau de bord, rapports, utilisateurs, paramètres et réglages, annulations."),
      tl("Chaque utilisateur crée son code PIN à sa première connexion ; l'administrateur peut le réinitialiser (icône bouclier)."),
    ],
    tips: [
      tl("Sécurité : gestionnaires et administrateurs n'ouvrent pas de caisse. Si leur mot de passe fuit, personne ne peut encaisser avec leurs droits élevés. Créez des comptes caissier pour vendre."),
      tl("Désactivez un compte plutôt que de le supprimer : l'historique est conservé."), tl("Le PIN sert à se connecter rapidement et à confirmer les actions critiques.")],
  },
  audit: {
    title: tl("Journal d'activité"),
    purpose: tl("Traçabilité des opérations sensibles : connexions, annulations, ajustements de stock, changements de prix et de paramètres."),
    steps: [tl("Filtrez par période ou recherchez un utilisateur, une action.")],
  },
  categories: {
    title: tl("Catégories"),
    purpose: tl("Organiser le catalogue en arbre sans limite de niveaux : Catégorie → Sous-catégorie → Famille → … (ex. Alimentation › Riz › Riz local)."),
    steps: [
      tl("« Charger le catalogue » : ajoutez en un clic les 32 catégories prédéfinies et leurs sous-catégories (sans doublon)."),
      tl("« + » sur une ligne : ajoute une sous-catégorie dedans. Le crayon : renommer, changer la couleur, la photo ou déplacer vers une autre catégorie."),
      tl("L'œil masque une catégorie (et sa descendance) en caisse sans la supprimer."),
      tl("Exportez / importez l'arborescence en Excel (CSV) : une ligne par chemin « Catégorie > Sous-catégorie > Famille »."),
    ],
    tips: [
      tl("Filtre « Vides » : catégories sans aucun produit (à remplir ou à masquer)."),
      tl("Supprimer une catégorie supprime ses sous-catégories ; les produits sont conservés, sans catégorie (filtre « Sans catégorie » dans Produits)."),
    ],
  },
  settings: {
    title: tl("Paramètres"),
    purpose: tl("Réglages du magasin, organisés en onglets : commerce, apparence (logo, nom, couleur), Orange Money, ventes et ticket, sécurité et codes PIN, réseau et écran client, sauvegarde."),
    steps: [
      tl("Choisissez un onglet, modifiez les champs, puis « Enregistrer les modifications » en haut : votre code PIN d'administrateur est demandé."),
      tl("Apparence : ajoutez votre logo, choisissez la couleur du thème et le style du menu. Sans choix, le thème par défaut est conservé."),
      tl("Le mode réseau s'enregistre séparément (bouton dédié) et redémarre l'application."),
    ],
  },
  poste: {
    title: tl("Poste & réseau"),
    purpose: tl("Voir et régler ce poste : son rôle (serveur, client, poste unique), sa liaison avec le serveur, l'écran client, et la liste de tous les appareils connectés."),
    steps: [
      tl("Sur le PC qui garde la base : mode « Poste serveur ». Les autres PC : « Poste client » avec l'adresse du serveur."),
      tl("Les tablettes et téléphones ouvrent l'adresse du serveur (ou scannent le QR code) : rien à installer."),
      tl("« Synchronisé » signifie que l'appareil travaille en direct sur la base du serveur : ventes et stock sont partagés instantanément."),
      tl("Écran client : ouvrez-le sur un 2ᵉ écran, ou affichez l'adresse indiquée sur une TV / tablette."),
    ],
    tips: [
      tl("Point d'accès d'un téléphone : connectez le serveur et tous les appareils au même point d'accès, puis utilisez l'adresse affichée."),
      tl("Donnez un nom différent à chaque poste, sinon les écrans clients se mélangent."),
    ],
  },
  my_dashboard: {
    title: tl("Mon tableau de bord"),
    purpose: tl("Les chiffres de VOTRE session de caisse : ventes, panier moyen, articles vendus, répartition espèces / Orange Money / carte, espèces attendues dans le tiroir."),
    steps: [
      tl("Consultez « Espèces attendues » avant de clôturer : c'est ce que le tiroir doit contenir."),
      tl("Les ventes par heure montrent les moments d'affluence."),
      tl("Les annulations de la session sont listées : elles sont faites par l'administrateur avec motif."),
    ],
    tips: [tl("Sans caisse ouverte, ce sont les chiffres de votre dernière session qui s'affichent."), tl("Les chiffres se mettent à jour automatiquement toutes les 30 secondes.")],
  },
  display: {
    title: tl("Écran client"),
    purpose: tl("Afficher au client ses articles, les prix, le total, le montant reçu et la monnaie, sur un 2ᵉ écran, un moniteur, une TV ou un projecteur."),
    steps: [
      tl("2ᵉ écran branché sur la caisse : Caisse → bouton « Écran client »."),
      tl("TV ou PC du réseau : ouvrez dans le navigateur l'adresse indiquée dans Paramètres → Écran client."),
    ],
  },
};

/** Aides courtes des boutons et champs importants. */
export const TIPS: Record<string, string> = {
  categories:
    tl("Arborescence sans limite : Catégorie (Alimentation) → Sous-catégorie (Riz) → Famille (Riz local)… Filtrer sur une catégorie affiche les produits de toute sa descendance."),
  sku: tl("Code article interne de votre magasin (ex. RIZ-001). Il complète le code-barres et se cherche partout."),
  packagings:
    tl("Le même produit vendu en plusieurs formats : « Carton de 12 » contient 12 bouteilles. Scanner le code du carton ajoute 1 carton au ticket et retire 12 bouteilles du stock."),
  business_type:
    tl("Le logiciel s'adapte à votre commerce : catégories proposées, fonctions affichées (péremption, marques, conditionnements, quantités décimales, services). Vous pouvez changer à tout moment."),
  camera_scan:
    tl("Utilise la caméra du téléphone, de la tablette ou la webcam. Vidéo en direct sur l'adresse https (port 7879) ; sinon prenez le code en photo."),
  mobile_app:
    tl("L'application mobile n'a qu'une WebView : elle demande à Supabase l'adresse du poste serveur (avec le code du commerce) puis l'ouvre. Le téléphone doit être sur le même Wi-Fi (ou point d'accès) que le serveur."),
  other_tills:
    tl("Les tickets en cours des autres caisses, en direct. « Suivre » affiche les articles au fur et à mesure ; « Reprendre ce client » transfère son ticket sur votre caisse pour l'encaisser sans tout ressaisir (panne, problème de paiement, file d'attente)."),
  code_entry:
    tl("Code-barres illisible ? Tapez les chiffres sous le code-barres puis Entrée. « 3*code » ajoute 3 articles d'un coup."),
  hold: tl("Met le ticket de côté (client parti chercher un article) pour servir le client suivant. Reprenez-le avec « En attente » ou F8."),
  partial:
    tl("Combine plusieurs moyens de paiement : saisissez la première partie (ex. 5 000 en Orange Money), cliquez « Paiement partiel », puis complétez (ex. le reste en espèces)."),
  om_reference:
    tl("Après paiement, le client reçoit un SMS de confirmation avec un ID de transaction. Saisissez-le ou scannez-le : il prouve le paiement, ne peut pas être réutilisé et sert au rapprochement."),
  om_qr:
    tl("Photographiez l'autocollant QR code marchand fourni par Orange et ajoutez la photo ici : il s'affiche en caisse et sur l'écran client pour que le client paie en scannant."),
  generate_blocs:
    tl("Pose en une fois plusieurs gondoles sur le plan. Exemple : rayons A à C, étages 1 à 5, cases 1 à 6 = 3 rayons de 30 cases."),
  import: tl("Importez votre catalogue depuis Excel (CSV). Téléchargez le modèle pour connaître les colonnes : catégorie, sous-catégorie, bloc, étage, rangée…"),
  labels: tl("Imprime des étiquettes code-barres ou QR code (planche A4) ou des étiquettes de rayon (prix + emplacement) pour les produits cochés."),
  cash_close: tl("Comptez les espèces du tiroir et saisissez le total : le logiciel compare au montant attendu et enregistre l'écart."),
  cash_movement: tl("Enregistrez toute sortie d'espèces (dépense, versement à la banque) ou entrée (appoint de monnaie) pour que la caisse reste juste."),
  credit_limit: tl("Montant maximum de dette autorisé pour ce client. 0 = vente à crédit interdite. Seul un gérant peut le modifier."),
  cmup: tl("Coût moyen unitaire pondéré : le nouveau coût d'achat tient compte de l'ancien stock et du prix du nouveau lot."),
  expiry: tl("Date de péremption du lot le plus proche. Une alerte apparaît au tableau de bord quand elle approche."),
  network:
    tl("Poste unique : tout sur ce PC. Serveur : ce PC garde la base et la partage aux autres caisses (Wi-Fi ou câble). Client : ce PC utilise la base du serveur."),
  customer_display:
    tl("Ouvre une fenêtre plein écran sur le 2ᵉ écran (tourné vers le client) : articles, prix, total, montant reçu et monnaie à rendre."),
  auto_backup: tl("Une copie de la base est faite chaque jour dans ce dossier. Choisissez une clé USB, un disque externe ou un dossier synchronisé (Drive, OneDrive)."),
  allow_negative: tl("Si coché, on peut vendre un produit même si le stock indique 0 (stock mal saisi). Déconseillé : le stock devient faux."),
  require_session: tl("Oblige chaque caissier à ouvrir sa caisse (fond de caisse) avant de vendre : indispensable pour contrôler les espèces."),
  loyalty: tl("Le client gagne 1 point par tranche dépensée (ex. 1 point par 1 000 FCFA). 0 désactive la fidélité."),
  barcode: tl("Obligatoire : la caisse retrouve le produit en scannant ou en tapant ce code. Pas de code sur l'emballage (vrac, fait maison) ? Gardez le code interne proposé, puis imprimez son étiquette (code-barres ou QR code)."),
  bulk_location: tl("Range tous les produits cochés dans la case choisie (emplacement principal)."),
  plan: tl("Vue de dessus de la boutique, à l'échelle (un carreau = 1 mètre) ; le chiffre sur un meuble indique le nombre de produits rangés."),
  cancel_sale: tl("Annule la vente : les articles reviennent en stock et la dette éventuelle du client est retirée. Motif obligatoire, action tracée."),
};
