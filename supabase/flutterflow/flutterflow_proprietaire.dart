library;

import 'dart:io';

import 'package:flutterflow_ai/flutterflow_ai.dart';
import 'package:gestimarket_mobile/flutterflow_project.dart' as ff;

Future<void> main(List<String> args) async {
  if (Platform.environment['_FF_AI_DSL_LAUNCHER'] != '1') {
    stdout.writeln(
      'Tip: run this through `flutterflow ai run` (validated, faster)',
    );
  }
  final options = _parseCliOptions(args);
  try {
    await flutterFlowAI(
      buildOwnerFlow,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      projectName: options.projectName,
      projectId: options.projectId,
      findOrCreate: options.findOrCreate,
      allowNewProject: options.allowNewProject,
      dryRun: options.dryRun,
      commitMessage: options.commitMessage,
    );
  } catch (error, stackTrace) {
    stderr.writeln('Error: ${formatFlutterFlowAIError(error, stackTrace: stackTrace)}');
    exit(1);
  }
}

final class _CliOptions {
  const _CliOptions({
    this.apiKey,
    this.baseUrl,
    this.projectName,
    this.projectId,
    this.findOrCreate = false,
    this.allowNewProject = false,
    this.dryRun = false,
    this.commitMessage,
  });

  final String? apiKey;
  final String? baseUrl;
  final String? projectName;
  final String? projectId;
  final bool findOrCreate;
  final bool allowNewProject;
  final bool dryRun;
  final String? commitMessage;
}

_CliOptions _parseCliOptions(List<String> args) {
  String? apiKey;
  String? baseUrl;
  String? projectName;
  String? projectId;
  String? commitMessage;
  var findOrCreate = false;
  var allowNewProject = false;
  var dryRun = false;

  for (var i = 0; i < args.length; i++) {
    final arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        _printUsage();
        exit(0);
      case '--api-key':
        apiKey = _requireValue(args, ++i, '--api-key');
      case '--base-url':
        baseUrl = _requireValue(args, ++i, '--base-url');
      case '--project-name':
        projectName = _requireValue(args, ++i, '--project-name');
      case '--project-id':
        projectId = _requireValue(args, ++i, '--project-id');
      case '--commit-message':
        commitMessage = _requireValue(args, ++i, '--commit-message');
      case '--find-or-create':
        findOrCreate = true;
      case '--allow-new-project':
        allowNewProject = true;
      case '--dry-run':
        dryRun = true;
      default:
        stderr.writeln('Unknown option: $arg');
        _printUsage();
        exit(64);
    }
  }

  return _CliOptions(
    apiKey: apiKey,
    baseUrl: baseUrl,
    projectName: projectName,
    projectId: projectId,
    findOrCreate: findOrCreate,
    allowNewProject: allowNewProject,
    dryRun: dryRun,
    commitMessage: commitMessage,
  );
}

String _requireValue(List<String> args, int index, String flag) {
  if (index >= args.length) {
    stderr.writeln('Missing value for $flag.');
    _printUsage();
    exit(64);
  }
  return args[index];
}

void _printUsage() {
  stdout.writeln('proprietaire');
}

// ─────────────────────────────────────────────────────────────────────────────
// Espace propriétaire de l'application GestiMarket, en widgets natifs FlutterFlow et Supabase uniquement :
// connexion Supabase Auth (compte boutique), liste des boutiques (requête gm_stores) et abonnements
// d'une boutique (requête gm_subscriptions filtrée par la boutique choisie). Aucun appel d'API.
// Les règles d'accès Supabase limitent déjà chaque propriétaire à ses boutiques et à ses abonnements.
// ─────────────────────────────────────────────────────────────────────────────

