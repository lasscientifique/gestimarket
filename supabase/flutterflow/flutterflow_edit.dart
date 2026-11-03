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
      buildStarterEditFlow,
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
  stdout.writeln('''
Run the starter FlutterFlow AI edit flow.

Usage:
  flutterflow ai validate dsl/edit.dart [options]
  flutterflow ai run dsl/edit.dart [options]

Options:
  --api-key <key>           FlutterFlow API key. Defaults to FF_API_KEY.
  --base-url <url>          Override the FlutterFlow API base URL.
  --project-name <name>     Create a new project with this name.
  --project-id <id>         Push into an existing project by ID.
  --find-or-create          Retry by reusing a same-name project before creating.
  --allow-new-project       Bypass the workspace binding guard and create a different project.
  --commit-message <text>   Commit message for the push.
  --dry-run                 Compile and validate without pushing.
  --help, -h                Show this help.
''');
}

/// Widgets de l'application mobile GestiMarket : source unique dans le dépôt (supabase/flutterflow/).
const _kit = r'C:\Users\Fousseyni NDIAYE\Documents\gestion market\gestimarket-src\gestimarket\supabase\flutterflow';

String _widgetCode(String file) => File('$_kit\\$file').readAsStringSync();

void buildStarterEditFlow(App app) {
  // Scanner de codes-barres et QR codes (code du commerce, caisse depuis le téléphone).
  app.raw((project) {
    if (findPubDependency(project, name: 'mobile_scanner') == null) {
      addPubDependency(project, name: 'mobile_scanner', version: '6.0.0');
    }
  });

  // Le poste serveur répond en http sur le réseau local (http://192.168.x.x:7878).
  app.nativeFile(NativeFile.androidManifest).hook(
    NativeFileHook.manifestApplicationTag,
    name: 'Adresses locales en http',
    content: 'android:usesCleartextTraffic="true"',
  );
  app.nativeFile(NativeFile.infoPlist)
    ..hook(
      NativeFileHook.infoPlistProperty,
      name: 'Camera',
      content: '<key>NSCameraUsageDescription</key><string>Scanner les codes-barres et le code du commerce.</string>',
    )
    ..hook(
      NativeFileHook.infoPlistProperty,
      name: 'Reseau local',
      content: '<key>NSLocalNetworkUsageDescription</key><string>Connexion au poste serveur du magasin.</string>'
          '<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>',
    );

  // Widgets : remplacés par la version du dépôt (supabase/flutterflow/) à chaque exécution.
  final widgets = <(ProjectCustomWidgetHandle, String)>[
    (ff.CustomWidgets.gestiMarketSplash, 'gestimarket_splash.dart'),
    (ff.CustomWidgets.gestiMarketConnexion, 'gestimarket_connexion.dart'),
    (ff.CustomWidgets.gestiMarketWebView, 'gestimarket_webview.dart'),
    (ff.CustomWidgets.gestiMarketAbonnement, 'gestimarket_abonnement.dart'),
  ];
  for (final (handle, file) in widgets) {
    app.editCustomWidget(handle, (widget) => widget.replaceCode(_widgetCode(file)));
  }

  app.ensurePage(
    'SplashPage',
    description: 'Page de démarrage : logo, puis ouverture de la boutique retenue ou de la connexion.',
    route: '/splash',
    isInitial: true,
    body: Scaffold(body: CustomWidget('GestiMarketSplash', arguments: {}, name: 'Splash')),
  );
  app.ensurePage(
    'ConnexionPage',
    description: 'Connexion : propriétaire (compte boutique) ou personnel (code du commerce).',
    route: '/connexion',
    body: Scaffold(body: CustomWidget('GestiMarketConnexion', arguments: {}, name: 'Connexion')),
  );
  app.ensurePage(
    'MagasinPage',
    description: 'La boutique dans GestiMarket (WebView) ; écran « Serveur éteint » quand le PC est arrêté.',
    route: '/magasin',
    body: Scaffold(body: CustomWidget('GestiMarketWebView', arguments: {}, name: 'Magasin')),
  );
  app.ensurePage(
    'AbonnementPage',
    description: 'Gestion de l\'abonnement par la propriétaire, même PC éteint.',
    route: '/abonnement',
    body: Scaffold(body: CustomWidget('GestiMarketAbonnement', arguments: {}, name: 'Abonnement')),
  );
}
