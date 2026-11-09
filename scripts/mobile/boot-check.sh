#!/usr/bin/env bash
# Démarrage de l'APK sur un ancien Android (émulateur Android 9, comme BlueStacks) : sans Playwright
# (trop récent pour l'ancien moteur web), on lit l'écran par l'accessibilité d'Android (uiautomator).
#   Réussi : l'écran de première installation (« Bienvenue dans GestiMarket ») ou de connexion s'affiche.
#   Échoué : le message « GestiMarket n'arrive pas à démarrer », ou rien après 3 minutes.
# Usage : boot-check.sh <apk> <dossier de sortie>
set -u
APK="$1"
OUT="$2"
PKG=com.gestimarket.app
mkdir -p "$OUT"

WEBVIEW=$(adb shell dumpsys webviewupdate 2>/dev/null | grep -m1 -E "Current WebView package" | tr -d '\r')
echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r') ; $WEBVIEW" | tee "$OUT/android-ancien.txt"

timeout 300 adb install -r "$APK" || { echo "installation impossible" >> "$OUT/android-ancien.txt"; exit 1; }
adb logcat -c || true
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 > /dev/null 2>&1

result=1
for i in $(seq 1 36); do
  sleep 5
  adb shell uiautomator dump /sdcard/ecran.xml > /dev/null 2>&1 || continue
  adb pull /sdcard/ecran.xml "$OUT/ecran-android-ancien.xml" > /dev/null 2>&1 || continue
  if grep -q "arrive pas à démarrer" "$OUT/ecran-android-ancien.xml"; then
    echo "ÉCHEC : message « GestiMarket n'arrive pas à démarrer » après $((i * 5)) s" | tee -a "$OUT/android-ancien.txt"
    grep -o 'text="[^"]*"' "$OUT/ecran-android-ancien.xml" | head -20 >> "$OUT/android-ancien.txt"
    break
  fi
  if grep -qE "Bienvenue dans GestiMarket|Connexion|Identifiant" "$OUT/ecran-android-ancien.xml"; then
    echo "RÉUSSI : GestiMarket démarré en $((i * 5)) s" | tee -a "$OUT/android-ancien.txt"
    result=0
    break
  fi
done
[ $result -eq 0 ] || [ -s "$OUT/ecran-android-ancien.xml" ] || echo "ÉCHEC : écran illisible après 3 minutes" >> "$OUT/android-ancien.txt"
adb exec-out screencap -p > "$OUT/android-ancien.png" 2>/dev/null || true
adb logcat -d > "$OUT/logcat-android-ancien.txt" 2>/dev/null || true
grep -E "chromium|Console|GestiMarket|panicked|FATAL" "$OUT/logcat-android-ancien.txt" | tail -40 >> "$OUT/android-ancien.txt" || true
exit $result
