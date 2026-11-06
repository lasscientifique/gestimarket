#!/usr/bin/env bash
# Projet Android de Tauri (src-tauri/gen/android), généré sur GitHub Actions puis réglé pour GestiMarket.
# Le dossier gen/ n'est pas dans le dépôt : il est refait à chaque compilation avec la version de Tauri du dépôt.
set -euo pipefail

npx tauri android init --ci --skip-targets-install

G=src-tauri/gen/android/app/build.gradle.kts
# Poste client : le poste serveur de la boutique répond en http sur le Wi-Fi (adresse IP du PC).
# Android bloque ce trafic non chiffré dans une version finale si on ne l'autorise pas.
sed -i 's/manifestPlaceholders\["usesCleartextTraffic"\] = "false"/manifestPlaceholders["usesCleartextTraffic"] = "true"/' "$G"
if grep -q 'manifestPlaceholders\["usesCleartextTraffic"\] = "false"' "$G"; then
  echo "::error title=Projet Android::le http du réseau local est toujours bloqué ($G)"
  exit 1
fi

# Écran : le modèle de Tauri dessine la page sous la barre d'état (heure, batterie) et la barre de navigation.
# GestiMarket garde sa page entre les barres du système et au-dessus du clavier (marges = taille des barres),
# sur fond sombre comme sa barre du haut, avec des icônes claires.
# Le bouton retour est géré par Tauri (2.9 et plus) : page précédente, sinon fermeture de l'application.
MA=$(find src-tauri/gen/android/app/src/main -name MainActivity.kt | head -1)
PKG=$(head -1 "$MA" | sed 's/^package //')
cat > "$MA" <<KOTLIN
package $PKG

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    window.decorView.setBackgroundColor(Color.parseColor("#0B1A24"))
    WindowCompat.getInsetsController(window, window.decorView).apply {
      isAppearanceLightStatusBars = false
      isAppearanceLightNavigationBars = false
    }
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }
}
KOTLIN
echo "MainActivity : $MA ($PKG)"

# Icônes Android (et iOS) à partir de l'icône de l'application.
npx tauri icon src-tauri/icons/icon.png
# L'icône du PC a été réécrite par « tauri icon » : on remet celle du dépôt (le PC n'est pas compilé ici).
git checkout -- src-tauri/icons

echo "Projet Android prêt :"
grep -n -E 'applicationId|minSdk|targetSdk|usesCleartextTraffic' "$G" || true
