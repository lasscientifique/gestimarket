# Application mobile GestiMarket (FlutterFlow)

Projet FlutterFlow : **GestiMarket** (`gesti-market-ywxut8`), paquet `com.edendev.gestimarket`, Supabase d'Eden Dev branché avec la clé publique (jamais la clé `service_role`).

L'application ouvre GestiMarket complet dans une WebView (l'interface s'adapte au téléphone). Elle a quatre pages, chacune portée par un widget personnalisé dont le code est dans `supabase/flutterflow/` :

| Page | Widget | Rôle |
|---|---|---|
| `SplashPage` (départ) | `GestiMarketSplash` | Logo, nom, « par Eden Dev » ; puis la boutique retenue sur le téléphone, ou la connexion |
| `ConnexionPage` | `GestiMarketConnexion` | **Propriétaire** : e-mail et mot de passe du compte boutique → ses boutiques → « Ouvrir » ou « Abonnement ». **Personnel** : code du commerce tapé ou scanné (QR du PC) |
| `MagasinPage` | `GestiMarketWebView` | GestiMarket : réseau local d'abord, sinon Internet ; écran **« Serveur éteint »** quand le PC est arrêté |
| `AbonnementPage` | `GestiMarketAbonnement` | Formule, échéance, postes, paiements ; payer par carte de bon, Orange Money ou carte Visa ; 1, 3, 6 ou 12 mois (2 offerts) |

```
Poste serveur GestiMarket ──(toutes les 30 s)──► Supabase : gm_publish_server (adresses, boutique Eden Dev du PC)
Propriétaire : compte boutique ──► gm_my_stores ──► gm_my_server(boutique) ──► adresse du PC
Personnel : code du commerce ──► gm_get_server(code) ──► adresse du PC
Application ──► WebView : http://192.168.x.x:7878 (Wi-Fi du magasin) ou https://gm-000123.<domaine> (Internet)
```

## 1. Ce que fait chaque page

**Démarrage.** Le logo est dessiné par le widget (aucune image à charger). Une boutique déjà ouverte sur ce téléphone est rouverte directement.

**Connexion.**
- La propriétaire se connecte une fois ; la session reste sur le téléphone.
- Le poste serveur de chaque boutique est retrouvé tout seul : le PC publie l'identifiant de sa boutique Eden Dev, et Supabase vérifie que ce PC y est bien relié.
- Le personnel tape ou scanne le code du commerce (Paramètres → Réseau & mobile sur le PC). Il se connecte ensuite dans GestiMarket avec son identifiant et son code PIN. Depuis Internet, la première fois, il tape aussi le code d'accès de 8 caractères donné par l'administrateur (0.14).

**Magasin.**
- Route : réseau local d'abord (réponse de `/api/ping` en moins de 1,5 s), sinon l'adresse publique.
- **PC serveur éteint** : écran « Serveur éteint » avec le nom de la boutique et l'heure de la dernière activité. La reconnexion se fait seule toutes les 10 s. Deux boutons : « Mon abonnement » (marche sans le PC) et « Changer de boutique ».
- Redémarrage du PC (pages 502/530 du tunnel) ou coupure du Wi-Fi : la page se recharge seule.
- La pastille « Réseau local / Internet », en bas à gauche, ouvre un menu : abonnement, autre boutique, recharger.
- Scanner natif de codes-barres pour la caisse et bouton retour d'Android.

**Abonnement** (réservé à la propriétaire). L'écran affiche la formule, la date de fin, les jours restants, les PC reliés et les 12 derniers paiements. Trois façons de payer :
- **Carte de bon** : activation immédiate.
- **Orange Money** : code marchand, puis l'ID de transaction ; Eden Dev valide.
- **Carte Visa** : page sécurisée Cybersource dans l'application ; le numéro de carte ne passe ni par GestiMarket ni par Eden Dev.

La licence du PC se met à jour toute seule ensuite.

## 2. Mettre à jour le projet FlutterFlow

Le dossier `gestimarket-mobile` (à côté du dépôt) est relié au projet par l'outil FlutterFlow. Son script `dsl/edit.dart` envoie le code des quatre widgets depuis `supabase/flutterflow/` et crée les pages si elles manquent :

```bash
dart pub global run flutterflow_cli ai run dsl/edit.dart --dry-run
dart pub global run flutterflow_cli ai run dsl/edit.dart --commit-message "…"
```

