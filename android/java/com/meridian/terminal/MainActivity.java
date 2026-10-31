package com.meridian.terminal;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.CookieHandler;
import java.net.CookiePolicy;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Meridian for Android. The Meridian web app is served at https://localhost/ from the app's
 * files: the copy bundled in the APK (assets/www), or a newer one the app downloaded from
 * GitHub (files/web), so Meridian updates without reinstalling the app.
 *
 * Meridian's data backend runs in the page (src/app-backend.js). Browsers may not read market
 * data from a web page (CORS), so the backend's requests go through {@link NetBridge}, which
 * makes them natively and answers via window.__meridianNetDone(id, json). Only the data
 * sources Meridian uses are allowed.
 */
public class MainActivity extends Activity {

    private static final String HOST = "localhost";
    private static final String START = "https://" + HOST + "/";
    private static final String REPO = "petarsokolov2000-creator/meridian-terminal";
    private static final String UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36";
    private static final Pattern ALLOWED = Pattern.compile(
            "^(query1\\.finance\\.yahoo\\.com|query2\\.finance\\.yahoo\\.com|fc\\.yahoo\\.com"
                    + "|finnhub\\.io|api\\.stlouisfed\\.org|home\\.treasury\\.gov|data-api\\.ecb\\.europa\\.eu"
                    + "|api\\.frankfurter\\.dev|www\\.sec\\.gov|data\\.sec\\.gov|raw\\.githubusercontent\\.com)$");
    private static final int MAX_BODY = 24 * 1024 * 1024;
    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html");
        MIME.put("js", "text/javascript");
        MIME.put("mjs", "text/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("ico", "image/x-icon");
        MIME.put("txt", "text/plain");
    }

