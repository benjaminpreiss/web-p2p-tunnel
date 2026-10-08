package dev.webp2p.controllerprobe;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView status;
    private Button open;
    private final Runnable refresh = new Runnable() {
        @Override public void run() {
            status.setText(getSharedPreferences("probe", MODE_PRIVATE)
                    .getString("status", "Not started. Tap Start server."));
            open.setEnabled(ControllerService.listening);
            if (!ControllerService.listening && getSharedPreferences("probe", MODE_PRIVATE).getBoolean("running", false)) {
                status.setText("Previous listener is no longer running. Start a fresh attempt.");
            }
            handler.postDelayed(this, 500);
        }
    };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(pad, pad * 2, pad, pad);
        TextView title = new TextView(this);
        title.setText("Phone-local controller probe");
        title.setTextSize(24);
        layout.addView(title);
        TextView description = new TextView(this);
        description.setText("Serves the bundled browser controller and delivery probe. "
                + "No native UDP or remote asset downloads. The browser owns the tunnel. "
                + "Server stops after 10 minutes; Stop does not revoke an existing browser tunnel.\n\n"
                + "1. Start server.\n2. Wait for LISTENING.\n3. Manually type the URL in Chrome/Brave.\n"
                + "4. Open bundled tunnel controller from the probe page.\n\n"
                + "The Open button may return HTTP 403; manual URL entry is the tested path.\n\n"
                + ControllerService.URL + "\n");
        layout.addView(description);
        Button start = new Button(this);
        start.setText("Start server — 10 minutes");
        start.setOnClickListener(view -> {
            try {
                startForegroundService(new Intent(this, ControllerService.class));
            } catch (RuntimeException error) {
                getSharedPreferences("probe", MODE_PRIVATE).edit()
                        .putBoolean("running", false)
                        .putString("status", "Service start failed: " + error.getClass().getSimpleName()
                                + ": " + error.getMessage()).apply();
            }
        });
        layout.addView(start);
        open = new Button(this);
        open.setText("Open test page in browser");
        open.setEnabled(false);
        open.setOnClickListener(view -> {
            Intent browser = new Intent(Intent.ACTION_VIEW, Uri.parse(ControllerService.URL));
            browser.addCategory(Intent.CATEGORY_BROWSABLE);
            try { startActivity(Intent.createChooser(browser, "Choose Chrome or Brave")); }
            catch (RuntimeException error) { status.setText("Could not open browser. Type " + ControllerService.URL); }
        });
        layout.addView(open);
        Button stop = new Button(this);
        stop.setText("Stop server");
        stop.setOnClickListener(view -> stopService(new Intent(this, ControllerService.class)));
        layout.addView(stop);
        status = new TextView(this);
        status.setTextIsSelectable(true);
        layout.addView(status);
        ScrollView scroll = new ScrollView(this);
        scroll.addView(layout);
        setContentView(scroll);
    }

    @Override public void onResume() { super.onResume(); handler.post(refresh); }
    @Override public void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
}
