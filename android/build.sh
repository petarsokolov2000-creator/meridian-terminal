#!/usr/bin/env bash
# Builds Meridian.apk with no Gradle: icons -> aapt2 -> javac -> d8 -> zip assets -> zipalign ->
# apksigner. Used by the GitHub Actions workflow (.github/workflows/android.yml); also runs on
# any Linux or macOS machine with Node, a JDK and an Android SDK (build-tools + a platform).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$(dirname "$ROOT")"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$SDK" ] || { echo "Set ANDROID_HOME to your Android SDK"; exit 1; }
BT="$(ls -d "$SDK"/build-tools/* | sort -V | tail -1)"
JAR="$(ls "$SDK"/platforms/android-*/android.jar | sort -V | tail -1)"
VERSION="$(tr -d '[:space:]' < "$APP/VERSION")"
CODE="${VERSION_CODE:-1}"
echo "build-tools: $BT"
echo "platform:    $JAR"
echo "version:     $VERSION ($CODE)"

OUT="$ROOT/build"
rm -rf "$OUT"
mkdir -p "$OUT/res" "$OUT/flat" "$OUT/classes" "$OUT/dex" "$OUT/pkg/assets/www"

echo "[1/7] icons + resources"
cp -r "$ROOT/res/." "$OUT/res/"
node "$ROOT/make-icons.mjs" "$OUT/res"
"$BT/aapt2" compile --dir "$OUT/res" -o "$OUT/flat/res.zip"

echo "[2/7] manifest"
"$BT/aapt2" link -o "$OUT/base.apk" -I "$JAR" --manifest "$ROOT/AndroidManifest.xml" \
  -R "$OUT/flat/res.zip" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$CODE" --version-name "$VERSION" --auto-add-overlay

echo "[3/7] javac"
javac -source 8 -target 8 -nowarn -bootclasspath "$JAR" -classpath "$JAR" -d "$OUT/classes" \
  $(find "$ROOT/java" -name '*.java')

echo "[4/7] d8"
"$BT/d8" --lib "$JAR" --min-api 24 --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')

echo "[5/7] web app -> assets/www"
cp "$APP/index.html" "$APP/styles.css" "$APP/VERSION" "$OUT/pkg/assets/www/"
cp -r "$APP/src" "$APP/server" "$OUT/pkg/assets/www/"
rm -f "$OUT/pkg/assets/www/server/mock.mjs"   # test fixtures stay out of the app
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q "$OUT/unsigned.apk" classes.dex)
(cd "$OUT/pkg" && zip -qr "$OUT/unsigned.apk" assets)

echo "[6/7] zipalign"
"$BT/zipalign" -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "[7/7] sign"
# Signing key: MERIDIAN_KEYSTORE_B64 (a base64 PKCS12 keystore, alias "meridian", from the
# repository secret of the same name) keeps every build installable as an update of the last.
# Without it, a key is made for this build only: the app installs fine, but an app built later
# with a different key needs the old one uninstalled first. Keys are never stored in the repo.
KS="$OUT/meridian.keystore"
KS_PASS="${MERIDIAN_KEYSTORE_PASSWORD:-meridian-android}"
if [ -n "${MERIDIAN_KEYSTORE_B64:-}" ]; then
  echo "$MERIDIAN_KEYSTORE_B64" | base64 -d > "$KS"
else
  echo "::warning::No MERIDIAN_KEYSTORE_B64 secret: signing with a one-off key (see android/README.md)"
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -alias meridian -keyalg RSA -keysize 2048 \
    -validity 20000 -storepass "$KS_PASS" -keypass "$KS_PASS" -dname "CN=Meridian Terminal, O=Meridian, C=US" >/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-key-alias meridian \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$ROOT/Meridian.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$ROOT/Meridian.apk"
ls -l "$ROOT/Meridian.apk"
