// Widget personnalisé FlutterFlow : GestiMarketConnexion (page « ConnexionPage »).
//
// Deux façons d'ouvrir la boutique sur ce téléphone :
//  • Propriétaire : e-mail et mot de passe du compte boutique (Supabase Auth, session gardée par
//    supabase_flutter) → ses boutiques → « Ouvrir » (poste serveur trouvé par gm_my_server) ou « Abonnement ».
//  • Personnel : code du commerce (GM-XXXXXX) tapé ou scanné sur le QR code affiché par le PC serveur.
//    L'identifiant, le PIN et, la première fois depuis Internet, le code d'accès se tapent ensuite dans GestiMarket.
// La boutique choisie est retenue (shared_preferences) : au prochain lancement, la page de démarrage l'ouvre.
// Dépendance en plus de FlutterFlow : mobile_scanner (scan du QR code du commerce).

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

const _brand = Color(0xFF0D9488);
const _brandDark = Color(0xFF0F766E);

class GestiMarketConnexion extends StatefulWidget {
  const GestiMarketConnexion({super.key, this.width, this.height});

  final double? width;
  final double? height;

  @override
  State<GestiMarketConnexion> createState() => _GestiMarketConnexionState();
}

class _GestiMarketConnexionState extends State<GestiMarketConnexion> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _code = TextEditingController();
  int _tab = 0; // 0 : propriétaire, 1 : personnel
  bool _busy = false;
  String? _error;
  List<Map<String, dynamic>>? _stores;

  SupabaseClient get _sb => Supabase.instance.client;

  @override
  void initState() {
    super.initState();
    if (_sb.auth.currentSession != null) _loadStores();
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await task();
    } on AuthException catch (e) {
      _fail(e.message.toLowerCase().contains('invalid') ? 'E-mail ou mot de passe incorrect.' : e.message);
    } on PostgrestException catch (e) {
      _fail(e.message);
    } catch (_) {
      _fail('Connexion impossible : vérifiez Internet, puis réessayez.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _fail(String message) {
    if (mounted) setState(() => _error = message);
  }

  Future<void> _signIn() => _run(() async {
        if (_email.text.trim().isEmpty || _password.text.isEmpty) {
          return _fail('Saisissez l\'e-mail et le mot de passe du compte boutique.');
        }
        await _sb.auth.signInWithPassword(email: _email.text.trim().toLowerCase(), password: _password.text);
        _password.clear();
        await _loadStores();
      });

  Future<void> _loadStores() async {
    final list = await _sb.rpc('gm_my_stores');
    if (!mounted) return;
    setState(() => _stores = ((list as List?) ?? const []).cast<Map<String, dynamic>>());
  }

  Future<void> _openStore(Map<String, dynamic> store) => _run(() async {
        final code = '${store['code']}';
        final server = Map<String, dynamic>.from(await _sb.rpc('gm_my_server', params: {'p_store_code': code}) as Map);
        if (server['found'] != true) {
          _tab = 1;
          return _fail('${server['error'] ?? 'Poste serveur introuvable.'}');
        }
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('gm_shop_code', '${server['shop_code']}');
        await prefs.setString('gm_store_code', code);
        if (mounted) context.goNamed('MagasinPage');
      });

  Future<void> _subscription(Map<String, dynamic> store) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('gm_store_code', '${store['code']}');
    if (mounted) context.goNamed('AbonnementPage');
  }

  Future<void> _signOut() async {
    await _sb.auth.signOut();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('gm_store_code');
    if (mounted) setState(() => _stores = null);
  }

  Future<void> _useCode([String? scanned]) => _run(() async {
        final code = (scanned ?? _code.text).trim().replaceFirst(RegExp(r'^gestimarket:', caseSensitive: false), '').toUpperCase();
        if (code.length < 4) return _fail('Saisissez ou scannez le code du commerce (ex. GM-7KQ2PX).');
        final info = Map<String, dynamic>.from(await _sb.rpc('gm_get_server', params: {'p_shop_code': code}) as Map);
        if (info['found'] != true) return _fail('Code du commerce inconnu : $code');
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('gm_shop_code', code);
        if (_sb.auth.currentSession == null) await prefs.remove('gm_store_code');
        if (mounted) context.goNamed('MagasinPage');
      });

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const _ScanCodePage()));
    if (code != null && code.isNotEmpty) {
      _code.text = code.replaceFirst(RegExp(r'^gestimarket:', caseSensitive: false), '');
      await _useCode(code);
    }
  }

  String _date(Object? iso) {
    final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
    if (d == null) return '—';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year}';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: widget.width ?? double.infinity,
      height: widget.height ?? double.infinity,
      color: const Color(0xFFF3F5F8),
      child: SafeArea(
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 28, 20, 24), children: [
          Row(children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(color: _brand, borderRadius: BorderRadius.circular(13)),
              child: const Icon(Icons.shopping_cart_outlined, color: Colors.white, size: 26),
            ),
            const SizedBox(width: 12),
            const Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('GestiMarket', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                Text('Ouvrir ma boutique', style: TextStyle(color: Colors.black54)),
              ]),
            ),
          ]),
          const SizedBox(height: 22),
          Container(
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12)),
            padding: const EdgeInsets.all(4),
            child: Row(children: [
              _tabButton(0, Icons.storefront_outlined, 'Propriétaire'),
              _tabButton(1, Icons.badge_outlined, 'Personnel'),
            ]),
          ),
          const SizedBox(height: 16),
          if (_error != null)
            Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: const Color(0xFFFEE2E2), borderRadius: BorderRadius.circular(10)),
              child: Text(_error!, style: const TextStyle(color: Color(0xFF991B1B))),
            ),
          if (_tab == 0) ..._owner() else ..._staff(),
        ]),
      ),
    );
  }

  Widget _tabButton(int index, IconData icon, String label) {
    final active = _tab == index;
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: () => setState(() {
          _tab = index;
          _error = null;
        }),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 150),
          padding: const EdgeInsets.symmetric(vertical: 11),
          decoration: BoxDecoration(color: active ? _brand : Colors.transparent, borderRadius: BorderRadius.circular(9)),
          child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
            Icon(icon, size: 18, color: active ? Colors.white : Colors.black54),
            const SizedBox(width: 6),
            Text(label, style: TextStyle(fontWeight: FontWeight.w600, color: active ? Colors.white : Colors.black54)),
          ]),
        ),
      ),
    );
  }

  InputDecoration _field(String label, IconData icon) => InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        filled: true,
        fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      );

  Widget _primary(String label, VoidCallback? onPressed, {IconData? icon}) => SizedBox(
        height: 50,
        child: FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: _brand, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          onPressed: _busy ? null : onPressed,
          icon: _busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : Icon(icon ?? Icons.arrow_forward),
          label: Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ),
      );

  List<Widget> _owner() {
    final stores = _stores;
    if (stores == null) {
      return [
        const Text('Compte boutique Eden Dev (celui créé sur le PC à la première configuration).',
            style: TextStyle(color: Colors.black54)),
        const SizedBox(height: 14),
        TextField(controller: _email, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: _field('E-mail', Icons.mail_outline)),
        const SizedBox(height: 12),
        TextField(
          controller: _password,
          obscureText: true,
          decoration: _field('Mot de passe', Icons.lock_outline),
          onSubmitted: (_) => _signIn(),
        ),
        const SizedBox(height: 18),
        _primary('Se connecter', _signIn, icon: Icons.login),
      ];
    }
    return [
      Row(children: [
        Expanded(child: Text('Mes boutiques (${stores.length})', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700))),
        TextButton.icon(onPressed: _busy ? null : _signOut, icon: const Icon(Icons.logout, size: 18), label: const Text('Déconnexion')),
      ]),
      const SizedBox(height: 8),
      if (stores.isEmpty) const Text('Aucune boutique sur ce compte : créez-la depuis GestiMarket sur le PC.'),
      for (final s in stores)
        Card(
          elevation: 0,
          margin: const EdgeInsets.only(bottom: 12),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${s['name']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              const SizedBox(height: 2),
              Text('${s['code']} · ${s['city'] ?? ''}', style: const TextStyle(color: Colors.black54)),
              const SizedBox(height: 6),
              Text(
                s['plan_label'] == null
                    ? 'Aucun abonnement en cours'
                    : '${s['plan_label']}${s['trial'] == true ? ' (essai)' : ''} jusqu\'au ${_date(s['ends_at'])}',
                style: TextStyle(color: s['plan_label'] == null ? const Color(0xFFB45309) : _brandDark, fontWeight: FontWeight.w600),
              ),
              const SizedBox(height: 12),
              Row(children: [
                Expanded(child: _primary('Ouvrir', () => _openStore(s), icon: Icons.storefront)),
                const SizedBox(width: 10),
                OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size(0, 50)),
                  onPressed: _busy ? null : () => _subscription(s),
                  icon: const Icon(Icons.workspace_premium_outlined),
                  label: const Text('Abonnement'),
                ),
              ]),
            ]),
          ),
        ),
    ];
  }

  List<Widget> _staff() => [
        const Text(
          'Code du commerce affiché sur le PC serveur (Paramètres → Réseau & mobile), ou scannez son QR code. '
          'Vous taperez ensuite votre identifiant et votre code PIN dans GestiMarket.',
          style: TextStyle(color: Colors.black54),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _code,
          textCapitalization: TextCapitalization.characters,
          autocorrect: false,
          decoration: _field('Code du commerce', Icons.qr_code_2).copyWith(hintText: 'GM-7KQ2PX'),
          onSubmitted: (_) => _useCode(),
        ),
        const SizedBox(height: 12),
        OutlinedButton.icon(
          style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
          onPressed: _busy ? null : _scan,
          icon: const Icon(Icons.qr_code_scanner),
          label: const Text('Scanner le QR code du PC'),
        ),
        const SizedBox(height: 12),
        _primary('Continuer', () => _useCode()),
      ];
}

class _ScanCodePage extends StatefulWidget {
  const _ScanCodePage();

  @override
  State<_ScanCodePage> createState() => _ScanCodePageState();
}

class _ScanCodePageState extends State<_ScanCodePage> {
  bool _done = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scanner le code du commerce')),
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
