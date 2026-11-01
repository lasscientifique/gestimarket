// Widget personnalisé FlutterFlow : GestiMarketWebView
// FlutterFlow → Custom Code → Widgets → + Add → nom « GestiMarketWebView ».
//
// Paramètres (tous de type String, obligatoires) :
//   shopCode     code du commerce (ex. GM-NWAWU5), saisi ou scanné une fois
//   supabaseUrl  https://xxxx.supabase.co
//   supabaseKey  clé publique (anon / sb_publishable_…). Jamais la clé service_role.
//
// Dépendances (Pubspec Dependencies) :
//   webview_flutter: ^4.10.0
//   mobile_scanner: ^6.0.0
//   http: ^1.3.0
//
// Ce que fait le widget, sans autre configuration dans FlutterFlow :
//  1. Interroge Supabase (gm_get_server) pour connaître les adresses du poste serveur du magasin.
//  2. Choisit la route : RÉSEAU LOCAL d'abord (test rapide de /api/ping), sinon INTERNET (adresse
//     publique / tunnel Cloudflare). Même Wi-Fi que le magasin = adresse locale, rapide et sans Internet.
//  3. Surveille le serveur toutes les 10 s : si le PC serveur redémarre (page d'erreur 502/530 du tunnel,
//     serveur arrêté, coupure Wi-Fi), le widget affiche l'état et recharge SEUL dès que le serveur revient.
//     Plus besoin de fermer et rouvrir l'application. Il refait aussi la résolution au retour de l'application.
//  4. Scanner natif de codes-barres / QR (canal JavaScript « GestiMarketNative ») et bouton retour Android.
//
// Android : android:usesCleartextTraffic="true" (adresses http locales) + permission CAMERA.
// iOS : NSAppTransportSecurity → NSAllowsLocalNetworking, NSLocalNetworkUsageDescription, NSCameraUsageDescription.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:webview_flutter/webview_flutter.dart';

class GestiMarketWebView extends StatefulWidget {
  const GestiMarketWebView({
    super.key,
    this.width,
    this.height,
    required this.shopCode,
    required this.supabaseUrl,
    required this.supabaseKey,
  });

  final double? width;
  final double? height;
  final String shopCode;
  final String supabaseUrl;
  final String supabaseKey;

  @override
  State<GestiMarketWebView> createState() => _GestiMarketWebViewState();
}

enum _Route { local, internet }

class _GestiMarketWebViewState extends State<GestiMarketWebView> with WidgetsBindingObserver {
  late final WebViewController _controller;

