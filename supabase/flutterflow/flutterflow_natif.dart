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
      buildNativeFlow,
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

// ─────────────────────────────────────────────────────────────────────────────
// Script qui a créé les pages natives le 4 novembre 2026 (outil FlutterFlow, dossier gestimarket-mobile/dsl).
// Il ne se relance pas tel quel sur le projet : les pages existent déjà. Depuis, le projet se modifie
// dans l'éditeur FlutterFlow, où les appels d'API ci-dessous sont remplacés par des actions Supabase RPC
// natives (voir APPLICATION_MOBILE.md). Cette copie sert de référence (structure, textes, états).
//
// GestiMarket mobile en widgets natifs FlutterFlow (aucun code personnalisé).
// Données : fonctions Supabase (RPC) appelées par des appels d'API, avec la clé publique
// et, pour la propriétaire, la session du compte boutique (jeton JWT de Supabase Auth).
// ─────────────────────────────────────────────────────────────────────────────

const _supabase = 'https://wpuchfnyuyujdflbmqpn.supabase.co';
// Clé publique (anon) : sans danger dans l'application, les fonctions vérifient les droits.
const _anon =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndwdWNoZm55dXl1amRmbGJtcXBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NDYxNjksImV4cCI6MjEwOTEyMjE2OX0.2IrWi0c2RbK0fD32UmSFn5Mx6edNuajJ6FpM89gaSdk';
const _logo = 'projects/gesti-market-ywxut8/assets/2487b6618f529b86/GestiMarket_splash_logo.png';

