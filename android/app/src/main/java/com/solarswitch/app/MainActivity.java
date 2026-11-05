package com.solarswitch.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    static final String EXTRA_PATH = "solar_switch_path";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(InboxPlugin.class);
        super.onCreate(savedInstanceState);
        // Android's saved-login popup lands on top of the box being typed in inside the
        // web view, so keep autofill out of the app; logins are saved by the app itself.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && getBridge() != null) {
            getBridge().getWebView().setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        // Keep the background check for the app-icon badge running after updates and restarts.
        if (InboxWorker.prefs(this).getString("key", null) != null) {
            InboxWorker.schedule(this);
            InboxWorker.checkNow(this);
        }
        openPathFrom(getIntent());
    }

    @Override
    public void onResume() {
        super.onResume();
        // Coming back to the app: bring the badge up to date straight away.
        if (InboxWorker.prefs(this).getString("key", null) != null) InboxWorker.checkNow(this);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        openPathFrom(intent);
    }

    /** A tapped notification opens the page it is about, such as My recommendations. */
    private void openPathFrom(Intent intent) {
        if (intent == null || getBridge() == null) return;
        String path = intent.getStringExtra(EXTRA_PATH);
        if (path == null || !path.startsWith("/") || path.startsWith("//")) return;
        intent.removeExtra(EXTRA_PATH);
        String base = getBridge().getServerUrl();
        if (base == null) return;
        String url = base.replaceAll("/+$", "") + path;
        getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
    }
}
