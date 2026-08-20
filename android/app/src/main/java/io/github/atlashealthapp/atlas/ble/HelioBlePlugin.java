package io.github.atlashealthapp.atlas.ble;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.os.Build;
import android.util.Base64;

import java.util.List;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Bridges the direct-BLE spike to the dev panel in the WebView.
 *
 * Deliberately thin: it owns permission handling and pushes log lines to JS, and
 * leaves everything about Bluetooth to {@link HelioLink}. Every interesting
 * event goes out as a "bleLog" listener event rather than as a call result,
 * because the connection sequence is a long conversation and the panel needs to
 * show progress as it happens, not one verdict at the end.
 */
@CapacitorPlugin(
        name = "HelioBle",
        permissions = {
                @Permission(alias = HelioBlePlugin.BLE_ALIAS, strings = {Manifest.permission.BLUETOOTH_CONNECT}),
                @Permission(alias = HelioBlePlugin.NOTIFY_ALIAS, strings = {"android.permission.POST_NOTIFICATIONS"})
        }
)
public class HelioBlePlugin extends Plugin {

    static final String BLE_ALIAS = "ble";
    static final String NOTIFY_ALIAS = "notifications";

    /** Rejection code for "something else holds the link", which is a wait, not a fault. */
    static final String LINK_BUSY = "LINK_BUSY";

    /**
     * Written from the Capacitor plugin thread and read from the GATT callback
     * thread, so the two must not see different values for it.
     */
    private volatile HelioLink link;
    private boolean live;

    /**
     * An alarm message built and validated by {@link #setAlarm}, waiting for
     * {@link #startLink} to hand it to a link. Same pattern as {@code live}: the
     * permission dance and the link-busy guards sit between the call arriving and
     * the connection opening, so what the session is *for* has to survive that
     * gap somewhere.
     */
    private volatile byte[] alarmPayload;

    /** Mirrored to logcat as well as the panel, so `adb logcat -s HelioBle` captures a whole session. */
    private void emit(final String event, final String message) {
        android.util.Log.i("HelioBle", message);
        final JSObject payload = new JSObject();
        payload.put("event", event);
        payload.put("message", message);
        notifyListeners("bleLog", payload);
    }

    /**
     * One per link, rather than one shared instance, so a close can be attributed
     * to the link that sent it. Without that, a close arriving late from a link
     * that has already been replaced clears the field pointing at the live one,
     * which is then unreachable and never disconnected: its GATT connection stays
     * open, and Android keeps delivering the next link's notifications to it.
     */
    private final class LinkListener implements HelioLink.Listener {

        /** Assigned immediately after construction; the link cannot exist before its listener. */
        HelioLink owner;

        @Override
        public void onLog(final String message) {
            emit("log", message);
        }

        @Override
        public void onReady() {
            emit("ready", "link ready");
        }

        @Override
        public void onAuthResult(final boolean success, final String detail) {
            emit(success ? "authenticated" : "authFailed", detail);
        }

        @Override
        public void onBattery(final int levelPercent, final boolean charging) {
            emit("battery", "battery " + levelPercent + "%" + (charging ? " charging" : ""));
        }

        /**
         * Sent to JS as base64 rather than decoded here, so the existing and
         * already-tested huamiSleep.js decoder does the work. Duplicating those
         * byte offsets in Java would be a second thing to keep correct.
         */
        @Override
        public void onSleepSessions(final List<byte[]> sessions) {
            final JSArray encoded = new JSArray();
            for (final byte[] session : sessions) {
                encoded.put(Base64.encodeToString(session, Base64.NO_WRAP));
            }
            final JSObject payload = new JSObject();
            payload.put("event", "sleepSessions");
            payload.put("message", sessions.size() + " sleep session(s) received");
            payload.put("sessions", encoded);
            notifyListeners("bleLog", payload);
            android.util.Log.i("HelioBle", "sleep sessions: " + sessions.size());
        }

