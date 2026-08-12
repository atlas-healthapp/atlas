package io.github.atlashealthapp.atlas.ble;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.view.View;
import android.widget.RemoteViews;

import androidx.annotation.Nullable;

import io.github.atlashealthapp.atlas.MainActivity;
import io.github.atlashealthapp.atlas.R;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

/**
 * Keeps the band's data flowing while Atlas is closed.
 *
 * Runs as a foreground service because that is the only way Android reliably
 * permits periodic Bluetooth work: a plain background service is killed within
 * minutes, and WorkManager jobs are deferred under Doze precisely when a
 * long-idle phone most needs a sync. The cost is a permanent low-priority
 * notification, which is the same bargain Gadgetbridge makes.
 *
 * The service never touches app storage. It fetches, parks the result in
 * {@link HelioCache}, and lets the WebView ingest it on next launch, because
 * IndexedDB does not exist outside the WebView.
 */
public class HelioSyncService extends Service {

    /**
     * v2 because Android will not let an existing channel's importance be raised
     * in code - once created, that setting belongs to the user. The original
     * channel sat at IMPORTANCE_MIN, which minimises the notification to a single
     * grey line at the bottom of the shade and keeps it off the lock screen, so
     * the custom layout was mostly never seen. LOW is still silent: no sound, no
     * vibration, no heads-up, only a status bar icon.
     */
    private static final String CHANNEL_STATUS = "helio_status_v2";
    private static final String CHANNEL_STATUS_LEGACY = "helio_status";
    private static final String CHANNEL_BATTERY = "helio_battery";
    private static final String CHANNEL_SESSION = "helio_session";
    private static final int NOTIFICATION_ID = 4711;
    private static final int NOTIFICATION_ID_BATTERY = 4712;
    private static final int NOTIFICATION_ID_SESSION = 4713;

    /**
     * Alert below this, clear above the higher one. The gap is deliberate: a
     * strap sitting at exactly the threshold drifts a percent either way between
     * syncs, and without hysteresis that would re-alert every half hour.
     */
    private static final int BATTERY_ALERT_AT = 20;
    private static final int BATTERY_CLEAR_AT = 25;

    /** Long enough to be kind to the battery, short enough that a day's data never piles up. */
    private static final long INTERVAL_MS = 30 * 60 * 1000L;

    /** Each run only needs the gap since the last one, plus slack for a missed run. */
    private static final int SYNC_DAYS = 2;

    static final String PREFS = "helio";
    static final String KEY_AUTH = "auth_key";
    static final String KEY_ENABLED = "background_enabled";
    static final String KEY_LAST_SYNC = "last_sync";
    static final String KEY_LAST_BATTERY = "last_battery";
    static final String KEY_BATTERY_ALERTED = "battery_alerted";
    /**
     * The newest workout start this service has already told you about. Only
     * ever moves forward, so a re-fetch of the same session - and the service
     * refetches the last {@link #SYNC_DAYS} days on every run - cannot announce
     * it twice.
     */
    static final String KEY_LAST_SESSION_SEEN = "last_session_seen";

    /**
     * Set the moment an alarm-window booking has to fall back to an inexact
     * alarm, so the app can say the smart alarm cannot work rather than letting
     * it fail again in the night with nothing to show for it.
     */
    static final String KEY_EXACT_REFUSED = "alarm_exact_refused";

    /** When this service woke, and what it decided. See {@link #trail}. */
    static final String KEY_TRAIL = "alarm_trail";

    /**
     * Two nights of ordinary half-hourly ticks, plus the window's own checks.
     * Sized so a morning's reading still has the whole night above it.
     */
    private static final int TRAIL_MAX = 120;

    /** Redraw the notification from a freshly published summary. Never starts the service. */
    private static final String ACTION_REFRESH = "io.github.atlashealthapp.atlas.REFRESH_NOTIFICATION";
    /** A booked run arriving back from AlarmManager rather than from the handler. */
    private static final String ACTION_TICK = "io.github.atlashealthapp.atlas.SYNC_TICK";
    private static final int TICK_REQUEST = 4101;

    /**
     * Whether the service is alive, so a redraw request from the app can be
     * dropped rather than starting it. Static because the caller is the plugin,
     * which has no handle on the instance.
     */
    private static volatile boolean running;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private HelioLink link;
    private boolean syncing;

    private final List<HelioFetch.Sample> samples = new ArrayList<>();
    private final List<byte[]> sleepSessions = new ArrayList<>();
    private final List<HelioFetch.Workout> workouts = new ArrayList<>();

