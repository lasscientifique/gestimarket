// Widget personnalisé FlutterFlow : GestiMarketWebView (page « MagasinPage »).
//
// Ouvre GestiMarket complet (l'interface s'adapte au téléphone) pour la boutique retenue sur ce
// téléphone (code du commerce enregistré par la page de connexion), sans paramètre :
//  1. Demande à Supabase (gm_get_server, client Supabase de FlutterFlow) les adresses du poste serveur.
//  2. Choisit la route : RÉSEAU LOCAL d'abord (réponse de /api/ping en moins de 1,5 s), sinon INTERNET
//     (adresse publique : adresse automatique https://gm-000123.<domaine> ou tunnel de la boutique).
//  3. PC serveur éteint : écran « Serveur éteint » (depuis quand), reconnexion seule toutes les 10 s,
//     boutons « Mon abonnement » (fonctionne sans le PC) et « Changer de boutique ».
//  4. Surveille le serveur : redémarrage du PC (pages 502/530 du tunnel), coupure Wi-Fi → recharge seul.
//  5. Scanner natif de codes-barres / QR (canal JavaScript « GestiMarketNative ») et bouton retour Android.
//  6. La pastille « Réseau local / Internet » (en bas à gauche) ouvre le menu : abonnement, autre boutique, recharger.
//
// Dépendance en plus de FlutterFlow : mobile_scanner.
// Android : android:usesCleartextTraffic="true" (adresses http locales) + permission CAMERA.
// iOS : NSAppTransportSecurity → NSAllowsLocalNetworking, NSLocalNetworkUsageDescription, NSCameraUsageDescription.

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:http/http.dart' as http;
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _brand = Color(0xFF0D9488);

class GestiMarketWebView extends StatefulWidget {
  const GestiMarketWebView({super.key, this.width, this.height});