        /**
         * Decoded natively (unlike sleep, which hands raw bytes to the already-
         * tested JS decoder) since the workout protobuf reader has no JS-side
         * equivalent to defer to. Stage 1: logged to the dev panel only, no
         * storage yet - see HelioSyncService.onWorkouts for the same stub.
         */
        @Override
        public void onWorkouts(final List<HelioFetch.Workout> workouts) {
            final JSArray encoded = new JSArray();
            for (final HelioFetch.Workout w : workouts) {
                final JSObject one = new JSObject();
                one.put("startMillis", w.startMillis);
                one.put("endMillis", w.endMillis);
                one.put("typeCode", w.typeCode);
                one.put("typeAutoDetected", w.typeAutoDetected);
                one.put("activeSeconds", w.activeSeconds);
                one.put("caloriesKcal", w.caloriesKcal);
                one.put("hrAvg", w.hrAvg);
                one.put("hrMax", w.hrMax);
                one.put("hrMin", w.hrMin);
                one.put("distanceMeters", w.distanceMeters);
                one.put("altitudeAvgMeters", w.altitudeAvgMeters);
                encoded.put(one);
            }
            final JSObject payload = new JSObject();
            payload.put("event", "workouts");
            payload.put("message", workouts.size() + " workout(s) received");
            payload.put("workouts", encoded);
            notifyListeners("bleLog", payload);
            android.util.Log.i("HelioBle", "workouts: " + workouts.size());
        }

        /**
         * Emitted in the same {metric, t, v} shape gadgetbridgeSource.js already
         * produces, so everything downstream (sample store, rollups, BODY tab)
         * consumes band data without knowing it came from somewhere new.
         */
        @Override
        public void onSamples(final List<HelioFetch.Sample> samples) {
            final JSArray encoded = new JSArray();
            for (final HelioFetch.Sample sample : samples) {
                final JSObject one = new JSObject();
                one.put("metric", sample.metric);
                one.put("t", sample.t);
                one.put("v", sample.v);
                encoded.put(one);
            }
            final JSObject payload = new JSObject();
            payload.put("event", "samples");
            payload.put("message", samples.size() + " sample(s)");
            payload.put("samples", encoded);
            notifyListeners("bleLog", payload);
        }

        @Override
        public void onFetchComplete() {
            emit("fetchComplete", "fetch complete");
        }

        /** Not routed through emit(): a reading every second would swamp logcat. */
        @Override
        public void onHeartRate(final int bpm) {
            final JSObject payload = new JSObject();
            payload.put("event", "heartRate");
            payload.put("bpm", bpm);
            notifyListeners("bleLog", payload);
        }

        @Override
        public void onAlarmSet(final boolean accepted, final int status) {
            final JSObject payload = new JSObject();
            payload.put("event", "alarmSet");
            payload.put("message", accepted ? "alarm set" : "alarm refused (status " + status + ")");
            payload.put("accepted", accepted);
            payload.put("status", status);
            notifyListeners("bleLog", payload);
            android.util.Log.i("HelioBle", "alarm set: " + accepted + ", status " + status);
            // Nothing else is coming on this link, so it lets go rather than
            // sitting open on the band's single central slot until it times out.
            closeLink();
        }

        @Override
        public void onClosed(final String reason) {
            synchronized (HelioBlePlugin.this) {
                if (link == owner) {
                    link = null;
                }
            }
            emit("closed", reason);
        }
    }

    @PluginMethod
    public void connect(final PluginCall call) {
        // Every entry point states what it wants, rather than inheriting whatever
        // the last one left behind. A sticky `live` was a silent hang: a fetch that
        // opened a link in live mode never fetched, so the caller waited for a
        // completion event that by definition was never coming.
        live = false;
        requestLink(call);
    }

    /**
     * Writes one alarm to the band and closes.
     *
     * The result does not come back through this call, which resolves as soon as
     * the link is asked for: it arrives as an `alarmSet` event on `bleLog`, the
     * same way every other outcome on this plugin does. A call that waited would
     * have to hold a PluginCall across a connect, an auth handshake and a reply,
     * and every other entry point here already established that the events are
     * where results live.
     */
    @PluginMethod
    public void setAlarm(final PluginCall call) {
        live = false;
        final Integer hour = call.getInt("hour");
        final Integer minute = call.getInt("minute");
        if (hour == null || minute == null) {
            call.reject("hour and minute are required");
            return;
        }
        final Integer slot = call.getInt("slot", 0);
        final Integer repeat = call.getInt("repeat", HelioAlarm.REPEAT_ONCE);
        try {
            alarmPayload = HelioAlarm.create(
                    slot != null ? slot : 0,
                    hour,
                    minute,
                    Boolean.TRUE.equals(call.getBoolean("enabled", true)),
                    Boolean.TRUE.equals(call.getBoolean("smart", false)),
                    repeat != null ? repeat : HelioAlarm.REPEAT_ONCE);
        } catch (final IllegalArgumentException e) {
            alarmPayload = null;
            call.reject(e.getMessage());
            return;
        }
        requestLink(call);
    }