void buildOwnerFlow(App app) {
  final brand = Colors.hex(0xFF0F766E);
  final stores = ff.Tables.gmStores;
  final subscriptions = ff.Tables.gmSubscriptions;

  // Boutique choisie dans la liste, pour la page des abonnements.
  app.state('selectedStoreId', string);
  app.state('selectedStoreName', string);

  // ───── Connexion de la propriétaire ─────
  app.page(
    'Connexion',
    route: '/proprietaire',
    description: 'Connexion de la propriétaire avec le compte de sa boutique (Supabase Auth).',
    body: Scaffold(
      appBar: AppBar(title: 'Espace propriétaire'),
      body: Column(
        scrollable: true,
        padding: 24,
        spacing: 16,
        children: [
          Text('Connectez-vous avec le compte de votre boutique.', style: Styles.bodyMedium),
          TextField(name: 'ownerEmail', label: 'E-mail', keyboard: Keyboard.email),
          TextField(name: 'ownerPassword', label: 'Mot de passe', obscureText: true),
          Button(
            'Se connecter',
            name: 'OwnerLoginButton',
            width: double.infinity,
            height: 48,
            color: brand,
            onTap: [
              LoginEmailPassword(
                WidgetState('ownerEmail', WidgetStateProperty.text),
                WidgetState('ownerPassword', WidgetStateProperty.text),
              ),
            ],
          ),
        ],
      ),
    ),
  );

  // ───── Mes boutiques ─────
  final boutiques = app.page(
    'Boutiques',
    route: '/mes-boutiques',
    description: 'Boutiques du compte connecté (requête Supabase gm_stores) : ouvrir GestiMarket ou voir l\'abonnement.',
    state: {'stores': listOf(stores)},
    onLoad: [
      PostgresQuery(
        stores,
        outputAs: 'storesQuery',
        query: PostgresQuerySpec(
          filters: [
            PostgresFilter('owner_id', relation: PostgresFilterRelation.equalTo, value: AuthUser(AuthUserField.userId)),
          ],
          orderBys: [PostgresOrderBy('name')],
        ),
      ),
      SetState('stores', ActionOutput('storesQuery')),
    ],
    body: Scaffold(
      appBar: AppBar(title: 'Mes boutiques'),
      body: Column(
        padding: 16,
        spacing: 12,
        children: [
          Expanded(
            ListView(
              source: State('stores'),
              spacing: 12,
              itemBuilder: (item) => Container(
                name: 'StoreCard',
                padding: 16,
                borderRadius: 12,
                color: Colors.secondaryBackground,
                child: Column(
                  crossAxis: CrossAxis.start,
                  spacing: 6,
                  children: [
                    Text(item['name'], name: 'StoreNameText', style: Styles.titleMedium),
                    Text(item['code'], name: 'StoreCodeText', color: Colors.secondaryText),
                    Text(item['city'], name: 'StoreCityText', style: Styles.bodySmall),
                    Row(
                      spacing: 8,
                      children: [
                        Expanded(
                          Button(
                            'Ouvrir',
                            name: 'OpenStoreButton',
                            color: brand,
                            onTap: [
                              UpdateAppState.set(ff.AppState.storeCode, item['code']),
                              Navigate(ff.Pages.boutique),
                            ],
                          ),
                        ),
                        Expanded(
                          Button(
                            'Abonnement',
                            name: 'StoreSubscriptionButton',
                            variant: ButtonVariant.outlined,
                            onTap: [
                              UpdateAppState.set('selectedStoreId', item['id']),
                              UpdateAppState.set('selectedStoreName', item['name']),
                              Navigate('Abonnement'),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ),
          Button(
            'Se déconnecter',
            name: 'LogoutButton',
            variant: ButtonVariant.text,
            onTap: [Logout()],
          ),
        ],
      ),
    ),
  );

  // ───── Abonnements d'une boutique ─────
  app.page(
    'Abonnement',
    route: '/abonnements',
    description: 'Abonnements de la boutique choisie (requête Supabase gm_subscriptions filtrée par store_id).',
    state: {'subs': listOf(subscriptions)},
    onLoad: [
      PostgresQuery(
        subscriptions,
        outputAs: 'subsQuery',
        query: PostgresQuerySpec(
          filters: [
            PostgresFilter('store_id', relation: PostgresFilterRelation.equalTo, value: AppState('selectedStoreId')),
          ],
          orderBys: [PostgresOrderBy('starts_at', ascending: false)],
        ),
      ),
      SetState('subs', ActionOutput('subsQuery')),
    ],
    body: Scaffold(
      appBar: AppBar(title: 'Abonnement'),
      body: Column(
        padding: 16,
        spacing: 12,
        crossAxis: CrossAxis.stretch,
        children: [
          Text(AppState('selectedStoreName'), name: 'SelectedStoreText', style: Styles.titleMedium),
          Text('Pour prolonger : GestiMarket sur le PC → Abonnement & licence (carte de bon, Orange Money, Visa).',
              name: 'RenewHintText', style: Styles.bodySmall, color: Colors.secondaryText),
          Expanded(
            ListView(
              source: State('subs'),
              spacing: 10,
              itemBuilder: (s) => Container(
                name: 'SubscriptionCard',
                padding: 14,
                borderRadius: 10,
                color: Colors.secondaryBackground,
                child: Column(
                  crossAxis: CrossAxis.start,
                  spacing: 4,
                  children: [
                    Text(s['plan_code'], name: 'PlanText', style: Styles.titleSmall),
                    Text(s['status'], name: 'StatusText', style: Styles.labelMedium),
                    Text(s['starts_at'], name: 'StartsText', color: Colors.secondaryText),
                    Text(s['ends_at'], name: 'EndsText', color: Colors.secondaryText),
                    Text(s['months'], name: 'MonthsText', style: Styles.bodySmall),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );

  // Connexion Supabase (e-mail) : sans session, l'application reste sur Demarrage (code du commerce) ;
  // après connexion, elle va sur la liste des boutiques.
  app.supabaseAuth(
    providers: [SupabaseAuthProvider.email],
    homePage: boutiques,
    signInPage: ff.Pages.demarrage,
  );
}
