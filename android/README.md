# Meridian for Android

Install: open https://github.com/petarsokolov2000-creator/meridian-terminal/releases/tag/android
on your Android phone and tap **Meridian.apk**. Android asks to allow installing apps from your
browser the first time; allow it, then tap **Install**. No PC is needed afterwards.

The app runs Meridian's data backend on the phone itself (`src/app-backend.js` +
`server/backend.mjs`) and fetches market data natively through `MainActivity`'s bridge. It
downloads newer versions of Meridian's web files from this repository by itself, so you only
reinstall when the Android code here changes. API keys (`FINNHUB <key>`, `FRED <key>`) are
stored in the app on the phone.

Built by GitHub Actions (`.github/workflows/android.yml`, `android/build.sh`) whenever
`android/` changes; run the workflow by hand from the Actions tab to rebuild.

## Optional: a permanent signing key

Without one, each build gets its own key, so installing an app built later (only needed when
`android/` changes) means uninstalling the old one first, which clears the app's saved
settings. To avoid that, create a key once and add it as repository secrets
(Settings → Secrets and variables → Actions → New repository secret):

```
keytool -genkeypair -keystore meridian.keystore -storetype PKCS12 -alias meridian -keyalg RSA \
  -keysize 2048 -validity 20000 -storepass YOURPASSWORD -keypass YOURPASSWORD -dname "CN=Meridian"
base64 -w0 meridian.keystore        # Windows PowerShell: [Convert]::ToBase64String([IO.File]::ReadAllBytes("meridian.keystore"))
```

- `MERIDIAN_KEYSTORE_B64`: the base64 text
- `MERIDIAN_KEYSTORE_PASSWORD`: YOURPASSWORD

Keep `meridian.keystore` somewhere safe and never commit it.
