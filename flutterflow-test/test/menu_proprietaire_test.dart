// Bouton flottant : parcours complet de la propriétaire, de la connexion à la déconnexion.
// (Un fichier par parcours : la bulle est unique pour toute l'application, comme dans FlutterFlow.)
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gestimarket_flutterflow_test/ff_stubs.dart';

import 'app.dart';

void main() {
  testWidgets('la bulle suit les pages et chaque choix du menu ouvre la bonne page', (tester) async {
    final routeur = await lancerApplication(tester);

    // Démarrage, sans session : pas de bulle.
    expect(titre('Démarrage'), findsOneWidget);
    expect(bulle, findsNothing);

    // Connexion, puis Mes boutiques : la bulle apparaît.
    await tester.tap(find.text('Espace propriétaire'));
    await tester.pumpAndSettle();
    expect(titre('Connexion'), findsOneWidget);
    expect(bulle, findsNothing);
    await tester.tap(find.text('Se connecter'));
    await tester.pumpAndSettle();
    expect(titre('Boutiques'), findsOneWidget);
    expect(bulle, findsOneWidget);

    // « Ouvrir » (pushNamed) : la WebView de la boutique, avec la bulle par-dessus.
    await tester.tap(find.text('Ouvrir GM-000001'));
    await tester.pumpAndSettle();
    expect(find.text('WebView GM-000001'), findsOneWidget);
    expect(bulle, findsOneWidget);

    // Le menu s'ouvre sur la page actuelle (« Ma boutique » coché).
    await tester.tap(bulle);
    await tester.pumpAndSettle();
    expect(bulleOuverte, findsOneWidget);
    for (final choix in ['Mes boutiques', 'Ma boutique', 'Abonnement', 'Contact Eden Dev', 'Se déconnecter']) {
      expect(find.text(choix), findsOneWidget, reason: choix);
    }
    expect(choixCoche('Ma boutique'), findsOneWidget);

    // Toucher le fond ferme le menu.
    await tester.tapAt(const Offset(20, 120));
    await tester.pumpAndSettle();
    expect(find.text('Contact Eden Dev'), findsNothing);
    expect(bulle, findsOneWidget);

    // Retour (bouton Android) : Mes boutiques, la bulle reste et la coche suit.
    routeur.pop();
    await tester.pumpAndSettle();
    expect(titre('Boutiques'), findsOneWidget);
    await tester.tap(bulle);
    await tester.pumpAndSettle();
    expect(choixCoche('Mes boutiques'), findsOneWidget);

    // Abonnement, Contact, Ma boutique, Mes boutiques : chaque choix remplace la page affichée.
    await tester.tap(find.text('Abonnement'));
    await tester.pumpAndSettle();
    expect(titre('Abonnement'), findsOneWidget);
    expect(find.text('Contact Eden Dev'), findsNothing, reason: 'le menu se referme');
    expect(bulle, findsOneWidget);

    await tester.tap(bulle);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Contact Eden Dev'));
    await tester.pumpAndSettle();
    expect(titre('Contact'), findsOneWidget);
    expect(find.text('lasscientifique@gmail.com'), findsOneWidget);

    await tester.tap(bulle);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Ma boutique'));
    await tester.pumpAndSettle();
    expect(find.text('WebView GM-000001'), findsOneWidget);

    await tester.tap(bulle);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Mes boutiques'));
    await tester.pumpAndSettle();
    expect(titre('Boutiques'), findsOneWidget);

    // Se déconnecter : boutique oubliée, session fermée, retour au démarrage, plus de bulle.
    await tester.tap(bulle);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Se déconnecter'));
    await tester.pumpAndSettle();
    expect(SupaFlow.client.auth.signOuts, 1);
    expect(SupaFlow.client.auth.currentUser, isNull);
    expect(FFAppState().storeCode, '');
    expect(titre('Démarrage'), findsOneWidget);
    expect(bulle, findsNothing);
  });
}
