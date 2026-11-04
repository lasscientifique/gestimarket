# Application mobile GestiMarket (FlutterFlow)

Projet FlutterFlow : **GestiMarket** (`gesti-market-ywxut8`), paquet `com.edendev.gestimarket`. Il est branché sur le Supabase d'Eden Dev avec la clé publique, jamais la clé `service_role`.

L'application est une simple fenêtre sur GestiMarket. Elle a **deux pages en widgets natifs FlutterFlow** et aucun code personnalisé. Toute la logique (connexion du personnel, caisse, abonnement…) est dans le logiciel GestiMarket, que la WebView affiche à l'adresse Internet de la boutique (`https://gm-000123.gestimarket.shop`).

| Page | Rôle |
|---|---|
| `Demarrage` (page d'entrée, `/accueil`) | Logo sur fond `#0F766E`, champ « Boutique Code » et « par Eden Dev ». Vérifie le code, le garde (`storeCode`) et ouvre la boutique |
| `boutique` (`/boutique`) | WebView native sur l'adresse Internet de la boutique. Écran **« Serveur éteint »** quand le PC est arrêté, avec un bouton « Changer de boutique » |

```
Poste serveur GestiMarket ──(toutes les 30 s)──► Supabase : gm_publish_server (adresses, dernière activité)
Application : code GM-… ──► RPC gm_get_server(code) ──► active ? WebView(public_url) : « Serveur éteint »
```

## 1. La fonction Supabase utilisée

L'application lit la boutique **uniquement par la fonction RPC `gm_get_server`** (action FlutterFlow Supabase → Call RPC). Elle ne lit **pas** la table `gm_servers`. Cette table est fermée au téléphone (« permission denied ») : elle contient l'empreinte du secret de chaque PC et les adresses locales de toutes les boutiques.

`gm_get_server(p_shop_code text) → jsonb` :
- `found` : le code existe ;
- `active` : le PC a donné signe de vie depuis moins de 90 s. Une coupure de courant passe donc bien en « Serveur éteint » ;
- `shop_name`, `shop_code`, `public_url` (adresse Internet de la boutique), `seconds_ago`, `version`.

Le code est accepté en minuscules et avec des espaces autour.

| Page, déclencheur | Action | Suite |
|---|---|---|
| `Demarrage`, au chargement | si `storeCode` n'est pas vide | aller à `boutique` |
| `Demarrage`, bouton (icône connexion) | Call RPC `gm_get_server`, `p_shop_code` = champ code, résultat `serverInfo` | si `$.found` : `storeCode` = code, aller à `boutique` ; sinon « Code inconnu » |
| `boutique`, au chargement et bouton « Réessayer » | Call RPC `gm_get_server`, `p_shop_code` = `storeCode`, résultat dans l'état de page `server` (JSON) | Conditional Builder sur `$.active` : WebView sur `$.public_url`, sinon « Serveur éteint » |
| `boutique`, « Changer de boutique » | `storeCode` = vide | aller à `Demarrage` |

FlutterFlow doit connaître la fonction : Settings → Integrations → Supabase → **Get Schema**. `gm_get_server` y est déjà.

**Limites connues.**
- Toujours par l'adresse Internet, même sur le Wi-Fi du magasin : un peu plus lent qu'en réseau local, mais ça marche partout.
- Une boutique sans adresse Internet automatique (PC serveur avant la 0.15) ne s'ouvre pas dans l'application.
- Le scanner de la caisse, dans GestiMarket, passe par la caméra du navigateur de la WebView.
- L'abonnement se gère dans GestiMarket, sur le PC ou par la WebView.

Les versions précédentes restent dans le dépôt pour mémoire, sans être dans le projet FlutterFlow :
- l'application en code personnalisé (`gestimarket_*.dart`, script `flutterflow_edit.dart`) ;
- la version native à cinq pages (`flutterflow_natif.dart`).

## 2. Outil FlutterFlow (ligne de commande)

Le dossier `gestimarket-mobile` (à côté du dépôt) est relié au projet. Pour regénérer le code et le vérifier :

```bash
dart pub global run flutterflow_cli ai refresh-context gesti-market-ywxut8
```

Puis lancer `dart analyze lib` dans `gestimarket-mobile/generated_code`. L'action RPC de l'outil n'accepte que des valeurs écrites en dur : les branchements se font dans l'éditeur.

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

Fonctions Edge à déployer, avec *Verify JWT* désactivé : `gm-license`, `gm-pay`, `gm-tunnel`.

L'application n'appelle que `gm_get_server(code)`, avec la clé publique. Les fonctions de la propriétaire (`gm_my_stores`, `gm_my_server`, `gm_my_payments`, `gm_my_redeem_voucher`, `gm_declare_payment`) et la page de paiement de `gm-pay` (champ `html`) restent disponibles, au cas où des écrans natifs reviendraient un jour.

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
