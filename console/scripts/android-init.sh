#!/usr/bin/env bash
# Projet Android de la Console Eden Dev (console/src-tauri/gen/android), généré sur GitHub Actions.
# À lancer depuis le dossier console/. Le dossier gen/ n'est pas dans le dépôt.
set -euo pipefail

npx tauri android init --ci --skip-targets-install

# Écran : le modèle de Tauri dessine la page sous la barre d'état et la barre de navigation. La console garde
# sa page entre les barres du système et au-dessus du clavier, sur fond sombre comme son menu.
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

# Icônes Android à partir de l'icône de la console ; celles du PC (dans le dépôt) sont remises ensuite.
npx tauri icon src-tauri/icons/icon.png
git checkout -- src-tauri/icons
git clean -fdq -- src-tauri/icons

echo "Projet Android prêt :"
grep -n -E 'applicationId|minSdk|targetSdk' src-tauri/gen/android/app/build.gradle.kts || true
