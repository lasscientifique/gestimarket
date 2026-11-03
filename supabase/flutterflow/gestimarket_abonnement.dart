// Widget personnalisé FlutterFlow : GestiMarketAbonnement (page « AbonnementPage »).
//
// Réservé à la propriétaire (compte boutique Eden Dev, session Supabase gardée sur le téléphone) ;
// fonctionne même quand le PC serveur est éteint :
//  • formule, date de fin, jours restants, postes reliés ;
//  • payer ou renouveler : carte de bon (activation immédiate), Orange Money (ID de transaction validé par
//    Eden Dev) ou carte Visa (page sécurisée Cybersource) — 1, 3, 6 ou 12 mois (2 mois offerts) ;
//  • derniers paiements et leur état.
// Fonctions Supabase : gm_my_stores, gm_public_options, gm_my_payments, gm_my_redeem_voucher,
// gm_declare_payment, fonction « gm-pay » (carte). Dépendances : celles de FlutterFlow (webview_flutter…).

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';

const _brand = Color(0xFF0D9488);
const _brandDark = Color(0xFF0F766E);
const _months = [1, 3, 6, 12];

class GestiMarketAbonnement extends StatefulWidget {
  const GestiMarketAbonnement({super.key, this.width, this.height});

  final double? width;
  final double? height;

  @override
  State<GestiMarketAbonnement> createState() => _GestiMarketAbonnementState();
}

