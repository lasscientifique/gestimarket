# Application mobile GestiMarket (FlutterFlow + WebView)

L'application mobile ne contient qu'une **WebView**. Elle demande à Supabase l'adresse du poste serveur du magasin, puis ouvre cette adresse : c'est GestiMarket complet (l'interface s'adapte à l'écran du téléphone).

```
Poste serveur GestiMarket ──(toutes les 30 s)──► Supabase : gm_publish_server(code, secret, actif, adresses)
Application FlutterFlow  ──(au démarrage)──────► Supabase : gm_get_server(code)  →  { active, url, … }
Application FlutterFlow  ──► WebView(url = http://192.168.x.x:7878)  ──► GestiMarket
```

> Le téléphone doit être sur **le même réseau** que le poste serveur (Wi-Fi du magasin ou point d'accès d'un téléphone).
> Les adresses publiées sont des adresses du réseau local ; elles ne fonctionnent pas depuis Internet, sauf si vous renseignez une « adresse publique » (redirection de port, tunnel).

---

## 1. Supabase (une seule fois)

1. Ouvrez votre projet → **SQL Editor** → *New query*.
2. Collez le contenu de `gestimarket_mobile.sql`, puis **Run**.
3. Notez dans **Project Settings → API** :
   - l'**URL du projet** (`https://xxxx.supabase.co`) ;
   - la **clé publique** (`anon` ou `sb_publishable_…`). N'utilisez jamais la clé `service_role`.

Ce que crée le script :

| Élément | Rôle |
|---|---|
| table `gm_servers` | une ligne par commerce : code, nom, adresses, actif, dernière publication. Illisible directement (RLS sans politique). |
| `gm_publish_server(p_shop_code, p_secret, p_active, p_payload)` | appelée par le poste serveur. Le premier poste qui publie un code en devient propriétaire : un autre poste ne peut pas détourner l'adresse. |
| `gm_get_server(p_shop_code)` | appelée par l'application. `active` vaut `true` si le serveur a publié il y a moins de 90 s. |

## 2. GestiMarket (poste serveur)

**Paramètres → Réseau & mobile → Application mobile (Supabase)** :

1. Cochez « Publier l'adresse du poste serveur sur Supabase ».
2. Saisissez l'URL du projet et la clé publique, puis **Enregistrer les modifications** (code PIN administrateur).
3. **Publier maintenant** : la date de « Dernière publication réussie » s'affiche, avec le **code du commerce** (ex. `GM-7KQ2PX`) et son QR code.

Ensuite, c'est automatique : publication toutes les 30 s, et « arrêté » dès qu'on ferme le poste serveur.

## 3. FlutterFlow

### 3.1 État de l'application (App State)

| Nom | Type | Persisté |
|---|---|---|
| `shopCode` | String | oui |
| `serverUrl` | String | non |

### 3.2 Appel d'API « GetServer »

*API Calls → + Add → API Call* :

- **Method** : `POST`
- **URL** : `https://xxxx.supabase.co/rest/v1/rpc/gm_get_server`
- **Headers** :
  - `apikey: <clé publique>`
  - `Authorization: Bearer <clé publique>`
  - `Content-Type: application/json`
- **Variables** : `shopCode` (String)
- **Body (JSON)** : `{ "p_shop_code": "<shopCode>" }`
- **JSON Paths** :

| Nom | Chemin |
|---|---|
| found | `$.found` |
| active | `$.active` |
| url | `$.url` |
| httpsUrl | `$.https_url` |
| publicUrl | `$.public_url` |
| shopName | `$.shop_name` |
| secondsAgo | `$.seconds_ago` |

Exemple de réponse :

```json
{ "found": true, "active": true, "shop_name": "Supérette Kanu",
  "url": "http://192.168.1.10:7878", "https_url": "https://192.168.1.10:7879",
  "urls": ["http://192.168.1.10:7878"], "postes_online": 4, "seconds_ago": 12 }
```

### 3.3 Page « Code du commerce » (premier lancement)

- Un champ texte pour le code, ou un bouton **Scan barcode/QR code** : le QR affiché dans GestiMarket contient `gestimarket:GM-XXXXXX`. Retirez le préfixe `gestimarket:`.
- Bouton « Continuer » : *Update App State* `shopCode`, puis naviguer vers la page « Magasin ».
- Au démarrage de l'application : si `shopCode` n'est pas vide, aller directement à « Magasin ».

### 3.4 Page « Magasin »

1. **On Page Load** : appel `GetServer(shopCode)`.
   - Si `found` est faux : message « Code inconnu », puis retour à la page « Code du commerce ».
   - Si `active` est vrai : *Update App State* `serverUrl = url`.
   - Sinon : afficher « Serveur du magasin arrêté », avec un bouton « Réessayer » qui relance l'appel.
2. Le widget **GestiMarketWebView** occupe toute la page (`url = serverUrl`), visible quand `serverUrl` n'est pas vide.

Le widget simple **WebView** de FlutterFlow fonctionne aussi. Le widget personnalisé `flutterflow/gestimarket_webview.dart` ajoute deux choses :
- le **scanner natif** de codes-barres et QR codes (fiable dans une WebView) ;
- le bouton retour d'Android.

### 3.5 Widget personnalisé GestiMarketWebView

*Custom Code → Widgets → + Add* :
- Nom : `GestiMarketWebView`
- Paramètre : `url` (String)
- Code : collez `flutterflow/gestimarket_webview.dart`
- Dépendances : `webview_flutter: ^4.10.0`, `mobile_scanner: ^6.0.0`

Échange entre la page et l'application :

| Sens | Message |
|---|---|
| Page → application | canal JavaScript `GestiMarketNative` : `{"action":"scan","title":"Scanner les articles"}` |
| Application → page | `window.gestimarketScan("6181234567893")` (en caisse, l'article est ajouté au ticket) |

GestiMarket détecte le canal tout seul : le bouton caméra ouvre alors le scanner du téléphone au lieu de celui du navigateur.

### 3.6 Réglages Android et iOS (adresses `http://` du réseau local)

- **Android** : autorisez le trafic HTTP local. Dans *Custom Code → Configuration Files → AndroidManifest.xml*, ajoutez `android:usesCleartextTraffic="true"` sur la balise `<application>`. Permission caméra : `android.permission.CAMERA`.
- **iOS** : dans *Info.plist*, ajoutez :
  - `NSAppTransportSecurity → NSAllowsLocalNetworking = YES` (adresses locales en http) ;
  - `NSLocalNetworkUsageDescription` (« Connexion au poste serveur du magasin ») ;
  - `NSCameraUsageDescription` (« Scanner les codes-barres »).

## 4. Vérifications

- Dans GestiMarket, **Poste & réseau** liste chaque téléphone : nom du poste, modèle (« Téléphone Android (SM-A546B) · application »), adresse IP, utilisateur connecté, synchronisé ou non.
- Test sans application : `curl -X POST https://xxxx.supabase.co/rest/v1/rpc/gm_get_server -H "apikey: <clé>" -H "Authorization: Bearer <clé>" -H "Content-Type: application/json" -d '{"p_shop_code":"GM-XXXXXX"}'`

---

## 5. Widget tout-en-un (recommandé) : réseau local + Internet

`flutterflow/gestimarket_webview.dart` remplace les sections 3.2 à 3.5 : il interroge lui-même Supabase, choisit la route et se reconnecte seul.

- **Paramètres** (String) : `shopCode`, `supabaseUrl`, `supabaseKey` (clé publique).
- **Dépendances** : `webview_flutter: ^4.10.0`, `mobile_scanner: ^6.0.0`, `http: ^1.3.0`.
- **Route** : réseau local d'abord (réponse de `/api/ping` en moins de 1,5 s), sinon l'adresse publique (tunnel Cloudflare, champ « Adresse publique » de GestiMarket). Une pastille « Réseau local » / « Internet » s'affiche en bas à gauche.
- **Redémarrage du PC serveur** : le widget détecte les pages d'erreur 502/530 du tunnel et les coupures, affiche l'état et recharge tout seul dès que le serveur revient.
- **Dans GestiMarket** : « Poste & réseau » indique pour chaque appareil « Réseau local » ou « Internet », et pour le serveur si le réseau local et l'adresse publique répondent (test toutes les 30 s).