  final double? width;
  final double? height;

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
  String? _detail;
  IconData _messageIcon = Icons.wifi_off;
  bool _serverOff = false;
  String _shopName = '';
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
    _resolving = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      final code = (prefs.getString('gm_shop_code') ?? '').trim();
      if (code.isEmpty) {
        if (mounted) context.goNamed('ConnexionPage');
        return;
      }
      final info = Map<String, dynamic>.from(
        await Supabase.instance.client.rpc('gm_get_server', params: {'p_shop_code': code}).timeout(const Duration(seconds: 10)) as Map,
      );
      if (info['found'] != true) {
        _show('Code du commerce inconnu : $code', Icons.help_outline, detail: 'Choisissez de nouveau la boutique.');
        return;
      }
      _shopName = '${info['shop_name'] ?? ''}';
      if (info['active'] != true) {
        final ago = (info['seconds_ago'] as num?)?.toInt();
        final since = ago == null ? null : DateTime.now().subtract(Duration(seconds: ago));
        _show(
          'Serveur éteint',
          Icons.power_settings_new,
          detail: since == null
              ? 'Le PC serveur de la boutique est éteint ou hors ligne.'
              : 'Le PC serveur de la boutique est éteint ou hors ligne depuis ${_when(since)}.',
          serverOff: true,
        );
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
      // 2) Internet : adresse publique (adresse automatique ou tunnel).
      if (base == null && public.isNotEmpty && await _ping(public, const Duration(seconds: 5))) {
        base = public;
        route = _Route.internet;
      }
      if (base == null) {
        _show(
          'Poste serveur injoignable',
          Icons.wifi_off,
          detail: public.isEmpty
              ? 'Branchez-vous sur le Wi-Fi du magasin (pas encore d\'adresse Internet pour cette boutique).'
              : 'Ni le réseau local ni Internet ne répondent. Nouvelle tentative…',
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
        _serverOff = false;
        _pageLoaded = true;
        _loading = true;
        _pingFailures = 0;
      });
      await _controller.loadRequest(Uri.parse(base));
    } catch (_) {
      _show('Connexion impossible', Icons.wifi_off, detail: 'Vérifiez Internet sur ce téléphone. Nouvelle tentative…');
    } finally {
      _resolving = false;
    }
  }

  String _when(DateTime d) {
    String two(int n) => n.toString().padLeft(2, '0');
    final now = DateTime.now();
    final time = '${two(d.hour)} h ${two(d.minute)}';
    return d.year == now.year && d.month == now.month && d.day == now.day ? time : 'le ${two(d.day)}/${two(d.month)} à $time';
  }

  void _show(String text, IconData icon, {String? detail, bool serverOff = false}) {
    if (!mounted) return;
    setState(() {
      _message = text;
      _detail = detail;
      _messageIcon = icon;
      _serverOff = serverOff;
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

  Future<void> _otherShop() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('gm_shop_code');
    if (mounted) context.goNamed('ConnexionPage');
  }

  void _menu() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheet) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          if (_shopName.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(_shopName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
            ),
          ListTile(
            leading: const Icon(Icons.workspace_premium_outlined),
            title: const Text('Mon abonnement'),
            onTap: () {
              Navigator.of(sheet).pop();
              context.pushNamed('AbonnementPage');
            },
          ),
          ListTile(
            leading: const Icon(Icons.swap_horiz),
            title: const Text('Changer de boutique'),
            onTap: () {
              Navigator.of(sheet).pop();
              _otherShop();
            },
          ),
          ListTile(
            leading: const Icon(Icons.refresh),
            title: const Text('Recharger'),
            onTap: () {
              Navigator.of(sheet).pop();
              _pageLoaded = false;
              _resolve(force: true);
            },
          ),
        ]),
      ),
    );
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

  Widget _panel() {
    return Container(
      color: const Color(0xFFF3F5F8),
      padding: const EdgeInsets.all(28),
      alignment: Alignment.center,
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            width: 84,
            height: 84,
            decoration: BoxDecoration(
              color: _serverOff ? const Color(0xFFFEF3C7) : const Color(0xFFE0F2F1),
              shape: BoxShape.circle,
            ),
            child: Icon(_messageIcon, size: 42, color: _serverOff ? const Color(0xFFB45309) : _brand),
          ),
          const SizedBox(height: 18),
          Text(_message!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w800)),
          if (_shopName.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(_shopName, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: Colors.black54)),
          ],
          if (_detail != null) ...[
            const SizedBox(height: 12),
            Text(_detail!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15)),
          ],
          const SizedBox(height: 18),
          const Row(mainAxisSize: MainAxisSize.min, children: [
            SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            SizedBox(width: 10),
            Text('Reconnexion automatique toutes les 10 secondes', style: TextStyle(color: Colors.black54)),
          ]),
          const SizedBox(height: 22),
          SizedBox(
            width: 280,
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: _brand, minimumSize: const Size.fromHeight(48)),
                onPressed: () => _resolve(force: true),
                icon: const Icon(Icons.refresh),
                label: const Text('Réessayer maintenant'),
              ),
              const SizedBox(height: 10),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                onPressed: () => context.pushNamed('AbonnementPage'),
                icon: const Icon(Icons.workspace_premium_outlined),
                label: const Text('Mon abonnement'),
              ),
              const SizedBox(height: 4),
              TextButton.icon(onPressed: _otherShop, icon: const Icon(Icons.swap_horiz), label: const Text('Changer de boutique')),
            ]),
          ),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: widget.width ?? double.infinity,
      height: widget.height ?? double.infinity,
      child: PopScope(
        canPop: false,
        // Bouton « retour » d'Android : page précédente de GestiMarket.
        onPopInvokedWithResult: (didPop, _) async {
          if (!didPop && await _controller.canGoBack()) _controller.goBack();
        },
        child: SafeArea(
          child: Stack(children: [
            WebViewWidget(controller: _controller),
            if (_loading && _message == null) const LinearProgressIndicator(minHeight: 3),
            if (_message != null) Positioned.fill(child: _panel()),
            // Pastille de route (réseau local / Internet), en bas à gauche : ouvre le menu.
            if (_message == null && _route != null)
              Positioned(
                left: 8,
                bottom: 8,
                child: GestureDetector(
                  onTap: _menu,
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                    decoration: BoxDecoration(
                      color: (_route == _Route.local ? Colors.green : Colors.blue).withAlpha(217),
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(_route == _Route.local ? Icons.wifi : Icons.public, size: 12, color: Colors.white),
                      const SizedBox(width: 4),
                      Text(_route == _Route.local ? 'Réseau local' : 'Internet',
                          style: const TextStyle(fontSize: 11, color: Colors.white, fontWeight: FontWeight.w600)),
                      const SizedBox(width: 2),
                      const Icon(Icons.expand_less, size: 13, color: Colors.white),
                    ]),
                  ),
                ),
              ),
          ]),
        ),
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
