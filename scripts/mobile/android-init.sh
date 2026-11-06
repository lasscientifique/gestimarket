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

# Icônes Android (et iOS) à partir de l'icône de l'application.
npx tauri icon src-tauri/icons/icon.png
# L'icône du PC a été réécrite par « tauri icon » : on remet celle du dépôt (le PC n'est pas compilé ici).
git checkout -- src-tauri/icons

echo "Projet Android prêt :"
grep -n -E 'applicationId|minSdk|targetSdk|usesCleartextTraffic' "$G" || true
