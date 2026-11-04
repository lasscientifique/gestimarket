// Widget personnalisé FlutterFlow : MenuFlottant.
//
// Bulle de navigation que l'on déplace où l'on veut sur l'écran, affichée au-dessus de la page,
// WebView de la boutique comprise : c'est elle qui permet de quitter GestiMarket pour une autre page.
// Un toucher ouvre le menu : Mes boutiques, Ma boutique, Abonnement, Contact Eden Dev, Se déconnecter.
//
// Le widget posé dans une page ne prend aucune place : il installe une seule bulle pour toute
// l'application (au-dessus des pages), visible seulement sur les pages listées dans _routesAvecMenu.
// Chaque choix remplace la page affichée par celle de sa route (une seule WebView ouverte à la fois).
// « Se déconnecter » vide la boutique retenue (storeCode) et ferme la session Supabase.
// La position de la bulle est gardée d'une page à l'autre.
// Routes des pages FlutterFlow : Boutiques /mes-boutiques, boutique /boutique, Abonnement /abonnements,
// ContactEdenDev /contact ; accueil / (Demarrage sans session).

const _menuBrand = Color(0xFF0F766E);

/// Routes des pages où la bulle est visible, et route ouverte par chaque choix du menu.
const _routesAvecMenu = ['/mes-boutiques', '/boutique', '/abonnements', '/contact'];
const _routeBoutiques = '/mes-boutiques';
const _routeBoutique = '/boutique';
const _routeAbonnement = '/abonnements';
const _routeContact = '/contact';
const _routeAccueil = '/';

class MenuFlottant extends StatefulWidget {
  const MenuFlottant({super.key, this.width, this.height});

  final double? width;
  final double? height;

  @override
  State<MenuFlottant> createState() => _MenuFlottantState();
}

class _MenuFlottantState extends State<MenuFlottant> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _BulleMenu.attacher(this);
    });
  }

  @override
  void dispose() {
    _BulleMenu.detacher(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => const SizedBox.shrink();
}

/// Bulle unique de l'application (OverlayEntry du navigateur racine).
class _BulleMenu {
  static OverlayEntry? _entree;
  static GoRouter? _routeur;
  static final ValueNotifier<String> route = ValueNotifier('');
  static final ValueNotifier<bool> ouvert = ValueNotifier(false);
  static Offset? position;

  static void attacher(_MenuFlottantState h) {
    if (_routeur == null) {
      try {
        _routeur = GoRouter.of(h.context);
        _routeur!.routerDelegate.addListener(_routeChangee);
      } catch (_) {
        _routeur = null;
      }
    }
    _routeChangee();
    if (_entree == null) {
      final overlay = Navigator.of(h.context, rootNavigator: true).overlay;
      if (overlay == null) return;
      _entree = OverlayEntry(builder: (_) => const _Bulle());
      overlay.insert(_entree!);
    }
  }

  /// La bulle reste installée (elle se cache hors des pages listées).
  static void detacher(_MenuFlottantState h) {}

  static void _routeChangee() {
    String chemin = '';
    try {
      chemin = _routeur?.routerDelegate.currentConfiguration.uri.path ?? '';
    } catch (_) {
      chemin = '';
    }
    // Appelé pendant une navigation : la mise à jour attend la fin de l'image en cours.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      route.value = chemin;
      ouvert.value = false;
    });
  }

  /// Choix du menu : la page de la route remplace la page affichée.
  static Future<void> choisir(String cible) async {
    ouvert.value = false;
    try {
      if (cible == _routeAccueil) {
        // Se déconnecter : boutique oubliée sur ce téléphone, session Supabase fermée, accueil.
        FFAppState().storeCode = '';
        await SupaFlow.client.auth.signOut();
      }
      _routeur?.go(cible);
    } catch (_) {}
  }
}

class _Bulle extends StatefulWidget {
  const _Bulle();

  @override
  State<_Bulle> createState() => _BulleState();
}

class _BulleState extends State<_Bulle> {
  static const double _taille = 58;