    private void requestLink(final PluginCall call) {
        // BLUETOOTH_CONNECT only became a runtime permission in Android 12.
        // Below that the legacy BLUETOOTH permission is granted at install time,
        // so requesting anything here would fail rather than help.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && getPermissionState(BLE_ALIAS) != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias(BLE_ALIAS, call, "onBlePermission");
            return;
        }
        startLink(call);
    }

    @PermissionCallback
    private void onBlePermission(final PluginCall call) {
        if (getPermissionState(BLE_ALIAS) != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("bluetooth permission denied");
            return;
        }
        startLink(call);
    }

    /**
     * Holds the connection open and streams heart rate instead of fetching.
     * Separate from connect() because the two are opposites: a fetch wants to
     * finish and let go, live mode wants to stay.
     */
    @PluginMethod
    public void startLiveHeartRate(final PluginCall call) {
        live = true;
        requestLink(call);
    }

    @PluginMethod
    public void stopLiveHeartRate(final PluginCall call) {
        live = false;
        closeLink();
        call.resolve();
    }

    /**
     * Takes the link out of the field before closing it, so the close cannot race
     * a second caller into disconnecting the same object twice, and so nothing can
     * hand out a link that is on its way down.
     */
    private void closeLink() {
        closeLink("closed by user");
    }

    private void closeLink(final String reason) {
        final HelioLink closing;
        synchronized (this) {
            closing = link;
            link = null;
        }
        if (closing != null) {
            closing.disconnect(reason);
        }
    }

    /**
     * The Bridge is rebuilt whenever the Activity is recreated, and this plugin
     * goes with it. Without this the outgoing instance keeps its HelioLink, and
     * with it an open GATT connection that nothing can reach to close: Android
     * then delivers the replacement link's notifications to both, and the stale
     * one answers a handshake that was never its own. That is the 2026-07-28
     * "session key rejected, status 0x02 / 0x26" failure.
     */
    @Override
    protected void handleOnDestroy() {
        // Reported as its own reason rather than as the shared "closed by user".
        // Android destroys the Activity on its own whenever it reclaims the app,
        // which on a first connect is minutes long and happens while somebody is
        // checking Bluetooth settings or another band app. Telling them they
        // cancelled it sends them looking for a button they never pressed.
        closeLink("Atlas was closed by Android while the sync was running");
        super.handleOnDestroy();
    }

    private void startLink(final PluginCall call) {
        final byte[] key;
        try {
            // Supplied per call rather than stored natively, so the pairing secret
            // stays in one place on the JS side and never enters the source tree.
            key = parseAuthKey(call.getString("authKey"));
        } catch (final IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        final Integer sinceDays = call.getInt("sinceDays", 3);
        // Milliseconds overflow a JS-bridged int, so this crosses as a string.
        final long workoutSince = parseMillis(call.getString("workoutSinceMillis"));
        // HelioSyncService holds its own separate link field, invisible to the
        // `link != null` check below - this catches that case too, so the
        // background service's own sync does not desync a foreground one (or
        // vice versa) by opening a second GATT connection to the same band.
        if (HelioLink.isLinkActive()) {
            call.reject("the strap link is already in use", LINK_BUSY);
            return;
        }
        final HelioLink target;
        synchronized (this) {
            // Refused, not quietly ignored. The band accepts about one central at
            // a time, so a second request cannot be served concurrently - and the
            // link used to answer this case by logging "already connected" and
            // returning, which left the caller waiting on events for work that was
            // never started. A rejection at least ends the wait truthfully.
            if (link != null) {
                // Coded, not just worded: the caller has to be able to tell "busy,
                // ask again later" apart from a real failure without matching on
                // the text of a message. An overlap is not a fault to report.
                call.reject("the strap link is already in use", LINK_BUSY);
                return;
            }
            final LinkListener owned = new LinkListener();
            link = new HelioLink(getContext(), owned, key);
            owned.owner = link;
            target = link;
        }
        // Taken and cleared together, so a rejected or abandoned setAlarm cannot
        // leave a payload behind for the next ordinary sync to send.
        final byte[] alarm = alarmPayload;
        alarmPayload = null;
        if (alarm != null) {
            target.connectForAlarm(alarm);
        } else {
            target.connect(sinceDays != null ? sinceDays : 3, live, workoutSince);
        }
        call.resolve();
    }

    /** A missing or unparseable value means "no cursor", never a wrong one. */
    static long parseMillis(final String value) {
        if (value == null || value.trim().isEmpty()) {
            return 0L;
        }
        try {
            final long parsed = Long.parseLong(value.trim());
            return parsed > 0 ? parsed : 0L;
        } catch (final NumberFormatException e) {
            return 0L;
        }
    }

    /** @return the 16 raw bytes of a 32-character hex auth key */
    static byte[] parseAuthKey(final String hex) {
        if (hex == null || hex.trim().isEmpty()) {
            throw new IllegalArgumentException("no auth key supplied");
        }
        String value = hex.trim();
        if (value.startsWith("0x") || value.startsWith("0X")) {
            value = value.substring(2);
        }
        if (value.length() != 32) {
            throw new IllegalArgumentException("auth key must be 32 hex characters, got " + value.length());
        }
        final byte[] out = new byte[16];
        for (int i = 0; i < 16; i++) {
            try {
                out[i] = (byte) Integer.parseInt(value.substring(i * 2, i * 2 + 2), 16);
            } catch (final NumberFormatException e) {
                throw new IllegalArgumentException("auth key is not valid hex");
            }
        }
        return out;
    }

    /**
     * The background service has no WebView, so it cannot ask JS for the key
     * when it wakes. Storing it in app-private preferences is the price of
     * syncing while Atlas is closed; that directory is unreadable by other apps
     * without root.
     */
    @PluginMethod
    public void setAuthKey(final PluginCall call) {
        final String key = call.getString("authKey");
        try {
            parseAuthKey(key);
        } catch (final IllegalArgumentException e) {
            call.reject(e.getMessage());
            return;
        }
        getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit()
                .putString(HelioSyncService.KEY_AUTH, key.trim())
                .apply();
        call.resolve();
    }

    @PluginMethod
    public void startBackgroundSync(final PluginCall call) {
        // A foreground service without a visible notification is not permitted
        // on Android 13+, so the service simply would not run.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState(NOTIFY_ALIAS) != com.getcapacitor.PermissionState.GRANTED) {
            requestPermissionForAlias(NOTIFY_ALIAS, call, "onNotifyPermission");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void onNotifyPermission(final PluginCall call) {
        if (getPermissionState(NOTIFY_ALIAS) != com.getcapacitor.PermissionState.GRANTED) {
            call.reject("notification permission denied, background sync cannot run");
            return;
        }
        startService(call);
    }

    private void startService(final PluginCall call) {
        getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit()
                .putBoolean(HelioSyncService.KEY_ENABLED, true)
                .apply();
        // **Never let this take the app down.** startForegroundService throws
        // ForegroundServiceStartNotAllowedException whenever Android does not
        // consider the app foreground at that instant, and the app calls this
        // on startup: measured 2026-08-12, where the WebView booted, asked for
        // the service and crashed the whole process with a FATAL EXCEPTION on
        // the CapacitorPlugins thread. The flag above is already written, so the
        // service starts on the next launch that is allowed to start it.
        try {
            HelioSyncService.start(getContext());
        } catch (final Exception e) {
            call.reject("background sync could not start: " + e.getMessage());
            return;
        }
        call.resolve();
    }

    /**
     * The app has written a fresher summary; ask the service to redraw its
     * notification. Resolves either way - the service may not be running, and a
     * shade that did not update is not an error worth failing a sync over.
     */
    /**
     * Turns the overnight sleep probe on or off.
     *
     * No UI, deliberately: it is a measurement with a battery cost and an end
     * date, not a setting. Driven from `scripts/device-eval.mjs` for the nights
     * it is wanted, and read back with `scripts/read-sleep-probe.mjs`.
     */
    @PluginMethod
    public void setSleepProbe(final PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit()
                .putBoolean(SleepProbe.KEY_ENABLED, on)
                .apply();
        emit("sleepProbe", "sleep probe " + (on ? "ON, syncing every 10 min" : "off"));
        final JSObject result = new JSObject();
        result.put("enabled", on);
        call.resolve(result);
    }

    /**
     * Mirror the alarm the app has set into SharedPreferences.
     *
     * <p>The service cannot read the app's own copy: alarms live in
     * localStorage, which belongs to the WebView, and the WebView is not running
     * at four in the morning. This is the same bridge {@code nativeSummary}
     * builds for the notification, and for the same reason.
     *
     * <p>Written on every successful alarm write rather than on a schedule, so
     * the two can only disagree if a write to the strap succeeded and this
     * failed, which would leave the service watching a window for an alarm the
     * band no longer holds. That is a missed early wake, never a spurious one.
     */
    @PluginMethod
    public void setAlarmPlan(final PluginCall call) {
        final android.content.SharedPreferences.Editor edit =
                getContext()
                        .getSharedPreferences(
                                HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                        .edit();

        edit.putString(SmartAlarm.KEY_MODE, call.getString("mode", "fixed"));
        edit.putInt(SmartAlarm.KEY_HOUR, call.getInt("hour", -1));
        edit.putInt(SmartAlarm.KEY_MINUTE, call.getInt("minute", 0));
        edit.putBoolean(SmartAlarm.KEY_ENABLED, Boolean.TRUE.equals(call.getBoolean("enabled", false)));
        edit.putString(SmartAlarm.KEY_DAYS, call.getString("days", ""));
        edit.putFloat(SmartAlarm.KEY_ONSET_HOURS, call.getFloat("onsetHours", 8f));
        edit.putInt(SmartAlarm.KEY_LATEST_HOUR, call.getInt("latestHour", -1));
        edit.putInt(SmartAlarm.KEY_LATEST_MINUTE, call.getInt("latestMinute", 0));
        // A new plan clears the "already woken you tonight" mark, so changing the
        // alarm during the evening does not silently disarm the window.
        edit.remove(SmartAlarm.KEY_FIRED_ON);
        // And the debt owed by a spent one-off, because this call only ever
        // follows the band accepting the very write that debt was asking for.
        // Left in place, the service would connect again later to set an alarm
        // the strap is already holding.
        edit.remove(SmartAlarm.KEY_REARM_AFTER);
        edit.apply();

        emit("alarmPlan", "alarm plan stored for the background service");
        call.resolve();
    }

    @PluginMethod
    public void refreshNotification(final PluginCall call) {
        HelioSyncService.refreshNotification(getContext());
        // **Not inside the service call**, which returns early when the service
        // is not running. A widget on the home screen has to redraw whether or
        // not a background service happens to be up, and this is the moment the
        // app has just published a fresh summary.
        io.github.atlashealthapp.atlas.widget.AtlasWidgets.refreshAll(getContext());
        call.resolve();
    }

    /**
     * The newest live heart rate the background service has streamed.
     *
     * <p><b>The app reads this instead of opening a stream of its own, and that
     * is the whole point.</b> The strap takes one BLE central at a time. With the
     * session sheet starting its own stream while the service held one, the two
     * fought: the sheet sat on READING THE STRAP forever, the app's own sync
     * failed with the link busy, and the shade - fed by the service that had won
     * the race - was the only surface showing anything. Reported exactly that way.
     *
     * <p>So the service owns the radio and every surface reads what it publishes.
     * That is the same division the widgets already run on, pointed the other way:
     * for stored data the app is the authority and native restates it; for a live
     * reading only one process can hold the link, and it has to be the one that
     * keeps running when the app is closed.
     *
     * <p>Returns nulls rather than failing when there is no reading yet, so a
     * caller can tell "not connected yet" from "no session".
     */
    @PluginMethod
    public void liveHeartRate(final PluginCall call) {
        final android.content.SharedPreferences prefs =
                getContext().getSharedPreferences(
                        HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE);
        final int bpm = prefs.getInt(HelioSyncService.KEY_LIVE_HR, -1);
        final long at = prefs.getLong(HelioSyncService.KEY_LIVE_HR_AT, 0);
        final JSObject result = new JSObject();
        result.put("bpm", bpm > 0 ? bpm : null);
        result.put("at", at > 0 ? at : null);
        call.resolve(result);
    }

    /**
     * Every live reading kept during the session in progress.
     *
     * <p>This is what makes a recap possible for a session the band has not yet
     * handed over - which for anything short is most of them. The archive copy
     * arrives later and is better (it covers the whole window, not only the parts
     * where the screen was on), so a caller merges rather than choosing.
     */
    @PluginMethod
    public void sessionHeartTrail(final PluginCall call) {
        final String raw = getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .getString(HelioSyncService.KEY_LIVE_TRAIL, "[]");
        final JSObject result = new JSObject();
        try {
            result.put("trail", new JSArray(raw));
        } catch (final org.json.JSONException e) {
            result.put("trail", new JSArray());
        }
        call.resolve(result);
    }

    /**
     * Start a fresh trail. Called when a session starts, never between readings.
     *
     * <p>A trail is about one session; carrying yesterday's into today's recap
     * would draw a chart of two different afternoons joined in the middle.
     */
    @PluginMethod
    public void clearSessionHeartTrail(final PluginCall call) {
        getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit()
                .remove(HelioSyncService.KEY_LIVE_TRAIL)
                .apply();
        call.resolve();
    }

    /**
     * Every device bonded to this phone, so a person can say which one is theirs.
     *
     * <p><b>The list, not a verdict.</b> {@code likelyStrap} says only whether
     * {@link HelioLink#matchesStrapName} recognises the name, which is exactly
     * the rule that has already failed by the time anybody looks at this screen.
     * It orders the list and nothing more. Atlas does not otherwise guess which
     * of somebody's Bluetooth devices is a fitness band, because the plausible
     * guesses and somebody's earbuds are the same shape.
     *
     * <p>An empty list is a real and useful answer: it means nothing at all is
     * paired, which needs Android's Bluetooth settings rather than anything here.
     */
    @PluginMethod
    public void listBondedDevices(final PluginCall call) {
        final JSObject result = new JSObject();
        final JSArray devices = new JSArray();
        final BluetoothManager manager = getContext().getSystemService(BluetoothManager.class);
        final BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            result.put("supported", false);
            result.put("enabled", false);
            result.put("devices", devices);
            call.resolve(result);
            return;
        }
        result.put("supported", true);
        result.put("enabled", adapter.isEnabled());
        if (!adapter.isEnabled()) {
            // Bluetooth off returns no bonds rather than an error: the list would
            // be empty and that reads as "nothing is paired", which is a different
            // and wrong thing to tell somebody.
            result.put("devices", devices);
            call.resolve(result);
            return;
        }
        final String chosen = getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .getString(HelioSyncService.KEY_STRAP_ADDRESS, null);
        // Keyed by address so a device that is both bonded and currently
        // connected is one row rather than two.
        final java.util.LinkedHashMap<String, JSObject> found = new java.util.LinkedHashMap<>();
        try {
            for (final BluetoothDevice device : adapter.getBondedDevices()) {
                found.put(device.getAddress().toUpperCase(java.util.Locale.ROOT),
                        describe(device, true, false, chosen));
            }

            // **Bonded is not the same as connected, and on the 1.0.6 report this
            // is the difference** (2026-08-19). Five devices were bonded to that
            // phone and the reporter confirmed none of them is the strap: the
            // oddly named one is their laptop. So no list built from
            // getBondedDevices could ever have shown their band, and a picker
            // offering four sets of earbuds would have been worse than useless.
            //
            // A BLE device can hold a GATT connection having never been bonded,
            // which is the live explanation for a strap that plainly works while
            // Atlas says it is not paired.
            //
            // This is the one way to see those without scanning, which HelioLink
            // avoids on purpose: a scan drags in the location permission and a
            // whole class of discovery timing bugs. getConnectedDevices needs
            // nothing Atlas does not already hold.
            for (final BluetoothDevice device
                    : manager.getConnectedDevices(android.bluetooth.BluetoothProfile.GATT)) {
                final String key = device.getAddress().toUpperCase(java.util.Locale.ROOT);
                final JSObject existing = found.get(key);
                if (existing != null) {
                    existing.put("connected", true);
                } else {
                    found.put(key, describe(device, false, true, chosen));
                }
            }
        } catch (final SecurityException e) {
            // BLUETOOTH_CONNECT can be revoked between the check and the call.
            call.reject("Atlas needs the Bluetooth permission to list paired devices");
            return;
        }
        for (final JSObject entry : found.values()) devices.put(entry);
        result.put("devices", devices);
        call.resolve(result);
    }

    /** One row of the device list. Split out so bonded and connected build it identically. */
    private JSObject describe(final BluetoothDevice device, final boolean bonded,
                              final boolean connected, final String chosen) {
        final JSObject entry = new JSObject();
        final String name = device.getName();
        entry.put("name", name == null ? "" : name);
        entry.put("address", device.getAddress());
        entry.put("likelyStrap", HelioLink.matchesStrapName(name));
        entry.put("chosen", device.getAddress().equalsIgnoreCase(chosen));
        entry.put("bonded", bonded);
        entry.put("connected", connected);
        return entry;
    }

    /**
     * Remembers which bonded device is the strap, by address.
     *
     * <p>Passing null or an empty address clears it, which puts the name rules
     * back in charge. That is the way out of a wrong pick, and it matters because
     * a wrong pick otherwise persists across restarts exactly as well as a right
     * one does.
     */
    @PluginMethod
    public void setStrapAddress(final PluginCall call) {
        final String address = call.getString("address");
        final android.content.SharedPreferences.Editor edit = getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit();
        if (address == null || address.trim().isEmpty()) {
            edit.remove(HelioSyncService.KEY_STRAP_ADDRESS).apply();
        } else {
            edit.putString(HelioSyncService.KEY_STRAP_ADDRESS, address.trim()).apply();
        }
        call.resolve();
    }

    /**
     * Whether the phone will let Atlas book the exact alarm the smart wake needs.
     *
     * <p><b>`askable` is separate from `granted` on purpose.</b> Below Android 12
     * there is no such permission and nothing to send anybody to, so a screen must
     * be able to tell "you need to grant this" apart from "this phone has no such
     * setting" - offering a button that opens nothing is worse than staying quiet.
     */
    @PluginMethod
    public void exactAlarmState(final PluginCall call) {
        final JSObject result = new JSObject();
        result.put("granted", HelioSyncService.canBeExact(getContext()));
        result.put("askable", Build.VERSION.SDK_INT >= Build.VERSION_CODES.S);
        call.resolve(result);
    }

    /**
     * Opens the system screen that grants exact alarms.
     *
     * <p>There is no in-app dialog for this one: it is a special app access, so
     * the only route is the Settings screen and the user has to come back by
     * themselves. Which is why the caller re-reads {@link #exactAlarmState} on
     * resume rather than trusting what it knew before leaving.
     *
     * <p>Falls back to the app's own details page if the phone has no such screen.
     * {@code ACTION_REQUEST_SCHEDULE_EXACT_ALARM} is documented from API 31, but an
     * OEM build that has stripped it would otherwise throw
     * {@code ActivityNotFoundException} out of a button that promises to fix
     * something.
     */
    @PluginMethod
    public void requestExactAlarm(final PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            call.resolve();
            return;
        }
        final android.net.Uri self =
                android.net.Uri.parse("package:" + getContext().getPackageName());
        try {
            final android.content.Intent ask =
                    new android.content.Intent(
                            android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, self);
            ask.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(ask);
            call.resolve();
        } catch (final Exception e) {
            try {
                final android.content.Intent details =
                        new android.content.Intent(
                                android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, self);
                details.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(details);
                call.resolve();
            } catch (final Exception fallback) {
                call.reject("could not open the alarm permission screen: " + fallback.getMessage());
            }
        }
    }

    @PluginMethod
    public void stopBackgroundSync(final PluginCall call) {
        getContext()
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .edit()
                .putBoolean(HelioSyncService.KEY_ENABLED, false)
                .apply();
        HelioSyncService.stop(getContext());
        call.resolve();
    }

    /** Hands over everything the background service cached, and clears it. */
    @PluginMethod
    public void drainCache(final PluginCall call) {
        try {
            final org.json.JSONObject drained = HelioCache.drain(getContext());
            final JSObject result = new JSObject();
            result.put("samples", drained.getJSONArray("samples"));
            result.put("sessions", drained.getJSONArray("sessions"));
            result.put("workouts", drained.getJSONArray("workouts"));
            // When the SERVICE last talked to the strap, which the app has no
            // other way of knowing. Its own lastSyncAt only moves when it syncs
            // or when a drain brings something back, so a background run that
            // found nothing new was invisible to it - and the shade, which reads
            // the service's figure, would sit hours ahead of the app's.
            result.put(
                    "serviceSyncedAt",
                    getContext()
                            .getSharedPreferences(
                                    HelioSyncService.PREFS,
                                    android.content.Context.MODE_PRIVATE)
                            .getLong(HelioSyncService.KEY_LAST_SYNC, 0));
            call.resolve(result);
        } catch (final Exception e) {
            call.reject("could not drain cache: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnect(final PluginCall call) {
        closeLink();
        call.resolve();
    }
}
