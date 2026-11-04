# Application mobile GestiMarket (FlutterFlow)

Projet FlutterFlow : **GestiMarket** (`gesti-market-ywxut8`), paquet `com.edendev.gestimarket`. Il est branché sur le Supabase d'Eden Dev avec la clé publique, jamais la clé `service_role`.

L'application est faite en **widgets natifs FlutterFlow et Supabase uniquement** : pas d'appel d'API, pas de code personnalisé. Toute la logique de la boutique (personnel, caisse, abonnement…) reste dans le logiciel GestiMarket, que la WebView affiche à l'adresse Internet de la boutique : `https://<code en minuscules>.gestimarket.shop`, par exemple `https://gm-000001.gestimarket.shop`.

| Page | Rôle | Supabase |
|---|---|---|
| `Demarrage` (page d'entrée sans session) | Logo, champ du code du commerce, « par Eden Dev » ; lien vers l'espace propriétaire | RPC `gm_server_status` |
| `boutique` | WebView native sur l'adresse de la boutique ; écran « Serveur éteint » | RPC `gm_server_status` |
| `Connexion` | Connexion de la propriétaire (compte boutique) | Supabase Auth, e-mail |
| `Boutiques` (page après connexion) | Ses boutiques, chacune avec deux boutons : « Ouvrir » (WebView) et « Abonnement » ; déconnexion | requête `gm_stores` |
| `Abonnement` | Abonnements de la boutique choisie : formule, statut, début, fin, durée | requête `gm_subscriptions` filtrée par `store_id` |

État de l'application :
- `storeCode` (gardé) : code de la boutique ouverte ;
- `selectedStoreId`, `selectedStoreName` : boutique choisie pour la page Abonnement.

## 1. Supabase

**Statut du PC serveur : RPC `gm_server_status`** (action FlutterFlow Supabase → Call RPC, clé publique). Script `gestimarket_statut_serveur.sql`, en *security definer* : la table `gm_servers` reste fermée au téléphone, sans policy.

```
gm_server_status(p_shop_code text) → [{"check": bool, "active": bool}]
  check   le code existe dans gm_servers
  active  le PC a donné signe de vie depuis moins de 90 s (coupure de courant = false)
```

Le code est accepté en minuscules et avec des espaces autour.

**Espace propriétaire : requêtes natives** sur `gm_stores` et `gm_subscriptions`. Les policies existantes (« gm mes boutiques », « gm mes abonnements », « gm mes paiements ») limitent la propriétaire connectée à ses propres boutiques. Rien à ajouter côté Supabase.

| Page, déclencheur | Action | Suite |
|---|---|---|
| `Demarrage`, au chargement | si `storeCode` n'est pas vide | aller à `boutique` |
| `Demarrage`, bouton (icône connexion) | Call RPC `gm_server_status`, `p_shop_code` = champ code | si `check` : `storeCode` = code, aller à `boutique` ; sinon « Code inconnu » |
| `Demarrage`, lien « Espace propriétaire » | — | aller à `Connexion` |
| `boutique`, au chargement et « Réessayer » | Call RPC `gm_server_status`, `p_shop_code` = `storeCode` | si `active` : WebView sur `https://` + code en minuscules + `.gestimarket.shop` ; sinon « Serveur éteint » |
| `Connexion`, « Se connecter » | Log In (e-mail, mot de passe) | FlutterFlow ouvre `Boutiques` |
| `Boutiques`, au chargement | requête `gm_stores`, filtre `owner_id` = utilisateur connecté, triée par nom | liste |
| `Boutiques`, « Ouvrir » | `storeCode` = code de la boutique | aller à `boutique` |
| `Boutiques`, « Abonnement » | `selectedStoreId` et `selectedStoreName` | aller à `Abonnement` |
| `Abonnement`, au chargement | requête `gm_subscriptions`, filtre `store_id` = `selectedStoreId`, du plus récent au plus ancien | liste |

FlutterFlow doit connaître la fonction RPC : Settings → Integrations → Supabase → **Get Schema**, après chaque script SQL qui ajoute une fonction.

Sur les pages `Boutiques` et `Abonnement`, la requête est lancée au chargement de la page puis affichée par la ListView. On peut la déplacer en « Backend Query » directement sur la ListView dans l'éditeur. L'outil en ligne de commande ne sait pas poser une requête Supabase sur un widget.

**Limites connues.**
- Toujours par l'adresse Internet, même sur le Wi-Fi du magasin : un peu plus lent qu'en réseau local, mais ça marche partout.
- Une boutique sans adresse Internet automatique (PC serveur avant la 0.15) ne s'ouvre pas dans l'application.
- Le scanner de la caisse, dans GestiMarket, passe par la caméra du navigateur de la WebView.
- Le paiement de l'abonnement se fait dans GestiMarket (PC ou WebView) : la page `Abonnement` ne fait que l'afficher.

Les versions précédentes restent dans le dépôt pour mémoire : `gestimarket_*.dart` et `flutterflow_edit.dart` (code personnalisé), `flutterflow_natif.dart` (cinq pages avec appels d'API).

## 2. Outil FlutterFlow (ligne de commande)

Le dossier `gestimarket-mobile` (à côté du dépôt) est relié au projet. Le script `supabase/flutterflow/flutterflow_proprietaire.dart` a créé les pages `Connexion`, `Boutiques` et `Abonnement`.

Pour regénérer le code :

```bash
dart pub global run flutterflow_cli ai refresh-context gesti-market-ywxut8
```

Puis lancer `dart analyze lib` dans `gestimarket-mobile/generated_code`.

Ce que l'outil ne sait pas faire :
- relier les arguments d'une action RPC à l'état ou aux champs : il n'accepte que des valeurs écrites en dur ;
- poser une requête Supabase directement sur un widget.

Ces deux réglages se font dans l'éditeur.

## 3. Images

Les images sont dans `supabase/flutterflow/images/` ; le logo et l'icône sont déjà dans la bibliothèque d'images du projet.

| Fichier | Où |
|---|---|
| `GestiMarket_splash_logo.png` | Page `Demarrage`. Aussi : Settings → App Assets → **Splash Image**, fond `#0F766E` |
| `GestiMarket_icone_1024.png` | Écran « Serveur éteint ». Aussi : Settings → App Assets → **Launcher Icon** |
| `GestiMarket_splash_1080x1920.png`, `GestiMarket_splash_1242x2688.png` | Fiches du Play Store et de l'App Store |

Nom de l'application sous l'icône : Settings → General → App Details → App Name = **GestiMarket**.

## 4. Supabase

À exécuter dans le SQL Editor, dans cet ordre :
1. `gestimarket_licences.sql`
2. `gestimarket_types_commerce.sql`
3. `gestimarket_paiements.sql`
4. `gestimarket_international.sql`
5. `gestimarket_mobile.sql`
6. `gestimarket_abonnement_mobile.sql` (0.15)
7. `gestimarket_statut_serveur.sql` (application mobile)

Fonctions Edge à déployer, avec *Verify JWT* désactivé : `gm-license`, `gm-pay`, `gm-tunnel`.

L'application appelle `gm_server_status(code)` (clé publique) et lit `gm_stores` et `gm_subscriptions` (propriétaire connectée). `gm_get_server(code)` reste pour les anciennes versions. Les fonctions de la propriétaire (`gm_my_stores`, `gm_my_server`, `gm_my_payments`, `gm_my_redeem_voucher`, `gm_declare_payment`) et la page de paiement de `gm-pay` (champ `html`) restent disponibles, au cas où des écrans natifs reviendraient un jour.

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
