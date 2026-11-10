# Choisir l'installation de la boutique

GestiMarket s'adapte à chaque boutique : avec ou sans PC, avec ou sans Internet, un ou plusieurs appareils.

| Situation | Serveur (garde les données) | Autres appareils | Internet |
|---|---|---|---|
| Un seul téléphone | Le téléphone | — | Non |
| Téléphone + TV (écran client) | Le téléphone, avec son partage de connexion | TV Android | Non |
| Téléphone + plusieurs caisses | Le téléphone | Téléphones, tablettes, TV, iPhone | Non |
| PC serveur dans la boutique | Le PC | PC, téléphones, tablettes, TV, iPhone, par le Wi-Fi | Non |
| Le propriétaire regarde de loin | PC avec son adresse Internet | Application « Espace propriétaire », Safari | Oui |

## Les modes d'un appareil (Poste & réseau)

- **Poste unique** : la base est sur cet appareil, personne d'autre ne s'y relie.
- **Serveur de la boutique** (PC ou téléphone Android) : la base est ici et elle est partagée aux autres appareils de la boutique.
- **Poste client** : l'appareil travaille sur la base du serveur de la boutique.

Changer de mode : **Poste & réseau**, choisissez le mode, puis **Enregistrer et redémarrer**. Sur un poste qui garde les données, le code PIN d'un responsable est demandé.

## Relier un appareil au serveur

Sur le nouvel appareil :

- **Application Android** : « Rejoindre une boutique » (premier démarrage) ou Poste & réseau → Poste client. La boutique est trouvée toute seule ; sinon, scannez le QR code du serveur.
- **iPhone, iPad, navigateur** : scannez le QR code affiché sur le serveur (Poste & réseau), ou tapez son adresse, par exemple `http://192.168.1.10:7878`.

L'adresse en **https** (port 7879) active la caméra du navigateur pour scanner les codes-barres. À la première ouverture, le navigateur affiche « connexion non privée » : touchez « Paramètres avancés », puis « Continuer ».

## Adresse Internet de la boutique (PC serveur)

Avec la formule PRO, le PC serveur peut avoir une **adresse Internet** (`https://gm-000123.gestimarket.shop`) : le propriétaire ouvre sa boutique de n'importe où. Paramètres → Réseau & mobile → **Créer l'adresse Internet**. Chaque téléphone qui se connecte depuis Internet doit d'abord être **autorisé** par l'administrateur (code d'accès ou compte de la boutique).
