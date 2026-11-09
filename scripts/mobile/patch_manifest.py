"""Manifeste Android de GestiMarket (projet généré par Tauri, réglé à chaque compilation).

- Téléphone serveur : service permanent « serveur de la boutique » (notification), réveil du processeur
  et du Wi-Fi, demande d'exemption d'économie de batterie.
- TV Android : l'application apparaît sur l'écran d'accueil de la TV (bannière, télécommande, sans écran
  tactile ni caméra obligatoires).

Usage : python3 scripts/mobile/patch_manifest.py src-tauri/gen/android/app/src/main/AndroidManifest.xml
"""
import re
import sys

path = sys.argv[1]
s = open(path, encoding="utf-8").read()

PERMISSIONS = [
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.WAKE_LOCK",
    "android.permission.ACCESS_WIFI_STATE",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
]
FEATURES = [
    "android.hardware.touchscreen",
    "android.software.leanback",
]

head = ""
for p in PERMISSIONS:
    if f'android:name="{p}"' not in s:
        head += f'    <uses-permission android:name="{p}" />\n'
for f in FEATURES:
    if f'android:name="{f}"' not in s:
        head += f'    <uses-feature android:name="{f}" android:required="false" />\n'
# Juste avant <application …>.
s = re.sub(r"(\n\s*<application\b)", "\n" + head.rstrip("\n") + r"\1", s, count=1)

# Bannière de la TV.
if "android:banner=" not in s:
    s = re.sub(r"<application\b", '<application android:banner="@drawable/tv_banner"', s, count=1)

# Lanceur de la TV : même activité que sur téléphone.
if "LEANBACK_LAUNCHER" not in s:
    s = s.replace(
        '<category android:name="android.intent.category.LAUNCHER" />',
        '<category android:name="android.intent.category.LAUNCHER" />\n'
        '                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />',
        1,
    )
    if "LEANBACK_LAUNCHER" not in s:
        s = s.replace(
            '<category android:name="android.intent.category.LAUNCHER"/>',
            '<category android:name="android.intent.category.LAUNCHER"/>\n'
            '                <category android:name="android.intent.category.LEANBACK_LAUNCHER"/>',
            1,
        )

# Service du téléphone serveur.
if "GestiServerService" not in s:
    service = (
        '        <service android:name=".GestiServerService" android:exported="false"\n'
        '            android:foregroundServiceType="specialUse">\n'
        '            <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"\n'
        '                android:value="Serveur local de la boutique : caisses et écran client reliés par le Wi-Fi" />\n'
        "        </service>\n"
    )
    s = s.replace("</application>", service + "    </application>", 1)

for needle in ["LEANBACK_LAUNCHER", "GestiServerService", "FOREGROUND_SERVICE_SPECIAL_USE", "android:banner"]:
    if needle not in s:
        print(f"::error title=Manifeste Android::{needle} absent de {path}")
        sys.exit(1)
open(path, "w", encoding="utf-8").write(s)
print("Manifeste Android : service du serveur, TV et permissions ajoutés.")
