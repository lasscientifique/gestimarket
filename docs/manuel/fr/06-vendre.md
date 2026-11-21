# Vendre à la caisse

## La journée de la caissière

1. **Ouvrir la caisse** : Sessions de caisse → Ouvrir, en déclarant le fond de caisse.
2. **Encaisser** chaque client (ci-dessous).
3. **Fermer la caisse** le soir : comptez les espèces, GestiMarket calcule l'écart. Le rapport Z de la journée est numéroté et ne peut plus être modifié.

## Encaisser un client

1. **Scanner** les articles : douchette, caméra du téléphone (bouton appareil photo), ou toucher les vignettes. Tapez `3*code` pour ajouter 3 articles d'un coup.
2. **Client** (facultatif) : F4. Obligatoire pour une vente sur le compte client.
3. **Encaisser** : F9. Choisissez le moyen de paiement. « Paiement partiel » combine plusieurs moyens (espèces + Orange Money…).
4. **Ticket** : imprimez-le, puis « Nouvelle vente ».

| Touche | Action |
|---|---|
| F2 | Rechercher un produit |
| F4 | Choisir le client |
| F8 | Tickets mis en attente |
| F9 ou F12 | Encaisser |
| Ctrl + K | Où est ce produit ? (partout) |

## Paiements mobiles

Orange Money, Moov Money, Sarali, Wave… se règlent dans Paramètres → Paiements. Le QR code marchand s'affiche sur l'écran client : le client scanne et paie, la caissière saisit la référence reçue par SMS.

**PI-SPI (BCEAO)** : le paiement instantané de toutes les banques et de tous les portefeuilles de l'UEMOA (Orange Money, Moov Money, Sama Money, banques…).
- Dans Paramètres → Paiements → Autres opérateurs, ajoutez **PI-SPI (toutes banques)** et saisissez l'**alias PI-SPI** de la boutique (36 caractères). Il se trouve dans l'application de votre banque ou de votre portefeuille : PI-SPI → Détails du compte. Vous pouvez aussi coller le texte de votre QR PI-SPI.
- En caisse, GestiMarket affiche un **QR avec le montant exact et la référence de la vente**, aussi sur l'écran client. Le client le scanne avec son application, le montant est déjà rempli.
- Vérifiez l'arrivée du paiement sur le téléphone de la boutique, puis validez la vente. La référence de la vente est gardée avec le paiement.
- **Imprimer le QR du comptoir** donne un QR fixe : le client saisit lui-même le montant.
- PI-SPI fonctionne en francs CFA (XOF).

## Remises et contrôles

- Une remise au-delà du seuil (5 % par défaut) est validée par le **code PIN d'un responsable**.
- Retirer un article ou vider le ticket peut demander un code PIN (Paramètres → Sécurité).
- Le même ticket envoyé deux fois (réseau qui coupe) n'est enregistré qu'une fois.

## Autres caisses

Le bouton « Autres caisses » montre en direct les tickets des collègues. Un client peut être **repris** sur une autre caisse (avec son code PIN).

## Retours et avoirs

Historique des ventes ou Retours & avoirs : choisissez la vente, les articles rendus, puis le remboursement : espèces, **avoir** (bon numéroté, payable en caisse) ou sur le compte du client. Un article abîmé n'est pas remis en stock.