Il règle aussi :
- Android : `android:usesCleartextTraffic="true"`, pour les adresses http du réseau local. La permission caméra vient du paquet `mobile_scanner`.
- iOS : `NSCameraUsageDescription`, `NSLocalNetworkUsageDescription` et `NSAppTransportSecurity → NSAllowsLocalNetworking`.
- Dépendance ajoutée : `mobile_scanner 6.0.0`. Les autres paquets sont ceux de FlutterFlow : `webview_flutter`, `supabase_flutter`, `shared_preferences`, `http` et `go_router`.

## 3. Images (à poser une fois dans FlutterFlow)

Les images sont dans `supabase/flutterflow/images/` (copiées aussi dans les livrables) :

| Fichier | Où le mettre |
|---|---|
| `GestiMarket_splash_logo.png` | FlutterFlow → Settings → App Assets → **Splash Image**, couleur de fond `#0F766E` |
| `GestiMarket_icone_1024.png` | FlutterFlow → Settings → App Assets → **Launcher Icon** |
| `GestiMarket_splash_1080x1920.png`, `GestiMarket_splash_1242x2688.png` | Écran complet : fiches du Play Store et de l'App Store, présentations |

L'outil FlutterFlow ne sait pas encore téléverser ces images : il faut le faire à la main dans l'éditeur.

## 4. Supabase

À exécuter dans le SQL Editor, dans cet ordre :
1. `gestimarket_licences.sql`
2. `gestimarket_types_commerce.sql`
3. `gestimarket_paiements.sql`
4. `gestimarket_international.sql`
5. `gestimarket_mobile.sql`
6. `gestimarket_abonnement_mobile.sql` (0.15)

Fonctions Edge à déployer, avec *Verify JWT* désactivé : `gm-license`, `gm-pay`, `gm-tunnel`.

| Fonction | Appelée par | Rôle |
|---|---|---|
| `gm_get_server(code)` | personnel (clé publique) | adresses du poste serveur d'un code du commerce |
| `gm_my_stores()`, `gm_my_server(boutique)` | propriétaire connectée | ses boutiques ; poste serveur d'une boutique |
| `gm_my_payments(boutique)`, `gm_my_redeem_voucher(boutique, code)` | propriétaire connectée | paiements ; carte de bon depuis le téléphone |
| `gm_declare_payment(…)` | propriétaire connectée | Orange Money |
| fonction `gm-pay` (`store_code`, `plan`, `months`) | propriétaire connectée | carte Visa |

## 5. Adresse Internet automatique de chaque boutique

Sur le PC serveur, le chemin est **Paramètres → Réseau & mobile → Adresse Internet de la boutique → Créer l'adresse Internet**. L'administrateur tape l'e-mail et le mot de passe du compte boutique, une seule fois.

1. La fonction `gm-tunnel` crée le tunnel Cloudflare de la boutique.
2. Elle crée aussi l'adresse `https://gm-000123.<domaine>`, qui mène au port du PC serveur.
3. Le PC lance `cloudflared` lui-même et publie l'adresse pour l'application.

Il faut installer cloudflared une fois sur le PC serveur :

```bash
winget install --id Cloudflare.cloudflared
```

Côté Eden Dev, une fois :
1. **Le domaine** : `gestimarket.shop`, acheté chez Hostinger et ajouté à Cloudflare (plan Free). Chez Hostinger, ses serveurs DNS doivent être les deux que Cloudflare indique ; il passe ensuite « Active ». Le domaine est enregistré dans `gm_config.tunnel_domain`. Le secret `TUNNEL_DOMAIN`, s'il existe, a priorité.
2. **Un seul secret** dans Supabase (Edge Functions → Secrets) : `CF_API_TOKEN`, un jeton Cloudflare avec trois droits :
   - Account → Cloudflare Tunnel → Edit ;
   - Zone → Zone → Read ;
   - Zone → DNS → Edit, limités à `gestimarket.shop`.

   Le compte et la zone sont retrouvés par le domaine. Les secrets `CF_ACCOUNT_ID` et `CF_ZONE_ID` restent possibles mais facultatifs.

Tant que le jeton manque, la fonction répond que l'adresse automatique n'est pas encore ouverte. Si le domaine n'est pas encore « Active », elle le dit aussi. L'adresse publique saisie à la main reste possible.

## 6. Vérifications

- Dans GestiMarket, **Poste & réseau** liste chaque téléphone (« · application ») avec sa route : réseau local ou Internet.
- Test sans application :

```bash
curl -X POST https://xxxx.supabase.co/rest/v1/rpc/gm_get_server -H "apikey: <clé publique>" -H "Content-Type: application/json" -d '{"p_shop_code":"GM-XXXXXX"}'
```