    private WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(6);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        // Yahoo's fundamentals need its session cookie between requests.
        if (CookieHandler.getDefault() == null) {
            CookieHandler.setDefault(new java.net.CookieManager(null, CookiePolicy.ACCEPT_ALL));
        }

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);     // API keys, watchlist, panels, added tickers
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);

        web.addJavascriptInterface(new NetBridge(), "AndroidNet");
        web.setWebViewClient(new AppClient());
        setContentView(web);

        dropStaleDownload();
        if (state != null) web.restoreState(state);
        else web.loadUrl(START);

        // Look for a newer Meridian on GitHub in the background.
        pool.execute(new Runnable() {
            @Override
            public void run() {
                checkForUpdate();
            }
        });
    }

    // ---- serving the web app -------------------------------------------------------------

    private File webDir() {
        return new File(getFilesDir(), "web");
    }

    private String bundledVersion() {
        try {
            return readAll(getAssets().open("www/VERSION")).trim();
        } catch (IOException e) {
            return "";
        }
    }

    private String installedVersion() {
        File v = new File(webDir(), "VERSION");
        if (v.isFile()) {
            try {
                return readAll(new FileInputStream(v)).trim();
            } catch (IOException ignored) {
                // fall back to the bundled copy
            }
        }
        return bundledVersion();
    }

    /** A downloaded copy older than the one in a newer APK must not shadow it. */
    private void dropStaleDownload() {
        File v = new File(webDir(), "VERSION");
        if (!v.isFile()) return;
        try {
            String downloaded = readAll(new FileInputStream(v)).trim();
            if (compareVersions(downloaded, bundledVersion()) <= 0) deleteTree(webDir());
        } catch (IOException e) {
            deleteTree(webDir());
        }
    }

    /** Serves https://localhost/ from the downloaded or bundled files; other links open in the browser. */
    private class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (!HOST.equals(u.getHost())) return null;
            String path = u.getPath();
            if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
            if (path.contains("..")) return notFound();
            String ext = path.substring(path.lastIndexOf('.') + 1).toLowerCase();
            String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
            Map<String, String> headers = new HashMap<String, String>();
            headers.put("Cache-Control", "no-store");
            try {
                File f = new File(webDir(), path.substring(1));
                InputStream in = f.isFile() ? new FileInputStream(f) : getAssets().open("www" + path);
                return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, in);
            } catch (IOException e) {
                return notFound();
            }
        }

        private WebResourceResponse notFound() {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    new HashMap<String, String>(), null);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (HOST.equals(u.getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (ActivityNotFoundException ignored) {
                // no browser installed: stay put
            }
            return true;
        }
    }

    // ---- network bridge for the page ------------------------------------------------------

    /** window.AndroidNet.request(id, optsJson): optsJson = {url, method, headers, body, redirect, timeout}. */
    private class NetBridge {
        @JavascriptInterface
        public void request(final String id, final String optsJson) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    answer(id, fetch(optsJson));
                }
            });
        }
    }

    /** Hands a bridge result back to the page. */
    private void answer(final String id, final String result) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) {
                    web.evaluateJavascript("window.__meridianNetDone && window.__meridianNetDone("
                            + JSONObject.quote(id) + "," + JSONObject.quote(result) + ")", null);
                }
            }
        });
    }

    private static String fetch(String optsJson) {
        HttpURLConnection conn = null;
        try {
            JSONObject opts = new JSONObject(optsJson);
            URL url = new URL(opts.getString("url"));
            if (!"https".equals(url.getProtocol()) || !ALLOWED.matcher(url.getHost()).matches()) {
                return error(url.getHost() + " is not a data source Meridian uses.");
            }
            String method = opts.optString("method", "GET");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod(method);
            conn.setInstanceFollowRedirects(!"manual".equals(opts.optString("redirect", "follow")));
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(opts.optInt("timeout", 30000));
            conn.setRequestProperty("User-Agent", UA);
            conn.setRequestProperty("Accept", "application/json,text/plain,*/*");
            JSONObject headers = opts.optJSONObject("headers");
            if (headers != null) {
                Iterator<String> keys = headers.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    // cookies come from the app's own cookie store
                    if ("cookie".equalsIgnoreCase(k)) continue;
                    conn.setRequestProperty(k, headers.getString(k));
                }
            }
            String body = opts.isNull("body") ? null : opts.optString("body", null);
            if (body != null && !"GET".equals(method)) {
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                conn.setDoOutput(true);
                conn.setFixedLengthStreamingMode(bytes.length);
                OutputStream out = conn.getOutputStream();
                try {
                    out.write(bytes);
                } finally {
                    out.close();
                }
            }
            int status = conn.getResponseCode();
            InputStream in = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String text = in == null ? "" : readAll(in);
            JSONObject h = new JSONObject();
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                String k = e.getKey().toLowerCase();
                if ("set-cookie".equals(k)) continue; // handled by the cookie store
                h.put(k, e.getValue().get(0));
            }
            return new JSONObject().put("status", status).put("text", text).put("headers", h).toString();
        } catch (UnknownHostException e) {
            return error("No internet connection.");
        } catch (SocketTimeoutException e) {
            return error("The request timed out. Check your connection and try again.");
        } catch (Exception e) {
            return error("Request failed: " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    // ---- self-update from GitHub ----------------------------------------------------------

    /**
     * Compares the installed Meridian with the newest VERSION on GitHub and, if newer, downloads
     * the repository ZIP and unpacks its web files into files/web. The page reloads into it.
     * Any failure leaves the current version running.
     */
    private void checkForUpdate() {
        File tmp = new File(getFilesDir(), "web.new");
        try {
            String latest = httpText("https://raw.githubusercontent.com/" + REPO + "/main/VERSION?t="
                    + System.currentTimeMillis()).trim();
            if (latest.isEmpty() || latest.length() > 40) return;
            if (compareVersions(latest, installedVersion()) <= 0) return;

            deleteTree(tmp);
            if (!tmp.mkdirs()) return;
            HttpURLConnection conn = open("https://codeload.github.com/" + REPO + "/zip/refs/heads/main");
            ZipInputStream zip = new ZipInputStream(conn.getInputStream());
            int files = 0;
            try {
                ZipEntry e;
                while ((e = zip.getNextEntry()) != null) {
                    String name = e.getName();
                    int slash = name.indexOf('/');
                    if (slash < 0 || e.isDirectory()) continue;
                    String rel = name.substring(slash + 1); // drop "meridian-terminal-main/"
                    if (rel.contains("..") || !isWebFile(rel)) continue;
                    File out = new File(tmp, rel);
                    File parent = out.getParentFile();
                    if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("can't create " + parent);
                    FileOutputStream fo = new FileOutputStream(out);
                    try {
                        byte[] buf = new byte[16384];
                        int n;
                        while ((n = zip.read(buf)) != -1) fo.write(buf, 0, n);
                    } finally {
                        fo.close();
                    }
                    files++;
                }
            } finally {
                zip.close();
                conn.disconnect();
            }
            if (files < 10 || !new File(tmp, "index.html").isFile() || !new File(tmp, "VERSION").isFile()) {
                deleteTree(tmp);
                return;
            }
            deleteTree(webDir());
            if (!tmp.renameTo(webDir())) {
                deleteTree(tmp);
                return;
            }
            final String v = latest;
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, "Meridian updated to " + v, Toast.LENGTH_LONG).show();
                    if (web != null) web.reload();
                }
            });
        } catch (Exception e) {
            deleteTree(tmp); // offline or GitHub unreachable: keep the current version
        }
    }

    private static boolean isWebFile(String rel) {
        return rel.equals("index.html") || rel.equals("styles.css") || rel.equals("VERSION")
                || rel.startsWith("src/") || rel.startsWith("server/");
    }

    /** Versions look like 2026.10.31.7: compared number by number. */
    static int compareVersions(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            long p = i < x.length ? parseLong(x[i]) : 0;
            long q = i < y.length ? parseLong(y[i]) : 0;
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }

    private static long parseLong(String s) {
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static HttpURLConnection open(String address) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(address).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(60000);
        conn.setRequestProperty("User-Agent", "Meridian-Android");
        int status = conn.getResponseCode();
        if (status != 200) {
            conn.disconnect();
            throw new IOException("HTTP " + status);
        }
        return conn;
    }

    private static String httpText(String address) throws IOException {
        HttpURLConnection conn = open(address);
        try {
            return readAll(conn.getInputStream());
        } finally {
            conn.disconnect();
        }
    }

    // ---- helpers ------------------------------------------------------------------------

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    private static String readAll(InputStream in) throws IOException {
        try {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[16384];
            int n;
            while ((n = in.read(chunk)) != -1) {
                buf.write(chunk, 0, n);
                if (buf.size() > MAX_BODY) throw new IOException("response too large");
            }
            return new String(buf.toByteArray(), StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    private static String error(String message) {
        try {
            return new JSONObject().put("error", message).toString();
        } catch (Exception e) {
            return "{\"error\":\"Request failed\"}";
        }
    }

    @Override
    protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
