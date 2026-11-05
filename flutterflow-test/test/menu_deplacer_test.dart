// Bouton flottant : position de départ, glisser, bords de l'écran, position gardée d'une page à l'autre.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gestimarket_flutterflow_test/ff_stubs.dart';

import 'app.dart';

void main() {
  testWidgets('la bulle se déplace, reste dans l\'écran et garde sa place', (tester) async {
    // Application ouverte avec une session : « / » affiche Mes boutiques.
    SupaFlow.client.auth.signIn('proprietaire-1');
    final routeur = await lancerApplication(tester);
    expect(titre('Boutiques'), findsOneWidget);
    expect(bulle, findsOneWidget);

    // Départ : bord droit, loin des barres de GestiMarket (en haut 56 px ; en bas onglets et « Encaisser », 130 px).
    var r = tester.getRect(bulle);
    expect(r.right, greaterThan(ecranTelephone.width - 80));
    expect(r.top, greaterThan(56 + 40));
    expect(r.bottom, lessThan(ecranTelephone.height - 130));

    // Glisser loin en haut à gauche : la bulle s'arrête au bord de l'écran.
    await tester.drag(bulle, const Offset(-2000, -2000));
    await tester.pumpAndSettle();
    r = tester.getRect(bulle);
    expect(r.left, greaterThanOrEqualTo(0));
    expect(r.top, greaterThanOrEqualTo(0));
    expect(r.left, lessThan(30));

    // Glisser loin en bas à droite : toujours entière à l'écran.
    await tester.drag(bulle, const Offset(3000, 3000));
    await tester.pumpAndSettle();
    r = tester.getRect(bulle);
    expect(r.right, lessThanOrEqualTo(ecranTelephone.width));
    expect(r.bottom, lessThanOrEqualTo(ecranTelephone.height));

    // Un glisser n'ouvre pas le menu.
    expect(find.text('Contact Eden Dev'), findsNothing);

    // Au milieu, puis on change de page : même place.
    await tester.drag(bulle, const Offset(-150, -300));
    await tester.pumpAndSettle();
    final avant = tester.getRect(bulle);
    await tester.tap(find.text('Ouvrir GM-000001'));
    await tester.pumpAndSettle();
    expect(find.text('WebView GM-000001'), findsOneWidget);
    expect(tester.getRect(bulle), avant);

    // Un toucher ouvre toujours le menu.
    await tester.tap(bulle);
    await tester.pumpAndSettle();
    expect(find.text('Contact Eden Dev'), findsOneWidget);
    routeur.pop();
    await tester.pumpAndSettle();
    expect(find.text('Contact Eden Dev'), findsNothing, reason: 'un changement de page referme le menu');
  });
}