void buildNativeFlow(App app) {
  final brand = Colors.hex(0xFF0F766E);

  // ───── Données ─────
  final boutique = app.struct('Boutique', {
    'code': string,
    'name': string,
    'city': string,
    'plan_label': string,
    'ends_at': string,
    'trial': bool_,
  });
  final serveur = app.struct('Serveur', {
    'found': bool_,
    'active': bool_,
    'shop_code': string,
    'shop_name': string,
    'public_url': string,
    'error': string,
  });
  final paiement = app.struct('Paiement', {
    'created_at': string,
    'method': string,
    'plan_label': string,
    'months': int_,
    'amount': int_,
    'currency': string,
    'status': string,
  });

  final resultat = app.struct('Resultat', {'ok': bool_, 'error': string});
  final pageCarte = app.struct('PageCarte', {'status': string, 'message': string, 'html': string});

  // Gardés sur le téléphone : la boutique ouverte et celle choisie par la propriétaire.
  app.state('shopCode', string, persisted: true);
  app.state('storeCode', string, persisted: true);

  // ───── Appels d'API (fonctions Supabase) ─────
  Map<String, String> headers(String token) =>
      {'apikey': _anon, 'Authorization': 'Bearer $token', 'Content-Type': 'application/json'};

  final getServer = Endpoint.post(
    'GetServer',
    '$_supabase/rest/v1/rpc/gm_get_server',
    variables: {'code': string},
    headers: headers(_anon),
    bodyText: '{"p_shop_code": "<code>"}',
    bodyType: HttpBodyType.json,
    response: serveur,
  );
  final myStores = Endpoint.post(
    'MyStores',
    '$_supabase/rest/v1/rpc/gm_my_stores',
    variables: {'token': string},
    headers: headers('[token]'),
    bodyText: '{}',
    bodyType: HttpBodyType.json,
    response: listOf(boutique),
  );
  final myServer = Endpoint.post(
    'MyServer',
    '$_supabase/rest/v1/rpc/gm_my_server',
    variables: {'token': string, 'store': string},
    headers: headers('[token]'),
    bodyText: '{"p_store_code": "<store>"}',
    bodyType: HttpBodyType.json,
    response: serveur,
  );
  final myPayments = Endpoint.post(
    'MyPayments',
    '$_supabase/rest/v1/rpc/gm_my_payments',
    variables: {'token': string, 'store': string},
    headers: headers('[token]'),
    bodyText: '{"p_store_code": "<store>"}',
    bodyType: HttpBodyType.json,
    response: listOf(paiement),
  );
  final redeem = Endpoint.post(
    'RedeemVoucher',
    '$_supabase/rest/v1/rpc/gm_my_redeem_voucher',
    variables: {'token': string, 'store': string, 'voucher': string},
    headers: headers('[token]'),
    bodyText: '{"p_store_code": "<store>", "p_code": "<voucher>"}',
    bodyType: HttpBodyType.json,
    response: resultat,
  );
  final declare = Endpoint.post(
    'DeclareOrangeMoney',
    '$_supabase/rest/v1/rpc/gm_declare_payment',
    variables: {
      'token': string,
      'store': string,
      'plan': string,
      'months': string,
      'txid': string,
      'phone': string,
    },
    headers: headers('[token]'),
    bodyText: '{"p_store_code": "<store>", "p_plan": "<plan>", "p_months": <months>, "p_method": "orange_money", '
        '"p_reference": "<txid>", "p_payer_phone": "<phone>"}',
    bodyType: HttpBodyType.json,
  );
  final cardPay = Endpoint.post(
    'StartCardPayment',
    '$_supabase/functions/v1/gm-pay',
    variables: {'token': string, 'store': string, 'plan': string, 'months': string},
    headers: headers('[token]'),
    bodyText: '{"store_code": "<store>", "plan": "<plan>", "months": <months>}',
    bodyType: HttpBodyType.json,
    response: pageCarte,
  );
  for (final e in [getServer, myStores, myServer, myPayments, redeem, declare, cardPay]) {
    app.api(e);
  }
  final jwt = AuthUser(AuthUserField.jwtToken);

  // ───── Démarrage ─────
  app.page(
    'Demarrage',
    route: '/accueil',
    description: 'Logo GestiMarket, puis la boutique retenue sur ce téléphone, ou la connexion.',
    isInitial: true,
    onLoad: [
      Wait(1200),
      If(
        Equals(AppState('shopCode'), ''),
        then: [Navigate('Connexion')],
        orElse: [Navigate('Boutique')],
      ),
    ],
    body: Scaffold(
      body: Container(
        color: brand,
        width: double.infinity,
        height: double.infinity,
        child: Column(
        mainAxis: MainAxis.center,
        crossAxis: CrossAxis.center,
        spacing: 12,
        children: [
          Image(_logo, isNetwork: false, width: 180, height: 180, fit: ImageFit.contain),
          Text('par Eden Dev', color: Colors.hex(0xFFCCFBF1), style: Styles.bodyMedium),
        ],
      ),
      ),
    ),
  );

  // ───── Connexion ─────
  app.page(
    'Connexion',
    route: '/login',
    description: 'Propriétaire : compte boutique. Personnel : code du commerce tapé ou scanné.',
    body: Scaffold(
      appBar: AppBar(title: 'GestiMarket'),
      body: TabBar(
        name: 'ConnexionTabs',
        tabs: [
          TabItem(
            'Propriétaire',
            Column(
              scrollable: true,
              padding: 20,
              spacing: 14,
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
          TabItem(
            'Personnel',
            Column(
              scrollable: true,
              padding: 20,
              spacing: 14,
              children: [
                Text('Tapez ou scannez le code du commerce affiché sur le PC (Paramètres → Réseau & mobile).',
                    style: Styles.bodyMedium),
                TextField(name: 'staffCode', label: 'Code du commerce (GM-…)'),
                Button(
                  'Ouvrir la boutique',
                  name: 'StaffOpenButton',
                  width: double.infinity,
                  height: 48,
                  color: brand,
                  onTap: [
                    UpdateAppState.set('shopCode', WidgetState('staffCode', WidgetStateProperty.text)),
                    Navigate('Boutique'),
                  ],
                ),
                Button(
                  'Scanner le code',
                  name: 'StaffScanButton',
                  icon: 'qr_code_scanner',
                  width: double.infinity,
                  height: 48,
                  variant: ButtonVariant.outlined,
                  onTap: [
                    BarcodeScanner(outputAs: 'scannedCode'),
                    UpdateAppState.set('shopCode', ActionOutput('scannedCode')),
                    Navigate('Boutique'),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  // ───── Mes boutiques (propriétaire) ─────
  final mesBoutiques = app.page(
    'MesBoutiques',
    route: '/mes-boutiques',
    description: 'Boutiques du compte de la propriétaire : ouvrir GestiMarket ou gérer l\'abonnement.',
    state: {'stores': listOf(boutique)},
    onLoad: [
      ApiCall(
        myStores,
        params: {'token': jwt},
        outputAs: 'storesResult',
        onSuccess: (res) => [SetState('stores', res)],
        onFailure: [Snackbar('Impossible de charger vos boutiques.')],
      ),
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
                padding: 16,
                borderRadius: 12,
                color: Colors.secondaryBackground,
                child: Column(
                  crossAxis: CrossAxis.start,
                  spacing: 6,
                  children: [
                    Text(item['name'], style: Styles.titleMedium),
                    Text(item['code'], color: Colors.secondaryText),
                    Text(item['plan_label'], style: Styles.labelMedium),
                    Row(
                      spacing: 8,
                      children: [
                        Expanded(
Button(
                            'Ouvrir',
                            color: brand,
                            onTap: [
                              ApiCall(
                                myServer,
                                params: {'token': jwt, 'store': item['code']},
                                outputAs: 'serverResult',
                                onSuccess: (res) => [
                                  If(
                                    res['found'],
                                    then: [
                                      UpdateAppState.set('shopCode', res['shop_code']),
                                      Navigate('Boutique'),
                                    ],
                                    orElse: [Snackbar(res['error'])],
                                  ),
                                ],
                                onFailure: [Snackbar('Connexion impossible.')],
                              ),
                            ],
                          ),
                        ),
                        Expanded(
Button(
                            'Abonnement',
                            variant: ButtonVariant.outlined,
                            onTap: [
                              UpdateAppState.set('storeCode', item['code']),
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
            variant: ButtonVariant.text,
            onTap: [UpdateAppState.set('shopCode', ''), UpdateAppState.set('storeCode', ''), Logout()],
          ),
        ],
      ),
    ),
  );

  // ───── Boutique : GestiMarket dans la WebView, ou « Serveur éteint » ─────
  app.page(
    'Boutique',
    route: '/boutique',
    description: 'GestiMarket de la boutique (WebView sur son adresse Internet) ; « Serveur éteint » si le PC est arrêté.',
    state: {'server': serveur},
    onLoad: [
      ApiCall(
        getServer,
        params: {'code': AppState('shopCode')},
        outputAs: 'serverCheck',
        onSuccess: (res) => [SetState('server', res)],
        onFailure: [Snackbar('Pas de connexion Internet.')],
      ),
    ],
    body: Scaffold(
      body: Column(
        children: [
          Expanded(
WebView(
              url: State('server')['public_url'],
              name: 'ShopWebView',
              visible: State('server')['active'],
            ),
          ),
          Container(
            name: 'ServerOffPanel',
            visible: Not(State('server')['active']),
            padding: 28,
            child: Column(
              crossAxis: CrossAxis.center,
              spacing: 12,
              children: [
                Icon('power_settings_new', size: 56, color: Colors.hex(0xFFB45309)),
                Text('Serveur éteint', style: Styles.headlineSmall),
                Text(State('server')['shop_name'], color: Colors.secondaryText),
                Text('Le PC serveur de la boutique est éteint ou hors ligne. Rallumez-le, puis touchez « Réessayer ».',
                    style: Styles.bodyMedium),
                Button(
                  'Réessayer',
                  icon: 'refresh',
                  width: double.infinity,
                  height: 48,
                  color: brand,
                  onTap: [
                    ApiCall(
                      getServer,
                      params: {'code': AppState('shopCode')},
                      outputAs: 'serverRetry',
                      onSuccess: (res) => [SetState('server', res)],
                      onFailure: [Snackbar('Pas de connexion Internet.')],
                    ),
                  ],
                ),
                Button(
                  'Mon abonnement',
                  width: double.infinity,
                  height: 48,
                  variant: ButtonVariant.outlined,
                  onTap: [Navigate('MesBoutiques')],
                ),
                Button(
                  'Changer de boutique',
                  variant: ButtonVariant.text,
                  onTap: [UpdateAppState.set('shopCode', ''), Navigate('Connexion')],
                ),
              ],
            ),
          ),
        ],
      ),
    ),
  );

  // ───── Abonnement (propriétaire) ─────
  app.page(
    'Abonnement',
    route: '/forfait',
    description: 'Abonnement d\'une boutique de la propriétaire : paiements, carte de bon, Orange Money, Visa.',
    state: {
      'payments': listOf(paiement),
      'plan': string.withDefault('starter'),
      'months': string.withDefault('12'),
      'cardHtml': string.withDefault(''),
    },
    onLoad: [
      ApiCall(
        myPayments,
        params: {'token': jwt, 'store': AppState('storeCode')},
        outputAs: 'paymentsResult',
        onSuccess: (res) => [SetState('payments', res)],
      ),
    ],
    body: Scaffold(
      appBar: AppBar(title: 'Abonnement'),
      body: Column(
        scrollable: true,
        padding: 16,
        spacing: 14,
        crossAxis: CrossAxis.stretch,
        children: [
          Text(AppState('storeCode'), style: Styles.titleMedium),
          Text('Formule et durée', style: Styles.titleSmall),
          Dropdown(
            options: ['starter', 'pro', 'business'],
            label: 'Formule (STARTER 5 000, PRO 18 000, BUSINESS 50 000 F / mois)',
            value: State('plan'),
            onChanged: SetState('plan', WidgetValue()),
          ),
          Dropdown(
            options: ['1', '3', '6', '12'],
            label: 'Durée en mois (12 mois : 2 offerts)',
            value: State('months'),
            onChanged: SetState('months', WidgetValue()),
          ),
          Divider(),
          Text('Carte de bon', style: Styles.titleSmall),
          TextField(name: 'voucherCode', label: 'Code de la carte'),
          Button(
            'Activer la carte',
            color: brand,
            height: 48,
            onTap: [
              ApiCall(
                redeem,
                params: {
                  'token': jwt,
                  'store': AppState('storeCode'),
                  'voucher': WidgetState('voucherCode', WidgetStateProperty.text),
                },
                outputAs: 'redeemResult',
                onSuccess: (res) => [
                  If(
                    res['ok'],
                    then: [Snackbar('Carte acceptée : abonnement prolongé.'), ClearTextField('voucherCode')],
                    orElse: [Snackbar(res['error'])],
                  ),
                ],
                onFailure: [Snackbar('Carte refusée.')],
              ),
            ],
          ),
          Divider(),
          Text('Orange Money', style: Styles.titleSmall),
          Text('Payez au marchand Eden Dev, puis saisissez l\'ID de transaction reçu par SMS.', style: Styles.bodySmall),
          TextField(name: 'omReference', label: 'ID de transaction'),
          TextField(name: 'omPhone', label: 'Numéro qui a payé'),
          Button(
            'Envoyer le paiement',
            color: brand,
            height: 48,
            onTap: [
              ApiCall(
                declare,
                params: {
                  'token': jwt,
                  'store': AppState('storeCode'),
                  'plan': State('plan'),
                  'months': State('months'),
                  'txid': WidgetState('omReference', WidgetStateProperty.text),
                  'phone': WidgetState('omPhone', WidgetStateProperty.text),
                },
                outputAs: 'declareResult',
                onSuccess: (res) => [
                  Snackbar('Paiement envoyé à Eden Dev : l\'abonnement sera prolongé dès sa validation.'),
                  ClearTextField('omReference'),
                ],
                onFailure: [Snackbar('Paiement refusé : vérifiez l\'ID de transaction.')],
              ),
            ],
          ),
          Divider(),
          Text('Carte Visa', style: Styles.titleSmall),
          Button(
            'Payer par carte',
            icon: 'lock',
            height: 48,
            variant: ButtonVariant.outlined,
            onTap: [
              ApiCall(
                cardPay,
                params: {'token': jwt, 'store': AppState('storeCode'), 'plan': State('plan'), 'months': State('months')},
                outputAs: 'cardResult',
                onSuccess: (res) => [SetState('cardHtml', res['html'])],
                onFailure: [
                  Snackbar('Paiement par carte indisponible pour le moment : utilisez une carte de bon ou Orange Money.'),
                ],
              ),
            ],
          ),
          Container(
            name: 'CardPaymentFrame',
            visible: Not(Equals(State('cardHtml'), '')),
            height: 560,
            child: WebView(html: State('cardHtml'), name: 'CardWebView'),
          ),
          Divider(),
          Text('Derniers paiements', style: Styles.titleSmall),
          ListView(
            source: State('payments'),
            shrinkWrap: true,
            spacing: 8,
            itemBuilder: (p) => Container(
              padding: 12,
              borderRadius: 10,
              color: Colors.secondaryBackground,
              child: Column(
                crossAxis: CrossAxis.start,
                spacing: 2,
                children: [
                  Text(p['plan_label'], style: Styles.titleSmall),
                  Text(p['created_at'], color: Colors.secondaryText),
                  Text(p['status'], style: Styles.labelMedium),
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );

  // Connexion de la propriétaire (Supabase Auth, compte boutique).
  app.supabaseAuth(
    providers: [SupabaseAuthProvider.email],
    homePage: mesBoutiques,
    // Page d'entrée sans session : le démarrage, qui rouvre la boutique retenue (personnel) ou la connexion.
    signInPage: 'Demarrage',
  );

  // Les anciennes pages en code personnalisé (SplashPage, ConnexionPage, MagasinPage, AbonnementPage)
  // et leurs widgets ont été retirés le 4 novembre 2026 (commit FlutterFlow k00w9pHwb8SE27zwfwLN).
}