  Offset _borner(Offset p, Size ecran, EdgeInsets marges) {
    const minX = 6.0;
    final maxX = ecran.width - _taille - 6;
    final minY = marges.top + 6;
    final maxY = ecran.height - _taille - marges.bottom - 6;
    return Offset(p.dx.clamp(minX, maxX < minX ? minX : maxX), p.dy.clamp(minY, maxY < minY ? minY : maxY));
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<String>(
      valueListenable: _BulleMenu.route,
      builder: (context, chemin, _) {
        if (!_routesAvecMenu.contains(chemin)) return const SizedBox.shrink();
        final media = MediaQuery.of(context);
        final ecran = media.size;
        final pos = _borner(
          _BulleMenu.position ?? Offset(ecran.width - _taille - 16, ecran.height - _taille - media.padding.bottom - 110),
          ecran,
          media.padding,
        );
        return ValueListenableBuilder<bool>(
          valueListenable: _BulleMenu.ouvert,
          builder: (context, ouvert, _) => Stack(
            children: [
              if (ouvert)
                Positioned.fill(
                  child: GestureDetector(
                    behavior: HitTestBehavior.opaque,
                    onTap: () => _BulleMenu.ouvert.value = false,
                    child: const ColoredBox(color: Color(0x66000000)),
                  ),
                ),
              if (ouvert) Center(child: _Panneau(route: chemin)),
              Positioned(
                left: pos.dx,
                top: pos.dy,
                child: GestureDetector(
                  onPanUpdate: (d) => setState(() => _BulleMenu.position = _borner(pos + d.delta, ecran, media.padding)),
                  onTap: () => _BulleMenu.ouvert.value = !ouvert,
                  child: Material(
                    color: _menuBrand,
                    elevation: 8,
                    shape: const CircleBorder(),
                    child: SizedBox(
                      width: _taille,
                      height: _taille,
                      child: Icon(ouvert ? Icons.close_rounded : Icons.apps_rounded, color: Colors.white, size: 30),
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _Panneau extends StatelessWidget {
  const _Panneau({required this.route});

  final String route;

  @override
  Widget build(BuildContext context) {
    Widget choix(IconData icone, String texte, String cible, {bool danger = false}) {
      final actuel = cible == route;
      final couleur = danger ? const Color(0xFFDC2626) : _menuBrand;
      return InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: actuel ? () => _BulleMenu.ouvert.value = false : () => _BulleMenu.choisir(cible),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 13),
          decoration: BoxDecoration(
            color: actuel ? _menuBrand.withAlpha(26) : null,
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(color: couleur.withAlpha(30), shape: BoxShape.circle),
                child: Icon(icone, color: couleur, size: 21),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Text(
                  texte,
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: actuel ? FontWeight.w700 : FontWeight.w600,
                    color: danger ? couleur : const Color(0xFF0F172A),
                  ),
                ),
              ),
              if (actuel) const Icon(Icons.check_rounded, color: _menuBrand, size: 20),
            ],
          ),
        ),
      );
    }

    return Material(
      color: Colors.white,
      elevation: 12,
      borderRadius: BorderRadius.circular(20),
      child: Container(
        width: 300,
        padding: const EdgeInsets.fromLTRB(10, 16, 10, 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Padding(
              padding: EdgeInsets.only(left: 12, bottom: 8),
              child: Text('GestiMarket', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFF64748B), letterSpacing: 0.4)),
            ),
            choix(Icons.storefront_rounded, 'Mes boutiques', _routeBoutiques),
            choix(Icons.point_of_sale_rounded, 'Ma boutique', _routeBoutique),
            choix(Icons.workspace_premium_rounded, 'Abonnement', _routeAbonnement),
            choix(Icons.support_agent_rounded, 'Contact Eden Dev', _routeContact),
            const Divider(height: 18),
            choix(Icons.logout_rounded, 'Se déconnecter', _routeAccueil, danger: true),
          ],
        ),
      ),
    );
  }
}
