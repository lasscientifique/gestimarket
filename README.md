# GestiMarket

Logiciel de **caisse et de gestion de magasin** pour boutiques, supérettes, supermarchés, grossistes, pharmacies, quincailleries, etc. Interface en **français (par défaut) et en anglais**, utilisable dans **tous les pays** (devises, formats, taxes, opérateurs de paiement mobile), fonctionnement **hors ligne** (base SQLite locale), multi-postes sur le réseau du magasin, utilisable sur PC, tablette et téléphone.

- Application de bureau : **Tauri 2** (Rust) + **React 19 / TypeScript / Vite**
- Base de données : **SQLite** (intégrée, aucune installation)
- Version actuelle : **0.22.0**
- Cible principale : Windows (installateur NSIS et version portable) ; fonctionne aussi sous Linux

> État des tests : 73 tests automatiques Rust, plus un essai de vitesse avec une grosse boutique (20 000 produits, 50 000 ventes, 200 000 lignes) (0.17 : meuble hors du niveau ou sur un autre refusé, chevauchement d'un ancien plan toléré, déplacement de plusieurs meubles, copie posée à la place libre la plus proche, état du stock par meuble et par case, carte des ventes par meuble ; 0.16 : remise au-delà du seuil refusée sans le PIN d'un responsable et tracée, même ticket envoyé deux fois enregistré une fois, remises par caissier, appel réseau sans objet JSON refusé, CORS, cache des fichiers, sauvegarde vérifiée et alerte après 48 h, journal sur 14 jours, imprimante par poste ; retours en espèces et en avoir, article abîmé non remis en stock, quantité restante, délai, avoir payé en plusieurs fois, expiré, recrédité à l'annulation, rapports X et Z numérotés et chaînés, modification refusée, prix de gros par quantité et client grossiste, promotions de catégorie et prix promo, licence signée par Supabase, horloge, échéances, postes, connexions, page de paiement par carte, plan de la boutique : poser, prendre, déplacer, redimensionner, supprimer, meubles personnalisés, reprise des anciens blocs, hauteurs et dessins 3D, assistant « Créer ma boutique » pour les 4 côtés d'entrée sans chevauchement, plan proposé pour chacun des 22 types de commerce, les 462 paires et des trios d'activités sans chevauchement ni débordement, hauteur sous plafond, étage, dessin du bâtiment, personnel par identifiant et PIN, équipe par défaut, validation par le responsable choisi, blocage par compte, suppression, téléphones autorisés et codes d'accès, mise à jour depuis la 0.13, opérateurs de paiement mobile configurables, catalogue anglais), vérification TypeScript et contrôle des traductions anglaises : interface et messages (GitHub Actions, Ubuntu). L'interface anglaise n'a pas encore été relue en entier sur un vrai poste. La vue 3D a été vérifiée à l'écran sur une boutique d'exemple (vue d'ensemble, visite, déplacement refusé sur un meuble, chemin vers un produit, miniatures de la palette) ; sa fluidité sur un PC modeste n'a pas été mesurée. Test d'interface de bout en bout sous Xvfb avec Playwright : 170 vérifications sur 170, dont 84 sur un téléphone de 360 px (version mobile : chaque page de l'administrateur et de la caissière, onglets des Paramètres, menu, fiche produit, ticket et paiement, plan ; rien hors de l'écran ni caché sous une barre, export CSV téléchargé, import par le sélecteur de fichiers, message d'impression et d'export dans l'application mobile ; 0.17 : frigo posé sur la gondole et meuble hors du niveau refusés, copie à la place libre la plus proche, stock bas signalé sur le frigo et liste de ses produits, carte des ventes, deux meubles alignés ensemble, étiquettes de rayon sur l'imprimante à tickets ; 0.16 : appel depuis Internet sans objet JSON refusé, interface compressée et gardée en cache, fichier d'une ancienne version refusé (404), remise de 10 % refusée sans PIN puis validée par le gestionnaire, même ticket envoyé deux fois, remises par caissier, sauvegarde par défaut, page de test ESC/POS avec accents et coupe du papier, journal ; prix de gros et promotion du jour en caisse, changement du prix de gros confirmé par PIN, pages Promotions et Retours & avoirs, réseau local, téléphone par un faux tunnel Cloudflare, coupure et retour du tunnel, lecture seule et licence, paiement refusé depuis le réseau, plan de la boutique : palette, frigo posé, produit rangé, vue de face, produit localisé sur le plan, plan en 3D affiché par WebGL logiciel, visite, plan proposé pour supérette + quincaillerie et gardé, équipe par défaut, plus de mot de passe, téléphone refusé puis autorisé par code d'accès sur l'écran de connexion, page Personnel). 0.19 : 5 tests Rust de plus pour le compte client et le client fidèle (fonds puis dette jusqu'au plafond, versement qui rembourse d'abord la dette, fonds rendus, bonus selon les étoiles, bonus dépensé, annulation et retours, expiration, conversion des points, carte QR) ; le test d'interface vérifie le versement, l'achat payé avec les fonds, le refus au-delà des fonds, le bonus gagné, la carte de fidélité et la page Clients. Le compte client et le bonus n'ont pas encore été essayés en caisse dans une vraie boutique. 0.20 : le programme fabriqué est vérifié lisible par les moteurs web depuis Chrome 70 et iOS 13 ; le test d'interface ouvre aussi les écrans dans Safari (WebKit, taille iPhone) et mesure la vitesse sur un petit téléphone simulé en 4G (processeur ralenti 6 fois) ; l'APK est démarré dans un émulateur Android 9 ; 3 tests Rust de plus (vignettes des photos, numéros de version). L'APK x86_64 n'a pas encore été essayé dans BlueStacks. 0.21 : dans l'émulateur Android, le téléphone en « Serveur de la boutique » répond sur le réseau, se retrouve par la recherche des boutiques, démarre son service permanent et s'arrête en repassant en poste unique ; 1 test Rust de plus (adresses essayées par la recherche). Pas encore essayé : une vraie TV Android, le partage de connexion d'un vrai téléphone, l'Espace propriétaire avec un vrai compte. 0.22 : le test d'interface vérifie la visite guidée (la caméra avance de l'entrée jusqu'au produit) et fabrique les deux manuels PDF ; 1 test Rust de plus (noms des fichiers d'aide). Application Android (Tauri, 0.18) : 26 vérifications sur 26 dans un émulateur Android 14, Playwright branché sur la page de l'application (première configuration, licence, produit et vente par la caissière dans la base SQLite du téléphone, stock décompté, 9 pages à la largeur de l'écran, mode serveur refusé, liaison à un poste serveur en http, page de test reçue par une imprimante réseau, sauvegarde, bouton retour, aucune erreur JavaScript) ; iOS : lancée dans le simulateur d'iPhone. Ni l'une ni l'autre n'ont encore été essayées sur un vrai téléphone (caméra, imprimante, Wi-Fi de la boutique, choix des fichiers). L'export PNG / PDF et l'import d'un dessin en PDF n'ont pas encore été essayés sur un vrai poste. Paiements testés directement dans Supabase ; la page Cybersource n'a pas encore été essayée faute de clés. L'installateur Windows est compilé par GitHub Actions sur Windows (MSVC) et n'a pas encore été essayé sur un vrai PC Windows. Application mobile : pages FlutterFlow natives (Supabase Auth, requêtes et temps réel, sans appel d'API) ; le code Flutter généré compile sans erreur ; le bouton flottant et la fonction isServerActive passent 6 tests Flutter (go_router 12.1.3) ; la connexion et la liste des boutiques ont été essayées sur un iPhone (journaux Supabase). Supabase 0.15 (12 mois, carte de bon depuis le téléphone, poste serveur de la boutique) appliqué ; l'adresse Internet automatique (`https://gm-000123.gestimarket.shop`) fonctionne depuis le 3 novembre 2026. L'onglet Paramètres → Développeur Eden Dev (0.15.1) n'a pas encore été essayé sur un vrai PC Windows. 0.16 : l'impression directe ESC/POS et le tiroir-caisse n'ont pas encore été essayés sur une vraie imprimante (la compilation Windows est vérifiée par GitHub Actions) ; le premier chargement de l'interface sur téléphone passe de 5,2 Mo à 0,7 Mo (pages chargées à la demande, réponses compressées en gzip / brotli). 0.17 : le plan à deux doigts et à l'appui long n'a pas encore été essayé sur une vraie tablette ; les étiquettes de rayon sur une vraie imprimante thermique non plus. 0.23 : 5 tests Rust de plus (sauvegarde chiffrée par morceaux : mauvais mot de passe, fichier coupé ou modifié refusés ; restauration d'une sauvegarde protégée sur un autre appareil avec copie de sécurité ; fichiers refusés ; essai sans Internet ; mots de passe trop simples) ; le test d'interface vérifie l'essai dès la configuration, la TV simulée (boutique trouvée, caisse choisie, écran client), l'Espace propriétaire avec un faux Supabase (connexion, boutiques, paiements, mot de passe changé puis oublié) et la restauration d'une sauvegarde protégée ; l'application FlutterFlow et son test sont retirés. Pas encore essayé : restaurer sur un vrai téléphone un fichier pris dans Google Drive ou WhatsApp, et l'envoi réel du code « mot de passe oublié » (service d'e-mails à brancher dans Supabase). 0.24 : 1 test Rust de plus (acceptation des conditions, ancienne version refusée, textes hors de l'écran des paramètres) ; le test d'interface vérifie l'acceptation à la configuration, le refus d'une ancienne version, le contrat de licence affiché dans les Paramètres et le manuel lu page par page dans GestiMarket ; l'installateur Windows avec sa page de licence est fabriqué à chaque envoi. Pas encore relu par un juriste : les trois textes.

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Rôles et sécurité](#rôles-et-sécurité)
3. [Installation et utilisation](#installation-et-utilisation)
4. [Multi-postes, tablettes et téléphones](#multi-postes-tablettes-et-téléphones)
5. [Application mobile](#application-mobile)
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
- Remises, tickets en attente, client associé, **compte client** (fonds déposés, puis dette dans la limite du plafond), **bonus fidélité** utilisable en caisse ; carte de fidélité scannée = client choisi.
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
- **Plan qui aide à vendre** (0.17) : affichage **État du stock** (meuble en rouge : rupture, orange : stock bas, jaune : péremption proche, vert : rien à signaler ; chiffre sur le meuble : produits à signaler ; un clic donne la liste) et **Ventes** (chiffre d'affaires de chaque meuble, ou au m² de sol, sur une période ; meubles qui vendent le plus et le moins), vue de dessus et en 3D. Chaque produit compte pour le meuble de son emplacement principal. **Étiquettes de rayon** d'un meuble, case par case (prix, code-barres, case), sur feuille A4 ou sur l'imprimante à tickets.
- **Dessin sûr et rapide** (0.17) : un meuble ne peut ni sortir du niveau ni en chevaucher un autre (vue de dessus comme en 3D, contrôlé aussi par le serveur ; un plan ancien qui se chevauchait reste modifiable) ; un meuble posé sur un autre prend la place libre la plus proche ; repères d'alignement (bords et milieux) et cotes autour du meuble, allée de moins de 0,90 m signalée (1,20 m conseillé) ; **plusieurs meubles** (Maj + clic, cadre tracé avec Maj, appui long au doigt) se déplacent, s'alignent, s'espacent, tournent ou se suppriment ensemble ; deux doigts pour zoomer sur tablette.
- **Version mobile** (0.17.1) : chaque page tient dans la largeur d'un téléphone (grands tableaux qui défilent dans leur cadre, résumé de caisse sur une colonne, prix et promotion du ticket lisibles, messages en haut de l'écran) ; **Exporter** télécharge le fichier CSV et **Importer** ouvre le sélecteur de fichiers dans le navigateur du téléphone ; dans l'application mobile, **Imprimer**, **Exporter** et la caméra en direct expliquent quoi faire au lieu de rester sans effet.
- **Très facile à dessiner** : assistant **« Créer ma boutique »** (activités, dimensions, entrée, aperçu) qui pose murs, entrée, caisse, froid, étagères, allées et réserve ; en 3D, un meuble glissé s'aimante aux murs et à ses voisins et revient à sa place s'il en chevauche un autre ; **Répéter ×3** pour une rangée ; palette illustrée par l'image 3D de chaque meuble ; double-clic : la porte du frigo s'ouvre et ses cases s'affichent.
- **Vue de face** de chaque meuble (étages × cases) : **poser** un produit dans une case, le **prendre** (retirer), le déplacer ; un produit peut avoir plusieurs emplacements (rayon, réserve, frigo) dont un principal ; étiquettes de cases avec QR code.
- **Où est le produit ?** (Ctrl + K, aussi pour les caissiers) : en 3D, la caméra va au meuble, la case clignote et un **chemin vert au sol** mène de l'entrée au rayon ; la case est montrée dans la vue de face ; scanner l'étiquette d'une case montre son contenu.
- Stock : ajustements, inventaire, historique des mouvements.
- Achats / réceptions avec coût moyen pondéré, fournisseurs.
- **Compte client** (0.19) : un seul solde par client, dette en rouge ou fonds en vert. Un **versement** rembourse d'abord la dette, le reste devient des **fonds**, dépensés ensuite en caisse avec « Compte client » (d'abord les fonds, puis une dette jusqu'au plafond de crédit). **Fonds rendus** au client avec le PIN d'un gestionnaire (espèces sorties du tiroir ou paiement mobile). Les fonds ne sont pas du chiffre d'affaires : le tableau de bord les montre à part (« Fonds des clients »), la caisse et le rapport Z distinguent les versements et les ventes payées avec les fonds. Relevé de compte : achats, versements, fonds rendus, retours remis sur le compte.
- **Client fidèle** (0.19, formules PRO et BUSINESS, à activer dans Paramètres → Ventes) : **étoiles de 0 à 5** selon le nombre d'achats des 12 derniers mois (paliers réglables, 3, 10, 25, 50, 100 par défaut ; un achat sous le minimum ne compte pas) ; à chaque achat, **bonus de 0,5 % à 1 %** du montant payé selon les étoiles (ni la part payée en bonus, ni la part mise en dette, qui donne son bonus une fois réglée) ; le bonus paie tout ou partie d'un achat en caisse ; il expire après 12 mois sans achat (réglable). Annulations et retours remettent le bonus. **Carte de fidélité** imprimable avec QR code. Les anciens points se convertissent en bonus.

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
- **Remises contrôlées par le serveur** (0.16) : jusqu'au seuil réglable (5 % du ticket par défaut) sans validation ; au-delà, le PIN d'un gestionnaire ou de l'administrateur est exigé par le serveur lui-même, quel que soit l'appareil qui encaisse. Chaque remise est inscrite au journal ; le rapport des ventes montre les **remises par caissier** et celles validées par un responsable.
- **Pas de vente en double** (0.16) : chaque ticket porte un numéro unique choisi par la caisse ; la même vente renvoyée après une coupure du réseau n'est enregistrée qu'une fois (stock décompté une fois). Les appels réseau ont un délai maximum avec un message clair.
- **Serveur réseau durci** (0.16) : paramètres d'appel toujours vérifiés (un appel venu d'Internet ne peut plus passer pour un appel du magasin), appels d'autres sites web refusés (CORS limité aux postes clients).

---

## Installation et utilisation

### Utilisateur final (Windows)
1. Lancer `GestiMarket_x.y.z_x64-setup.exe`, ou décompresser la version portable (`gestimarket.exe` + `WebView2Loader.dll`).
2. **Première configuration** : compte boutique Eden Dev, nom du commerce et devise, administrateur (identifiant et PIN de 6 chiffres), **équipe** (gestionnaire et caissière proposés, fiches d'accès à imprimer), **activités** (jusqu'à 3, avec les catégories recommandées), puis **plan de départ** aux dimensions de la salle.
3. Chacun se connecte en touchant son nom puis en tapant son PIN (ou identifiant + PIN au clavier). D'autres postes s'ajoutent dans le menu **Personnel** : seule une caissière (ou un caissier) peut vendre.

Les données sont dans le dossier de données de l'application (`gestimarket.db`). La **sauvegarde automatique quotidienne** est active dès l'installation (0.16) : sans dossier choisi, les copies vont dans `Documents\GestiMarket\Sauvegardes` ; mieux vaut choisir une clé USB, un disque externe ou un dossier synchronisé (Paramètres → Sauvegarde). Chaque copie est vérifiée ; le tableau de bord affiche une alerte rouge si aucune sauvegarde n'a réussi depuis 48 h.

**Imprimante à tickets** (0.16, Paramètres → Ventes, propre à chaque PC) : le ticket sort directement sur l'imprimante thermique (ESC/POS, 58 ou 80 mm), sans fenêtre d'impression, le papier est coupé et le tiroir-caisse s'ouvre pour un paiement en espèces. Page de test et ouverture du tiroir depuis les Paramètres. Sans imprimante choisie, la fenêtre d'impression habituelle reste utilisée. **Imprimante réseau** (0.18) : « Imprimante réseau (adresse IP)… » puis l'adresse de l'imprimante (ex. `192.168.1.50`, port 9100 par défaut) : le ticket part directement par le Wi-Fi ou le câble, sans pilote. C'est l'imprimante des téléphones et tablettes.

**Journal** (0.16) : démarrages, erreurs, sauvegardes ratées, coupures du tunnel et de la licence sont notés 14 jours dans `journaux/` (dossier de la boutique). Paramètres → Développeur Eden Dev → « Enregistrer le journal » prépare le fichier à envoyer à Eden Dev.

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
- **Poste serveur stable** (0.17.2) : le serveur ne s'arrête plus net quand plusieurs caisses, tablettes ou téléphones l'appellent en même temps. Jusqu'à la 0.17.1, il pouvait se fermer d'un coup sous cette charge ; mettez à jour le poste serveur en priorité.
- **Compte** (0.25) : l'adresse e-mail du compte Eden Dev se **confirme par un code à 6 chiffres** (réglage « Confirm email » de Supabase : la boutique est créée quand le code est tapé, « Renvoyer le code », code demandé aussi à la connexion suivante) ; **changer l'e-mail du compte** (mot de passe actuel, puis code reçu à la nouvelle adresse ; les boutiques suivent grâce au déclencheur `gm_account_email`) ; **informations de la boutique** (nom complet, téléphone, ville, adresse) modifiables depuis l'Espace propriétaire et Abonnement & licence (`gm_update_store`, `supabase/gestimarket_compte.sql`). E-mails envoyés par Resend (domaine gestimarket.shop) ; modèles français dans Supabase.
- **Conditions, licence et manuel** (0.24) : au premier démarrage, les **conditions générales d'utilisation**, le **contrat de licence** et la **politique de données personnelles** (`docs/conditions`, français et anglais) sont résumés, lisibles en entier et acceptés au nom de la boutique ; version, date et administrateur enregistrés, version envoyée avec le compte Eden Dev ; nouvelle acceptation par l'administrateur quand les textes changent. Les installateurs Windows (`-setup.exe` et `.msi`) montrent le contrat de licence (`src-tauri/licence.rtf`, refait par `scripts/licence-rtf.py`, réglé dans `src-tauri/tauri.windows.conf.json`). Onglet **Paramètres → Aide, conditions et licence** : manuel PDF **rangé dans l'application** (`scripts/fetch-manuals.mjs` à la fabrication) et lu dans GestiMarket page par page, même sans Internet ; aide hors ligne ; les trois textes. Le manuel PDF les reprend en annexe.
- **Sûr** (0.23) :
  - **Restaurer une sauvegarde** (Paramètres → Sauvegarde, ou « J'ai une sauvegarde » au premier démarrage d'un téléphone ou d'un PC neuf) : le fichier est vérifié et son contenu montré avant ; les données actuelles sont copiées puis remplacées, sans redémarrer. Sert aussi à changer de téléphone et à passer du téléphone au PC ; l'appareil garde sa propre licence.
  - **Sauvegarde protégée par un mot de passe** (au choix) : fichier `.gmsave` chiffré (ChaCha20-Poly1305 par morceaux, clé Argon2id), illisible sans le mot de passe.
  - **Essai gratuit de 14 jours sans Internet** dès la première configuration (formule PRO, 3 postes), une fois par boutique ; le compte se crée plus tard.
  - **Mot de passe du compte** oublié (code reçu par e-mail) ou changé, depuis l'Espace propriétaire, Abonnement & licence et l'écran de connexion ; mots de passe trop simples refusés.
  - Tests automatiques de la TV et de l'Espace propriétaire, contrôle du code (ESLint, clippy, failles des modules), actions GitHub à jour, application FlutterFlow retirée.
- **Aide : visite guidée, manuel et vidéos** (0.22) : dans **Localiser un produit**, la vue **Visite** fait marcher la caméra toute seule, à hauteur d'homme, de l'entrée jusqu'au meuble du produit, puis montre l'étage et la case (pause, recommencer, vitesse ×2, « Regarder autour », plein écran sur téléphone). Le bouton **Aide** de chaque écran propose ses **vidéos** (présentation de l'écran et tâches pas à pas : vente, Orange Money, compte client, caisse, produit, visite), et chaque petit « ? » lié a « Voir en vidéo ». Les vidéos sont **filmées toutes seules sur GitHub** avec le vrai logiciel (voix de synthèse Piper : SIWIS en français et LibriTTS-R en anglais, licence CC BY 4.0 ; sous-titres incrustés). Le **manuel d'utilisation PDF** (français et anglais) est fabriqué à chaque test d'interface, avec les captures et l'aide de chaque écran. Vidéos et manuel sont publiés dans la pré-release « aide » ; **Aide hors ligne** (Paramètres → Développeur Eden Dev) les télécharge une fois sur le poste, qui les sert aussi aux téléphones de la boutique sans Internet.
- **Téléphone serveur, TV et tablette** (0.21) : une boutique **sans ordinateur** travaille avec un téléphone Android. Au premier démarrage, l'application propose **« Ma boutique sur ce téléphone »** (sans PC, même sans Internet), **« Rejoindre une boutique »** (une caisse de plus, reliée au serveur de la boutique) ou **« Espace propriétaire »**. Le téléphone peut devenir le **serveur de la boutique** (Poste & réseau) : un service permanent le garde actif écran verrouillé, et la **TV Android** (écran client), les autres téléphones, les tablettes et les iPhone (Safari, par le QR code) s'y relient par son **partage de connexion**, même sans forfait Internet. Les appareils **trouvent la boutique tout seuls** sur le Wi-Fi ou le partage de connexion. Sur une **TV Android**, la même application apparaît sur l'écran d'accueil et s'ouvre en écran client de la caisse choisie (écran toujours allumé, reconnexion automatique). **Espace propriétaire** (ce que faisait l'application FlutterFlow) : compte Eden Dev gardé connecté, **Mes boutiques** (serveur allumé ou éteint, abonnement ; liste lisible sans Internet), ouverture d'une boutique **à distance avec l'écran de l'application** (seules les données passent par Internet), **Abonnements** (paiements, carte de bon, Orange Money et Moov Money), **Contact Eden Dev**. Rappel chaque semaine d'envoyer une copie de la sauvegarde hors du téléphone.
- **Compatible et rapide** (0.20) : GestiMarket démarre aussi sur les anciens Android (moteur web Chrome 70 et plus, boîtiers TV, BlueStacks) et les iPhone depuis iOS 13 ; sinon, un message explique comment mettre à jour le moteur web. L'APK contient aussi la version x86_64 (BlueStacks, émulateurs, Chromebook). Sur téléphone et par Internet : listes de 100 lignes avec « Afficher plus », **vignettes** des photos fabriquées par le serveur (environ 4 Ko au lieu de 50 à 80), plusieurs demandes envoyées en **un seul aller-retour**, rien n'est envoyé quand l'application est cachée, caisse moins bavarde (10 s), plan vu de dessus et 3D « Simple » par défaut, pas d'effet de flou, dictionnaire anglais chargé seulement en anglais. **Nouvelle version** signalée à l'administrateur. **Pannes du programme** envoyées à Eden Dev (aucune donnée commerciale ; désactivable dans Paramètres → Sécurité).
- **Application Android et iOS** (0.18) : GestiMarket s'installe sur un téléphone ou une tablette (APK Android ; iOS compilé pour le simulateur d'iPhone, un compte Apple Developer est nécessaire pour un vrai iPhone ou iPad). Au premier lancement : **Poste client** (relié au poste serveur de la boutique par le Wi-Fi ou par l'adresse Internet ; l'adresse se lit en scannant le QR code du serveur) ou **Poste unique** (toute la boutique sur l'appareil, même sans Internet). Jamais poste serveur : Android et iOS arrêtent les applications en arrière-plan. Scanner natif (caméra du téléphone, EAN-13, QR codes…, rouvert tout seul entre deux articles en caisse), imprimante à tickets réseau, export, import, photos et sauvegarde par les fichiers du système (Drive, Fichiers, carte SD), bouton retour d'Android. Réservés au PC : écran client sur un 2ᵉ écran (sur mobile, son lien s'ouvre sur un autre appareil), plusieurs boutiques, adresse Internet, impression A4.
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

## Application mobile

L'application FlutterFlow (WebView vers la boutique) est **retirée du projet depuis la 0.23** : tout ce qu'elle faisait est dans l'application GestiMarket installée (Android et iOS), qui marche aussi sans Internet. Le projet FlutterFlow reste chez FlutterFlow ; ses pages et son test ne sont plus dans ce dépôt.

- **Espace propriétaire** (0.21) : compte Eden Dev, boutiques et état de leur serveur, ouverture à distance, abonnements, contact ; **mot de passe oublié ou changé** (0.23), **e-mail du compte et informations de la boutique** (0.25).
- Les fonctions Supabase qu'elle utilisait (`gm_my_stores`, `gm_my_server`, `gm_get_server`, paiements) servent toujours à l'Espace propriétaire et à la publication de l'adresse du poste serveur (`supabase/*.sql`).
- Les navigateurs des téléphones et tablettes (Chrome, Safari) ouvrent toujours la boutique à l'adresse du poste serveur ou à son adresse Internet (`https://gm-000123.gestimarket.shop`).

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
| `e2e` | envoi sur `main` | compilation debug, GestiMarket en mode serveur sous Xvfb, `e2e/run.mjs` (Playwright) avec le faux tunnel et la fausse API Supabase de `e2e/mocks.mjs`, puis `e2e/mobile.mjs` : chaque page sur un téléphone de 360 px (administrateur et caissière) ; captures publiées dans une pré-release `e2e-N` |
| `qualite` | chaque envoi | ESLint (`eslint.config.js`), `cargo clippy` (avertissements refusés), failles connues des modules : `npm audit` et `cargo audit` |
| _(retiré en 0.23)_ | | test du code FlutterFlow (application retirée) |
| `android-test`, `android-apk`, `ios` (workflow « Android et iOS », `tauri-mobile.yml`) | changement de l'interface ou de Rust, étiquette `v*` | projet Android généré par `scripts/mobile/android-init.sh` (page entre les barres du système, bouton retour, http du réseau local autorisé) ; APK debug lancé dans un émulateur Android 14 et piloté par Playwright (`e2e/android.mjs`) ; APK arm64 + armv7 signé avec la clé de la boutique (secrets `ANDROID_KEYSTORE_BASE64` et `ANDROID_KEYSTORE_PASSWORD`, sinon clé d'essai) ; iOS compilé pour le simulateur et lancé ; résultats dans une pré-release `mobile-N`, APK joint à la release |
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
└── supabase/                 Scripts SQL et fonctions d'Eden Dev (comptes, licences, paiements, serveurs)
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
| 011 | Remise validée par un responsable (`sales.discount_approved_by`), numéro unique de ticket contre les doublons (`sales.client_ref`, index unique), validation des remises passée au niveau gestionnaire |

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
- [x] Plan qui aide à vendre : état du stock et ventes par meuble, étiquettes de rayon ; dessin sans chevauchement, plusieurs meubles, cotes d'allée, tablette
- [ ] Dépenses, bons de commande, variantes, codes-barres de balance ; retours déduits des rapports de ventes et du tableau de bord
- [ ] Chiffrement de la base (SQLCipher) et sauvegardes chiffrées
- [ ] Tableau de bord Eden Dev, paiement mobile automatique, mises à jour signées
- [ ] Application mobile : essai sur de vrais téléphones, publication sur le Play Store et l'App Store
- [ ] Test sur vrai PC Windows et vrais téléphones
- [ ] Synchronisation de données entre magasins distants (Supabase) : hors périmètre actuel
- [ ] Conversion libre entre unités (kg ↔ g…)
- [ ] Module réglementaire pharmacie (médicaments sur ordonnance)