class _GestiMarketAbonnementState extends State<GestiMarketAbonnement> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _voucher = TextEditingController();
  final _reference = TextEditingController();
  final _phone = TextEditingController();

  bool _busy = false;
  String? _error;
  String? _notice;
  List<Map<String, dynamic>> _stores = [];
  Map<String, dynamic>? _store;
  Map<String, dynamic>? _options;
  List<Map<String, dynamic>> _payments = [];
  String _plan = 'pro';
  int _monthsChoice = 1;
  String _method = 'voucher';

  SupabaseClient get _sb => Supabase.instance.client;
  bool get _signedIn => _sb.auth.currentSession != null;

  @override
  void initState() {
    super.initState();
    if (_signedIn) _load();
  }

  @override
  void dispose() {
    for (final c in [_email, _password, _voucher, _reference, _phone]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      _busy = true;
      _error = null;
      _notice = null;
    });
    try {
      await task();
    } on AuthException catch (e) {
      _setError(e.message.toLowerCase().contains('invalid') ? 'E-mail ou mot de passe incorrect.' : e.message);
    } on PostgrestException catch (e) {
      _setError(e.message);
    } on FunctionException catch (e) {
      final details = e.details;
      _setError(details is Map && details['message'] != null ? '${details['message']}' : 'Paiement par carte indisponible pour le moment.');
    } catch (_) {
      _setError('Connexion impossible : vérifiez Internet, puis réessayez.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _setError(String message) {
    if (mounted) setState(() => _error = message);
  }

  Future<void> _load() => _run(() async {
        final prefs = await SharedPreferences.getInstance();
        final wanted = prefs.getString('gm_store_code') ?? '';
        final stores = ((await _sb.rpc('gm_my_stores') as List?) ?? const []).cast<Map<String, dynamic>>();
        final options = Map<String, dynamic>.from(await _sb.rpc('gm_public_options') as Map);
        Map<String, dynamic>? store;
        for (final s in stores) {
          if (s['code'] == wanted) store = s;
        }
        store ??= stores.isEmpty ? null : stores.first;
        var payments = <Map<String, dynamic>>[];
        if (store != null) {
          payments = ((await _sb.rpc('gm_my_payments', params: {'p_store_code': store['code']}) as List?) ?? const [])
              .cast<Map<String, dynamic>>();
          await prefs.setString('gm_store_code', '${store['code']}');
        }
        if (!mounted) return;
        setState(() {
          _stores = stores;
          _store = store;
          _options = options;
          _payments = payments;
          final current = '${store?['plan'] ?? ''}';
          if (current.isNotEmpty && current != 'free') _plan = current;
          if (!_cardEnabled && _method == 'card') _method = 'voucher';
        });
      });

  Future<void> _signIn() => _run(() async {
        await _sb.auth.signInWithPassword(email: _email.text.trim().toLowerCase(), password: _password.text);
        _password.clear();
      }).then((_) {
        if (_signedIn) _load();
      });

  Future<void> _signOut() async {
    await _sb.auth.signOut();
    if (mounted) {
      setState(() {
        _stores = [];
        _store = null;
        _payments = [];
      });
    }
  }

  void _back() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.goNamed('MagasinPage');
    }
  }

  // ───── Prix ─────

  List<Map<String, dynamic>> get _plans =>
      ((_options?['plans'] as List?) ?? const []).cast<Map<String, dynamic>>().where((p) => p['code'] != 'free').toList();

  Map<String, dynamic> get _payment => Map<String, dynamic>.from((_options?['payment'] as Map?) ?? const {});

  bool get _cardEnabled => _payment['card_enabled'] == true;

  String get _currency => '${_store?['currency'] ?? 'XOF'}';

  int _billed(int months) => months == 12 ? 10 : months;

  /// Prix mensuel dans la devise de la boutique si Eden Dev l'a fixé, sinon en FCFA.
  (int, String) _price(Map<String, dynamic> plan, {String? currency}) {
    final cur = currency ?? _currency;
    final prices = Map<String, dynamic>.from((plan['prices'] as Map?) ?? const {});
    final value = prices[cur];
    if (value is num) return (value.toInt(), cur);
    return ((plan['price_month'] as num? ?? 0).toInt(), 'XOF');
  }

  String _money(int amount, String currency) {
    final digits = amount.abs().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ' ');
    final value = '${amount < 0 ? '-' : ''}$digits';
    return switch (currency) {
      'XOF' || 'XAF' => '$value FCFA',
      'EUR' => '$value €',
      'USD' => '$value \$US',
      _ => '$value $currency',
    };
  }

  String _date(Object? iso) {
    final d = DateTime.tryParse('${iso ?? ''}')?.toLocal();
    if (d == null) return '—';
    String two(int n) => n.toString().padLeft(2, '0');
    return '${two(d.day)}/${two(d.month)}/${d.year}';
  }

  Map<String, dynamic>? get _chosenPlan {
    for (final p in _plans) {
      if (p['code'] == _plan) return p;
    }
    return _plans.isEmpty ? null : _plans.first;
  }

  // ───── Paiements ─────

  Future<void> _redeem() => _run(() async {
        final r = Map<String, dynamic>.from(
          await _sb.rpc('gm_my_redeem_voucher', params: {'p_store_code': _store!['code'], 'p_code': _voucher.text.trim()}) as Map,
        );
        if (r['ok'] != true) return _setError('${r['error'] ?? 'Carte de bon refusée.'}');
        _voucher.clear();
        await _load();
        if (mounted) {
          setState(() => _notice = 'Carte acceptée : ${r['plan_label']} ${r['months']} mois, jusqu\'au ${_date(r['ends_at'])}. '
              'Le PC serveur met sa licence à jour tout seul.');
        }
      });

  Future<void> _orangeMoney() => _run(() async {
        final plan = _chosenPlan;
        if (plan == null) return;
        final r = Map<String, dynamic>.from(await _sb.rpc('gm_declare_payment', params: {
          'p_store_code': _store!['code'],
          'p_plan': plan['code'],
          'p_months': _monthsChoice,
          'p_method': 'orange_money',
          'p_reference': _reference.text.trim(),
          'p_payer_phone': _phone.text.trim(),
        }) as Map);
        _reference.clear();
        await _load();
        if (mounted) {
          setState(() => _notice = 'Paiement envoyé à Eden Dev (${r['plan_label']}, ${r['months']} mois, '
              '${_money((r['amount'] as num).toInt(), 'XOF')}). Dès sa validation, l\'abonnement est prolongé.');
        }
      });

  Future<void> _payByCard() => _run(() async {
        final plan = _chosenPlan;
        if (plan == null) return;
        final res = await _sb.functions.invoke('gm-pay', body: {'store_code': _store!['code'], 'plan': plan['code'], 'months': _monthsChoice});
        final data = Map<String, dynamic>.from((res.data as Map?) ?? const {});
        if (data['status'] != 'ok') return _setError('${data['message'] ?? 'Paiement par carte impossible.'}');
        if (!mounted) return;
        await Navigator.of(context).push<void>(MaterialPageRoute(
          builder: (_) => _CardPage(endpoint: '${data['endpoint']}', fields: Map<String, dynamic>.from(data['fields'] as Map)),
        ));
        await _load();
      });

  // ───── Affichage ─────

  @override
  Widget build(BuildContext context) {
    return Container(
      width: widget.width ?? double.infinity,
      height: widget.height ?? double.infinity,
      color: const Color(0xFFF3F5F8),
      child: SafeArea(
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 6, 12, 0),
            child: Row(children: [
              IconButton(onPressed: _back, icon: const Icon(Icons.arrow_back)),
              const Expanded(child: Text('Mon abonnement', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800))),
              if (_signedIn) IconButton(tooltip: 'Actualiser', onPressed: _busy ? null : _load, icon: const Icon(Icons.refresh)),
            ]),
          ),
          if (_busy) const LinearProgressIndicator(minHeight: 2, color: _brand),
          Expanded(
            child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
              if (_error != null) _banner(_error!, const Color(0xFFFEE2E2), const Color(0xFF991B1B)),
              if (_notice != null) _banner(_notice!, const Color(0xFFD1FAE5), const Color(0xFF065F46)),
              if (!_signedIn) ..._login() else if (_store == null && !_busy) _empty() else if (_store != null) ..._content(),
            ]),
          ),
        ]),
      ),
    );
  }

  Widget _banner(String text, Color bg, Color fg) => Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
        child: Text(text, style: TextStyle(color: fg)),
      );

  Widget _card(List<Widget> children) => Card(
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: children)),
      );

  InputDecoration _field(String label, IconData icon, {String? hint}) => InputDecoration(
        labelText: label,
        hintText: hint,
        prefixIcon: Icon(icon),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
      );

  Widget _primary(String label, VoidCallback onPressed, {IconData icon = Icons.check}) => SizedBox(
        width: double.infinity,
        height: 50,
        child: FilledButton.icon(
          style: FilledButton.styleFrom(backgroundColor: _brand, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10))),
          onPressed: _busy ? null : onPressed,
          icon: Icon(icon),
          label: Text(label, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
        ),
      );

  List<Widget> _login() => [
        _card([
          const Text('Réservé à la propriétaire', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          const Text('Connectez-vous avec le compte boutique Eden Dev. L\'abonnement se gère même quand le PC est éteint.',
              style: TextStyle(color: Colors.black54)),
          const SizedBox(height: 14),
          TextField(controller: _email, keyboardType: TextInputType.emailAddress, autocorrect: false, decoration: _field('E-mail', Icons.mail_outline)),
          const SizedBox(height: 12),
          TextField(controller: _password, obscureText: true, decoration: _field('Mot de passe', Icons.lock_outline), onSubmitted: (_) => _signIn()),
          const SizedBox(height: 16),
          _primary('Se connecter', _signIn, icon: Icons.login),
        ]),
      ];

  Widget _empty() => _card([
        const Text('Aucune boutique sur ce compte.', style: TextStyle(fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        const Text('Créez la boutique depuis GestiMarket sur le PC (première configuration).'),
        const SizedBox(height: 12),
        TextButton.icon(onPressed: _signOut, icon: const Icon(Icons.logout), label: const Text('Se déconnecter')),
      ]);

  List<Widget> _content() {
    final s = _store!;
    final ends = DateTime.tryParse('${s['ends_at'] ?? ''}')?.toLocal();
    final days = ends?.difference(DateTime.now()).inDays;
    final plan = _chosenPlan;
    final unit = plan == null ? (0, 'XOF') : _price(plan, currency: _method == 'orange_money' ? 'XOF' : null);
    final amount = unit.$1 * _billed(_monthsChoice);
    return [
      if (_stores.length > 1)
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: InputDecorator(
            decoration: _field('Boutique', Icons.storefront_outlined),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                isExpanded: true,
                isDense: true,
                value: '${s['code']}',
                items: [for (final x in _stores) DropdownMenuItem(value: '${x['code']}', child: Text('${x['name']} (${x['code']})'))],
                onChanged: (code) async {
                  final prefs = await SharedPreferences.getInstance();
                  await prefs.setString('gm_store_code', code ?? '');
                  _load();
                },
              ),
            ),
          ),
        ),
      _card([
        Text('${s['name']}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        Text('${s['code']} · ${s['city'] ?? ''}', style: const TextStyle(color: Colors.black54)),
        const SizedBox(height: 14),
        Row(children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(color: const Color(0xFFE0F2F1), borderRadius: BorderRadius.circular(999)),
            child: Text(s['plan_label'] == null ? 'Aucune formule' : '${s['plan_label']}${s['trial'] == true ? ' · essai' : ''}',
                style: const TextStyle(color: _brandDark, fontWeight: FontWeight.w700)),
          ),
          const SizedBox(width: 10),
          Text('${s['pcs'] ?? 0} PC relié(s)', style: const TextStyle(color: Colors.black54)),
        ]),
        const SizedBox(height: 10),
        Text(
          ends == null ? 'Pas d\'abonnement en cours : la boutique est en consultation seule.' : 'Jusqu\'au ${_date(s['ends_at'])}',
          style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
        if (days != null)
          Text(
            days < 0 ? 'Expiré' : '$days jour(s) restant(s)',
            style: TextStyle(color: days < 7 ? const Color(0xFFB45309) : Colors.black54, fontWeight: FontWeight.w600),
          ),
      ]),
      _card([
        const Text('Payer ou renouveler', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 12),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final p in _plans)
            ChoiceChip(
              selected: p['code'] == plan?['code'],
              selectedColor: const Color(0xFFCCFBF1),
              label: Text('${p['label']} · ${_money(_price(p).$1, _price(p).$2)} / mois'),
              onSelected: (_) => setState(() => _plan = '${p['code']}'),
            ),
        ]),
        const SizedBox(height: 10),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final m in _months)
            ChoiceChip(
              selected: _monthsChoice == m,
              selectedColor: const Color(0xFFCCFBF1),
              label: Text(m == 12 ? '12 mois (2 offerts)' : '$m mois'),
              onSelected: (_) => setState(() => _monthsChoice = m),
            ),
        ]),
        const SizedBox(height: 14),
        SegmentedButton<String>(
          segments: [
            const ButtonSegment(value: 'voucher', icon: Icon(Icons.confirmation_number_outlined), label: Text('Bon')),
            const ButtonSegment(value: 'orange_money', icon: Icon(Icons.phone_iphone), label: Text('Orange Money')),
            if (_cardEnabled) const ButtonSegment(value: 'card', icon: Icon(Icons.credit_card), label: Text('Visa')),
          ],
          selected: {_method},
          onSelectionChanged: (v) => setState(() => _method = v.first),
        ),
        const SizedBox(height: 14),
        if (_method == 'voucher') ...[
          const Text('Carte de bon Eden Dev : la formule et la durée sont celles de la carte ; activation immédiate.',
              style: TextStyle(color: Colors.black54)),
          const SizedBox(height: 10),
          TextField(
            controller: _voucher,
            textCapitalization: TextCapitalization.characters,
            autocorrect: false,
            decoration: _field('Code de la carte (16 caractères)', Icons.confirmation_number_outlined, hint: '7K2M-QX9P-4TRD-H8WN'),
          ),
          const SizedBox(height: 12),
          _primary('Activer la carte', _redeem),
        ] else ...[
          Text('Montant : ${_money(amount, unit.$2)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
          if (_monthsChoice == 12) const Text('12 mois pour le prix de 10.', style: TextStyle(color: _brandDark)),
          const SizedBox(height: 10),
          if (_method == 'orange_money') ...[
            Text(
              'Payez ce montant au code marchand ${_payment['om_merchant_code'] ?? ''}'
              '${(_payment['om_merchant_name'] ?? '') != '' ? ' (${_payment['om_merchant_name']})' : ''}, '
              'puis saisissez l\'ID de transaction reçu par SMS. Eden Dev vérifie et valide.',
            ),
            const SizedBox(height: 10),
            TextField(controller: _reference, autocorrect: false, decoration: _field('ID de la transaction', Icons.receipt_long_outlined)),
            const SizedBox(height: 10),
            TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: _field('Numéro qui a payé', Icons.phone_outlined)),
            const SizedBox(height: 12),
            _primary('Envoyer le paiement', _orangeMoney, icon: Icons.send),
          ] else ...[
            const Text('La page de paiement sécurisée de Visa s\'ouvre ; le numéro de carte ne passe ni par GestiMarket ni par Eden Dev.'),
            const SizedBox(height: 12),
            _primary('Payer par carte', _payByCard, icon: Icons.lock_outline),
          ],
        ],
      ]),
      _card([
        const Text('Derniers paiements', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
        const SizedBox(height: 6),
        if (_payments.isEmpty) const Text('Aucun paiement pour le moment.', style: TextStyle(color: Colors.black54)),
        for (final p in _payments) _paymentRow(p),
      ]),
      Center(child: TextButton.icon(onPressed: _signOut, icon: const Icon(Icons.logout), label: const Text('Se déconnecter du compte boutique'))),
    ];
  }

  Widget _paymentRow(Map<String, dynamic> p) {
    final status = '${p['status']}';
    final abandoned = p['abandoned'] == true;
    final (label, color) = switch (status) {
      'validated' => ('Validé', const Color(0xFF047857)),
      'refused' => ('Refusé', const Color(0xFFB91C1C)),
      _ when abandoned => ('Abandonné', Colors.black45),
      _ => ('En attente', const Color(0xFFB45309)),
    };
    final method = switch ('${p['method']}') {
      'carte_bon' => 'Carte de bon',
      'orange_money' => 'Orange Money',
      'carte_visa' => 'Carte Visa',
      final m => m,
    };
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${p['plan_label']} · ${p['months']} mois', style: const TextStyle(fontWeight: FontWeight.w600)),
            Text('$method · ${_date(p['created_at'])}', style: const TextStyle(color: Colors.black54, fontSize: 13)),
            if (status == 'refused' && '${p['note'] ?? ''}'.isNotEmpty)
              Text('${p['note']}', style: const TextStyle(color: Color(0xFFB91C1C), fontSize: 13)),
          ]),
        ),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(_money((p['amount'] as num? ?? 0).toInt(), '${p['currency'] ?? 'XOF'}'), style: const TextStyle(fontWeight: FontWeight.w700)),
          Text(label, style: TextStyle(color: color, fontWeight: FontWeight.w600, fontSize: 13)),
        ]),
      ]),
    );
  }
}

/// Page de paiement Cybersource (Visa) : le formulaire signé par « gm-pay » est envoyé tout seul.
class _CardPage extends StatefulWidget {
  const _CardPage({required this.endpoint, required this.fields});

  final String endpoint;
  final Map<String, dynamic> fields;

  @override
  State<_CardPage> createState() => _CardPageState();
}

class _CardPageState extends State<_CardPage> {
  late final WebViewController _controller;

  String _esc(Object? v) => const HtmlEscape(HtmlEscapeMode.attribute).convert('${v ?? ''}');

  @override
  void initState() {
    super.initState();
    final inputs = widget.fields.entries.map((e) => '<input type="hidden" name="${_esc(e.key)}" value="${_esc(e.value)}">').join();
    final html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'
        '<body onload="document.forms[0].submit()" style="font-family:sans-serif;padding:24px">'
        '<p>Ouverture de la page de paiement sécurisée…</p>'
        '<form method="post" action="${_esc(widget.endpoint)}">$inputs</form></body></html>';
    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..loadHtmlString(html);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Paiement par carte'),
        actions: [TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Terminé'))],
      ),
      body: WebViewWidget(controller: _controller),
    );
  }
}
