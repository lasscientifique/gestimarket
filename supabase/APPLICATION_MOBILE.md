# Application mobile GestiMarket (FlutterFlow)

Projet FlutterFlow : **GestiMarket** (`gesti-market-ywxut8`), paquet `com.edendev.gestimarket`. Il est branché sur le Supabase d'Eden Dev avec la clé publique, jamais la clé `service_role`.

L'application ouvre GestiMarket complet dans la **WebView native** de FlutterFlow, sur l'adresse Internet de la boutique (`https://gm-000123.gestimarket.shop`). L'interface s'adapte au téléphone. Depuis le 4 novembre 2026, toutes les pages sont en **widgets natifs FlutterFlow**, sans code personnalisé. Elles se modifient dans l'éditeur.

| Page | Rôle |
|---|---|
| `Demarrage` (page d'entrée) | Logo sur fond `#0F766E`, « par Eden Dev ». Ouvre ensuite la boutique retenue sur le téléphone (état `shopCode`), ou la connexion |
| `Connexion` | Deux onglets. **Propriétaire** : e-mail et mot de passe du compte boutique (Supabase Auth). **Personnel** : code du commerce tapé ou scanné (QR affiché sur le PC) |
| `MesBoutiques` (page après connexion) | Boutiques du compte, chacune avec deux boutons : « Ouvrir » et « Abonnement ». Déconnexion |
| `Boutique` | WebView sur l'adresse de la boutique. Écran **« Serveur éteint »** quand le PC est arrêté, avec trois boutons : « Réessayer », « Mon abonnement », « Changer de boutique » |
| `Abonnement` | Formule (STARTER, PRO, BUSINESS) et durée (1, 3, 6, 12 mois ; 12 mois = 2 offerts). Paiement par carte de bon, Orange Money ou Visa. Derniers paiements |

```
Poste serveur GestiMarket ──(toutes les 30 s)──► Supabase : gm_publish_server (adresses, boutique Eden Dev du PC)
Personnel : code du commerce ──► gm_get_server(code) ──► adresse Internet du PC ──► WebView
Propriétaire : compte boutique ──► gm_my_stores ──► gm_my_server(boutique) ──► code ──► WebView
```

Données du téléphone (état de l'application, gardé) : `shopCode` (boutique ouverte) et `storeCode` (boutique choisie pour l'abonnement). Structures : `Boutique`, `Serveur`, `Paiement`, `Resultat`, `PageCarte`.

## 1. Actions Supabase de chaque page

Chaque page appelle les fonctions Supabase par l'action native **Supabase → Call RPC**, qui utilise toute seule la session de la propriétaire. FlutterFlow doit connaître ces fonctions : Settings → Integrations → Supabase → **Get Schema**, à refaire après chaque script SQL qui en ajoute.

| Page, déclencheur | Fonction | Arguments | Suite |
|---|---|---|---|
| `Boutique`, au chargement et bouton « Réessayer » | `gm_get_server` | `p_shop_code` = `shopCode` | état de page `server` ; WebView visible si `server.active`, sinon « Serveur éteint » |
| `MesBoutiques`, au chargement | `gm_my_stores` | — | liste `stores` |
| `MesBoutiques`, bouton « Ouvrir » | `gm_my_server` | `p_store_code` = code de la boutique | si `found` : `shopCode` = `shop_code`, puis `Boutique` ; sinon message `error` |
| `MesBoutiques`, bouton « Abonnement » | — | — | `storeCode` = code de la boutique, puis `Abonnement` |
| `Abonnement`, au chargement | `gm_my_payments` | `p_store_code` = `storeCode` | liste `payments` |
| `Abonnement`, « Activer la carte » | `gm_my_redeem_voucher` | `p_store_code` = `storeCode`, `p_code` = champ `voucherCode` | message selon `ok` / `error` |
| `Abonnement`, « Envoyer le paiement » | `gm_declare_payment` | `p_store_code`, `p_plan`, `p_months` (nombre), `p_method` = `orange_money`, `p_reference`, `p_payer_phone` | message ; Eden Dev valide ensuite |
| `Abonnement`, « Payer par carte » | fonction Edge `gm-pay` | `store_code`, `plan`, `months` (session de la propriétaire) | son champ `html` va dans la WebView en mode HTML : la page Cybersource s'ouvre seule |

Le script qui a créé les pages (`supabase/flutterflow/flutterflow_natif.dart`) passait par des appels d'API. Ils sont remplacés par ces actions RPC ; une fois tous remplacés, on supprime les appels d'API inutiles (API Calls).

**Réglages d'authentification** (Settings → Authentication, Supabase, e-mail) : page d'entrée `Demarrage`, page après connexion `MesBoutiques`. Avant « Se déconnecter », vider `shopCode` et `storeCode`.

**Limites connues de la version native.**
- Toujours par l'adresse Internet, même sur le Wi-Fi du magasin. C'est un peu plus lent qu'en réseau local, mais ça marche partout.
- Pas de reconnexion automatique : on touche « Réessayer » après avoir rallumé le PC.
- Le bouton scanner de la caisse, dans GestiMarket, passe par la caméra du navigateur de la WebView.
- Le scanner natif ne fonctionne que sur téléphone : il ne marche pas dans l'aperçu web « Run ».

L'ancienne version en code personnalisé (`gestimarket_*.dart`, script `flutterflow_edit.dart`) reste dans le dépôt pour mémoire. Elle n'est plus dans le projet FlutterFlow.

## 2. Outil FlutterFlow (ligne de commande)

Le dossier `gestimarket-mobile` (à côté du dépôt) est relié au projet :

```bash
dart pub global run flutterflow_cli ai status gesti-market-ywxut8
dart pub global run flutterflow_cli ai codegen refresh
```

À savoir avant de l'utiliser :
- L'action RPC native n'y accepte que des valeurs écrites en dur. Pour les relier à l'état ou aux champs, il faut passer par l'éditeur.
- Dans un appel d'API, une variable s'écrit `<nom>` dans le corps et `[nom]` dans les en-têtes.
- Un script de création ne se relance pas sur des pages existantes.

## 3. Images

Les images sont dans `supabase/flutterflow/images/`, et copiées aussi dans les livrables. Le logo et l'icône sont déjà dans la bibliothèque d'images du projet.

| Fichier | Où le mettre |
|---|---|
| `GestiMarket_splash_logo.png` | Affiché par la page `Demarrage`. Aussi : Settings → App Assets → **Splash Image**, fond `#0F766E` |
| `GestiMarket_icone_1024.png` | Settings → App Assets → **Launcher Icon** |
| `GestiMarket_splash_1080x1920.png`, `GestiMarket_splash_1242x2688.png` | Fiches du Play Store et de l'App Store, présentations |

Nom de l'application sous l'icône : Settings → General → App Details → App Name = **GestiMarket**.

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
| fonction `gm-pay` (`store_code`, `plan`, `months`) | propriétaire connectée | carte Visa ; renvoie aussi `html`, la page de paiement prête pour la WebView |

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
