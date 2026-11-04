# GestiMarket

Logiciel de **caisse et de gestion de magasin** pour boutiques, supérettes, supermarchés, grossistes, pharmacies, quincailleries, etc. Interface en **français (par défaut) et en anglais**, utilisable dans **tous les pays** (devises, formats, taxes, opérateurs de paiement mobile), fonctionnement **hors ligne** (base SQLite locale), multi-postes sur le réseau du magasin, utilisable sur PC, tablette et téléphone.

- Application de bureau : **Tauri 2** (Rust) + **React 19 / TypeScript / Vite**
- Base de données : **SQLite** (intégrée, aucune installation)
- Version actuelle : **0.15.1**
- Cible principale : Windows (installateur NSIS et version portable) ; fonctionne aussi sous Linux

> État des tests : 53 tests automatiques Rust (retours en espèces et en avoir, article abîmé non remis en stock, quantité restante, délai, avoir payé en plusieurs fois, expiré, recrédité à l'annulation, rapports X et Z numérotés et chaînés, modification refusée, prix de gros par quantité et client grossiste, promotions de catégorie et prix promo, licence signée par Supabase, horloge, échéances, postes, connexions, page de paiement par carte, plan de la boutique : poser, prendre, déplacer, redimensionner, supprimer, meubles personnalisés, reprise des anciens blocs, hauteurs et dessins 3D, assistant « Créer ma boutique » pour les 4 côtés d'entrée sans chevauchement, plan proposé pour chacun des 22 types de commerce, les 462 paires et des trios d'activités sans chevauchement ni débordement, hauteur sous plafond, étage, dessin du bâtiment, personnel par identifiant et PIN, équipe par défaut, validation par le responsable choisi, blocage par compte, suppression, téléphones autorisés et codes d'accès, mise à jour depuis la 0.13, opérateurs de paiement mobile configurables, catalogue anglais), vérification TypeScript et contrôle des traductions anglaises : interface et messages (GitHub Actions, Ubuntu). L'interface anglaise n'a pas encore été relue en entier sur un vrai poste. La vue 3D a été vérifiée à l'écran sur une boutique d'exemple (vue d'ensemble, visite, déplacement refusé sur un meuble, chemin vers un produit, miniatures de la palette) ; sa fluidité sur un PC modeste n'a pas été mesurée. Test d'interface de bout en bout sous Xvfb avec Playwright : 55 vérifications sur 55 (prix de gros et promotion du jour en caisse, changement du prix de gros confirmé par PIN, pages Promotions et Retours & avoirs, réseau local, téléphone par un faux tunnel Cloudflare, coupure et retour du tunnel, lecture seule et licence, paiement refusé depuis le réseau, plan de la boutique : palette, frigo posé, produit rangé, vue de face, produit localisé sur le plan, plan en 3D affiché par WebGL logiciel, visite, plan proposé pour supérette + quincaillerie et gardé, équipe par défaut, plus de mot de passe, téléphone refusé puis autorisé par code d'accès sur l'écran de connexion, page Personnel). L'export PNG / PDF et l'import d'un dessin en PDF n'ont pas encore été essayés sur un vrai poste. Paiements testés directement dans Supabase ; la page Cybersource n'a pas encore été essayée faute de clés. L'installateur Windows est compilé par GitHub Actions sur Windows (MSVC) et n'a pas encore été essayé sur un vrai PC Windows. Application mobile : pages FlutterFlow natives (Supabase Auth, requêtes et temps réel, sans appel d'API) ; le code Flutter généré compile sans erreur ; la connexion et la liste des boutiques ont été essayées sur un iPhone (journaux Supabase). Supabase 0.15 (12 mois, carte de bon depuis le téléphone, poste serveur de la boutique) appliqué ; l'adresse Internet automatique (`https://gm-000123.gestimarket.shop`) fonctionne depuis le 3 novembre 2026. L'onglet Paramètres → Développeur Eden Dev (0.15.1) n'a pas encore été essayé sur un vrai PC Windows.

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Rôles et sécurité](#rôles-et-sécurité)
3. [Installation et utilisation](#installation-et-utilisation)
4. [Multi-postes, tablettes et téléphones](#multi-postes-tablettes-et-téléphones)
5. [Application mobile (FlutterFlow + Supabase)](#application-mobile-flutterflow--supabase)
6. [Abonnements et licences (Eden Dev)](#abonnements-et-licences-eden-dev)
7. [Développement](#développement)
8. [Architecture](#architecture)
9. [Base de données](#base-de-données)
10. [Interface RPC](#interface-rpc)
11. [Feuille de route](#feuille-de-route)

---

## Fonctionnalités

### Vente (caisse)
- Scan à la douchette, **à la caméra** (téléphone, tablette, webcam) ou saisie manuelle d'un code au pavé numérique ; syntaxe `3*code` pour la quantité.
- Navigation dans les catégories par fil d'Ariane, produits avec photo, emplacement et stock.
- **Conditionnements** : vendre au carton, au sac ou au pack (1 carton = 12 bouteilles) avec code-barres et prix propres ; le stock est décompté en unités de base.
- Remises, tickets en attente, client associé, vente à crédit (plafond par client), points de fidélité.
- **Prix de gros** (article et conditionnement) à partir d'une quantité, ou dès la première unité pour un **client grossiste** ; **promotions datées** (remise en % sur un article ou une catégorie, prix promo sur un article). En caisse, le prix le plus bas l'emporte tout seul ; le ticket montre l'ancien prix et « Vous économisez ».
- **Retours et avoirs** : depuis la vente, tout ou partie des articles (7 jours, réglable), remis en rayon ou abîmés, validés par le PIN d'un gestionnaire ou de l'administrateur ; remboursement en espèces, par le moyen de la vente, sur la dette du client ou en **avoir** (bon numéroté avec code-barres, payable en caisse en une ou plusieurs fois, 90 jours). Une vente qui a eu un retour ne s'annule plus.
- **Paiements** : espèces (monnaie rendue, pavé numérique), **Orange Money / Sarali** et **opérateurs configurables** (Wave, MTN MoMo, M-Pesa…) : numéro marchand ou QR code, ID de transaction obligatoire et unique ; autre mobile money, carte, crédit ; paiement partiel multi-moyens.
- Ticket imprimable, écran client.
- **Suivi des collègues** : voir en direct le ticket des autres caisses et **reprendre un client** sans tout ressaisir.

### Catalogue
- **Code-barres obligatoire** (EAN ou QR) : généré automatiquement si absent ; étiquettes imprimables en code-barres ou QR code.
- Champs : désignation, référence interne, marque, catégorie, unité, prix d'achat et de vente (saisi TTC ou HT), taxe, stock, seuil d'alerte, fournisseur, péremption, photo, emplacement, statut.
- **Catégories en arbre sans limite de niveaux** (catégorie → sous-catégorie → famille…), déplacement, masquage, couleur et photo, import / export CSV, détection des catégories vides et des produits sans catégorie.
- **Catalogue prédéfini** de 32 catégories avec leurs sous-catégories (+ menu restaurant), en français ou en anglais, chargeable à la carte sans doublon.
- **22 types de commerce** (boutique de quartier, commerce général, supermarché, supérette, grossiste, pharmacie, vêtements et chaussures, quincaillerie, matériaux de construction, électronique, téléphonie, boulangerie-pâtisserie, boucherie-poissonnerie, fruits et légumes, cosmétiques-parfumerie, librairie-papeterie, pièces auto-moto, agro-vétérinaire, bar-maquis-café, kiosque / station-service, boutique spécialisée, restaurant) : l'interface s'adapte (péremption, marque, référence, conditionnements, quantités décimales, services) et le plan propose les meubles du métier. Mêmes codes que les types de boutique du compte Eden Dev.
- Familles d'unités (poids, volume, longueur, conditionnement, boissons, matériaux, tissus…).
- Import de produits depuis Excel / CSV.

### Magasin
- **Plan de la boutique**, comme un plan d'architecte, à l'échelle en mètres : niveaux du bâtiment (rez-de-chaussée, étage, entrepôt), pièces (salle de vente, réserve…), murs, portes, caisse, et une **palette de meubles** à glisser sur le plan : gondoles, têtes de gondole, étagères murales, réfrigérateurs, congélateurs, vitrines réfrigérées, chambres froides, présentoirs, bacs vrac, palettes, portants, racks, armoires, armoires à tiroirs, vitrines fermées, comptoirs, **et des meubles personnalisés** créés par la boutique. Déplacer, redimensionner, tourner, dupliquer, annuler / rétablir, imprimer le plan.
- **Plan en 3D réaliste** (vues *Dessus*, *3D* et *Visite*) : chaque meuble est dessiné à ses vraies dimensions et garni de ses produits (couleur de leur catégorie, photo en option) : gondoles double face avec tablettes et bandes de prix, frigos à portes vitrées éclairés, congélateurs coffres à couvercles vitrés, vitrines réfrigérées bombées, chambres froides, racks de réserve avec palettes, portants avec vêtements, bacs vrac, caisse avec tapis et écran, murs, portes vitrées, fenêtres, escaliers ; sol en carrelage, béton, parquet ou lino. Tourner autour, zoomer, murs coupés pour voir l'intérieur ; **visite** à hauteur d'homme (flèches, Z Q S D ou boutons à l'écran). Qualité *Réaliste* (ombres) ou *Simple* (PC modeste) ; plan vu de dessus si l'appareil n'a pas de 3D.
- **Plan de départ proposé pour chaque type de commerce ou combinaison** (jusqu'à 3 activités, ex. supérette + quincaillerie) : à la première configuration, GestiMarket dessine la boutique à la taille habituelle de l'activité ; on donne les vraies dimensions de la salle (**longueur, largeur, hauteur sous plafond**) et le côté de l'entrée, l'aperçu 3D se redessine aussitôt, puis « Garder ce plan ». Une salle partagée est découpée en **rayons** (60/40 ou 50/25/25), chacun avec ses meubles et son nom au sol ; un meuble plus haut que le plafond est abaissé ; un niveau à l'étage reçoit un escalier.
- **Export** du plan en **photo (PNG)** (vue 3D ou plan) et en **PDF détaillé** : plan coté (longueur, largeur, échelle, meubles numérotés), hauteur sous plafond et surface, liste des meubles avec leurs dimensions, vue 3D, contenu de chaque meuble en option.
- **Dessin du bâtiment** : la photo ou le PDF du plan de l'architecte s'affiche sous le plan, se recale par une mesure connue (deux clics sur un mur et sa longueur), se décale et s'éclaircit ; on pose les meubles par-dessus.
- **Très facile à dessiner** : assistant **« Créer ma boutique »** (activités, dimensions, entrée, aperçu) qui pose murs, entrée, caisse, froid, étagères, allées et réserve ; en 3D, un meuble glissé s'aimante aux murs et à ses voisins et revient à sa place s'il en chevauche un autre ; **Répéter ×3** pour une rangée ; palette illustrée par l'image 3D de chaque meuble ; double-clic : la porte du frigo s'ouvre et ses cases s'affichent.
- **Vue de face** de chaque meuble (étages × cases) : **poser** un produit dans une case, le **prendre** (retirer), le déplacer ; un produit peut avoir plusieurs emplacements (rayon, réserve, frigo) dont un principal ; étiquettes de cases avec QR code.
- **Où est le produit ?** (Ctrl + K, aussi pour les caissiers) : en 3D, la caméra va au meuble, la case clignote et un **chemin vert au sol** mène de l'entrée au rayon ; la case est montrée dans la vue de face ; scanner l'étiquette d'une case montre son contenu.
- Stock : ajustements, inventaire, historique des mouvements.
- Achats / réceptions avec coût moyen pondéré, fournisseurs.
- Clients : dettes, règlements, relevé de compte.

### Pilotage
- Tableau de bord administrateur (chiffre d'affaires, marge, alertes de stock et de péremption, créances).
- **Tableau de bord du caissier** : statistiques de sa session (ventes, panier moyen, espèces attendues, répartition par moyen de paiement, ventes par heure, meilleurs articles).
- Sessions de caisse : fond de caisse, entrées / sorties d'espèces, retours remboursés, clôture avec calcul de l'écart ; clôture forcée par l'administrateur.
- **Rapport X** (chiffres de la caisse en cours, sans la fermer) et **rapport Z** à chaque clôture : ventes brutes, remises, promotions, taxes par taux, encaissements par moyen, retours et articles abîmés, espèces attendues, comptées et écart. Numéroté (Z-0001…), figé, impossible à modifier ou supprimer (la base le refuse), chaîné par empreintes SHA-256 ; total par journée ; impression ticket ou A4.
- Rapports de ventes, suivi des paiements mobiles, journal d'activité complet.

### International (langues, devises, taxes)
- **Français (par défaut) et anglais** : chaque utilisateur choisit sa langue (icône langue du menu, écran de connexion, première configuration), mémorisée sur son compte. Les **tickets et l'écran client** suivent la langue de la boutique (*Paramètres → Boutique*). Les messages du poste serveur et de Supabase sont traduits à l'affichage.
- **Tous les pays et toutes les devises** (ISO 4217) : décimales de la devise (0 pour le FCFA et le GNF, 2 pour l'euro et le dollar, 3 pour le dinar tunisien…), symbole modifiable, placé avant ou après le montant ; nombres et dates au format du pays. La saisie accepte la virgule ou le point décimal.
- **Taxes** : taux nommés (« TVA 18 %=18 », « Exonéré=0 ») proposés sur la fiche produit ; prix saisis **TTC ou HT** (le ticket détaille alors total HT, taxe et TTC) ; identifiants légaux (NIF, RCCM…) sur plusieurs lignes, imprimés sur le ticket.
- **Paiements mobiles configurables** : en plus d'Orange Money / Sarali, une liste d'opérateurs (Wave, Moov Money, MTN MoMo, Airtel Money, M-Pesa, Free Money, Mixx by Yas, T-Money, Flooz, Celtiis Cash, Telecel Money ou tout autre) : bouton en caisse aux couleurs de l'opérateur, numéro marchand, QR code (photo ou texte) affiché aussi sur l'écran client, ID de transaction obligatoire ou non et jamais utilisé deux fois, rapprochement dans *Paiements mobiles*.
- **Catalogue prédéfini** en français ou en anglais selon la langue de la boutique (mêmes catégories).
- **Abonnement** : prix des formules dans la devise de la boutique quand Eden Dev l'a fixé (`gm_plan_prices`), sinon en FCFA.

### Personnalisation
- Logo, nom du commerce, couleur du thème, style du menu, thème clair / sombre ; thème par défaut sinon.
- Aide contextuelle (bouton « ? ») sur chaque écran et chaque action importante.
- Paramètres → **Développeur Eden Dev** : contacter l'éditeur (e-mail lasscientifique@gmail.com, WhatsApp @edendeveloppeur, téléphone +223 76 59 36 76). Sur le PC, les liens s'ouvrent avec la messagerie, WhatsApp ou l'application d'appel de Windows ; dans un navigateur ou l'application mobile, comme des liens ordinaires.

---

## Rôles et sécurité

| Rôle | Droits |
|---|---|
| **Caissier / caissière** | **Seul rôle qui vend** : caisse, clients, ses ventes, sa session de caisse, son tableau de bord |
| **Gestionnaire** | Produits (ajout, modification, suppression), catégories, emplacements, stock, achats, fournisseurs. Ne vend pas |
| **Administrateur** | Contrôle total : tableau de bord, rapports, personnel, paramètres, annulations, clôture forcée d'une caisse. Ne vend pas |

- **Personnel : identifiant et code PIN seulement**, sans mot de passe ni compte en ligne (seule la boutique a un compte chez Eden Dev). Chaque boutique démarre avec **un administrateur, un gestionnaire et une caissière** ; l'administrateur ajoute ensuite des gestionnaires et des caissières (identifiant et PIN proposés, **fiche d'accès** imprimable).
- **PIN** haché Argon2 : 6 chiffres pour l'administrateur, 4 à 6 pour les autres. Chacun peut changer le sien ; l'administrateur en donne un nouveau, **bloque**, **supprime** (un compte qui a travaillé reste dans l'historique) et voit **les actions de chacun**.
- **Confirmation de toute action critique** par PIN (annulation de vente, remise, suppression d'article, changement de prix, archivage, ajustement de stock, clôture de caisse, paramètres, changement de réseau…). Si la personne connectée n'a pas le droit, elle touche le nom du responsable, qui tape **son** PIN : deux personnes peuvent avoir le même code sans qu'une caissière valide à la place de l'administrateur. C'est tracé.
- **Séparation des rôles** : les administrateurs et gestionnaires n'ouvrent pas de caisse. La règle est appliquée côté serveur.
- Blocage temporaire **par compte** après 5 PIN faux (1 min, puis 5 min, puis 30 min) et **par appareil**.
- **Depuis Internet** (tunnel) : le téléphone doit être **autorisé une fois**, par le compte boutique (téléphone de l'administrateur) ou par un **code d'accès de 8 lettres et chiffres** que l'administrateur génère pour une personne (une seule fois, 7 jours) ; ensuite identifiant + PIN suffisent. Accès Internet coché par personne ; téléphones listés et retirables (la session se ferme). Pas de liste du personnel à l'écran de connexion, photos servies seulement avec une session, paramètres réduits au strict nécessaire avant connexion.
- **PIN administrateur oublié** : refait au magasin avec l'e-mail et le mot de passe du compte boutique.
- Mise à jour depuis la 0.13 : les PIN existants restent valables et les mots de passe sont effacés ; un administrateur sans PIN utilise une dernière fois son ancien mot de passe pour créer son PIN.
- Sessions réseau par jeton avec expiration ; jetons des téléphones et codes d'accès enregistrés hachés (SHA-256).
- Journal d'activité de toutes les opérations sensibles.
- Montants stockés en **unités mineures entières** (pas d'erreur d'arrondi) ; prix relus en base à chaque vente (le client ne fixe jamais un prix).

---

## Installation et utilisation

### Utilisateur final (Windows)
1. Lancer `GestiMarket_x.y.z_x64-setup.exe`, ou décompresser la version portable (`gestimarket.exe` + `WebView2Loader.dll`).
2. **Première configuration** : compte boutique Eden Dev, nom du commerce et devise, administrateur (identifiant et PIN de 6 chiffres), **équipe** (gestionnaire et caissière proposés, fiches d'accès à imprimer), **activités** (jusqu'à 3, avec les catégories recommandées), puis **plan de départ** aux dimensions de la salle.
3. Chacun se connecte en touchant son nom puis en tapant son PIN (ou identifiant + PIN au clavier). D'autres postes s'ajoutent dans le menu **Personnel** : seule une caissière (ou un caissier) peut vendre.

Les données sont dans le dossier de données de l'application (`gestimarket.db`). Une **sauvegarde automatique quotidienne** peut être activée vers une clé USB, un disque externe ou un dossier synchronisé (Paramètres → Sauvegarde).

### Raccourcis en caisse
`F2` recherche · `F4` client · `F8` tickets en attente · `F9` encaisser · `Ctrl + K` où est le produit ?

---

## Multi-postes, tablettes et téléphones

Trois modes, réglables depuis **Poste & réseau** sur chaque PC :

| Mode | Rôle |
|---|---|
| **Poste unique** | Tout est sur ce PC |
| **Poste serveur** | Garde la base et la partage sur le réseau (Wi-Fi, câble, ou point d'accès d'un téléphone) |
| **Poste client** | Travaille sur la base du serveur |

- Le serveur écoute en **HTTP sur le port 7878** et en **HTTPS sur le port 7879** (certificat auto-signé généré automatiquement ; indispensable pour la caméra en direct sur téléphone).
- **Tablettes et téléphones** : ouvrir l'adresse du serveur dans le navigateur (ou scanner le QR code affiché dans Paramètres → Réseau). L'interface s'adapte à l'écran : barre du haut, onglets du bas selon le rôle, feuilles plein écran, caisse avec barre « Ticket / Encaisser ». Installable sur l'écran d'accueil.
- **Postes connectés** : le serveur liste chaque appareil (nom du poste, nom de l'appareil, IP, utilisateur, synchronisé ou non, dernier signal) ; un voyant dans le menu indique « Serveur actif », « Synchronisé » ou « Serveur injoignable ».
- **Écran client** (2ᵉ écran, TV, projecteur, tablette) : disponible sur tous les postes ; affiche articles, total, montant reçu, monnaie, QR Orange Money.
- Pare-feu Windows : autoriser les ports 7878 et 7879 si une alerte s'affiche.

### Plusieurs boutiques sur un même PC (5 au maximum)

Un opérateur qui gère plusieurs commerces peut les ouvrir **en même temps sur un seul PC**, chacun dans sa fenêtre.
- **Poste & réseau → Mes boutiques** : liste des boutiques, bouton « Ouvrir », et « Nouvelle boutique » (administrateur). L'écran de connexion propose aussi les autres boutiques.
- Chaque boutique a sa **propre base** (produits, stock, ventes, utilisateurs, PIN), sa configuration réseau, son code commerce Supabase et ses données de navigateur. La boutique 1 garde le dossier historique : rien ne change pour une installation existante. Les boutiques 2 à 5 sont dans `boutiques/<n>/` du dossier de données.
- Raccourci direct : `gestimarket.exe --boutique 3`.
- Une même boutique ne s'ouvre qu'une fois (verrou local sur 127.0.0.1:47871 à 47875, jamais exposé au réseau).
- En mode serveur, ports par défaut distincts : 7878, 7888, 7898, 7908, 7918 (https = port + 1). Pour l'accès Internet, un sous-domaine du tunnel par boutique et par port.

---

## Application mobile (FlutterFlow + Supabase)

L'application mobile (iOS / Android, projet FlutterFlow « GestiMarket », paquet `com.edendev.gestimarket`) ouvre GestiMarket à l'adresse du poste serveur. Quatre pages : **démarrage** (logo), **connexion** (propriétaire : compte boutique ; personnel : code du commerce tapé ou scanné), **magasin** (WebView : réseau local d'abord, sinon Internet ; écran « Serveur éteint » avec reconnexion seule) et **abonnement** (formule, échéance, paiements ; carte de bon, Orange Money, carte Visa, même PC éteint). Détails : `supabase/APPLICATION_MOBILE.md`.

```
Poste serveur ──(toutes les 30 s)──► Supabase : gm_publish_server(code, secret, actif, adresses)
Application FlutterFlow ─(démarrage)► Supabase : gm_get_server(code) → { active, url, … }
Application FlutterFlow ──► WebView(url)  ──► GestiMarket
```

- Réglage : **Paramètres → Réseau & mobile** : cocher « Publier l'adresse du poste serveur » (URL et clé vides = service d'Eden Dev), « Publier maintenant ». Le code du commerce (`GM-XXXXXX`) et son QR code sont créés automatiquement ; le PC publie aussi sa boutique Eden Dev, pour que la propriétaire connectée retrouve son poste serveur sans code.
- **Adresse Internet automatique** (formules PRO et BUSINESS) : « Créer l'adresse Internet » (e-mail et mot de passe du compte boutique, une fois) ; Eden Dev crée le tunnel Cloudflare et l'adresse `https://gm-000123.<domaine>` (fonction `gm-tunnel`), GestiMarket lance `cloudflared` (à installer une fois : `winget install --id Cloudflare.cloudflared`) et le relance s'il s'arrête.
- À la fermeture du serveur, l'état « arrêté » est publié immédiatement.
- Sécurité : la table n'est pas lisible directement ; seul le poste qui a créé le code peut le mettre à jour (secret haché). N'utiliser **jamais** la clé `service_role`.
- Les adresses publiées sont celles du réseau local ; pour joindre le magasin depuis **un autre réseau** (4G, autre Wi-Fi), renseignez l'**adresse publique** (voir ci-dessous).
- Un widget FlutterFlow fournit en plus un **scanner natif** de codes-barres ; la page le détecte automatiquement (canal JavaScript `GestiMarketNative`).

### Accès depuis Internet (tunnel Cloudflare)

Chaque magasin garde son PC serveur ; un **tunnel Cloudflare** lui donne une adresse publique fixe en HTTPS (ex. `https://eden.mondomaine.com`), sans redirection de port. `cloudflared` est installé en service Windows (démarrage automatique) et relie `https://eden.mondomaine.com` à `http://localhost:7878`. L'adresse est saisie dans **Paramètres → Réseau & mobile → Adresse publique** et publiée dans Supabase (`public_url`). Il faut un domaine géré par Cloudflare, un sous-domaine par magasin. Protégez l'adresse avec Cloudflare Access : une caisse est exposée sur Internet. Chaque téléphone doit être autorisé une fois (compte boutique ou code d'accès donné par l'administrateur) avant que l'identifiant et le PIN suffisent.

### Réseau local ou Internet : indication de la route

- Le serveur détecte la route de chaque appareil : les requêtes qui arrivent par le tunnel (en-têtes Cloudflare, depuis 127.0.0.1) sont « **Internet** » et gardent leur vraie adresse IP ; les autres sont « **Réseau local** ».
- **Poste & réseau** affiche un badge de route pour chaque appareil connecté et pour ce poste ; la pastille de connexion indique « Synchronisé · Réseau local » ou « Synchronisé · Internet ».
- Sur le poste serveur, le test de l'adresse publique (`/api/ping`, toutes les 30 s) indique « Réseau local disponible », « Internet disponible » ou « indisponible », et « Les deux routes sont actives ».
- Le widget FlutterFlow `GestiMarketWebView` (paramètres `shopCode`, `supabaseUrl`, `supabaseKey`) choisit le **réseau local d'abord**, sinon Internet, et se **reconnecte seul** quand le PC serveur redémarre (pages 502/530 du tunnel, coupures). Voir `supabase/APPLICATION_MOBILE.md`, section 5.

Guide complet : [`supabase/APPLICATION_MOBILE.md`](supabase/APPLICATION_MOBILE.md) · script SQL : [`supabase/gestimarket_mobile.sql`](supabase/gestimarket_mobile.sql) · widget : [`supabase/flutterflow/gestimarket_webview.dart`](supabase/flutterflow/gestimarket_webview.dart)

---

## Abonnements et licences (Eden Dev)

Chaque boutique a un **compte Eden Dev** (Supabase Auth : e-mail + mot de passe) avec : nom de la boutique, nom complet de la propriétaire, téléphone, pays, ville, adresse et type de boutique. Un compte peut avoir jusqu'à 5 boutiques (code `GM-000001`…). **Aucune donnée commerciale** (ventes, produits, stocks, clients) n'est envoyée à Eden Dev.

| Formule | Postes | Fonctions | Prix en FCFA (`gm_plans`) ; autres devises dans `gm_plan_prices` |
|---|---|---|---|
| **FREE** | 1 | Consultation uniquement | 0 |
| **STARTER** | 1 | Ventes et modifications, PC seul, sans Internet obligatoire | 5 000 FCFA / mois |
| **PRO** | 3 | + postes clients (PC, téléphones, tablettes), accès Internet, écran client, logo | 18 000 FCFA / mois |
| **BUSINESS** | selon contrat | toutes les fonctions | 50 000 FCFA / mois |

Durées : 1, 3, 6 ou **12 mois (2 mois offerts : 10 payés)**, par carte de bon, Orange Money ou carte Visa, sur le PC ou dans l'application mobile.

Parcours :

1. **Première configuration** : création du compte et de la boutique (ou connexion à un compte existant), **14 jours d'essai PRO**. Internet n'est nécessaire que pour cette étape.
2. Chaque PC (et chaque boutique d'un même PC) a un **identifiant** (`K7QM-2XPA-9DTR`), empreinte de la machine et du numéro de boutique.
3. **Paiement** : menu *Abonnement & licence* → *Payer ou renouveler* → moyen de paiement (le PC est reconnu : pas de mot de passe à retaper) :
   - **Carte de bon** (carte prépayée Eden Dev, code de 16 caractères) : **activation immédiate**, licence téléchargée dans la foulée. Code utilisable une seule fois ; 5 codes faux bloquent la saisie une heure.
   - **Orange Money (Sarali)** : formule et durée, montant exact, **code marchand** d'Eden Dev (et son QR code), puis **ID de la transaction** reçu par SMS. Eden Dev vérifie et valide.
   - **Carte Visa (Cybersource, Visa)** : formule et durée, la **page de paiement sécurisée de Visa** s'ouvre dans le navigateur (3-D Secure). Le résultat signé arrive à Supabase : **validation automatique**. Le numéro de carte ne passe jamais par GestiMarket ni par Eden Dev.
   - *Mes paiements* : état de chaque paiement (en attente, validé, refusé avec le motif).
4. **Changement de formule** : une **formule supérieure s'applique tout de suite**, les jours restants des formules inférieures payées étant convertis en jours de la nouvelle au prorata du prix (l'essai gratuit ne compte pas) ; même formule ou formule inférieure : à la suite de la période en cours. Validation Orange Money par Eden Dev : tableau de bord Supabase → table `gm_payments` → `status` → `validated` (ou `refused`, avec un motif dans `note`) ; la vue `gm_paiements_a_valider` affiche les paiements avec la boutique. Après un paiement, la licence est vérifiée toutes les 2 minutes pendant 24 h.
5. La fonction `gm-license` **signe la licence (Ed25519)** et la dépose dans le bucket public `licences/<identifiant du PC>.gml`. GestiMarket la télécharge toute seule (toutes les 30 minutes, ou bouton *Vérifier maintenant*). Sans Internet : *Importer un fichier* (licence reçue par WhatsApp ou clé USB).

Règles appliquées par le poste serveur (Rust), même sans Internet :

- **Licence vérifiée hors ligne** : signature Ed25519 (clé privée rangée dans Vault, jamais dans l'application), liée au PC (une licence copiée sur un autre PC est refusée), modification = refus.
- **Expiration** : avertissements à J-7, J-3, J-1 et le jour J, puis **lecture seule** : consultation, rapports, sauvegardes et export restent possibles ; ventes et modifications bloquées. **Aucune donnée n'est jamais supprimée.** Un renouvellement réactive tout.
- **Horloge** : la date la plus avancée déjà vue est mémorisée ; reculer l'horloge du PC ne prolonge pas la licence. L'heure de Supabase corrige une date erronée.
- **Postes simultanés** : chaque appareil connecté (ce PC compris) occupe une place ; une connexion de trop est refusée. Un appareil sans signal depuis 3 minutes libère sa place. L'administrateur voit et déconnecte les postes (*Poste & réseau → Postes connectés*).
- **Fonctions** : mode serveur et appareils du réseau (PRO), accès par Internet (PRO), écran client (PRO), logo (PRO).

Côté Supabase : `supabase/gestimarket_licences.sql` (tables `gm_stores`, `gm_store_pcs`, `gm_plans`, `gm_subscriptions`, `gm_payments`, `gm_licenses`, `gm_license_events`, listes `gm_countries` et `gm_shop_types`, bucket `licences`), puis `supabase/gestimarket_types_commerce.sql` (types de boutique = types de commerce de l'application), `supabase/gestimarket_paiements.sql` (cartes de bon `gm_vouchers`, paiements par PC, carte Visa, changement de formule), `supabase/gestimarket_international.sql` (tous les pays avec leur devise ISO, prix des formules par devise `gm_plan_prices`, carte Visa dans la devise de la boutique), `supabase/gestimarket_mobile.sql` (annuaire des postes serveurs), `supabase/gestimarket_abonnement_mobile.sql` (0.15 : 12 mois avec 2 offerts, carte de bon, paiements et carte Visa depuis l'application, poste serveur de la boutique, adresses Internet `gm_tunnels`), et les fonctions `supabase/functions/gm-license`, `gm-pay` et `gm-tunnel` (*Verify JWT* désactivé). À régler une fois dans le tableau de bord : *Authentication → Sign In / Providers → Email → Confirm email* **désactivé** (sinon chaque inscription attend un e-mail de confirmation).

Réglages d'Eden Dev (table `gm_config`) :

| Clé | Rôle |
|---|---|
| `om_merchant_code`, `om_merchant_name` | Code marchand Sarali d'Eden Dev et nom affiché par Orange Money |
| `om_qr_payload` | Contenu du QR code marchand (facultatif ; scanner l'autocollant avec un téléphone pour le lire) |
| `card_enabled` | `true` pour ouvrir la carte Visa, une fois les clés Cybersource en place |
| `card_currency` | Devise par défaut des paiements par carte (`XOF`) |
| `card_currencies` | Devises acceptées par le profil Cybersource (`XOF,EUR,USD`) : la carte est payée dans la devise de la boutique si elle y figure et a un prix dans `gm_plan_prices` |

**Cartes de bon** : `select * from public.gm_voucher_batch('pro', 1, 20);` dans le SQL Editor (formule, mois, nombre de cartes, lot facultatif) → *Export → CSV* → `supabase/cartes_de_bon.html` (coller, afficher, imprimer : 10 cartes par page A4, format carte bancaire). Les codes ne sont visibles qu'à la création (gardés hachés en SHA-256). Suivi : vue `gm_cartes_de_bon` ; une carte perdue ou volée : `status` → `cancelled` dans `gm_vouchers`.

**Carte Visa (Cybersource)** : contrat de paiement en ligne avec une banque partenaire de Visa au Mali (BMS S.A., Cybersource). Dans le *Business Center* Cybersource : profil *Secure Acceptance* « Hosted Checkout », clé d'accès et clé secrète. Dans Supabase (*Edge Functions → Secrets*) : `CYBS_PROFILE_ID`, `CYBS_ACCESS_KEY`, `CYBS_SECRET_KEY` et `CYBS_ENV` (`test` pour le bac à sable gratuit, `live` en production), puis `card_enabled` = `true`. La fonction `gm-pay` signe chaque demande (HMAC-SHA256), indique son adresse pour la notification (`override_backoffice_post_url`) et n'active l'abonnement que si la signature, le montant et la devise du résultat sont exacts ; un paiement « en vérification » chez Cybersource passe dans les paiements à valider.
---

## Développement

### Prérequis
- Node.js 20+ et npm
- Rust stable
- Linux : dépendances Tauri (`webkit2gtk-4.1`, `libsoup-3.0`, etc. — voir la documentation Tauri 2)

### Commandes

```bash
npm install                 # dépendances front
npm run dev                 # interface seule (navigateur, port 1420)
npx tauri dev               # application complète en développement
npm run typecheck           # vérification TypeScript
npm run test:rust           # tests Rust (logique métier)
npm run i18n:check          # aucun texte sans traduction anglaise (interface et messages)
node scripts/i18n.mjs wrap  # entoure les nouveaux textes français de tl() / ts()
node e2e/run.mjs            # test d'interface (serveur lancé sur :7878, Playwright installé)
npx tauri build             # build de production de la plateforme courante
```

### Build Windows depuis Linux (MinGW)

```bash
rustup target add x86_64-pc-windows-gnu
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
# Résultat : src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/GestiMarket_<version>_x64-setup.exe
# Version portable : gestimarket.exe + WebView2Loader.dll (dossier release/)
```

Pour changer de version : `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (et `Cargo.lock`).

Traductions : les textes restent en français dans le code, entourés de `tl()` (interface, langue de l'utilisateur), `ts()` (ticket et écran client, langue de la boutique) ou `tm()` (messages du poste serveur et de Supabase). L'anglais est dans `src/i18n/en.ts` et `src/i18n/en-messages.ts` (`python scripts/i18n_messages.py` liste les messages Rust et SQL).

### Intégration continue (`.github/workflows/build.yml`)

| Job | Quand | Contenu |
|---|---|---|
| `test` | chaque envoi | `npm run typecheck`, contrôle des traductions anglaises et `cargo test` sous Ubuntu |
| `e2e` | envoi sur `main` | compilation debug, GestiMarket en mode serveur sous Xvfb, `e2e/run.mjs` (Playwright) avec le faux tunnel et la fausse API Supabase de `e2e/mocks.mjs` ; captures publiées dans une pré-release `e2e-N` |
| `release` | étiquette `v*` | installateurs Windows (`-setup.exe`, `.msi`), Linux (`.deb`, `.rpm`, `.AppImage`) et macOS, release publiée |

Version portable Windows : `gestimarket.exe` seul (la compilation MSVC intègre `WebView2Loader`), extrait du `.msi` par `msiexec /a`.

### Tester le mode serveur dans un navigateur
Lancer l'application en mode serveur (`network.json` : `{"mode":"server","poste_name":"Caisse 1","port":7878,"server_url":""}` dans le dossier de données), puis ouvrir `https://127.0.0.1:7879` (accepter le certificat). La caméra en direct exige https.

---

## Architecture

```
gestimarket/
├── src/                      Interface React + TypeScript
│   ├── pages/                Un fichier par écran (Pos, Products, Categories, Poste, Settings…)
│   ├── components/           Composants partagés (PinPad, CameraScanner, Layout, BusinessType…)
│   ├── lib/                  transport.ts (RPC local / réseau), presence.ts, scanner.ts, native.ts,
│   │                         format.ts, help.ts (textes d'aide), display.ts, csv.ts, receipt.ts
│   ├── context/AppContext    Session, thème, marque, toasts, PIN, fonctions activées
│   ├── api.ts, types.ts      Façade typée des opérations métier
│   └── styles.css            Design (variables CSS, thème, responsive mobile)
├── src-tauri/
│   ├── src/
│   │   ├── rpc.rs            Point d'entrée unique : dispatch(commande, droits, PIN)
│   │   ├── services/         Logique métier : catalog, sales, cash, stock, purchases, partners,
│   │   │                     reports, settings, templates (catalogue + types de commerce),
│   │   │                     users, auth, audit, backup, media, locations, plan (plan de la boutique)
│   │   ├── network.rs        Serveur HTTP / HTTPS (axum), certificat auto-signé, ressources
│   │   ├── live.rs           Présence des postes et tickets en cours (mémoire)
│   │   ├── cloud.rs          Publication de l'adresse du serveur sur Supabase
│   │   ├── state.rs          Session, rôles, jetons réseau, anti force brute du PIN
│   │   ├── db.rs             Ouverture SQLite et migrations
│   │   └── commands.rs       Commandes Tauri propres au PC (fichiers, réseau, fenêtres, écran client)
│   ├── migrations/           001 à 005 (versionnées par PRAGMA user_version)
│   └── data/catalogue_fr.txt Catalogue prédéfini de catégories
└── supabase/                 Kit application mobile (SQL, guide, widget FlutterFlow)
```

### Principes
- **Un seul point d'entrée métier** : `rpc::dispatch`. L'application de bureau (commande Tauri `rpc`) et les postes réseau (`POST /rpc/{commande}`) passent par le même code, avec les mêmes contrôles de droits et de PIN.
- **Le front ne décide jamais** des prix, des droits ni des stocks : tout est revérifié côté Rust.
- **Hors ligne d'abord** : tout fonctionne sans Internet ; Supabase n'est utilisé que pour publier l'adresse du serveur.
- **Images en base** (photos produits, logo), servies par le protocole `media://` en local et `/media/{id}` sur le réseau.
- **Transport** : `lib/transport.ts` choisit automatiquement l'appel local (Tauri), l'appel réseau (poste client) ou le navigateur (tablette, téléphone).

### Bibliothèques principales
Tauri 2, rusqlite (SQLite intégré), argon2, axum + tower-http, axum-server (HTTPS rustls), rcgen, ureq, chrono · React 19, react-router (HashRouter), recharts, lucide-react, qrcode, jsbarcode, @zxing/library, three.js (vue 3D du plan, chargée seulement à l'ouverture du plan), jsPDF (export du plan en PDF) et pdf.js (dessin du bâtiment importé en PDF), chargés seulement à l'usage.

---

## Base de données

SQLite, migrations versionnées (`PRAGMA user_version`, clés étrangères vérifiées après chaque migration).

| Migration | Contenu |
|---|---|
| 001 | Utilisateurs, catégories, produits, clients, fournisseurs, ventes, achats, stock, sessions de caisse, paramètres, journal |
| 002 | Médias (photos), emplacements (bloc / étage / rangée), paiements multiples, Orange Money |
| 003 | Catégories hiérarchiques (parent, ordre) |
| 004 | Code PIN des utilisateurs |
| 005 | Catalogue v2 : catégories actives, marque, référence, conditionnements, quantités en unités de base |
| 006 | Plan de la boutique : niveaux (`store_floors`), palette de meubles (`fixture_types`), meubles posés en mètres (`fixtures`), cases étage × case (`locations`), autres emplacements d'un produit (`product_locations`) ; les anciens blocs deviennent des gondoles |
| 007 | International : langue de chaque utilisateur (`users.lang`) |
| 008 | Plan en 3D : forme 3D et hauteur des types de meubles, hauteur propre d'un meuble, hauteur des murs et sol de chaque niveau |
| 009 | Personnel par identifiant et PIN (mots de passe effacés), accès Internet par personne, comptes supprimés gardés pour l'historique, téléphones autorisés (`trusted_devices`), codes d'accès (`access_codes`), dessin du bâtiment en fond d'un niveau |
| 010 | Retours (`returns`, `return_items`), avoirs (`credit_notes`), prix de gros (articles, conditionnements, client grossiste), promotions (`promotions`), prix appliqué sur chaque ligne de vente, rapports Z (`z_reports`, modification et suppression bloquées par déclencheurs) |

Conventions : montants en entiers (unités mineures de la devise), quantités en réels, prix de vente enregistrés TTC (même saisis HT), dates locales.

---

## Interface RPC

Les commandes sont appelées par `POST /rpc/{commande}` (corps JSON, en-tête `Authorization: Bearer <jeton>`) ou par la commande Tauri `rpc`. Réponse : `{ "ok": … }` ou `{ "error": "message en français" }` (traduit à l'affichage).

Familles de commandes : authentification et PIN · utilisateurs · paramètres · catégories et catalogue · produits (dont `scan_code`) · emplacements · stock · achats · clients · ventes · sessions de caisse (`cashier_stats`, `force_close_cash_session`) · rapports · postes (`poste_heartbeat`, `list_postes`) · tickets partagés (`live_cart_update`, `live_carts`, `live_cart_take`) · application mobile (`cloud_status`, `cloud_publish_now`) · écran client (`display_update`, `display_state`).

Chaque commande déclare le niveau requis (aucun, caissier, gestionnaire, administrateur) ; les actions critiques exigent en plus un PIN.

---

## Feuille de route

- [x] Caisse, stock, achats, clients, rapports, Orange Money / Sarali
- [x] Photos, emplacements, écran client, multi-postes (serveur / client)
- [x] Rôles, codes PIN, journal d'activité, personnalisation
- [x] Codes-barres / QR obligatoires, scanner caméra, conditionnements
- [x] Types de commerce, catalogue prédéfini, catégories illimitées
- [x] Version téléphone / tablette, tableau de bord caissier, vente réservée aux caissiers
- [x] Postes connectés, reprise de client entre caissiers, publication Supabase
- [x] Accès Internet par tunnel Cloudflare, route local / Internet indiquée, widget FlutterFlow tout-en-un
- [x] Plusieurs boutiques sur un même PC (5 au maximum)
- [x] Comptes boutique, formules FREE / STARTER / PRO / BUSINESS, licences signées Ed25519, lecture seule à l'expiration, postes simultanés
- [x] Paiement des abonnements : carte de bon (activation immédiate), Orange Money (Sarali), carte Visa (Cybersource) ; formule supérieure immédiate
- [x] Plan de la boutique façon architecte (meubles, frigos, réserve, meubles personnalisés, poser / prendre), 22 types de commerce
- [x] Plan en 3D réaliste : meubles dessinés et garnis, visite dans les allées, assistant « Créer ma boutique », chemin jusqu'au produit
- [x] Français / anglais et utilisation dans tous les pays (devises, taxes, paiements mobiles configurables, prix des formules par devise)
- [x] Personnel par identifiant et code PIN (équipe par défaut, blocage, suppression, actions de chacun), téléphones autorisés pour l'accès Internet (code d'accès)
- [x] Plan de départ proposé pour chaque type de commerce ou combinaison (rayons), dimensions et hauteur sous plafond, export PNG et PDF, dessin du bâtiment en fond
- [x] Retours et avoirs, prix de gros et client grossiste, promotions datées, rapports X et Z, abonnement de 12 mois (2 offerts)
- [x] Application mobile FlutterFlow : démarrage, connexion propriétaire / personnel, magasin (écran « Serveur éteint »), abonnement ; adresse Internet automatique par boutique
- [ ] Dépenses, bons de commande, variantes, codes-barres de balance, imprimante thermique ; retours déduits des rapports de ventes et du tableau de bord
- [ ] Chiffrement de la base (SQLCipher) et sauvegardes chiffrées
- [ ] Tableau de bord Eden Dev, paiement mobile automatique, mises à jour signées
- [ ] Application mobile : essai sur de vrais téléphones, publication sur le Play Store et l'App Store
- [ ] Test sur vrai PC Windows et vrais téléphones
- [ ] Synchronisation de données entre magasins distants (Supabase) : hors périmètre actuel
- [ ] Conversion libre entre unités (kg ↔ g…)
- [ ] Module réglementaire pharmacie (médicaments sur ordonnance)
