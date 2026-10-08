package dev.webp2p.controllerprobe;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.io.IOException;
import java.util.Map;

public final class ControllerService extends Service {
    public static final int PORT = 18787;
    public static final String URL = "http://127.0.0.1:" + PORT + "/";
    public static volatile boolean listening;
    private static final String CHANNEL = "loopback-probe";
    private final Handler main = new Handler(Looper.getMainLooper());
    private LoopbackServer server;
    private Thread worker;
    private volatile boolean stopping;
    private volatile boolean failed;

    private void status(String message, boolean running) {
        getSharedPreferences("probe", MODE_PRIVATE).edit()
                .putString("status", message).putBoolean("running", running).apply();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "STOP".equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (worker != null) return START_NOT_STICKY;
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Local controller probe", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1,
                new Intent(this, ControllerService.class).setAction("STOP"), PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_info_details)
                .setContentTitle("Local controller probe")
                .setContentText("Loopback only · stops after 10 minutes")
                .setContentIntent(open).setOngoing(true)
                .addAction(new Notification.Action.Builder(null, "Stop", stop).build()).build();
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(1, notification);
            }
        } catch (RuntimeException error) {
            failed = true;
            status("Foreground service failed: " + error.getClass().getSimpleName()
                    + ": " + error.getMessage(), false);
            stopSelf();
            return START_NOT_STICKY;
        }
        status("Loading bundled files; then opening TCP loopback listener…", false);
        main.postDelayed(this::stopSelf, 10 * 60 * 1000L);
        worker = new Thread(this::runServer, "controller-loopback");
        worker.start();
        return START_NOT_STICKY;
    }

    private void runServer() {
        String phase = "load bundled assets";
        try {
            Map<String, LoopbackServer.Asset> assets = BundledSite.load(name -> getAssets().open(name));
            phase = "create/bind TCP listener on 127.0.0.1:" + PORT;
            try (LoopbackServer candidate = new LoopbackServer(PORT, assets)) {
                synchronized (this) {
                    if (stopping) return;
                    server = candidate;
                    listening = true;
                    status("LISTENING at " + URL + "\nTCP loopback bind succeeded. Open the browser next.", true);
                }
                phase = "accept TCP connection";
                candidate.serve();
            }
        } catch (IOException | RuntimeException error) {
            synchronized (this) {
                if (!stopping) {
                    failed = true;
                    status("FAILED during " + phase + "\n" + error.getClass().getSimpleName()
                            + ": " + error.getMessage()
                            + "\nNo policy changes or fallback attempted.", false);
                }
            }
            main.post(this::stopSelf);
        }
    }

    @Override public void onDestroy() {
        synchronized (this) {
            stopping = true;
            listening = false;
            main.removeCallbacksAndMessages(null);
            if (server != null) {
                try { server.close(); } catch (IOException ignored) { }
            }
            if (!failed) status("Stopped. No listener running. Start for a new 10-minute attempt.", false);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
