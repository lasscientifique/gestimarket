// Widget personnalisé FlutterFlow : GestiMarketSplash (page de démarrage « SplashPage »).
//
// Logo GestiMarket dessiné (pas d'image à charger), nom et « par Eden Dev ». Après un court instant :
// boutique déjà choisie sur ce téléphone → page « MagasinPage », sinon → page « ConnexionPage ».
// Aucune dépendance en plus de FlutterFlow (shared_preferences, go_router).

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

class GestiMarketSplash extends StatefulWidget {
  const GestiMarketSplash({super.key, this.width, this.height});

  final double? width;
  final double? height;

  @override
  State<GestiMarketSplash> createState() => _GestiMarketSplashState();
}

class _GestiMarketSplashState extends State<GestiMarketSplash> {
  @override
  void initState() {
    super.initState();
    _next();
  }

  Future<void> _next() async {
    final prefs = await SharedPreferences.getInstance();
    await Future<void>.delayed(const Duration(milliseconds: 1400));
    if (!mounted) return;
    final shop = prefs.getString('gm_shop_code') ?? '';
    context.goNamed(shop.isEmpty ? 'ConnexionPage' : 'MagasinPage');
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: widget.width ?? double.infinity,
      height: widget.height ?? double.infinity,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF0D9488), Color(0xFF0F5F58)],
        ),
      ),
      child: SafeArea(
        child: Column(children: [
          const Spacer(flex: 3),
          const GestiMarketLogo(size: 128),
          const SizedBox(height: 28),
          const Text(
            'GestiMarket',
            style: TextStyle(color: Colors.white, fontSize: 34, fontWeight: FontWeight.w800, letterSpacing: 0.3),
          ),
          const SizedBox(height: 8),
          Text(
            'Caisse, stock et boutique',
            style: TextStyle(color: Colors.white.withAlpha(210), fontSize: 15),
          ),
          const Spacer(flex: 2),
          const SizedBox(
            width: 26,
            height: 26,
            child: CircularProgressIndicator(strokeWidth: 2.6, color: Color(0xFF5EEAD4)),
          ),
          const Spacer(),
          Text('par Eden Dev', style: TextStyle(color: Colors.white.withAlpha(190), fontSize: 13, letterSpacing: 0.4)),
          const SizedBox(height: 24),
        ]),
      ),
    );
  }
}

/// Logo GestiMarket : carré arrondi vert, chariot blanc, trois barres menthe.
class GestiMarketLogo extends StatelessWidget {
  const GestiMarketLogo({super.key, this.size = 96});

  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(width: size, height: size, child: CustomPaint(painter: _LogoPainter()));
}

class _LogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 100;
    final square = RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(24 * s));
    canvas.drawShadow(Path()..addRRect(square), Colors.black, 6 * s, false);
    canvas.drawRRect(
      square,
      Paint()
        ..shader = const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF14806F), Color(0xFF0B4F49)],
        ).createShader(Offset.zero & size),
    );
    final white = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6.5 * s
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;
    // Poignée puis panier du chariot.
    final cart = Path()
      ..moveTo(16 * s, 30 * s)
      ..lineTo(26 * s, 30 * s)
      ..lineTo(34 * s, 62 * s)
      ..lineTo(74 * s, 62 * s)
      ..lineTo(82 * s, 38 * s)
      ..lineTo(30 * s, 38 * s);
    canvas.drawPath(cart, white);
    final fill = Paint()..color = Colors.white;
    canvas.drawCircle(Offset(40 * s, 75 * s), 5.5 * s, fill);
    canvas.drawCircle(Offset(68 * s, 75 * s), 5.5 * s, fill);
    // Trois barres (le tableau de bord) dans le panier.
    final mint = Paint()..color = const Color(0xFF5EEAD4);
    for (final bar in [
      [43.0, 49.0],
      [52.0, 44.0],
      [61.0, 50.0],
    ]) {
      canvas.drawRRect(
        RRect.fromLTRBR(bar[0] * s, bar[1] * s, (bar[0] + 5) * s, 58 * s, Radius.circular(1.5 * s)),
        mint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
