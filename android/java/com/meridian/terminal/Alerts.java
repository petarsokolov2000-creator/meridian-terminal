package com.meridian.terminal;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.PowerManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Price alerts while Meridian is closed. The page hands over the alerts still waiting
 * ({@link #sync}); a background job ({@link AlertJob}, about every 15 minutes, only while at
 * least one alert is waiting) reads each ticker's price from Yahoo Finance, shows a
 * notification for every alert that is reached and keeps it in a list the page collects the
 * next time it opens ({@link #takeFired}). Everything stays on the phone.
 */
final class Alerts {

    static final String PREFS = "meridian";
    static final String NOTIFY_PERMISSION = "android.permission.POST_NOTIFICATIONS";
    private static final String CHANNEL = "price-alerts";
    private static final int JOB_ID = 7301;
    private static final long PERIOD_MS = 15 * 60 * 1000L;
    private static final int MAX_ALERTS = 100;
    private static final int MAX_SYMBOLS = 40;

    private Alerts() {
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---- the lists ------------------------------------------------------------------------

    private static JSONArray array(SharedPreferences p, String key) {
        try {
            return new JSONArray(p.getString(key, "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    /** The page's alerts that are still waiting: [{id, sym, y, op, v, dp, s10}]. */
    static synchronized void sync(Context c, String json) {
        if (json == null || json.length() > 64 * 1024) return;
        SharedPreferences p = prefs(c);
        try {
            JSONArray in = new JSONArray(json);
            JSONArray fired = array(p, "fired");
            JSONArray keep = new JSONArray();
            for (int i = 0; i < in.length() && keep.length() < MAX_ALERTS; i++) {
                JSONObject a = in.optJSONObject(i);
                if (a == null || a.optString("id").isEmpty() || a.optString("y").isEmpty()) continue;
                String op = a.optString("op");
                if (!(">".equals(op) || "<".equals(op)) || Double.isNaN(a.optDouble("v"))) continue;
                // one this app already triggered, which the page hasn't collected yet, isn't waiting any more
                if (indexOf(fired, a.optString("id")) >= 0) continue;
                keep.put(a);
            }
            p.edit().putString("alerts", keep.toString()).apply();
        } catch (JSONException e) {
            // not a list: keep what was there
        }
        schedule(c);
    }

    /** Alerts triggered while the page wasn't looking, [{id, price, at}]; reading empties the list. */
    static synchronized String takeFired(Context c) {
        SharedPreferences p = prefs(c);
        String fired = p.getString("fired", "[]");
        p.edit().putString("fired", "[]").apply();
        return fired;
    }

    static int waiting(Context c) {
        return array(prefs(c), "alerts").length();
    }

    private static int indexOf(JSONArray list, String id) {
        for (int i = 0; i < list.length(); i++) {
            JSONObject o = list.optJSONObject(i);
            if (o != null && id.equals(o.optString("id"))) return i;
        }
        return -1;
    }

    // ---- the check ------------------------------------------------------------------------

    static boolean reached(String op, double level, double price) {
        return ">".equals(op) ? price > level : "<".equals(op) && price < level;
    }

    /** The last regular-market price in Yahoo's chart answer. Yahoo writes some yields x10. */
    static double priceFrom(String json, boolean yield) throws JSONException {
        JSONObject chart = new JSONObject(json).getJSONObject("chart");
        JSONArray result = chart.optJSONArray("result");
        if (result == null || result.length() == 0) throw new JSONException("no price in Yahoo's answer");
        double p = result.getJSONObject(0).getJSONObject("meta").getDouble("regularMarketPrice");
        if (Double.isNaN(p) || Double.isInfinite(p)) throw new JSONException("no price in Yahoo's answer");
        return yield && p > 20 ? p * 0.1 : p;
    }

    /** What one check decided: which alerts are still waiting and which were reached. */
    static final class Outcome {
        final JSONArray waiting = new JSONArray();
        final JSONArray reached = new JSONArray(); // the alert objects, each with "price" added
        int checked;
    }

    /** Sorts the waiting alerts by the prices just read; an alert whose price is missing keeps waiting. */
    static Outcome evaluate(JSONArray alerts, Map<String, Double> prices) throws JSONException {
        Outcome out = new Outcome();
        for (int i = 0; i < alerts.length(); i++) {
            JSONObject a = alerts.getJSONObject(i);
            Double price = prices.get(a.optString("y"));
            if (price == null) {
                out.waiting.put(a);
                continue;
            }
            out.checked++;
            if (reached(a.optString("op"), a.optDouble("v"), price)) out.reached.put(new JSONObject(a.toString()).put("price", price.doubleValue()));
            else out.waiting.put(a);
        }
        return out;
    }

    static String format(double v, int dp) {
        return String.format(Locale.US, "%,." + Math.max(0, Math.min(6, dp)) + "f", v);
    }

    /** Reads the prices, notifies, updates the lists. Runs on a background thread. Returns one line for STATUS. */
    static String check(Context c) {
        SharedPreferences p = prefs(c);
        JSONArray snapshot;
        synchronized (Alerts.class) {
            snapshot = array(p, "alerts");
        }
        String result;
        if (snapshot.length() == 0) {
            result = "no alerts waiting";
        } else {
            Map<String, Double> prices = new HashMap<String, Double>();
            Map<String, Boolean> tried = new HashMap<String, Boolean>();
            int failed = 0;
            String firstError = null;
            for (int i = 0; i < snapshot.length() && tried.size() < MAX_SYMBOLS; i++) {
                JSONObject a = snapshot.optJSONObject(i);
                if (a == null) continue;
                String y = a.optString("y");
                if (tried.containsKey(y)) continue;
                tried.put(y, Boolean.TRUE);
                try {
                    prices.put(y, priceFrom(fetch(y), a.optBoolean("s10")));
                } catch (Exception e) {
                    failed++;
                    if (firstError == null) firstError = a.optString("sym", y) + ": " + e.getMessage();
                }
            }
            int triggered = 0;
            int checked = 0;
            try {
                JSONArray notify;
                synchronized (Alerts.class) {
                    // the page may have changed the list while the prices were being read
                    Outcome out = evaluate(array(p, "alerts"), prices);
                    checked = out.checked;
                    JSONArray fired = array(p, "fired");
                    long now = System.currentTimeMillis();
                    for (int i = 0; i < out.reached.length(); i++) {
                        JSONObject a = out.reached.getJSONObject(i);
                        fired.put(new JSONObject().put("id", a.getString("id")).put("price", a.getDouble("price")).put("at", now));
                    }
                    p.edit().putString("alerts", out.waiting.toString()).putString("fired", fired.toString()).apply();
                    notify = out.reached;
                }
                triggered = notify.length();
                for (int i = 0; i < notify.length(); i++) {
                    JSONObject a = notify.getJSONObject(i);
                    int dp = a.optInt("dp", 2);
                    show(c, a.getString("id"),
                            a.optString("sym") + (">".equals(a.optString("op")) ? " above " : " below ") + format(a.optDouble("v"), dp),
                            "Last price " + format(a.getDouble("price"), dp) + ". Meridian price alert.");
                }
                result = checked + (checked == 1 ? " alert checked, " : " alerts checked, ") + triggered + " triggered"
                        + (failed > 0 ? "; " + failed + (failed == 1 ? " price" : " prices") + " couldn't be read (" + firstError + ")" : "");
            } catch (JSONException e) {
                result = "the saved alerts couldn't be read: " + e.getMessage();
            }
        }
        p.edit().putLong("alertCheckAt", System.currentTimeMillis()).putString("alertCheckResult", result).apply();
        return result;
    }

    private static String fetch(String ySymbol) throws IOException {
        URL url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/" + URLEncoder.encode(ySymbol, "UTF-8")
                + "?range=1d&interval=1d&includePrePost=false");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        try {
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(20000);
            conn.setRequestProperty("User-Agent", MainActivity.UA);
            conn.setRequestProperty("Accept", "application/json");
            int status = conn.getResponseCode();
            if (status != 200) throw new IOException("Yahoo Finance answered HTTP " + status);
            InputStream in = conn.getInputStream();
            try {
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) != -1) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > 512 * 1024) throw new IOException("Yahoo Finance's answer was too large");
                }
                return new String(buf.toByteArray(), StandardCharsets.UTF_8);
            } finally {
                in.close();
            }
        } finally {
            conn.disconnect();
        }
    }

    // ---- the background job -----------------------------------------------------------------

    /** Keeps the 15-minute job running while an alert is waiting, and stops it when none is. */
    static void schedule(Context c) {
        SharedPreferences p = prefs(c);
        try {
            JobScheduler js = (JobScheduler) c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
            if (js == null) {
                p.edit().putString("jobState", "this phone has no job scheduler").apply();
                return;
            }
            if (waiting(c) == 0) {
                js.cancel(JOB_ID);
                p.edit().putString("jobState", "off (no alerts waiting)").apply();
                return;
            }
            if (js.getPendingJob(JOB_ID) == null) {
                JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(c, AlertJob.class))
                        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                        .setPeriodic(PERIOD_MS)
                        .setPersisted(true) // keeps running after the phone restarts
                        .build();
                if (js.schedule(job) != JobScheduler.RESULT_SUCCESS) {
                    p.edit().putString("jobState", "Android refused to schedule the background check").apply();
                    return;
                }
            }
            p.edit().putString("jobState", "on (about every 15 minutes)").apply();
        } catch (RuntimeException e) {
            p.edit().putString("jobState", "couldn't be scheduled: " + e.getMessage()).apply();
        }
    }

    // ---- notifications ------------------------------------------------------------------------

    /** "granted", "denied" (off in the phone's settings, or refused), or "ask" (not asked yet). */
    static String permission(Context c) {
        if (Build.VERSION.SDK_INT >= 33) {
            if (c.checkSelfPermission(NOTIFY_PERMISSION) != PackageManager.PERMISSION_GRANTED) {
                return prefs(c).getBoolean("askedNotify", false) ? "denied" : "ask";
            }
        }
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.areNotificationsEnabled() ? "granted" : "denied";
    }

    static String battery(Context c) {
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()) ? "unrestricted" : "optimised";
    }

    @SuppressWarnings("deprecation")
    static boolean show(Context c, String id, String title, String body) {
        try {
            NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null || !"granted".equals(permission(c))) return false;
            Notification.Builder b;
            if (Build.VERSION.SDK_INT >= 26) {
                NotificationChannel ch = new NotificationChannel(CHANNEL, "Price alerts", NotificationManager.IMPORTANCE_HIGH);
                ch.setDescription("When a price alert you set in Meridian is reached");
                nm.createNotificationChannel(ch);
                b = new Notification.Builder(c, CHANNEL);
            } else {
                b = new Notification.Builder(c).setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
            }
            Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent tap = PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            int icon = c.getResources().getIdentifier("ic_stat_alert", "drawable", c.getPackageName());
            b.setSmallIcon(icon != 0 ? icon : android.R.drawable.stat_notify_more)
                    .setContentTitle(limit(title, 80))
                    .setContentText(limit(body, 240))
                    .setStyle(new Notification.BigTextStyle().bigText(limit(body, 240)))
                    .setColor(0xFFFFA028)
                    .setAutoCancel(true)
                    .setShowWhen(true)
                    .setWhen(System.currentTimeMillis())
                    .setContentIntent(tap);
            // the alert's id picks the slot, so the same alert never shows twice
            nm.notify(id == null ? 0 : id.hashCode(), b.build());
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static String limit(String s, int n) {
        if (s == null) return "";
        return s.length() > n ? s.substring(0, n) : s;
    }
}
