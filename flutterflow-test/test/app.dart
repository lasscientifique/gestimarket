// Application de test qui reproduit la navigation générée par FlutterFlow (lib/flutter_flow/nav/nav.dart) :
// mêmes routes et mêmes noms, route « / » selon la session, pages ouvertes par pushNamed, routeur
// rafraîchi à chaque connexion ou déconnexion. Les pages sont simplifiées ; MenuFlottant est posé là où
// il l'est dans FlutterFlow (Boutiques, boutique, Abonnement, ContactEdenDev).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:gestimarket_flutterflow_test/ff_stubs.dart';
import 'package:gestimarket_flutterflow_test/menu_flottant.dart';

const ecranTelephone = Size(390, 844);

GoRouter routeurFlutterFlow() => GoRouter(
      initialLocation: '/',
      refreshListenable: SupaFlow.client.auth,
      routes: [
        GoRoute(
          name: '_initialize',
          path: '/',
          builder: (context, _) => SupaFlow.client.auth.currentUser != null ? const _Boutiques() : const _Demarrage(),
        ),
        GoRoute(name: 'Demarrage', path: '/accueil', builder: (context, _) => const _Demarrage()),
        GoRoute(name: 'boutique', path: '/boutique', builder: (context, _) => const _Boutique()),
        GoRoute(name: 'Connexion', path: '/proprietaire', builder: (context, _) => const _Connexion()),
        GoRoute(name: 'Boutiques', path: '/mes-boutiques', builder: (context, _) => const _Boutiques()),
        GoRoute(name: 'Abonnement', path: '/abonnements', builder: (context, _) => const _Abonnement()),
        GoRoute(name: 'ContactEdenDev', path: '/contact', builder: (context, _) => const _Contact()),
      ],
    );

Future<GoRouter> lancerApplication(WidgetTester tester) async {
  // Écran du téléphone (taille logique 390 x 844, densité 3) : lu par MediaQuery, comme sur un vrai téléphone.
  tester.view.physicalSize = ecranTelephone * 3;
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final routeur = routeurFlutterFlow();
  await tester.pumpWidget(MaterialApp.router(routerConfig: routeur));
  await tester.pumpAndSettle();
  return routeur;
}

// ── Repères pour les tests
final bulle = find.byIcon(Icons.apps_rounded);
final bulleOuverte = find.byIcon(Icons.close_rounded);
Finder titre(String page) => find.text('PAGE $page');

/// Le choix du menu qui porte la coche « page actuelle ».
Finder choixCoche(String texte) => find.descendant(
      of: find.ancestor(of: find.text(texte), matching: find.byType(InkWell)),
      matching: find.byIcon(Icons.check_rounded),
    );

Widget _page(String titre, List<Widget> contenu, {bool menu = false}) => Scaffold(
      appBar: AppBar(title: Text('PAGE $titre')),
      body: SafeArea(
        child: Column(children: [...contenu, if (menu) const MenuFlottant()]),
      ),
    );

class _Demarrage extends StatelessWidget {
  const _Demarrage();
  @override
  Widget build(BuildContext context) => _page('Démarrage', [
        TextButton(onPressed: () => context.pushNamed('Connexion'), child: const Text('Espace propriétaire')),
      ]);
}

class _Connexion extends StatelessWidget {
  const _Connexion();
  @override
  Widget build(BuildContext context) => _page('Connexion', [
        TextButton(
          onPressed: () {
            // Comme FlutterFlow : prepareAuthEvent(), connexion, puis pushNamedAuth vers Mes boutiques.
            SupaFlow.client.auth.signIn('proprietaire-1', notify: false);
            context.pushNamed('Boutiques');
          },
          child: const Text('Se connecter'),
        ),
      ]);
}

class _Boutiques extends StatelessWidget {
  const _Boutiques();
  @override
  Widget build(BuildContext context) => _page(
        'Boutiques',
        [
          TextButton(
            onPressed: () {
              FFAppState().storeCode = 'GM-000001';
              context.pushNamed('boutique');
            },
            child: const Text('Ouvrir GM-000001'),
          ),
          TextButton(onPressed: () => context.pushNamed('Abonnement'), child: const Text("Voir l'abonnement")),
        ],
        menu: true,
      );
}

class _Boutique extends StatelessWidget {
  const _Boutique();
  @override
  Widget build(BuildContext context) => _page('boutique', [Text('WebView ${FFAppState().storeCode}')], menu: true);
}

class _Abonnement extends StatelessWidget {
  const _Abonnement();
  @override
  Widget build(BuildContext context) => _page('Abonnement', const [Text('Formule BUSINESS')], menu: true);
}

class _Contact extends StatelessWidget {
  const _Contact();
  @override
  Widget build(BuildContext context) => _page('Contact', const [Text('lasscientifique@gmail.com')], menu: true);
}
