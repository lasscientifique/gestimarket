# GestiMarket — Logiciel de gestion de supermarché et de boutiques

Application de bureau **hors-ligne** (Windows, Linux, macOS) construite avec **Tauri 2**, **Rust**, **SQLite** et **React/TypeScript**.
Elle couvre la caisse, le catalogue, le stock, les achats, les clients et le crédit, les sessions de caisse, les rapports et la traçabilité.

---

## 1. Fonctionnalités (version 0.2)

### Nouveautés 0.4
| Module | Contenu |
|---|---|
| **3 rôles** | **Caissier / caissière** : la vente (caisse, clients, ses ventes, sa session). **Gestionnaire** : les produits (ajout, modification, suppression), catégories, emplacements, stock, achats, fournisseurs. **Administrateur** : contrôle total (tableau de bord, rapports, utilisateurs, paramètres et réglages, annulations). Droits vérifiés côté serveur. |
| **Code PIN** | Chaque utilisateur crée son PIN (4 à 6 chiffres) à la 1ʳᵉ connexion. **Connexion rapide** : on touche son nom puis on tape son PIN. **Chaque action critique est confirmée par PIN** : annulation de vente (administrateur), changement de prix, archivage, import, ajustement de stock (gestionnaire), clôture de caisse et mouvements d'espèces, utilisateurs et paramètres (administrateur). En caisse : retrait d'article, baisse de quantité, ticket vidé, remises (niveau réglable). Un responsable peut autoriser sur place avec son propre PIN (tracé au journal). Blocage 1 min après 5 erreurs ; PIN chiffrés (Argon2). |
| **Personnalisation** | Logo, nom et **couleur du thème** du magasin (9 couleurs prêtes ou couleur personnalisée), style du menu (sombre, couleur du thème, clair), thème clair/sombre par défaut. Sans réglage, le thème GestiMarket par défaut est conservé. Logo et nom en haut du menu. |
| **Design premium** | Police Inter intégrée (hors ligne), menu latéral repliable (replié par défaut pour les caissiers), écran de connexion à l'image du magasin, cartes et boutons retravaillés, pavé numérique tactile pour l'encaissement. |
| **Paramètres en onglets** | Commerce · Apparence · Orange Money · Ventes & ticket · Sécurité & PIN · Réseau & écran client · Sauvegarde. |