    public static void start(final Context context) {
        final Intent intent = new Intent(context, HelioSyncService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(final Context context) {
        context.stopService(new Intent(context, HelioSyncService.class));
    }

    /**
     * Redraw the notification because the app has published fresher numbers.
     *
     * The service can only render what the WebView last mirrored into
     * SharedPreferences, and it has no way to notice a write. Without this, a
     * sync done inside the app updated the summary and the shade went on showing
     * whatever the last *background* run had produced, which is how the shade
     * ended up an hour behind the screen it mirrors.
     *
     * Does nothing when the service is not running: this is a redraw, and it must
     * never be the thing that starts a foreground service.
     */
    public static void refreshNotification(final Context context) {
        if (!running) {
            return;
        }
        context.startService(new Intent(context, HelioSyncService.class).setAction(ACTION_REFRESH));
    }

    @Nullable
    @Override
    public IBinder onBind(final Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
        // Asked once at startup rather than discovered from a thrown exception
        // in the middle of the night. A revoked permission is the difference
        // between the smart alarm working and it silently not, and the app can
        // only say so if something has looked.
        final boolean exact = canBeExact();
        prefs().edit().putBoolean(KEY_EXACT_REFUSED, !exact).apply();
        trail(System.currentTimeMillis(), "service start exact=" + (exact ? 1 : 0));
        handler.post(tick);
    }

    @Override
    public int onStartCommand(final Intent intent, final int flags, final int startId) {
        if (intent != null && ACTION_REFRESH.equals(intent.getAction())) {
            updateNotification();
            return START_STICKY;
        }
        // A booked run arriving from AlarmManager. This is the normal path for
        // every tick after the first, and the only one that survives the phone
        // being asleep.
        if (intent != null && ACTION_TICK.equals(intent.getAction())) {
            handler.post(tick);
            return START_STICKY;
        }
        // Restarted by the system after being killed: pick the schedule back up
        // rather than sitting idle until the user next opens the app.
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        // Or a booked run restarts the service after it was deliberately stopped.
        final AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (am != null) cancelScheduled(am);
        if (link != null) {
            link.disconnect();
            link = null;
        }
        super.onDestroy();
    }

    /**
     * Re-read every tick rather than captured once, so turning the probe on does
     * not need the service restarted: the next ordinary run picks up the shorter
     * interval by itself.
     */
    private long interval() {
        // Inside a smart alarm's window the checks come closer together, but no
        // closer than SmartAlarm.CHECK_INTERVAL_MS. That figure is measured, not
        // chosen: checking more often finds the first light reading sooner and
        // therefore wakes you EARLIER, which is worse rather than better. See
        // src/utils/smartAlarm.js for the three nights it came from.
        final long now = System.currentTimeMillis();
        if (SmartAlarm.insideWindow(prefs(), now)) {
            return SmartAlarm.CHECK_INTERVAL_MS;
        }

        final long ordinary =
                SleepProbe.enabled(prefs()) ? SleepProbe.INTERVAL_MS : INTERVAL_MS;

        // Wake exactly when the window opens if the ordinary interval would step
        // straight over it. Without this the whole feature can silently never
        // run: a tick at 06:53 books itself for 07:23, and a 07:20 alarm has
        // been and gone by then. It is not enough to shorten the interval once
        // inside the window, because nothing arrives inside it to notice.
        final long untilWindow = SmartAlarm.millisUntilWindow(prefs(), now);
        if (untilWindow > 0 && untilWindow < ordinary) {
            // A few seconds past the boundary rather than exactly on it, so a
            // slow handler cannot land a hair early and read as outside.
            return untilWindow + 5_000L;
        }
        return ordinary;
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            runSync();
            scheduleNext(interval());
        }
    };

    /**
     * Book the next run so that it actually happens.
     *
     * <p><b>A Handler cannot do this and never could.</b> {@code postDelayed}
     * counts in {@link android.os.SystemClock#uptimeMillis()}, which <b>stops
     * advancing while the device is in deep sleep</b>. With the phone on a
     * bedside table all night the timer is paused for most of it, so a delay of
     * thirty minutes takes however long it takes and the twenty-minute alarm
     * window is simply stepped over. Measured twice: on 2026-08-11 the last sync
     * of the night was 07:23 against a 07:20 alarm, and on 2026-08-12 it was
     * 08:45:25 against an 08:45 alarm. Both times the lookahead had computed the
     * right moment and nothing woke up to use it. It is also the most likely
     * explanation for the 39-63 minute holes the sleep probe measured in its own
     * cadence while the phone idled.
     *
     * <p>So the clock has to be {@link AlarmManager}, which counts real time and
     * can fire in Doze:
     *
     * <ul>
     *   <li><b>The alarm window uses {@code setAlarmClock}</b>, which is exempt
     *       from Doze entirely and needs no exact-alarm permission, because this
     *       genuinely is an alarm clock. Nothing else in Atlas earns that.
     *   <li><b>Every other tick uses {@code setAndAllowWhileIdle}</b>, which the
     *       system may still coalesce and rate-limit, but which does at least
     *       fire while the phone is asleep. An ordinary sync being a few minutes
     *       late costs nothing; being skipped for six hours costs a night of
     *       readings.
     * </ul>
     *
     * <p>The handler is kept only for the immediate first run at startup, where
     * the device is by definition awake.
     */
    private void scheduleNext(final long delayMs) {
        final AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (am == null) {
            // Nothing else can keep time here. Better a handler that pauses in
            // deep sleep than no schedule at all.
            handler.postDelayed(tick, delayMs);
            return;
        }
        final long now = System.currentTimeMillis();
        final long at = now + delayMs;
        cancelScheduled(am);
        // Whether THIS booking is one of the alarm's own, rather than whether an
        // alarm exists at all: an ordinary tick hours earlier must not claim the
        // alarm-clock exemption.
        //
        // Two cases, and the second was missing until 2026-08-12. The booking
        // that OPENS the window is the one whose delay lands on it. But every
        // check INSIDE the window is equally load-bearing and
        // millisUntilWindow returns -1 once the window is open, so those were
        // all falling through to the inexact branch. With a 20 minute window
        // and 10 minute checks that left exactly one usable check a night, and
        // an inexact alarm carrying a 22 minute window can miss even that.
        final long untilWindow = SmartAlarm.millisUntilWindow(prefs(), now);
        final boolean forWindow =
                SmartAlarm.watching(prefs())
                        && (SmartAlarm.insideWindow(prefs(), now)
                                || (untilWindow > 0 && delayMs <= untilWindow + 10_000L));
        boolean exact = false;
        try {
            if (forWindow) {
                am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, tickIntent()), tickIntent());
                exact = true;
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, tickIntent());
            }
        } catch (final SecurityException e) {
            // The permission is missing or has been revoked, or an OEM build
            // refuses the alarm-clock slot. An inexact wake is still far better
            // than a handler that stops with the CPU, but it is NOT good enough
            // for the alarm, so it is recorded rather than swallowed: this
            // failing silently is what made two mornings unexplainable.
            android.util.Log.w("HelioBle", "[bg] exact alarm refused, falling back: " + e);
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, tickIntent());
        }
        if (forWindow && !exact) {
            prefs().edit().putBoolean(KEY_EXACT_REFUSED, true).apply();
        }
        trail(now, (forWindow ? (exact ? "WINDOW-exact" : "WINDOW-INEXACT") : "tick")
                + " next=" + stamp(at));
    }

    /**
     * Whether this build is allowed to book an exact alarm at all.
     *
     * <p>Checked rather than inferred from a thrown exception, so the answer is
     * available before the night rather than after it.
     */
    boolean canBeExact() {
        final AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
        if (am == null) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        return am.canScheduleExactAlarms();
    }

    /**
     * To the second, unlike {@link #clock}, which sets the notification and
     * wants the tidier form. Seconds are the whole point here: on 2026-08-12
     * the last sync of the night landed at 08:45:25 against an 08:45 alarm, and
     * at minute resolution that reads as having been on time.
     */
    private static String stamp(final long millis) {
        final Calendar c = Calendar.getInstance();
        c.setTimeInMillis(millis);
        return String.format(
                Locale.UK,
                "%02d:%02d:%02d",
                c.get(Calendar.HOUR_OF_DAY),
                c.get(Calendar.MINUTE),
                c.get(Calendar.SECOND));
    }

    /**
     * A short record of when this service actually woke up, and what it found.
     *
     * <p><b>This exists because two failed alarm nights left nothing to reason
     * from but a single {@code last_sync} timestamp</b>, which cannot tell a
     * tick that never happened from one that happened and decided not to fire.
     * Newest last, capped, and deliberately in SharedPreferences rather than a
     * file so it can be read with one {@code run-as cat} the morning after.
     */
    private void trail(final long now, final String what) {
        try {
            final String existing = prefs().getString(KEY_TRAIL, "");
            final String[] parts = existing.isEmpty() ? new String[0] : existing.split(";");
            final StringBuilder out = new StringBuilder();
            final int drop = Math.max(0, parts.length + 1 - TRAIL_MAX);
            for (int i = drop; i < parts.length; i++) {
                out.append(parts[i]).append(';');
            }
            out.append(stamp(now)).append(' ').append(what);
            prefs().edit().putString(KEY_TRAIL, out.toString()).apply();
        } catch (final Exception ignored) {
            // A diagnostic must never be the thing that breaks the sync.
        }
    }

    private PendingIntent tickIntent() {
        final Intent intent = new Intent(this, HelioSyncService.class).setAction(ACTION_TICK);
        return PendingIntent.getService(
                this,
                TICK_REQUEST,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void cancelScheduled(final AlarmManager am) {
        try {
            am.cancel(tickIntent());
        } catch (final Exception ignored) {
            // Cancelling something that was never booked is not a failure.
        }
    }

    /**
     * Wake early, if this is the moment.
     *
     * <p>Overwrites the same slot the app wrote, with a time a couple of minutes
     * out to allow for the connect. That is the transactional part and it is
     * what makes failure safe: if the write lands, the early wake happens and
     * the original time is gone because it was replaced. <b>If it does not land,
     * the slot still holds the original time</b> and the user simply gets their
     * normal alarm.
     *
     * <p>Once a night, guarded by a day key, because a second write after the
     * first has already buzzed would be a second alarm.
     */
    private void maybeWakeEarly() {
        final long now = System.currentTimeMillis();
        // Recorded before the decision, and only inside the window, so the
        // morning after can tell "nothing woke up" from "it woke up and the
        // band had nothing to say" from "it woke up and you were in deep".
        // Those are three different faults and last_sync alone names none.
        if (SmartAlarm.insideWindow(prefs(), now)) {
            trail(now, "in-window stage=" + SmartAlarm.currentStage(sleepSessions, now)
                    + " sessions=" + sleepSessions.size());
        }
        if (!SmartAlarm.shouldWakeNow(prefs(), sleepSessions, now)) return;

        final Calendar at = Calendar.getInstance();
        at.setTimeInMillis(now + SmartAlarm.FIRE_LEAD_MINUTES * 60_000L);

        try {
            final byte[] payload =
                    HelioAlarm.create(
                            0,
                            at.get(Calendar.HOUR_OF_DAY),
                            at.get(Calendar.MINUTE),
                            true,
                            false,
                            HelioAlarm.REPEAT_ONCE);
            // Marked before the write rather than after. A write that half
            // succeeds must not leave the window armed for another attempt ten
            // minutes later, which would be a second buzz.
            SmartAlarm.markFired(prefs(), now);
            trail(now, "FIRING at " + stamp(at.getTimeInMillis()));
            if (link != null) link.connectForAlarm(payload);
        } catch (final Exception e) {
            // Nothing to recover: the strap keeps the time already on it.
            trail(now, "FIRE FAILED " + e);
        }
    }

    /**
     * Move an "N hours after you fall asleep" alarm onto its real time.
     *
     * <p>Once a night, and never before 02:00: the band revises its idea of when
     * sleep began, sometimes by more than two hours, and an alarm written from
     * an unsettled onset is an alarm written wrong. Capped by the latest time
     * the user set, which the strap is already holding, so a failure here leaves
     * that cap in place rather than leaving them unwoken.
     */
    private void maybeRetimeOnset() {
        final long now = System.currentTimeMillis();
        final long target = SmartAlarm.onsetTarget(prefs(), sleepSessions, now);
        if (target < 0) return;

        final Calendar at = Calendar.getInstance();
        at.setTimeInMillis(target);
        try {
            final byte[] payload =
                    HelioAlarm.create(
                            0,
                            at.get(Calendar.HOUR_OF_DAY),
                            at.get(Calendar.MINUTE),
                            true,
                            false,
                            HelioAlarm.REPEAT_ONCE);
            SmartAlarm.markRetimed(prefs(), now);
            if (link != null) link.connectForAlarm(payload);
        } catch (final Exception e) {
            // The cap the user set is still on the strap. Nothing to recover.
        }
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    /**
     * Today's numbers as the app last published them.
     *
     * Nothing here can be computed natively: habits live in the WebView's
     * localStorage and the samples live in IndexedDB, and this service runs
     * while there may be no WebView at all. So the app mirrors a small summary
     * into Capacitor's own SharedPreferences group and this only renders it.
     * Returns null whenever the mirror is missing or unreadable, and the
     * notification falls back to what the service knows by itself.
     */
    @Nullable
    private JSONObject summary() {
        try {
            final String raw = getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                    .getString("atlas_summary_native", null);
            return raw == null ? null : new JSONObject(raw);
        } catch (final Exception e) {
            return null;
        }
    }

    /** A JSON field the app may legitimately have sent as null. */
    @Nullable
    private static String str(final JSONObject json, final String key) {
        final String value = json.optString(key, "");
        return value.isEmpty() || "null".equals(value) ? null : value;
    }

    private void runSync() {
        if (syncing) {
            return;
        }
        // The foreground plugin holds its own separate HelioLink, invisible to
        // this service. Skipping this tick (rather than connecting anyway) is
        // enough - the next interval retries, and a foreground sync already in
        // progress is not lost by waiting for it.
        if (HelioLink.isLinkActive()) {
            android.util.Log.i("HelioBle", "[bg] skipping tick, link already in use");
            return;
        }
        final String authKey = prefs().getString(KEY_AUTH, null);
        if (authKey == null || authKey.isEmpty()) {
            return;
        }
        final byte[] key;
        try {
            key = HelioBlePlugin.parseAuthKey(authKey);
        } catch (final IllegalArgumentException e) {
            return;
        }

        syncing = true;
        samples.clear();
        sleepSessions.clear();
        workouts.clear();

        link = new HelioLink(this, new HelioLink.Listener() {
            @Override
            public void onLog(final String message) {
                android.util.Log.i("HelioBle", "[bg] " + message);
            }

            @Override
            public void onReady() {
            }

            @Override
            public void onAuthResult(final boolean success, final String detail) {
                if (!success) {
                    finish();
                }
            }

            @Override
            public void onBattery(final int levelPercent, final boolean charging) {
                prefs().edit().putInt(KEY_LAST_BATTERY, levelPercent).apply();
                // **Recorded as a sample, not just as the latest figure.** Only
                // the current percentage was ever kept, so the discharge curve was
                // overwritten every half hour and "how many days is it lasting"
                // could not be answered at all. Riding in the same cache the real
                // metrics use means it inherits the ingest path, the watermarks
                // and the retention for free.
                //
                // Charging rides as a second series rather than a flag on the
                // first, because a sample is {metric, t, v} all the way through to
                // IndexedDB and there is nowhere to put a third field. The reader
                // only needs to know a charge HAPPENED, which a 1 here says.
                samples.add(new HelioFetch.Sample("strapBattery", System.currentTimeMillis(),
                        levelPercent));
                if (charging) {
                    samples.add(new HelioFetch.Sample("strapCharging",
                            System.currentTimeMillis(), 1));
                }
                updateNotification();
                checkBattery(levelPercent, charging);
            }

            @Override
            public void onSleepSessions(final List<byte[]> sessions) {
                sleepSessions.addAll(sessions);
            }

            @Override
            public void onWorkouts(final List<HelioFetch.Workout> newWorkouts) {
                workouts.addAll(newWorkouts);
            }

            @Override
            public void onSamples(final List<HelioFetch.Sample> newSamples) {
                samples.addAll(newSamples);
            }

            @Override
            public void onHeartRate(final int bpm) {
                // Live mode is a foreground-only feature; the background service
                // never asks for it and would have nowhere to put it.
            }

            @Override
            public void onFetchComplete() {
                prefs().edit().putLong(KEY_LAST_SYNC, System.currentTimeMillis()).apply();
                finish();
            }

            @Override
            public void onClosed(final String reason) {
                // A close before the fetch completes still leaves whatever
                // arrived worth keeping, so it is cached rather than dropped.
                finish();
            }
        }, key);

        link.connect(SYNC_DAYS);
    }

    private void finish() {
        if (!syncing) {
            return;
        }
        syncing = false;
        // Before the cache, and outside its try: the probe is measuring what the
        // band handed over on this run, and a caching failure would otherwise
        // lose the observation along with the data.
        maybeRetimeOnset();
        maybeWakeEarly();

        if (SleepProbe.enabled(prefs())) {
            SleepProbe.record(this, System.currentTimeMillis(), sleepSessions);
        }
        try {
            HelioCache.store(this, samples, sleepSessions, workouts);
        } catch (final Exception e) {
            android.util.Log.w("HelioBle", "[bg] could not cache samples: " + e);
        }
        // After caching, so a session is announced only once it is parked
        // somewhere the app will actually find it. Announcing first and then
        // failing to store would point at a session that is not there.
        try {
            announceSessions();
        } catch (final Exception e) {
            android.util.Log.w("HelioBle", "[bg] could not announce session: " + e);
        }
        samples.clear();
        sleepSessions.clear();
        workouts.clear();
        if (link != null) {
            link.disconnect();
            link = null;
        }
        updateNotification();
    }

    /**
     * Say that a session has landed.
     *
     * The band publishes a workout on its own schedule, up to about 45 minutes
     * after it ends, and Atlas only reads. Measured 2026-08-04: a session ending
     * 20:31 was absent from a completed sync at 20:43 and present at 21:17. So
     * the only way to know it has arrived is to re-sync and look, which is the
     * thing this replaces.
     *
     * **The first run never announces.** Without that, installing the app or
     * clearing its data would fire a notification for whatever the band still
     * holds, which is a session from days ago presented as news. The watermark
     * is seeded silently instead.
     *
     * Known gap: the app's own foreground syncs fetch workouts too and this
     * service cannot see them, so a session first collected in-app is still
     * announced here later. Closing that needs the app to publish its newest
     * workout start in the summary and this to take it as a floor.
     */
    private void announceSessions() {
        if (workouts.isEmpty()) {
            return;
        }

        long newest = 0;
        HelioFetch.Workout latest = null;
        int landed = 0;
        final long seen = prefs().getLong(KEY_LAST_SESSION_SEEN, 0);

        for (final HelioFetch.Workout w : workouts) {
            if (w.startMillis > newest) {
                newest = w.startMillis;
            }
            if (w.startMillis > seen) {
                landed++;
                if (latest == null || w.startMillis > latest.startMillis) {
                    latest = w;
                }
            }
        }

        if (newest <= seen) {
            return;
        }
        prefs().edit().putLong(KEY_LAST_SESSION_SEEN, newest).apply();

        // Seeding run: the watermark is now set, and nothing is claimed to be new.
        if (seen == 0 || latest == null) {
            return;
        }

        final PendingIntent open = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        final String title = landed > 1 ? landed + " sessions landed" : "Session landed";

        getSystemService(NotificationManager.class).notify(
                NOTIFICATION_ID_SESSION,
                new Notification.Builder(this, CHANNEL_SESSION)
                        .setContentTitle(title)
                        .setContentText(sessionLine(latest))
                        .setSmallIcon(R.mipmap.ic_launcher)
                        .setContentIntent(open)
                        .setAutoCancel(true)
                        .build());
    }

    /** "17:33-20:31 · 2h 58m · tap to name it" */
    private String sessionLine(final HelioFetch.Workout w) {
        final StringBuilder line = new StringBuilder();
        line.append(clock(w.startMillis));
        if (w.endMillis > w.startMillis) {
            line.append('-').append(clock(w.endMillis));
        }

        // The band's own active time, which excludes the pauses it decided you
        // had stopped for, so it can read shorter than the span above. That is
        // the figure FITNESS shows, and the notification agreeing with the app
        // matters more than the two numbers looking consistent with each other.
        if (w.activeSeconds != null && w.activeSeconds > 0) {
            final int minutes = w.activeSeconds / 60;
            line.append(" · ");
            if (minutes >= 60) {
                line.append(minutes / 60).append("h ").append(minutes % 60).append('m');
            } else {
                line.append(minutes).append('m');
            }
        }

        line.append(" · tap to name it");
        return line.toString();
    }

    private String clock(final long millis) {
        final java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(millis);
        return String.format(Locale.UK, "%02d:%02d",
                c.get(java.util.Calendar.HOUR_OF_DAY), c.get(java.util.Calendar.MINUTE));
    }

    /**
     * Alert once per discharge, not once per sync. Charging clears the flag too,
     * so putting the strap on the charger arms the next warning even if it never
     * makes it past the clear threshold.
     */
    private void checkBattery(final int level, final boolean charging) {
        final boolean alerted = prefs().getBoolean(KEY_BATTERY_ALERTED, false);

        if (charging || level >= BATTERY_CLEAR_AT) {
            if (alerted) {
                prefs().edit().putBoolean(KEY_BATTERY_ALERTED, false).apply();
                getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID_BATTERY);
            }
            return;
        }
        if (level > BATTERY_ALERT_AT || alerted) {
            return;
        }

        prefs().edit().putBoolean(KEY_BATTERY_ALERTED, true).apply();

        final PendingIntent open = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        getSystemService(NotificationManager.class).notify(
                NOTIFICATION_ID_BATTERY,
                new Notification.Builder(this, CHANNEL_BATTERY)
                        .setContentTitle("Strap battery low")
                        .setContentText(level + "% left. Charge it before tonight to keep sleep tracking.")
                        .setSmallIcon(R.mipmap.ic_launcher)
                        .setContentIntent(open)
                        .setAutoCancel(true)
                        .build());
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        // The MIN channel would otherwise sit in system settings forever as a
        // second "Strap sync" entry that controls nothing.
        getSystemService(NotificationManager.class)
                .deleteNotificationChannel(CHANNEL_STATUS_LEGACY);

        final NotificationChannel channel = new NotificationChannel(
                CHANNEL_STATUS, "Strap sync", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Keeps Atlas reading the strap while it is closed");
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);

        // Separate channel so the low-battery warning can actually be seen
        // without the always-present status notification being intrusive. Two
        // channels also lets either be silenced independently in system settings.
        final NotificationChannel battery = new NotificationChannel(
                CHANNEL_BATTERY, "Strap battery", NotificationManager.IMPORTANCE_DEFAULT);
        battery.setDescription("Warns when the strap is about to run out");
        getSystemService(NotificationManager.class).createNotificationChannel(battery);

        // Its own channel rather than a line on the status notification: the
        // status one is always there, and a silent line on a permanent
        // notification is the thing you stop reading. DEFAULT so it makes a
        // sound and peeks, since the whole point is not having to go and look.
        final NotificationChannel session = new NotificationChannel(
                CHANNEL_SESSION, "Sessions", NotificationManager.IMPORTANCE_DEFAULT);
        session.setDescription("Tells you when a workout from the strap has arrived");
        getSystemService(NotificationManager.class).createNotificationChannel(session);
    }

    private Notification buildNotification() {
        final JSONObject summary = summary();

        // Two things sync the strap and each only knows about its own runs: this
        // service, and the app over its own BLE link. Whichever ran later is the
        // truth, or a pull-to-refresh at 20:10 leaves the shade insisting on the
        // background run at 19:51. The battery rides with it, since a reading is
        // only as current as the sync that took it.
        final long serviceSync = prefs().getLong(KEY_LAST_SYNC, 0);
        final int serviceBattery = prefs().getInt(KEY_LAST_BATTERY, -1);
        final long appSync = summary == null || summary.isNull("syncedAt")
                ? 0 : summary.optLong("syncedAt");
        final int appBattery = summary == null || summary.isNull("strapBattery")
                ? -1 : summary.optInt("strapBattery");
        final boolean appIsNewer = appSync > serviceSync;

        final long last = appIsNewer ? appSync : serviceSync;
        final int battery = appIsNewer && appBattery >= 0 ? appBattery : serviceBattery;

        // The service's own line: what it knows without the app's help. Always
        // built, because it is the fallback and it is also the last line of the
        // expanded view.
        final StringBuilder status = new StringBuilder();
        if (battery >= 0) {
            status.append("Strap ").append(battery).append("%");
        }
        if (last > 0) {
            if (status.length() > 0) {
                status.append(" · ");
            }
            status.append("synced ").append(String.format(Locale.getDefault(), "%tR", last));
        }
        if (status.length() == 0) {
            status.append("Waiting for first sync");
        }

        String title = "Atlas";
        String text = status.toString();
        String expanded = null;

        if (summary != null) {
            // Title is the day at a glance: the two numbers that move most.
            final StringBuilder head = new StringBuilder();
            if (!summary.isNull("steps")) {
                head.append(String.format(Locale.getDefault(), "%,d steps", summary.optLong("steps")));
            }
            final int due = summary.optInt("routineDue", 0);
            if (due > 0) {
                if (head.length() > 0) {
                    head.append(" · ");
                }
                head.append("routine ").append(summary.optInt("routineDone", 0)).append("/").append(due);
            }
            if (head.length() > 0) {
                title = head.toString();
            }

            final StringBuilder body = new StringBuilder();
            if (!summary.isNull("recovery")) {
                body.append("Recovery ").append(summary.optInt("recovery"));
            }
            if (!summary.isNull("protein") && !summary.isNull("proteinGoal")) {
                if (body.length() > 0) {
                    body.append(" · ");
                }
                body.append("protein ").append(summary.optInt("protein"))
                        .append("/").append(summary.optInt("proteinGoal")).append("g");
            }
            if (body.length() > 0) {
                text = body.toString();
            }

            // Expanded adds what does not fit on one line: what you are up to,
            // last night's sleep, and the strap status the collapsed view gave
            // up to make room.
            final StringBuilder more = new StringBuilder(text);
            final String next = str(summary, "nextHabit");
            if (next != null) {
                more.append("\nNext · ").append(next);
            }
            final String sleep = str(summary, "sleepText");
            if (sleep != null) {
                // "Sleep", not "Slept": every other row in the shade names the
                // thing being reported rather than narrating it, and this one
                // sat under a labelled SLEEP row in the collapsed view.
                more.append("\nSleep ").append(sleep);
            }
            more.append("\n").append(status);
            expanded = more.toString();
        }

        final PendingIntent open = PendingIntent.getActivity(
                this, 0, new Intent(this, MainActivity.class),
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        final Notification.Builder builder = new Notification.Builder(this, CHANNEL_STATUS)
                .setContentTitle(title)
                .setContentText(text)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(open)
                .setOngoing(true)
                .setShowWhen(false);

        if (summary != null) {
            // The marks. Title and text above are kept regardless: they are what
            // a surface that ignores custom views falls back to, and what an
            // accessibility service reads if it cannot walk the layout.
            builder.setStyle(new Notification.DecoratedCustomViewStyle())
                    .setCustomContentView(collapsedView(summary))
                    .setCustomBigContentView(expandedView(summary, status.toString()));
        } else if (expanded != null) {
            builder.setStyle(new Notification.BigTextStyle().bigText(expanded));
        }

        return builder.build();
    }

    /**
     * A bar fill as the app published it, or -1 when it withheld one.
     *
     * Withheld and zero are different states and must stay different here: a
     * full-width empty track says the day went badly, and "no reading yet" is
     * not a bad day. The app does the division (see utils/nativeSummary.js);
     * this side never computes a percentage, or the shade and the screen end up
     * rounding differently.
     */
    private static int fill(final JSONObject summary, final String key) {
        return summary.isNull(key) ? -1 : summary.optInt(key, -1);
    }

    /** Draws one bar and its figure, hiding the track entirely when withheld. */
    private static void mark(final RemoteViews views, final int barId, final int valueId,
                             final int pct, @Nullable final String value) {
        if (pct < 0) {
            views.setViewVisibility(barId, View.INVISIBLE);
        } else {
            views.setViewVisibility(barId, View.VISIBLE);
            views.setProgressBar(barId, 100, pct, false);
        }
        views.setTextViewText(valueId, value == null ? "--" : value);
    }

    /**
     * The collapsed strip: four marks, no labels. Roughly 48dp of custom content
     * is all Android 12+ gives a collapsed notification, so this drops the words
     * rather than dropping metrics. The order is fixed and matches Home's dials,
     * which is what makes it readable by position.
     */
    private RemoteViews collapsedView(final JSONObject summary) {
        final RemoteViews views = new RemoteViews(getPackageName(), R.layout.notif_collapsed);

        mark(views, R.id.bar_recovery, R.id.val_recovery, fill(summary, "recoveryPct"),
                summary.isNull("recovery") ? null : String.valueOf(summary.optInt("recovery")));

        mark(views, R.id.bar_sleep, R.id.val_sleep, fill(summary, "sleepPct"),
                str(summary, "sleepText"));

        final int due = summary.optInt("routineDue", 0);
        mark(views, R.id.bar_routine, R.id.val_routine, fill(summary, "routinePct"),
                due > 0 ? summary.optInt("routineDone", 0) + "/" + due : null);

        mark(views, R.id.bar_protein, R.id.val_protein, fill(summary, "proteinPct"),
                summary.isNull("protein") ? null : summary.optInt("protein") + "g");

        return views;
    }

    /** The rows: the same four named, plus steps, plus the footer. */
    private RemoteViews expandedView(final JSONObject summary, final String status) {
        final RemoteViews views = new RemoteViews(getPackageName(), R.layout.notif_expanded);

        String recovery = null;
        if (!summary.isNull("recovery")) {
            final String band = str(summary, "recoveryBand");
            recovery = summary.optInt("recovery") + (band == null ? "" : " " + band);
        }
        mark(views, R.id.row_bar_recovery, R.id.row_val_recovery, fill(summary, "recoveryPct"), recovery);

        mark(views, R.id.row_bar_sleep, R.id.row_val_sleep, fill(summary, "sleepPct"),
                str(summary, "sleepText"));

        mark(views, R.id.row_bar_protein, R.id.row_val_protein, fill(summary, "proteinPct"),
                summary.isNull("protein") || summary.isNull("proteinGoal")
                        ? null
                        : summary.optInt("protein") + " / " + summary.optInt("proteinGoal"));

        mark(views, R.id.row_bar_steps, R.id.row_val_steps, fill(summary, "stepsPct"),
                summary.isNull("steps")
                        ? null
                        : String.format(Locale.getDefault(), "%,d", summary.optLong("steps")));

        // The routine keeps its dots. Nine things you have to do is not a
        // proportion, and which ones are empty is the part worth seeing.
        final int due = summary.optInt("routineDue", 0);
        final int done = summary.optInt("routineDone", 0);
        for (int i = 0; i < DOT_IDS.length; i++) {
            if (i >= due) {
                views.setViewVisibility(DOT_IDS[i], View.GONE);
            } else {
                views.setViewVisibility(DOT_IDS[i], View.VISIBLE);
                views.setImageViewResource(DOT_IDS[i],
                        i < done ? R.drawable.notif_dot_on : R.drawable.notif_dot_off);
            }
        }
        views.setTextViewText(R.id.row_val_routine, due > 0 ? done + " / " + due : "--");

        final String next = str(summary, "nextHabit");
        views.setTextViewText(R.id.foot_next, next == null ? "Routine done" : "Next up · " + next);
        views.setTextViewText(R.id.foot_status, status.toUpperCase(Locale.getDefault()));

        return views;
    }

    /** Nine, because that is what the routine holds and a tenth would be hidden anyway. */
    private static final int[] DOT_IDS = {
            R.id.dot_1, R.id.dot_2, R.id.dot_3, R.id.dot_4, R.id.dot_5,
            R.id.dot_6, R.id.dot_7, R.id.dot_8, R.id.dot_9,
    };

    private void updateNotification() {
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
    }
}
