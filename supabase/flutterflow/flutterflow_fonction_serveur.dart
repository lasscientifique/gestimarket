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
      buildServerFunction,
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
  stdout.writeln('fonction');
}

/// Fonction personnalisée FlutterFlow « isServerActive » : le poste serveur d'une boutique est-il allumé ?
/// Arguments lus dans la ligne gm_servers de la boutique : shop_code, active, last_seen.
/// Le PC publie son état toutes les 30 s : au-delà de 90 s sans nouvelle (coupure de courant, PC éteint
/// sans fermer GestiMarket), il est considéré comme éteint, même si « active » est resté à true.
void buildServerFunction(App app) {
  app.customFunction(
    'isServerActive',
    args: {'shopCode': string, 'active': bool_, 'lastSeen': dateTime},
    returns: bool_,
    description: 'Vrai si le PC serveur de la boutique est allumé : code présent, active = true et '
        'dernier signe de vie (last_seen de gm_servers) il y a moins de 90 secondes.',
    code: r'''
if (shopCode == null || shopCode.trim().isEmpty) {
  return false;
}
if (active != true || lastSeen == null) {
  return false;
}
// Écart entre maintenant et le dernier signe de vie du PC (le PC publie toutes les 30 s).
// Un écart négatif (horloge du téléphone un peu en retard) compte comme « tout récent ».
final ecart = DateTime.now().toUtc().difference(lastSeen.toUtc());
return ecart.inSeconds < 90;
''',
  );
}
