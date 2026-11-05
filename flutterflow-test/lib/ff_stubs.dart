// Doublures de ce que FlutterFlow fournit à son code personnalisé : SupaFlow (client Supabase)
// et FFAppState (état de l'application). Seules les parties utilisées par MenuFlottant existent.
import 'package:flutter/foundation.dart';

class FakeUser {
  const FakeUser(this.id);
  final String id;
}

/// Session Supabase : prévient le routeur à chaque connexion ou déconnexion (comme AppStateNotifier).
class FakeAuth extends ChangeNotifier {
  FakeUser? currentUser;
  int signOuts = 0;

  /// [notify] à false reproduit prepareAuthEvent() de FlutterFlow avant une connexion suivie d'une navigation.
  void signIn(String id, {bool notify = true}) {
    currentUser = FakeUser(id);
    if (notify) notifyListeners();
  }

  Future<void> signOut() async {
    currentUser = null;
    signOuts++;
    notifyListeners();
  }
}

class FakeClient {
  final FakeAuth auth = FakeAuth();
}

class SupaFlow {
  static final FakeClient client = FakeClient();
}

class FFAppState extends ChangeNotifier {
  factory FFAppState() => _instance;
  FFAppState._();
  static final FFAppState _instance = FFAppState._();

  String _storeCode = '';
  String get storeCode => _storeCode;
  set storeCode(String value) {
    _storeCode = value;
    notifyListeners();
  }
}