  String? _base; // adresse actuellement ouverte (sans « / » final)
  _Route? _route;
  bool _pageLoaded = false; // la page GestiMarket est affichée et saine
  bool _loading = true;
  bool _resolving = false;
  String? _message; // état affiché quand la page n'est pas disponible
  IconData _messageIcon = Icons.wifi_off;
  int _pingFailures = 0;
  Timer? _watchdog;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onPageStarted: (_) {
          if (mounted) setState(() => _loading = true);
        },
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        // Erreur réseau sur la page principale (serveur éteint, Wi-Fi coupé…).
        onWebResourceError: (e) {
          if (e.isForMainFrame ?? true) _pageFailed('Connexion au poste serveur perdue. Nouvelle tentative…');
        },
        // Page d'erreur HTTP du tunnel (502/530…) pendant que le PC serveur redémarre.
        onHttpError: (e) {
          final code = e.response?.statusCode ?? 0;
          final uri = e.request?.uri;
          final main = uri != null && _base != null && uri.toString().startsWith(_base!) && (uri.path.isEmpty || uri.path == '/');
          if (main && code >= 500) _pageFailed('Le poste serveur redémarre. Reconnexion automatique…');
        },
      ))
      ..addJavaScriptChannel('GestiMarketNative', onMessageReceived: _onMessage);
    _identify();
    _resolve();
    _watchdog = Timer.periodic(const Duration(seconds: 10), (_) => _watch());
  }

  @override
  void dispose() {
    _watchdog?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Retour dans l'application (déverrouillage, changement de Wi-Fi) : on revérifie la route.
    if (state == AppLifecycleState.resumed) _resolve(force: true);
  }

  @override
  void didUpdateWidget(covariant GestiMarketWebView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.shopCode != widget.shopCode ||
        oldWidget.supabaseUrl != widget.supabaseUrl ||
        oldWidget.supabaseKey != widget.supabaseKey) {
      _resolve(force: true);
    }
  }

  // GestiMarket affiche « · application » pour ce téléphone dans la liste des appareils.
  Future<void> _identify() async {
    try {
      final ua = await _controller.getUserAgent() ?? '';
      if (!ua.contains('GestiMarketApp')) await _controller.setUserAgent('$ua GestiMarketApp'.trim());
    } catch (_) {}
  }

  // ───── Résolution de la route (Supabase → local → internet) ─────

  Future<bool> _ping(String base, Duration timeout) async {
    try {
      final r = await http.get(Uri.parse('$base/api/ping')).timeout(timeout);
      if (r.statusCode != 200) return false;
      return (jsonDecode(r.body) as Map<String, dynamic>)['app'] == 'GestiMarket';
    } catch (_) {
      return false;
    }
  }

  String _clean(Object? v) => (v as String? ?? '').trim().replaceAll(RegExp(r'/+$'), '');

  Future<void> _resolve({bool force = false}) async {
    if (_resolving || !mounted) return;
    final code = widget.shopCode.trim();
    if (code.isEmpty) {
      _show('Code du commerce manquant.', Icons.qr_code_2);
      return;
    }
    _resolving = true;
    try {
      final res = await http
          .post(
            Uri.parse('${_clean(widget.supabaseUrl)}/rest/v1/rpc/gm_get_server'),
            headers: {
              'apikey': widget.supabaseKey.trim(),
              'Authorization': 'Bearer ${widget.supabaseKey.trim()}',
              'Content-Type': 'application/json',
            },
            body: jsonEncode({'p_shop_code': code}),
          )
          .timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) {
        _show('Annuaire Supabase indisponible (${res.statusCode}). Nouvelle tentative…', Icons.cloud_off);
        return;
      }
      final info = jsonDecode(res.body) as Map<String, dynamic>;
      if (info['found'] != true) {
        _show('Code du commerce inconnu : $code', Icons.help_outline);
        return;
      }
      if (info['active'] != true) {
        _show('Serveur du magasin arrêté. Reconnexion automatique dès qu\'il redémarre…', Icons.power_settings_new);
        return;
      }

      final locals = <String>{
        _clean(info['url']),
        ...((info['urls'] as List?) ?? const []).map(_clean),
      }..removeWhere((u) => u.isEmpty);
      final public = _clean(info['public_url']);

      String? base;
      _Route? route;
      // 1) Réseau local : réponse en moins de 1,5 s si le téléphone est sur le Wi-Fi du magasin.
      for (final u in locals) {
        if (await _ping(u, const Duration(milliseconds: 1500))) {
          base = u;
          route = _Route.local;
          break;
        }
      }
      // 2) Internet : adresse publique (tunnel).
      if (base == null && public.isNotEmpty && await _ping(public, const Duration(seconds: 5))) {
        base = public;
        route = _Route.internet;
      }
      if (base == null) {
        _show(
          public.isEmpty
              ? 'Poste serveur introuvable. Branchez-vous sur le Wi-Fi du magasin.'
              : 'Poste serveur injoignable (réseau local et Internet). Nouvelle tentative…',
          Icons.wifi_off,
        );
        return;
      }

      // Déjà sur la bonne adresse et page saine : rien à recharger.
      if (_pageLoaded && _base == base && _message == null) return;
      if (!mounted) return;
      setState(() {
        _base = base;
        _route = route;
        _message = null;
        _pageLoaded = true;
        _loading = true;
        _pingFailures = 0;
      });
      await _controller.loadRequest(Uri.parse(base));
    } catch (_) {
      _show('Connexion impossible. Nouvelle tentative…', Icons.wifi_off);
    } finally {
      _resolving = false;
    }
  }

  void _show(String text, IconData icon) {
    if (!mounted) return;
    setState(() {
      _message = text;
      _messageIcon = icon;
      _pageLoaded = false;
      _loading = false;
    });
  }

  void _pageFailed(String text) {
    if (!mounted) return;
    _show(text, Icons.sync_problem);
    _resolve(force: true);
  }

  // Surveillance : page affichée → on vérifie que le serveur répond ; sinon on retente la résolution.
  Future<void> _watch() async {
    if (!mounted || _resolving) return;
    if (_pageLoaded && _base != null) {
      if (await _ping(_base!, const Duration(seconds: 4))) {
        _pingFailures = 0;
      } else if (++_pingFailures >= 2) {
        _pageFailed('Connexion au poste serveur perdue. Nouvelle tentative…');
      }
    } else {
      _resolve(force: true);
    }
  }

  // ───── Scanner natif ─────

  Future<void> _onMessage(JavaScriptMessage message) async {
    Map<String, dynamic> msg;
    try {
      msg = jsonDecode(message.message) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    if (msg['action'] != 'scan' || !mounted) return;
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => _ScanPage(title: (msg['title'] as String?) ?? 'Scanner un code')),
    );
    if (code != null && code.isNotEmpty) {
      await _controller.runJavaScript('window.gestimarketScan && window.gestimarketScan(${jsonEncode(code)});');
    }
  }

  // ───── Affichage ─────

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.width,
      height: widget.height,
      child: PopScope(
        canPop: false,
        // Bouton « retour » d'Android : page précédente de GestiMarket.
        onPopInvokedWithResult: (didPop, _) async {
          if (!didPop && await _controller.canGoBack()) _controller.goBack();
        },
        child: Stack(children: [
          WebViewWidget(controller: _controller),
          if (_loading && _message == null) const LinearProgressIndicator(minHeight: 3),
          if (_message != null)
            Container(
              color: Colors.white,
              padding: const EdgeInsets.all(24),
              alignment: Alignment.center,
              child: Column(mainAxisSize: MainAxisSize.min, children: [
                Icon(_messageIcon, size: 48),
                const SizedBox(height: 12),
                Text(_message!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 16)),
                const SizedBox(height: 16),
                const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5)),
                const SizedBox(height: 16),
                OutlinedButton(onPressed: () => _resolve(force: true), child: const Text('Réessayer maintenant')),
              ]),
            ),
          // Petit indicateur de route (réseau local / Internet), discret, en bas à gauche.
          if (_message == null && _route != null)
            Positioned(
              left: 8,
              bottom: 8,
              child: IgnorePointer(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: (_route == _Route.local ? Colors.green : Colors.blue).withAlpha(217),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Row(mainAxisSize: MainAxisSize.min, children: [
                    Icon(_route == _Route.local ? Icons.wifi : Icons.public, size: 12, color: Colors.white),
                    const SizedBox(width: 4),
                    Text(_route == _Route.local ? 'Réseau local' : 'Internet',
                        style: const TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.w600)),
                  ]),
                ),
              ),
            ),
        ]),
      ),
    );
  }
}

class _ScanPage extends StatefulWidget {
  const _ScanPage({required this.title});
  final String title;

  @override
  State<_ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<_ScanPage> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: MobileScanner(
        onDetect: (capture) {
          final value = capture.barcodes.isEmpty ? null : capture.barcodes.first.rawValue;
          if (value != null && value.isNotEmpty && !_done) {
            _done = true;
            Navigator.of(context).pop(value);
          }
        },
      ),
    );
  }
}