### Nouveautés 0.3
| Module | Contenu |
|---|---|
| **Écran client** | Le client voit ses articles (avec photos), les prix, le total, le montant reçu, la monnaie à rendre et le QR code Orange Money / Sarali, **avant de payer**. Sur un 2ᵉ écran branché à la caisse (bouton « Écran client », plein écran automatique), ou sur une **TV, un projecteur ou un autre PC** via un navigateur (adresse indiquée dans Paramètres → Écran client). |
| **Catégories → sous-catégories → produits** | Deux niveaux (ex. Boissons › Jus, Eaux). En caisse, une 2ᵉ rangée de filtres affiche les sous-catégories. Import Excel avec colonne « Sous-catégorie » ou « Catégorie > Sous-catégorie ». |
| **Blocs de A à Z** | Les blocs se nomment par lettre (A, B, C…) ; création en série (ex. blocs A à F × étages 1–3 × rangées 1–10). |
| **Aide intégrée** | Bouton **Aide** sur chaque écran (à quoi sert l'écran, comment faire, astuces) et petits boutons **?** à côté des actions et réglages importants. |
| **Multi-postes en réseau local** | Trois modes : **poste unique**, **poste serveur** (garde la base et la partage en Wi-Fi ou câble Ethernet), **poste client** (travaille sur la base du serveur). Le serveur sert aussi l'application aux **navigateurs** du réseau : tablettes, téléphones (Android, iPhone) et TV. Sessions sécurisées par jeton, mêmes droits que sur le poste serveur. |

#### Mettre en place plusieurs caisses
1. Sur le PC qui restera allumé (bureau / caisse principale) : **Paramètres → Réseau multi-postes → Poste serveur**, puis « Enregistrer et redémarrer ». Notez l'adresse affichée (ex. `http://192.168.1.10:7878`). Autorisez GestiMarket dans le pare-feu Windows si demandé.
2. Sur chaque autre caisse : installez GestiMarket, puis au premier écran « Se connecter au poste serveur » (ou depuis l'écran de connexion → « modifier »), choisissez **Poste client**, saisissez l'adresse, « Tester », puis « Enregistrer et redémarrer ».
3. Donnez un nom à chaque poste (Caisse 1, Caisse 2…) : chaque écran client affiche le panier de sa caisse.
4. Tablette / téléphone / TV : ouvrez l'adresse du serveur dans le navigateur.

### Nouveautés 0.2
| Module | Contenu |
|---|---|
| **Photos** | Photo de chaque produit et de chaque catégorie, logo du commerce (menu + tickets). Les images sont redimensionnées automatiquement et stockées dans la base : elles sont donc incluses dans les sauvegardes. |
| **Emplacements (Bloc / Étage / Rangée)** | Création d'un bloc complet en un clic (ex. Bloc 2, étages 1 à 3, rangées 1 à 10), plan visuel du magasin, rangement des produits (fiche produit, plan, sélection multiple, import), fiche de rayon imprimable. |
| **Localiser un produit** | Recherche par nom, catégorie ou code-barres scanné ; affichage en grand du **Bloc · Étage · Rangée** et mise en évidence sur le plan. Accessible partout avec **Ctrl + K**, y compris pour les caissiers. |
| **Orange Money / Sarali** | En caisse : QR code marchand affiché au client (photo de l'autocollant officiel ou contenu texte), numéro marchand, saisie ou **scan** de l'ID de transaction et du numéro du client. Un même ID ne peut jamais être réutilisé (anti-fraude). Écran **Paiements mobiles** pour le rapprochement avec le relevé de l'opérateur (export Excel). |
| **Paiements multiples** | Une vente peut être réglée en plusieurs fois : Orange Money + espèces, carte + espèces, etc. La monnaie n'est rendue que sur les espèces ; le reste peut aller au crédit client. |
| **Tickets en attente** | Mettre un ticket de côté (client qui a oublié un article) et le reprendre plus tard (**F8**). |
| **Étiquettes** | Impression d'étiquettes code-barres (planche A4 de 24) ou d'étiquettes de rayon (prix + code-barres + emplacement). |
| **Import Excel / CSV** | Import ou mise à jour du catalogue (code-barres, désignation, catégorie, prix, stock, seuil, bloc / étage / rangée, péremption), avec modèle à télécharger et aperçu avant import. |
| **Péremption** | Date de péremption par produit et par lot reçu, alertes au tableau de bord et dans le stock (délai paramétrable). |
| **Sauvegarde automatique** | Une copie par jour dans le dossier choisi (clé USB, disque externe, dossier synchronisé), rotation des anciennes copies. |
| **Nouveau design** | Interface repensée (vignettes photo en caisse, cartes de catégories, plan interactif) et **mode sombre**. |

### Fonctionnalités de base
| Module | Contenu |
|---|---|
| **Caisse (point de vente)** | Scan de code-barres (douchette USB), recherche, filtres par catégorie, syntaxe `3*code` pour la quantité, produits au poids (kg), remise par ligne et sur le ticket, client associé, calcul de la monnaie, reste à crédit, impression du ticket (58 ou 80 mm). Raccourcis : **F2** recherche, **F4** client, **F8** tickets en attente, **F9** encaissement, **Ctrl+K** localiser un produit. |
| **Sessions de caisse** | Ouverture avec fond de caisse, entrées/sorties d'espèces, clôture avec comptage et calcul de l'écart, détail par moyen de paiement (dont Orange Money). |
| **Produits** | Code-barres EAN (saisi, scanné ou généré), catégories, fournisseur, unité, prix d'achat/vente TTC, TVA, marge, seuil d'alerte, archivage, export. |
| **Stock & inventaire** | Valorisation, alertes de rupture et de péremption, ajustements d'inventaire, pertes/casse, retours, historique des mouvements. |
| **Achats / réceptions** | Entrée en stock, coût moyen pondéré (CMUP), mise à jour des prix de vente, dates de péremption par lot. |
| **Clients** | Plafond de crédit, dettes, règlements (espèces, Orange Money avec ID de transaction…), relevé de compte, points de fidélité. |
| **Ventes, rapports, journal** | Historique (recherche par n° de ticket, client ou ID de transaction), annulation avec motif, rapports par période / jour / moyen de paiement / catégorie / caissier / produit, journal d'activité. |
| **Utilisateurs & rôles** | Administrateur, Gérant, Caissier ; droits vérifiés côté Rust ; mots de passe Argon2. |

> **À propos d'Orange Money / Sarali** : la confirmation automatique en temps réel nécessite un accès à l'API marchande de
> l'opérateur (contrat et identifiants fournis par Orange) et une connexion Internet. La version actuelle fonctionne
> **sans Internet** : le client paie par QR code ou numéro marchand, le caissier enregistre l'ID de transaction (saisi ou
> scanné), et le rapprochement se fait avec le relevé. L'architecture (table `sale_payments`, références uniques) est prête
> pour brancher l'API dès que vous disposez des accès.

## 2. Architecture

```
gestimarket/
├── src/                      # Frontend React + TypeScript
│   ├── api.ts                # Appels typés vers les commandes Rust (invoke)
│   ├── types.ts              # Types partagés (miroir des structures Rust)
│   ├── context/AppContext.tsx# Utilisateur, paramètres, notifications, confirmations
│   ├── components/           # Layout, modales, sélecteur de produit, détail de vente…
│   ├── lib/                  # Formatage (devise, dates), tickets, export CSV
│   └── pages/                # Un fichier par écran
└── src-tauri/                # Backend Rust
    ├── migrations/           # Schéma SQLite versionné (PRAGMA user_version)
    └── src/
        ├── lib.rs            # Démarrage Tauri, base de données, enregistrement des commandes
        ├── commands.rs       # Commandes exposées au frontend + contrôle des droits
        ├── state.rs          # Connexion SQLite + utilisateur connecté
        ├── db.rs             # Ouverture, migrations, utilitaires SQL
        ├── error.rs          # Erreurs traduites en messages français
        └── services/         # Logique métier (ventes, stock, caisse, rapports…) + tests
```

**Choix techniques importants**

- **Hors-ligne d'abord** : base SQLite locale (mode WAL), aucune connexion Internet nécessaire.
- **Montants en entiers** dans la plus petite unité de la devise (pas d'erreurs d'arrondi des flottants).
- **Transactions** : une vente (lignes, stock, crédit, fidélité) est enregistrée entièrement ou pas du tout.
- **Prix relus en base** au moment de la vente : le frontend ne fixe jamais les prix.
- **Logique métier testée** : `cargo test` exécute des scénarios complets sur une base en mémoire.

## 3. Installation pour le développement

### Prérequis
- [Node.js 20+](https://nodejs.org) et [Rust](https://rustup.rs) (stable)
- **Windows** : « Microsoft C++ Build Tools » et WebView2 (déjà présent sur Windows 10/11)
- **Linux** : `sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev libayatana-appindicator3-dev librsvg2-dev`
- Détails : https://v2.tauri.app/start/prerequisites/

### Commandes
```bash
npm install            # dépendances JavaScript
npm run tauri dev      # lance l'application en mode développement (rechargement à chaud)
npm run test:rust      # tests de la logique métier
npm run typecheck      # vérification TypeScript
npm run tauri build    # crée l'installateur (.msi / .exe sous Windows, .deb / .AppImage sous Linux)
```

Au premier lancement, un assistant demande le nom du commerce, la devise et crée le compte administrateur.

### Compiler l'installateur Windows depuis Linux (MinGW)
```bash
sudo apt install nsis gcc-mingw-w64-x86-64
rustup target add x86_64-pc-windows-gnu
npx tauri build --target x86_64-pc-windows-gnu --bundles nsis
# → src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/GestiMarket_<version>_x64-setup.exe
```

### Générer les installateurs sans machine Windows
Le workflow GitHub Actions `.github/workflows/build.yml` lance les tests à chaque push et, lorsqu'on pousse un tag
(`git tag v0.1.0 && git push --tags`), produit les installateurs Windows, Linux et macOS dans un brouillon de release.

## 4. Données et sauvegarde

La base `gestimarket.db` se trouve dans le dossier de données de l'application :
- Windows : `%APPDATA%\com.gestimarket.app\`
- Linux : `~/.local/share/com.gestimarket.app/`
- macOS : `~/Library/Application Support/com.gestimarket.app/`

Utilisez **Paramètres → Sauvegarder maintenant** (sauvegarde cohérente même pendant l'utilisation) et conservez les copies
sur un support externe. Pour restaurer : fermer l'application, supprimer `gestimarket.db-wal` et `gestimarket.db-shm`
s'ils existent, puis remplacer `gestimarket.db` par la sauvegarde.

## 5. Matériel compatible

- **Douchette code-barres USB** (mode clavier) : fonctionne directement dans la caisse et les réceptions.
- **Imprimante ticket thermique** 58/80 mm : installer son pilote Windows, puis l'imprimer via « Imprimer le ticket ».
- **Tiroir-caisse** : se connecte généralement à l'imprimante ticket (ouverture à l'impression, réglage du pilote).

## 6. Feuille de route proposée

1. Confirmation automatique Orange Money via l'API marchande (dès obtention des identifiants auprès d'Orange).
2. Impression directe ESC/POS (sans boîte de dialogue) et ouverture du tiroir-caisse.
3. Retours partiels / avoirs, factures A4 et devis.
4. Promotions (prix barrés, 2+1, happy hour).
5. **Synchronisation cloud Supabase** entre boutiques situées sur des réseaux différents (voir ci-dessous).
6. Bons de commande fournisseurs générés depuis les alertes de stock.
7. Mises à jour automatiques (plugin `tauri-plugin-updater`).
8. Indicateurs avancés (rotation des stocks, analyse ABC, saisonnalité) et export PDF.

## 7. Étapes suivantes prévues : Supabase et applications mobiles

**Synchronisation cloud (Supabase)** pour des boutiques sur des réseaux différents :
- chaque boutique garde sa base locale (fonctionne sans Internet) ;
- un journal des modifications (ventes, stocks, produits, clients) est envoyé vers Supabase dès que la connexion revient ;
- le catalogue et les prix peuvent être gérés au siège et redescendus dans chaque boutique ;
- rapports consolidés multi-boutiques.
Nécessite un projet Supabase (compte et choix de la région) : à créer avec le propriétaire.

**Applications mobiles Android / iOS** :
- dès aujourd'hui : tablettes et téléphones utilisent GestiMarket dans le navigateur, connectés au poste serveur du magasin (Wi-Fi) ;
- ensuite : applications installables (Tauri 2 mobile) pour l'inventaire avec la caméra comme lecteur de code-barres, la consultation des stocks et des rapports à distance (via Supabase).
