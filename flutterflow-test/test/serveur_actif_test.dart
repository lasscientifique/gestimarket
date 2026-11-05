// Fonction personnalisée isServerActive : même règle que la table gm_servers_statut (90 s sans signe de vie).
import 'package:flutter_test/flutter_test.dart';
import 'package:gestimarket_flutterflow_test/is_server_active.dart';

void main() {
  final maintenant = DateTime.now().toUtc();

  test('code de boutique absent ou vide : éteint', () {
    expect(isServerActive(null, true, maintenant), isFalse);
    expect(isServerActive('  ', true, maintenant), isFalse);
  });

  test('active à false ou sans date : éteint', () {
    expect(isServerActive('GM-000001', false, maintenant), isFalse);
    expect(isServerActive('GM-000001', null, maintenant), isFalse);
    expect(isServerActive('GM-000001', true, null), isFalse);
  });

  test('signe de vie récent : allumé ; plus de 90 s : éteint', () {
    expect(isServerActive('GM-000001', true, maintenant.subtract(const Duration(seconds: 30))), isTrue);
    expect(isServerActive('GM-000001', true, maintenant.subtract(const Duration(seconds: 89))), isTrue);
    expect(isServerActive('GM-000001', true, maintenant.subtract(const Duration(seconds: 91))), isFalse);
    expect(isServerActive('GM-000001', true, maintenant.subtract(const Duration(minutes: 10))), isFalse);
  });

  test('heure locale du téléphone ou horloge en retard : bien comptée', () {
    expect(isServerActive('GM-000001', true, DateTime.now().subtract(const Duration(seconds: 20))), isTrue);
    expect(isServerActive('GM-000001', true, maintenant.add(const Duration(seconds: 40))), isTrue);
  });
}
