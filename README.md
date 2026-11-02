# GestiMarket

Logiciel de **caisse et de gestion de magasin** pour boutiques, supérettes, supermarchés, grossistes, pharmacies, quincailleries, etc. Interface 100 % française, fonctionnement **hors ligne** (base SQLite locale), multi-postes sur le réseau du magasin, utilisable sur PC, tablette et téléphone.

- Application de bureau : **Tauri 2** (Rust) + **React 19 / TypeScript / Vite**
- Base de données : **SQLite** (intégrée, aucune installation)
- Version actuelle : **0.8.0**
- Cible principale : Windows (installateur NSIS et version portable) ; fonctionne aussi sous Linux

> État des tests : 28 tests automatiques Rust et vérification TypeScript (GitHub Actions, Ubuntu). Test d'interface de bout en bout sous Xvfb avec Playwright : 24 vérifications sur 24 (PC et tablette sur le réseau local, téléphone 390 px par un faux tunnel Cloudflare, coupure puis retour du tunnel). L'installateur Windows est compilé par GitHub Actions sur Windows (MSVC) et n'a pas encore été essayé sur un vrai PC Windows. Le widget FlutterFlow est vérifié par `dart analyze` mais n'a pas été essayé sur un vrai téléphone.

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Rôles et sécurité](#rôles-et-sécurité)
3. [Installation et utilisation](#installation-et-utilisation)
4. [Multi-postes, tablettes et téléphones](#multi-postes-tablettes-et-téléphones)
5. [Application mobile (FlutterFlow + Supabase)](#application-mobile-flutterflow--supabase)
6. [Développement](#développement)
7. [Architecture](#architecture)
8. [Base de données](#base-de-données)
9. [Interface RPC](#interface-rpc)
10. [Feuille de route](#feuille-de-route)

---

## Fonctionnalités

### Vente (caisse)
- Scan à la douchette, **à la caméra** (téléphone, tablette, webcam) ou saisie manuelle d'un code au pavé numérique ; syntaxe `3*code` pour la quantité.
- Navigation dans les catégories par fil d'Ariane, produits avec photo, emplacement et stock.
- **Conditionnements** : vendre au carton, au sac ou au pack (1 carton = 12 bouteilles) avec code-barres et prix propres ; le stock est décompté en unités de base.
- Remises, tickets en attente, client associé, vente à crédit (plafond par client), points de fidélité.
- **Paiements** : espèces (monnaie rendue, pavé numérique), **Orange Money / Sarali** (numéro marchand ou QR code, ID de transaction obligatoire et unique), autre mobile money, carte, crédit ; paiement partiel multi-moyens.
- Ticket imprimable, écran client.
- **Suivi des collègues** : voir en direct le ticket des autres caisses et **reprendre un client** sans tout ressaisir.

### Catalogue
- **Code-barres obligatoire** (EAN ou QR) : généré automatiquement si absent ; étiquettes imprimables en code-barres ou QR code.
- Champs : désignation, référence interne, marque, catégorie, unité, prix d'achat et de vente TTC, TVA, stock, seuil d'alerte, fournisseur, péremption, photo, emplacement, statut.
- **Catégories en arbre sans limite de niveaux** (catégorie → sous-catégorie → famille…), déplacement, masquage, couleur et photo, import / export CSV, détection des catégories vides et des produits sans catégorie.
- **Catalogue prédéfini** de 32 catégories avec leurs sous-catégories (+ menu restaurant), chargeable à la carte sans doublon.
- **11 types de commerce** (boutique, commerce général, supermarché, supérette, grossiste, pharmacie, vêtements et chaussures, quincaillerie, électronique, boutique spécialisée, restaurant) : l'interface s'adapte (péremption, marque, référence, conditionnements, quantités décimales, services).
- Familles d'unités (poids, volume, longueur, conditionnement, boissons, matériaux, tissus…).
- Import de produits depuis Excel / CSV.

### Magasin
- **Emplacements** : bloc (A à Z), étage, rangée ; plan du magasin ; recherche « Où est le produit ? » (Ctrl + K).
- Stock : ajustements, inventaire, historique des mouvements.
- Achats / réceptions avec coût moyen pondéré, fournisseurs.
- Clients : dettes, règlements, relevé de compte.

### Pilotage
- Tableau de bord administrateur (chiffre d'affaires, marge, alertes de stock et de péremption, créances).
- **Tableau de bord du caissier** : statistiques de sa session (ventes, panier moyen, espèces attendues, répartition par moyen de paiement, ventes par heure, meilleurs articles).
- Sessions de caisse : fond de caisse, entrées / sorties d'espèces, clôture avec calcul de l'écart ; clôture forcée par l'administrateur.
- Rapports de ventes, suivi des paiements mobiles, journal d'activité complet.

### Personnalisation
- Logo, nom du commerce, couleur du thème, style du menu, thème clair / sombre ; thème par défaut sinon.
- Aide contextuelle (bouton « ? ») sur chaque écran et chaque action importante.

---

## Rôles et sécurité

| Rôle | Droits |
|---|---|
| **Caissier / caissière** | **Seul rôle qui vend** : caisse, clients, ses ventes, sa session de caisse, son tableau de bord |
| **Gestionnaire** | Produits (ajout, modification, suppression), catégories, emplacements, stock, achats, fournisseurs. Ne vend pas |
| **Administrateur** | Contrôle total : tableau de bord, rapports, utilisateurs, paramètres, annulations, clôture forcée d'une caisse. Ne vend pas |

- **Séparation des rôles** : les administrateurs et gestionnaires n'ouvrent pas de caisse. En cas de fuite de leur mot de passe, personne ne peut encaisser avec leurs droits élevés. La règle est appliquée côté serveur.
- **Code PIN** pour chaque utilisateur (haché Argon2) : connexion rapide et **confirmation de toute action critique** (annulation de vente, remise, suppression d'article, changement de prix, archivage, ajustement de stock, clôture de caisse, paramètres, changement de réseau…). Un responsable peut valider l'action d'un autre ; c'est tracé.
- Blocage temporaire après 5 PIN erronés.
- Mots de passe hachés Argon2 ; sessions réseau par jeton avec expiration.
- Journal d'activité de toutes les opérations sensibles.
- Montants stockés en **unités mineures entières** (pas d'erreur d'arrondi) ; prix relus en base à chaque vente (le client ne fixe jamais un prix).

---

## Installation et utilisation

### Utilisateur final (Windows)
1. Lancer `GestiMarket_x.y.z_x64-setup.exe`, ou décompresser la version portable (`gestimarket.exe` + `WebView2Loader.dll`).
2. **Première configuration** : nom du commerce, devise, compte administrateur, type de commerce (avec création des catégories recommandées), puis code PIN.
3. Créer au moins un **compte caissier** (menu Utilisateurs) : seul un caissier peut vendre.
4. Chaque utilisateur définit son code PIN à sa première connexion.

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

Au lieu de développer deux applications natives, l'application mobile (iOS / Android) est une simple **WebView FlutterFlow** qui ouvre GestiMarket à l'adresse du poste serveur.

```
Poste serveur ──(toutes les 30 s)──► Supabase : gm_publish_server(code, secret, actif, adresses)
Application FlutterFlow ─(démarrage)► Supabase : gm_get_server(code) → { active, url, … }
Application FlutterFlow ──► WebView(url)  ──► GestiMarket
```

- Réglage : **Paramètres → Réseau & mobile** (URL du projet Supabase, clé publique `anon`, bouton « Publier maintenant »). Le code du commerce (`GM-XXXXXX`) et son QR code sont créés automatiquement.
- À la fermeture du serveur, l'état « arrêté » est publié immédiatement.
- Sécurité : la table n'est pas lisible directement ; seul le poste qui a créé le code peut le mettre à jour (secret haché). N'utiliser **jamais** la clé `service_role`.
- Les adresses publiées sont celles du réseau local ; pour joindre le magasin depuis **un autre réseau** (4G, autre Wi-Fi), renseignez l'**adresse publique** (voir ci-dessous).
- Un widget FlutterFlow fournit en plus un **scanner natif** de codes-barres ; la page le détecte automatiquement (canal JavaScript `GestiMarketNative`).

### Accès depuis Internet (tunnel Cloudflare)

Chaque magasin garde son PC serveur ; un **tunnel Cloudflare** lui donne une adresse publique fixe en HTTPS (ex. `https://eden.mondomaine.com`), sans redirection de port. `cloudflared` est installé en service Windows (démarrage automatique) et relie `https://eden.mondomaine.com` à `http://localhost:7878`. L'adresse est saisie dans **Paramètres → Réseau & mobile → Adresse publique** et publiée dans Supabase (`public_url`). Il faut un domaine géré par Cloudflare, un sous-domaine par magasin. Protégez l'adresse avec Cloudflare Access et des PIN solides : une caisse est exposée sur Internet.

### Réseau local ou Internet : indication de la route

- Le serveur détecte la route de chaque appareil : les requêtes qui arrivent par le tunnel (en-têtes Cloudflare, depuis 127.0.0.1) sont « **Internet** » et gardent leur vraie adresse IP ; les autres sont « **Réseau local** ».
- **Poste & réseau** affiche un badge de route pour chaque appareil connecté et pour ce poste ; la pastille de connexion indique « Synchronisé · Réseau local » ou « Synchronisé · Internet ».
- Sur le poste serveur, le test de l'adresse publique (`/api/ping`, toutes les 30 s) indique « Réseau local disponible », « Internet disponible » ou « indisponible », et « Les deux routes sont actives ».
- Le widget FlutterFlow `GestiMarketWebView` (paramètres `shopCode`, `supabaseUrl`, `supabaseKey`) choisit le **réseau local d'abord**, sinon Internet, et se **reconnecte seul** quand le PC serveur redémarre (pages 502/530 du tunnel, coupures). Voir `supabase/APPLICATION_MOBILE.md`, section 5.

Guide complet : [`supabase/APPLICATION_MOBILE.md`](supabase/APPLICATION_MOBILE.md) · script SQL : [`supabase/gestimarket_mobile.sql`](supabase/gestimarket_mobile.sql) · widget : [`supabase/flutterflow/gestimarket_webview.dart`](supabase/flutterflow/gestimarket_webview.dart)

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

Pour changer de version : `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`.

### Intégration continue (`.github/workflows/build.yml`)

| Job | Quand | Contenu |
|---|---|---|
| `test` | chaque envoi | `npm run typecheck` et `cargo test` sous Ubuntu |
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
│   │   │                     users, auth, audit, backup, media, locations
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
Tauri 2, rusqlite (SQLite intégré), argon2, axum + tower-http, axum-server (HTTPS rustls), rcgen, ureq, chrono · React 19, react-router (HashRouter), recharts, lucide-react, qrcode, jsbarcode, @zxing/library.

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

Conventions : montants en entiers (unités mineures de la devise), quantités en réels, prix TTC, dates locales.

---

## Interface RPC

Les commandes sont appelées par `POST /rpc/{commande}` (corps JSON, en-tête `Authorization: Bearer <jeton>`) ou par la commande Tauri `rpc`. Réponse : `{ "ok": … }` ou `{ "error": "message en français" }`.

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
- [ ] Application mobile FlutterFlow (WebView) à construire et tester sur de vrais téléphones
- [ ] Test sur vrai PC Windows et vrais téléphones
- [ ] Synchronisation de données entre magasins distants (Supabase) : hors périmètre actuel
- [ ] Conversion libre entre unités (kg ↔ g…)
- [ ] Module réglementaire pharmacie (médicaments sur ordonnance)
