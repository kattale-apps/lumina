package com.solarswitch.app;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** Lets the web app hand the phone its background-check key and ask for notification permission. */
@CapacitorPlugin(
    name = "Inbox",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class InboxPlugin extends Plugin {

    @PluginMethod
    public void getKey(PluginCall call) {
        JSObject result = new JSObject();
        result.put("key", InboxWorker.prefs(getContext()).getString("key", null));
        result.put("owner", InboxWorker.prefs(getContext()).getString("owner", null));
        call.resolve(result);
    }

    @PluginMethod
    public void setKey(PluginCall call) {
        String key = call.getString("key");
        String endpoint = call.getString("endpoint");
        String owner = call.getString("owner");
        // https only, except the phone itself, which local test builds use.
        boolean allowed = endpoint != null && (endpoint.startsWith("https://") || endpoint.startsWith("http://127.0.0.1:"));
        if (key == null || !allowed) {
            call.reject("key and an https endpoint are required");
            return;
        }
        InboxWorker.prefs(getContext()).edit()
            .putString("key", key)
            .putString("endpoint", endpoint)
            .putString("owner", owner)
            .putInt("lastCount", 0)
            .apply();
        InboxWorker.schedule(getContext());
        InboxWorker.checkNow(getContext());
        call.resolve();
    }

    /** Refresh the badge now, for example right after messages were opened. */
    @PluginMethod
    public void checkNow(PluginCall call) {
        InboxWorker.checkNow(getContext());
        call.resolve();
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            resolvePermission(call, true);
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        resolvePermission(call, getPermissionState("notifications") == PermissionState.GRANTED);
    }

    private void resolvePermission(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }
}
