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
# Le pont window.GestiMarketAndroid et le service GestiServerService (téléphone serveur) sont ajoutés ici.
# GestiMarket garde sa page entre les barres du système et au-dessus du clavier (marges = taille des barres),
# sur fond sombre comme sa barre du haut, avec des icônes claires.
# Le bouton retour est géré par Tauri (2.9 et plus) : page précédente, sinon fermeture de l'application.
MA=$(find src-tauri/gen/android/app/src/main -name MainActivity.kt | head -1)
PKG=$(head -1 "$MA" | sed 's/^package //')
cat > "$MA" <<KOTLIN
package $PKG

import android.app.UiModeManager
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
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

  // Pont entre la page de GestiMarket et Android (window.GestiMarketAndroid) : serveur de la boutique,
  // TV, batterie, partage de connexion. Ajouté avant le chargement de la page.
  override fun onWebViewCreate(webView: WebView) {
    webView.addJavascriptInterface(GestiBridge(this), "GestiMarketAndroid")
  }
}

class GestiBridge(private val activity: MainActivity) {
  /** Téléphone serveur : service permanent (notification), le serveur continue écran verrouillé. */
  @JavascriptInterface
  fun startServer() {
    val intent = Intent(activity, GestiServerService::class.java)
    if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent) else activity.startService(intent)
  }

  @JavascriptInterface
  fun stopServer() {
    activity.stopService(Intent(activity, GestiServerService::class.java))
  }

  /** TV Android (télécommande, pas d'écran tactile) : GestiMarket s'ouvre en écran client. */
  @JavascriptInterface
  fun isTv(): Boolean {
    val ui = activity.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager
    return ui.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION ||
      activity.packageManager.hasSystemFeature("android.software.leanback")
  }

  /** Écran toujours allumé (écran client sur une TV). */
  @JavascriptInterface
  fun keepScreenOn(on: Boolean) {
    activity.runOnUiThread {
      if (on) activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  /** L'économie de batterie d'Android peut-elle encore arrêter GestiMarket en arrière-plan ? */
  @JavascriptInterface
  fun batteryRestricted(): Boolean {
    if (Build.VERSION.SDK_INT < 23) return false
    val pm = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
    return !pm.isIgnoringBatteryOptimizations(activity.packageName)
  }

  @JavascriptInterface
  fun askBatteryExemption() {
    activity.runOnUiThread {
      try {
        activity.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + activity.packageName)))
      } catch (e: Exception) {
        try { activity.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) } catch (ignored: Exception) { }
      }
    }
  }

  /** Android 13 et plus : autorisation d'afficher la notification du serveur. */
  @JavascriptInterface
  fun askNotifications() {
    if (Build.VERSION.SDK_INT >= 33) {
      activity.runOnUiThread { activity.requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 42) }
    }
  }

  /** Réglages du partage de connexion (point d'accès mobile). */
  @JavascriptInterface
  fun openHotspotSettings() {
    activity.runOnUiThread {
      val tether = Intent().setClassName("com.android.settings", "com.android.settings.TetherSettings")
      try { activity.startActivity(tether) } catch (e: Exception) {
        try { activity.startActivity(Intent(Settings.ACTION_WIRELESS_SETTINGS)) } catch (ignored: Exception) { }
      }
    }
  }
}
KOTLIN

# Service du téléphone serveur : notification permanente, processeur et Wi-Fi gardés éveillés.
cat > "$(dirname "$MA")/GestiServerService.kt" <<KOTLIN
package $PKG

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

class GestiServerService : Service() {
  private var wake: PowerManager.WakeLock? = null
  private var wifi: WifiManager.WifiLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channel = "gestimarket-serveur"
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      nm.createNotificationChannel(NotificationChannel(channel, "Serveur de la boutique", NotificationManager.IMPORTANCE_LOW))
    }
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, channel) else @Suppress("DEPRECATION") Notification.Builder(this)
    val notification = builder
      .setContentTitle("GestiMarket : serveur de la boutique actif")
      .setContentText("Les caisses et l'écran client restent reliés à ce téléphone.")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= 34) startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    else startForeground(1, notification)
    if (wake == null) {
      wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gestimarket:serveur").apply { setReferenceCounted(false); acquire() }
    }
    if (wifi == null) {
      @Suppress("DEPRECATION")
      wifi = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
        .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "gestimarket:serveur").apply { setReferenceCounted(false); acquire() }
    }
    // Processus arrêté par Android : pas de redémarrage sans l'application (le serveur vit avec elle).
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    wake?.release()
    wifi?.release()
    super.onDestroy()
  }
}
KOTLIN

# Bannière de l'écran d'accueil des TV Android, et manifeste (service du serveur, TV, permissions).
RES=src-tauri/gen/android/app/src/main/res
mkdir -p "$RES/drawable"
cp src-tauri/icons/tv-banner.png "$RES/drawable/tv_banner.png"
python3 scripts/mobile/patch_manifest.py src-tauri/gen/android/app/src/main/AndroidManifest.xml
echo "MainActivity : $MA ($PKG)"

# Icônes Android (et iOS) à partir de l'icône de l'application.
npx tauri icon src-tauri/icons/icon.png
# L'icône du PC a été réécrite par « tauri icon » : on remet celle du dépôt (le PC n'est pas compilé ici).
git checkout -- src-tauri/icons

echo "Projet Android prêt :"
grep -n -E 'applicationId|minSdk|targetSdk|usesCleartextTraffic' "$G" || true
