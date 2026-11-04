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
      buildMenuFlow,
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
  stdout.writeln('menu');
}

// ─────────────────────────────────────────────────────────────────────────────
// Design de l'application, page « Contact Eden Dev » et menu flottant déplaçable (4 novembre 2026).
// Le code du widget MenuFlottant est dans le dépôt : supabase/flutterflow/menu_flottant.dart.
// ─────────────────────────────────────────────────────────────────────────────

const _kit = r'C:\Users\Fousseyni NDIAYE\Documents\gestion market\gestimarket-src\gestimarket\supabase\flutterflow';
const _icone = 'projects/gesti-market-ywxut8/assets/d1b4b08d05906ee2/GestiMarket_icone_1024.png';

void buildMenuFlow(App app) {
  // ───── Thème : vert GestiMarket, fonds clairs (et sombres) ─────
  app.themeColor('primary', 0xFF0F766E, dark: 0xFF14B8A6);
  app.themeColor('secondary', 0xFF14B8A6, dark: 0xFF2DD4BF);
  app.themeColor('tertiary', 0xFFF59E0B, dark: 0xFFFBBF24);
  app.themeColor('alternate', 0xFFE2E8F0, dark: 0xFF243241);
  app.themeColor('primaryBackground', 0xFFF3F5F8, dark: 0xFF0B1118);
  app.themeColor('secondaryBackground', 0xFFFFFFFF, dark: 0xFF121A23);
  app.themeColor('primaryText', 0xFF0F172A, dark: 0xFFE2E8F0);
  app.themeColor('secondaryText', 0xFF64748B, dark: 0xFF8B9CAD);
  app.themeColor('success', 0xFF16A34A, dark: 0xFF22C55E);
  app.themeColor('warning', 0xFFD97706, dark: 0xFFF59E0B);
  app.themeColor('error', 0xFFDC2626, dark: 0xFFF87171);
  app.themeColor('info', 0xFF0F766E, dark: 0xFF14B8A6);

  // ───── Menu flottant (widget personnalisé : bulle déplaçable + menu) ─────
  app.customWidget(
    'MenuFlottant',
    description: 'Bulle de navigation déplaçable au-dessus des pages (WebView comprise) : Mes boutiques, '
        'Ma boutique, Abonnement, Contact Eden Dev, Se déconnecter. Ne prend aucune place dans la page.',
    code: File('$_kit\\menu_flottant.dart').readAsStringSync(),
  );

  // La bulle navigue elle-même par les routes des pages (les paramètres de type action ne passent pas
  // par l'outil FlutterFlow) : /mes-boutiques, /boutique, /abonnements, /contact.
  final contactPage = 'ContactEdenDev';
  DslWidget menu() => CustomWidget('MenuFlottant', name: 'MenuFlottant', arguments: {});

  // ───── Page Contact Eden Dev ─────
  DslWidget carte(String icone, String titre, String valeur, String bouton, String lien, String nom) => Container(
        name: '${nom}Card',
        padding: 16,
        borderRadius: 16,
        color: Colors.secondaryBackground,
        borderColor: Colors.alternate,
        borderWidth: 1,
        child: Column(
          crossAxis: CrossAxis.stretch,
          spacing: 10,
          children: [
            Row(
              spacing: 12,
              children: [
                Icon(icone, size: 26, color: Colors.primary),
                Expanded(
                  Column(
                    crossAxis: CrossAxis.start,
                    spacing: 2,
                    children: [
                      Text(titre, style: Styles.labelMedium, color: Colors.secondaryText),
                      Text(valeur, style: Styles.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                    ],
                  ),
                ),
              ],
            ),
            Button(
              bouton,
              name: '${nom}Button',
              icon: icone,
              height: 46,
              borderRadius: 12,
              color: Colors.primary,
              onTap: [LaunchUrl(lien)],
            ),
          ],
        ),
      );

  app.page(
    contactPage,
    route: '/contact',
    description: 'Contacter Eden Dev, éditeur de GestiMarket : e-mail, WhatsApp, téléphone.',
    body: Scaffold(
      appBar: AppBar(title: 'Contact Eden Dev'),
      body: Column(
        scrollable: true,
        padding: 20,
        spacing: 16,
        crossAxis: CrossAxis.stretch,
        children: [
          Container(
            name: 'EdenDevHeader',
            padding: 24,
            borderRadius: 20,
            color: Colors.primary,
            child: Column(
              crossAxis: CrossAxis.center,
              spacing: 8,
              children: [
                Image(_icone, isNetwork: false, width: 84, height: 84, fit: ImageFit.contain, borderRadius: 20),
                Text('Eden Dev', style: Styles.headlineSmall, color: Colors.hex(0xFFFFFFFF)),
                Text(
                  'Éditeur de GestiMarket : une question, une panne, une formation ou une nouvelle fonction ? Contactez-nous.',
                  style: Styles.bodyMedium,
                  color: Colors.hex(0xFFCCFBF1),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
          carte('mail', 'E-mail', 'lasscientifique@gmail.com', 'Écrire un e-mail', 'mailto:lasscientifique@gmail.com', 'Email'),
          carte('chat', 'WhatsApp', '@edendeveloppeur', 'Ouvrir WhatsApp', 'https://wa.me/22376593676', 'WhatsApp'),
          carte('call', 'Téléphone', '+223 76 59 36 76', 'Appeler', 'tel:+22376593676', 'Phone'),
          menu(),
        ],
      ),
    ),
  );

  // ───── Menu sur les pages existantes (le widget ne prend aucune place) ─────
  app.editPage(ff.Pages.boutiques, (page) {
    page.ensureInsertedAfter(page.findByKey('Image_tkwih2z2'), menu());
  });
  app.editPage(ff.Pages.abonnement, (page) {
    page.ensureInsertedAfter(page.findByKey('Image_oe8a2hgq'), menu());
  });
  app.editPage(ff.Pages.boutique, (page) {
    page.ensureInsertedInto(page.findByKey('Column_c9f65q5a'), menu());
    // Statut du PC en temps réel : la page bascule seule entre GestiMarket et « Serveur éteint ».
    // Code introuvable : « Serveur éteint » au lieu d'une page blanche.
    // La boucle « au chargement : rafraîchir la requête toutes les 0,5 s » est retirée : le temps réel
    // la remplace (elle envoyait environ deux requêtes par seconde et par téléphone).
    page.mutateNode(page.findByKey('Scaffold_6513d2yk'), (node) {
      node.triggerActions.removeWhere((t) => t.rootAction.key == '5snhvnao');
    });
    page.mutateNode(page.findByKey('ConditionalBuilder_4eeyc1wq'), (node) {
      node.databaseRequest.postgres.isStreamingSupabaseQuery = true;
      node.databaseRequest.postgres.hideOnEmpty = false;
    });
  });
}
