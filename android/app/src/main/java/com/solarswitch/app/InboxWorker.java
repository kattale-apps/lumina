package com.solarswitch.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

/**
 * Asks the server how many unread messages this phone's person has, and keeps one notification
 * in step with that number. The notification is what puts the dot or number on the app icon,
 * so it works while the app is closed and even when nobody is signed in on the screen.
 */
public class InboxWorker extends Worker {
    static final String PREFS = "solar_switch_inbox";
    static final String CHANNEL = "messages";
    static final int NOTIFICATION_ID = 4101;
    private static final String PERIODIC = "inbox-periodic";
    private static final String NOW = "inbox-now";

    public InboxWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static Constraints online() {
        return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
    }

    /** Every 15 minutes, the shortest interval Android allows for background work. */
    static void schedule(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(InboxWorker.class, 15, TimeUnit.MINUTES)
            .setConstraints(online())
            .build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request);
    }

    static void checkNow(Context context) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(InboxWorker.class).setConstraints(online()).build();
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, request);
    }

    static void stop(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(PERIODIC);
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
        prefs(context).edit().clear().apply();
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        SharedPreferences prefs = prefs(context);
        String key = prefs.getString("key", null);
        String endpoint = prefs.getString("endpoint", null);
        if (key == null || endpoint == null) return Result.success();

        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(endpoint).openConnection();
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(15000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            byte[] body = new JSONObject().put("key", key).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(body);
            }
            if (connection.getResponseCode() != 200) return Result.retry();
            JSONObject reply;
            try (InputStream in = connection.getInputStream()) {
                ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                int read;
                while ((read = in.read(chunk)) != -1) buffer.write(chunk, 0, read);
                reply = new JSONObject(buffer.toString("UTF-8"));
            }
            if (reply.optBoolean("stop", false)) {
                stop(context);
                return Result.success();
            }
            int count = reply.optInt("count", 0);
            int last = prefs.getInt("lastCount", 0);
            if (count <= 0) {
                NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID);
            } else {
                show(context, count, count > last, reply.optString("title", "Solar Switch"), reply.optString("body", "You have a new message"), reply.optString("path", "/"));
            }
            prefs.edit().putInt("lastCount", Math.max(count, 0)).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.retry();
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Messages", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Recommendations and quote requests");
        channel.setShowBadge(true);
        manager.createNotificationChannel(channel);
    }

    private static void show(Context context, int count, boolean alert, String title, String body, String path) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
        ensureChannel(context);
        Intent open = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(MainActivity.EXTRA_PATH, path);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pending = PendingIntent.getActivity(context, NOTIFICATION_ID, open, flags);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_solar)
            .setContentTitle(title)
            .setContentText(body)
            .setNumber(count)
            .setBadgeIconType(NotificationCompat.BADGE_ICON_SMALL)
            .setContentIntent(pending)
            .setAutoCancel(true)
            // Buzz only when something new arrived, not when the count is just refreshed.
            .setOnlyAlertOnce(!alert)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
        } catch (SecurityException ignored) {
            // Notifications not allowed on this phone.
        }
    }
}
