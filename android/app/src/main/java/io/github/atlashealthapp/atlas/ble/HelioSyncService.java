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
    /**
     * The channel a session IN PROGRESS is posted on, and it exists for one
     * reason: the lock screen.
     *
     * <p>{@code CHANNEL_STATUS} is {@code IMPORTANCE_LOW}, and this file's own
     * note on it already records what that costs: LOW keeps a notification off
     * the lock screen. That is right for the day's figures, which are a thing you
     * go and look at. It is wrong for a running session, which is the one thing
     * here you want to see <i>without</i> unlocking, and it is what "there is no
     * notification on my lock screen" turned out to be.
     *
     * <p><b>DEFAULT, but silent and alert-once.</b> Raising importance normally
     * buys a sound and a heads-up peek, which on a notification re-posted after
     * every sync would beep at you every half hour for the whole session. So the
     * channel is created with no sound and no vibration, and the notification
     * carries {@code setOnlyAlertOnce}. What is bought is lock-screen presence
     * and nothing else.
     *
     * <p>A separate id from {@code CHANNEL_SESSION}, which announces a workout
     * the band has finished and legitimately does make a sound. Two different
     * events, two channels, so either can be silenced without the other.
     */
    private static final String CHANNEL_SESSION_LIVE = "helio_session_live";
    private static final int NOTIFICATION_ID = 4711;
    private static final int NOTIFICATION_ID_BATTERY = 4712;
    private static final int NOTIFICATION_ID_SESSION = 4713;
    private static final int NOTIFICATION_ID_SESSION_LIVE = 4714;

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

    public static final String PREFS = "helio";
    static final String KEY_AUTH = "auth_key";
    /**
     * The bonded device the user told us is their strap, by MAC address.
     *
     * <p><b>Why an address and not a better name match</b> (2026-08-19, from a
     * public report on 1.0.6). The reporter said their strap was connected and
     * syncing and that a serial number they could see matched theirs, while
     * Atlas said it was not paired. What the log actually establishes is only
     * this: five devices were bonded to that phone, four named as earbuds and
     * one named {@code ADMINISTRATOR}, and {@code matchesStrapName} rejected all
     * five.
     *
     * <p><b>Answered by the reporter on the same day: none of the five was the
     * strap.</b> {@code ADMINISTRATOR} is their laptop. So the strap was not
     * bonded to that phone at all, and no list built from
     * {@code getBondedDevices} could ever have shown it - which is why
     * {@code listBondedDevices} also reports what is merely <i>connected</i>. A
     * BLE device can hold a GATT connection having never been bonded, and that is
     * now the live hypothesis for a strap that plainly works while Atlas cannot
     * see it.
     *
     * <p>The address override still earns its place, and not only for that
     * reporter: it is the general answer to a strap Atlas cannot name, whatever
     * the reason. A name rule loose enough to catch an arbitrary name would also
     * match headphones, which is the one thing a Bluetooth connect must never do.
     *
     * <p>So the choice is handed to the person who can actually see the strap.
     * An address is stable, is what {@code connectGatt} wants anyway, and a wrong
     * pick costs a failed connect and another go. Empty until somebody chooses.
     */
    public static final String KEY_STRAP_ADDRESS = "strap_address";
    static final String KEY_ENABLED = "background_enabled";
    public static final String KEY_LAST_SYNC = "last_sync";
    static final String KEY_LAST_BATTERY = "last_battery";
    /**
     * The newest live reading and when it arrived.
     *
     * <p>Stored rather than held in a field because the notification is rebuilt
     * from prefs on paths that do not run through the listener, and because an
     * age is the only honest way to draw a reading that is not being refreshed:
     * the stream stops the moment the screen goes off, so a figure with no
     * timestamp beside it would silently become a claim about now.
     */
    public static final String KEY_LIVE_HR = "live_hr";
    public static final String KEY_LIVE_HR_AT = "live_hr_at";
    /**
     * Every live reading taken during the session in progress, as JSON.
     *
     * <p><b>The readings were being thrown away and that was the defect.</b> The
     * stream produces about one a second while the screen is on, and only the
     * newest was kept - so a session could be watched live on three surfaces and
     * then produce an empty recap, because the archive copy does not arrive until
     * the band hands its window over, which for a short session may be never.
     * Reported as exactly that: "if we're capturing live bpm to show in the shade,
     * why can't we show the graph at the end".
     *
     * <p>Thinned to one every {@link #TRAIL_MIN_GAP_MS} rather than kept whole:
     * a chart cannot resolve per-second detail, and this is a SharedPreferences
     * string re-read on every notification redraw.
     *
     * <p>Cleared when a session starts, never merged across two.
     */
    public static final String KEY_LIVE_TRAIL = "live_trail";
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
    /** The link held purely to stream heart rate, separate from the sync's own. */
    private HelioLink liveLink;
    /** Whether the screen is on, which is the only time a live stream is worth holding. */
    private boolean screenOn = true;

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

    /**
     * Sync now, asked for from outside the app.
     *
     * <p>Exists for the widget's refresh control, and it is only possible because
     * <b>syncing lives here rather than in the WebView</b>. The widget ticket
     * rules out anything that would need the preferences bridge to run both ways
     * and native to reach IndexedDB; this needs neither, because the service
     * already owns the whole BLE conversation and parks the result in the cache.
     *
     * <p>Starts the service first rather than assuming it is up: a widget outlives
     * the app, and the common case for pressing refresh is that nothing has run
     * for a while. {@code start} is the guarded path that picks
     * startForegroundService where required, which matters because a plain
     * background start throws on modern Android and would take the process down.
     */
    public static void syncNow(final Context context) {
        try {
            start(context);
            context.startService(
                    new Intent(context, HelioSyncService.class).setAction(ACTION_TICK));
        } catch (final Exception e) {
            // A refusal to start is not worth taking anything down for; the next
            // booked tick still runs.
        }
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
        // **Registered in code, not the manifest.** ACTION_SCREEN_ON and
        // ACTION_SCREEN_OFF cannot be received by a manifest-declared receiver
        // at all - Android delivers them only to registered ones - which is the
        // trap to know about before wondering why nothing fires.
        final android.content.IntentFilter screenFilter = new android.content.IntentFilter();
        screenFilter.addAction(Intent.ACTION_SCREEN_ON);
        screenFilter.addAction(Intent.ACTION_SCREEN_OFF);
        registerReceiver(screenReceiver, screenFilter);
        final android.os.PowerManager power = getSystemService(android.os.PowerManager.class);
        screenOn = power == null || power.isInteractive();
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

    /**
     * The screen going on or off is the whole of the live stream's schedule.
     *
     * <p>Nothing else needs to decide when to hold the radio: somebody looking
     * at their phone is exactly the condition under which a live reading is
     * worth anything, and the moment the screen goes off it is worth nothing at
     * all.
     */
    private final android.content.BroadcastReceiver screenReceiver =
            new android.content.BroadcastReceiver() {
                @Override
                public void onReceive(final android.content.Context context, final Intent intent) {
                    if (intent == null || intent.getAction() == null) return;
                    screenOn = Intent.ACTION_SCREEN_ON.equals(intent.getAction());
                    updateLiveStream();
                }
            };

    @Override
    public void onDestroy() {
        running = false;
        try {
            unregisterReceiver(screenReceiver);
        } catch (final IllegalArgumentException ignored) {
            // Never registered, which happens if onCreate threw part way.
        }
        stopLiveStream("service stopping");
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
        // "This booking is the one that lands on the window", which means its
        // delay reaches the window rather than falling short of it. The test was
        // written the other way round (delayMs <= untilWindow) and that is true
        // of every ordinary tick while the window is still hours away: measured
        // on the trail, a tick at 00:02 for an 08:45 alarm was booked with
        // setAlarmClock and logged WINDOW-exact. Harmless to the alarm, because
        // interval() had already shortened the delay correctly, but it spent an
        // alarm-clock slot every half hour all night and it made the trail
        // useless for the one question it exists to answer - which booking was
        // the window one.
        final boolean forWindow =
                SmartAlarm.watching(prefs())
                        && (SmartAlarm.insideWindow(prefs(), now)
                                || (untilWindow > 0 && delayMs + 10_000L >= untilWindow));
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
        return canBeExact(this);
    }

    /**
     * The same question from outside the service, for the settings panel.
     *
     * <p>Static and context-taking so there is <b>one</b> definition of "is this
     * allowed": the panel asking the AlarmManager itself, rather than reading
     * {@link #KEY_EXACT_REFUSED}, is deliberate. That pref is the service's record
     * of what happened on a night, written when a booking was actually refused,
     * and it stays true until the next booking - so a permission granted this
     * morning would still read as refused until tonight. The live answer is the
     * one a screen offering to fix it needs.
     */
    static boolean canBeExact(final android.content.Context ctx) {
        final AlarmManager am =
                (AlarmManager) ctx.getSystemService(android.content.Context.ALARM_SERVICE);
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
    /**
     * Send an alarm, over the link this sync is holding if there is one.
     *
     * <p><b>Every alarm write from this service goes through here.</b> All three
     * of them - the early wake, the onset retime and the re-arm - are called
     * from {@code finish()}, which runs while the sync's own GATT is still open,
     * and {@code connectForAlarm} refuses outright when a link is up. So each of
     * them silently sent nothing, and {@code finish()} then disconnected and
     * discarded the payload. Nothing on the phone said so, because the trail
     * line is written before the write.
     *
     * @return true when a write was actually issued, so the caller can hold the
     *     link open for the acknowledgement instead of tearing it down.
     */
    private boolean sendAlarm(final byte[] payload, final String what) {
        if (link == null) {
            trail(System.currentTimeMillis(), what + " FAILED: no link");
            return false;
        }
        if (link.writeAlarmNow(payload)) return true;
        // No open link to ride on, so open one. This is the app's path and it is
        // the right one here too when a sync has already closed.
        link.connectForAlarm(payload);
        return true;
    }

    private void maybeWakeEarly() {
        final long now = System.currentTimeMillis();
        // Recorded before the decision, and only inside the window, so the
        // morning after can tell "nothing woke up" from "it woke up and the
        // band had nothing to say" from "it woke up and you were in deep".
        // Those are three different faults and last_sync alone names none.
        if (SmartAlarm.insideWindow(prefs(), now)) {
            // Every reason this tick might not wake you, named. `stage` is the
            // decision and answers -1 for three different causes, so `stale` and
            // `sessions` are recorded beside it: 0 sessions is a band that
            // handed over nothing, a large `stale` is a sync that was not fresh
            // enough, and `stale=-1` with sessions present is blobs that could
            // not be read. `fired` catches the fourth case, a window that was
            // already spent earlier the same morning.
            trail(now, "in-window stage=" + SmartAlarm.currentStage(sleepSessions, now)
                    + " sessions=" + sleepSessions.size()
                    + " stale=" + SmartAlarm.readingAgeMinutes(sleepSessions, now)
                    + " fired=" + (SmartAlarm.dayKey(now)
                            .equals(prefs().getString(SmartAlarm.KEY_FIRED_ON, null)) ? 1 : 0));
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
            // The slot now owes the user their own alarm back: what is about to
            // be written is a one-off, and once it has gone off the band holds
            // nothing. Recorded next to the mark that stops a second buzz, and
            // for the same reason - before the write rather than after, so a
            // write that half succeeds still leaves the debt recorded.
            SmartAlarm.markRearmOwed(prefs(), at.getTimeInMillis());
            trail(now, "FIRING at " + stamp(at.getTimeInMillis()));
            alarmWriteInFlight = sendAlarm(payload, "FIRE");
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
            // Owed back from when this one goes off, which may be hours away.
            SmartAlarm.markRearmOwed(prefs(), target);
            trail(now, "RETIME to " + stamp(target));
            alarmWriteInFlight = sendAlarm(payload, "RETIME");
        } catch (final Exception e) {
            // The cap the user set is still on the strap. Nothing to recover.
        }
    }

    /**
     * Put the user's own alarm back after a one-off has spent the slot.
     *
     * <p>Both early wakes and onset retimes work by overwriting the single slot
     * the app wrote with a {@code REPEAT_ONCE} alarm. That is what makes them
     * safe to fail, and it is also why the recurring alarm has to be written
     * again afterwards: once the one-off has gone off, the band is holding
     * nothing at all. Before 2026-08-14 nothing did, so the first smart wake
     * disarmed every night after it and the only cure was opening Settings and
     * pressing SEND.
     *
     * <p>Costs one BLE connect, on a tick well after the buzz. <b>The debt is
     * only cleared once the band has acknowledged the write</b>, which is what
     * {@code onAlarmSet} is for: a connect that fails because the strap is out of
     * range in the morning would otherwise leave the alarm unset for the
     * following night, which is precisely the failure this exists to stop. Each
     * attempt pushes the next one out by {@link #REARM_RETRY_MINUTES} so a strap
     * that is simply away is not hammered.
     */
    private void maybeRearm() {
        final long now = System.currentTimeMillis();
        if (!SmartAlarm.rearmDue(prefs(), now)) {
            // An alarm switched off between the buzz and now is not owed one.
            // Clearing here rather than leaving it means turning the alarm back
            // on months later cannot trigger a write nobody asked for.
            if (prefs().getLong(SmartAlarm.KEY_REARM_AFTER, 0L) > 0
                    && !prefs().getBoolean(SmartAlarm.KEY_ENABLED, false)) {
                SmartAlarm.clearRearm(prefs());
            }
            return;
        }

        final int hour = SmartAlarm.hardHour(prefs());
        if (hour < 0) {
            SmartAlarm.clearRearm(prefs());
            return;
        }

        try {
            final byte[] payload =
                    HelioAlarm.create(
                            0,
                            hour,
                            SmartAlarm.hardMinute(prefs()),
                            true,
                            false,
                            SmartAlarm.repeatMask(prefs().getString(SmartAlarm.KEY_DAYS, "")));
            // Not cleared here, unlike the fire mark above, and the asymmetry is
            // deliberate. A repeated fire is a second buzz in one morning, so
            // that one is marked before the write and never retried. A repeated
            // re-arm writes the same alarm twice, which costs a connect and
            // changes nothing, so this one is allowed to retry until the band
            // says yes. Backed off first so a failure cannot spin.
            SmartAlarm.markRearmAt(prefs(), now + REARM_RETRY_MINUTES * 60_000L);
            rearmInFlight = true;
            trail(now, "REARM to " + hour + ":" + SmartAlarm.hardMinute(prefs()));
            alarmWriteInFlight = sendAlarm(payload, "REARM");
        } catch (final Exception e) {
            rearmInFlight = false;
            trail(now, "REARM FAILED " + e);
        }
    }

    /** How long before a re-armed alarm the band never acknowledged is retried. */
    private static final int REARM_RETRY_MINUTES = 30;

    /**
     * True between asking for a re-arm and hearing back about it.
     *
     * <p>Needed because an early wake produces an alarm acknowledgement too, and
     * that one must not be taken as proof the user's own alarm went back on.
     */
    private boolean rearmInFlight;

    /**
     * True between issuing any alarm write and the band answering it.
     *
     * <p>{@code finish()} closes the link on its last line, two lines after the
     * alarm hooks run. Closing it there cut the write off, and before
     * 2026-08-14 it discarded every alarm this service ever tried to set.
     */
    private boolean alarmWriteInFlight;

    /**
     * Close the link once an alarm write has been answered, or given up on.
     *
     * <p>The band answers an alarm write in well under a second when it answers
     * at all. Ten seconds is generous, and the point of the backstop is that a
     * band which never replies must not leave the link held open until the next
     * tick - the strap takes one central at a time, so a link nobody closes is a
     * sync that cannot run.
     */
    private static final long ALARM_ACK_TIMEOUT_MS = 10_000L;

    private void scheduleAlarmWriteTimeout() {
        new android.os.Handler(android.os.Looper.getMainLooper())
                .postDelayed(
                        () -> {
                            if (!alarmWriteInFlight) return;
                            trail(System.currentTimeMillis(), "ALARM no answer, closing");
                            closeAfterAlarm();
                        },
                        ALARM_ACK_TIMEOUT_MS);
    }

    /**
     * A Handler is correct here and nowhere else in this file.
     *
     * <p>Everything that has to survive deep sleep is booked with AlarmManager,
     * because postDelayed counts in uptimeMillis and stops with the CPU. This
     * one is a ten-second wait on a link that is already open and keeping the
     * radio awake, so there is nothing for it to sleep through.
     */
    private void closeAfterAlarm() {
        alarmWriteInFlight = false;
        rearmInFlight = false;
        if (link != null) {
            link.disconnect();
            link = null;
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
        // **The stream yields to the sync rather than blocking it.** The strap
        // takes one central at a time, so a held stream would make every
        // background sync skip its tick - the link-busy failure this codebase
        // already knows. It is reopened by updateLiveStream once the sync is done.
        stopLiveStream("yielding to a sync");
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

            /**
             * The band's answer to an alarm write.
             *
             * <p>Only interesting for a re-arm, and only when accepted. An early
             * wake produces one of these too, and taking that as proof the user's
             * own alarm went back on would clear a debt nothing had paid.
             */
            /**
             * The band's answer to an alarm write.
             *
             * <p><b>Trailed for every write, not only for re-arms.</b> The trail
             * recorded FIRING before the write and nothing after it, so three
             * weeks of mornings looked like the decision had worked when no
             * alarm had left the phone at all. A decision without its outcome is
             * what made this take three attempts to find.
             */
            @Override
            public void onAlarmSet(final boolean accepted, final int status) {
                final long now = System.currentTimeMillis();
                trail(now, "ALARM " + (accepted ? "accepted" : "refused status " + status));
                if (rearmInFlight && accepted) {
                    // Only a re-arm clears the debt, and only when accepted. An
                    // early wake produces one of these too, and taking that as
                    // proof the user's own alarm went back on would clear a debt
                    // nothing had paid. A refusal is left owed: the backoff has
                    // already booked the retry.
                    SmartAlarm.clearRearm(prefs());
                }
                closeAfterAlarm();
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
                // **It has somewhere to put it now: a running session.** This
                // used to be empty with a note saying live mode was a
                // foreground-only feature. It still is, in the sense that
                // matters - the stream is only ever held while the screen is on
                // and a session is running - but the thing holding it is this
                // service, because the shade and the lock screen are exactly the
                // surfaces the app cannot draw.
                if (!HelioFetch.isRealHeartRate(bpm)) return;
                final long now = System.currentTimeMillis();
                prefs().edit()
                        .putInt(KEY_LIVE_HR, bpm)
                        .putLong(KEY_LIVE_HR_AT, now)
                        .apply();
                appendTrail(now, bpm);
                updateSessionNotification();
                io.github.atlashealthapp.atlas.widget.AtlasWidgets.refreshAll(HelioSyncService.this);
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
        // After both, never before: each of them can take the slot on this very
        // tick, and re-arming first would put the recurring alarm back and then
        // immediately overwrite it again.
        maybeRearm();

        if (SleepProbe.enabled(prefs())) {
            SleepProbe.record(this, System.currentTimeMillis(), sleepSessions);
        }
        try {
            HelioCache.store(this, samples, sleepSessions, workouts);
        } catch (final Exception e) {
            android.util.Log.w("HelioBle", "[bg] could not cache samples: " + e);
        }
        // Before the samples are cleared, and this is the whole reason a widget
        // refresh can change anything at all - see carryForward.
        carryForwardToWidgets();
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
        // **Held open when an alarm is still being written.** This close used to
        // run unconditionally, two lines after the alarm hooks, and it is what
        // discarded every alarm this service ever tried to set: the write had
        // already been refused for want of a free link, and the payload went out
        // with the link. onAlarmSet closes it now, and closeAfterAlarm is booked
        // as the backstop for a band that never answers.
        if (alarmWriteInFlight) {
            scheduleAlarmWriteTimeout();
        } else if (link != null) {
            link.disconnect();
            link = null;
        }
        updateNotification();
    }

    /**
     * Push the one reading the service can honestly own into the published
     * summary, so a widget refresh visibly does something.
     *
     * <p><b>The problem this solves.</b> Everything a widget draws is computed by
     * the app: the archive lives in IndexedDB and the maths lives in the WebView,
     * so a sync driven from a widget fetched real readings into a cache and left
     * every figure on screen exactly as it was. Reported, correctly, as "I'm not
     * convinced the refresh is forcing it to do anything - it works when I open
     * the app".
     *
     * <p><b>Why heart rate, and why steps joined it.</b> `hrNow` is the newest
     * sample the band just handed over. There is no averaging, no rounding rule
     * and no baseline behind it, so writing it here cannot disagree with the
     * app's own arithmetic - there is none to disagree with.
     *
     * <p>Steps were held back on the grounds that a day total needs the archive.
     * That was right about the archive and wrong about the consequence, and it
     * was reported on 2026-08-19 in exactly the terms that matter: the heart
     * widget refreshes and the steps widget does not, from the same press. The
     * band reports steps as a per-minute <b>increment</b>, so a sum of the
     * minutes it just handed over is the same arithmetic the app does - no
     * baseline and no rounding rule. It earns the exception on the identical
     * three-part test {@link #extendHeartSeries} already passes.
     *
     * <p><b>The first version of it added that sum to the published total and
     * was wrong, measured on the phone within the hour.</b> One press took 820
     * to 1,640 and the next to 2,460. The premise was that a batch holds only
     * what is new past the watermark; the log says otherwise - a single sync
     * carried 820 steps, which was the whole day. The band re-sends the window,
     * so the app's total already contained every minute being added to it. It
     * takes the larger of the two now, which cannot double count however many
     * times it runs.
     *
     * <p><b>A score is still not carried.</b> Recovery and the sleep score need
     * the archive and a baseline, and a second implementation of either is the
     * thing this payload exists to prevent. Those wait for the app.
     *
     * <p>The app overwrites the whole summary on its next publish, so this is a
     * temporary telling that gets corrected rather than a second source of truth.
     */
    private void carryForwardToWidgets() {
        long newestAt = 0;
        double newestHr = 0;
        for (final HelioFetch.Sample sample : samples) {
            // **`> 0` was not enough and this is where it showed** (2026-08-19).
            // The band marks a minute it has no reading for with 0xff, so a strap
            // on its charger published 255 BPM to the widgets. It is filtered at
            // the decoder now; asking the same question here as well is cheap and
            // says out loud that this figure is a raw handover with no arithmetic
            // and therefore no other chance to be sanity-checked.
            if (!"hr".equals(sample.metric) || !HelioFetch.isRealHeartRate(sample.v)) continue;
            if (sample.t > newestAt) {
                newestAt = sample.t;
                newestHr = sample.v;
            }
        }
        if (newestAt <= 0) return;
        try {
            final android.content.SharedPreferences prefs =
                    getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
            final String raw = prefs.getString("atlas_summary_native", null);
            if (raw == null || raw.isEmpty()) return;
            final org.json.JSONObject summary = new org.json.JSONObject(raw);
            summary.put("hrNow", (int) Math.round(newestHr));
            extendHeartSeries(summary);
            extendSteps(summary);
            final int battery = prefs().getInt(KEY_LAST_BATTERY, -1);
            if (battery >= 0) summary.put("strapBattery", battery);
            prefs.edit().putString("atlas_summary_native", summary.toString()).apply();
            android.util.Log.i(
                    "HelioBle", "[bg] carried hrNow=" + Math.round(newestHr) + " to the widgets");
        } catch (final Exception e) {
            android.util.Log.w("HelioBle", "[bg] could not carry the reading forward: " + e);
        }
    }

    /**
     * Carry the newly fetched heart rates into the published series, so the
     * widget's line grows on a refresh rather than only on an app launch.
     *
     * <p><b>This is one step further than the reading, and it is deliberate.</b>
     * Publishing `hrNow` needs no arithmetic at all - it is the last sample - so
     * it could never disagree with the app. Bucketing into half hours is
     * arithmetic, which is the thing this codebase keeps out of native. It earns
     * the exception because the rule is trivial and identical on both sides (the
     * mean of a bucket), because the app overwrites the whole series on its next
     * publish, and because the alternative is a chart that visibly stops at the
     * last time you opened the app while the number above it moves.
     *
     * <p>A touched bucket takes the mean of the NEW samples in it, which for a
     * half-full bucket is slightly different from the app's own answer over the
     * whole bucket. That difference lasts until the next drain and never leaves
     * the widget.
     */
    /**
     * How many readings a half hour needs before its mean means anything.
     *
     * <p>Mirrors `minSamples` in {@code nativeSummary.js}. The two are a
     * change-both-or-neither pair, like the smart alarm's decision: nothing can
     * check they agree, and when they disagree the symptom is a figure that
     * changes every time the widget is refreshed.
     */
    /**
     * How often a live reading is kept for the trail.
     *
     * Five seconds: fine enough that a chart of a ten-minute session has 120
     * points, coarse enough that an hour is 720 and the string stays small.
     */
    private static final long TRAIL_MIN_GAP_MS = 5_000L;

    /**
     * An hour at five seconds. Past this the oldest go, so the string is bounded.
     *
     * Named apart from {@code TRAIL_MAX}, which is the alarm trail's own cap: two
     * unrelated ring buffers in one class, and the compiler caught the collision.
     */
    private static final int HR_TRAIL_MAX = 720;

    /**
     * The three assignable rows in the expanded shade: container, label, bar,
     * value. Which metric each holds is decided at draw time from the published
     * dials, so this is the only place their ids are written down.
     */
    /**
     * The bar bitmap's own size, in pixels.
     *
     * A notification's width is not knowable when the bitmap is made, so it is
     * drawn wide and stretched by {@code fitXY}. Height is small because the bar
     * is 5dp on screen and a taller bitmap only costs memory.
     */
    private static final int BAR_WIDTH_PX = 420;
    private static final int BAR_HEIGHT_PX = 10;

    private static final int[][] DIAL_ROW_IDS = {
        {R.id.row_1, R.id.row_label_1, R.id.row_bar_1, R.id.row_val_1},
        {R.id.row_2, R.id.row_label_2, R.id.row_bar_2, R.id.row_val_2},
        {R.id.row_3, R.id.row_label_3, R.id.row_bar_3, R.id.row_val_3},
    };

    private static final int MIN_BUCKET_SAMPLES = 5;

    private void extendHeartSeries(final org.json.JSONObject summary) {
        try {
            final org.json.JSONArray series = summary.optJSONArray("hr48");
            if (series == null || series.length() == 0) return;

            final java.util.Calendar midnight = java.util.Calendar.getInstance();
            midnight.set(java.util.Calendar.HOUR_OF_DAY, 0);
            midnight.set(java.util.Calendar.MINUTE, 0);
            midnight.set(java.util.Calendar.SECOND, 0);
            midnight.set(java.util.Calendar.MILLISECOND, 0);
            final long from = midnight.getTimeInMillis();
            final long bucketMs = 30 * 60_000L;

            final double[] sums = new double[series.length()];
            final int[] counts = new int[series.length()];
            for (final HelioFetch.Sample sample : samples) {
                // A run of 0xff sentinels easily clears MIN_BUCKET_SAMPLES, so
                // without this a charging strap did not just spike one reading,
                // it published a half hour averaging 255 into the day's chart.
                if (!"hr".equals(sample.metric) || !HelioFetch.isRealHeartRate(sample.v)) continue;
                final int index = (int) ((sample.t - from) / bucketMs);
                if (index < 0 || index >= series.length()) continue;
                sums[index] += sample.v;
                counts[index]++;
            }
            boolean changed = false;
            for (int i = 0; i < counts.length; i++) {
                // **The app owns every bucket it has already answered; this only
                // fills the ones it has not.**
                //
                // Measured 2026-08-19, and it is the whole reason the figure
                // flickered. This service fetches the band's entire window,
                // while the app averages its own archive - which holds only what
                // has been ingested, and with the app's rate limit that is often
                // less. So the two computed different means for the same half
                // hour (the app 89, this 161) and each overwrote the other:
                // clean after opening the app, wrong after every widget refresh.
                //
                // Filling only the null tail keeps what this can honestly add -
                // the hours since you last opened Atlas - and gives up what it
                // cannot: a second opinion about a half hour the app has already
                // judged from the archive it owns.
                if (!series.isNull(i)) continue;
                // **The same minimum the app applies, and the two must agree.**
                // `bucketSeries` in nativeSummary.js withholds a half hour built
                // from fewer than five readings, because the band reports about
                // once a minute and a bucket holding one is the strap being
                // handled rather than worn. Without the rule here, the app
                // published a clean day and the next widget refresh put the
                // artifact straight back: measured on 2026-08-19, the card read
                // 89 MAX, went to 161 MAX on a refresh, and back to 89 after the
                // app was opened. Change this and change it there.
                if (counts[i] < MIN_BUCKET_SAMPLES) continue;
                series.put(i, (int) Math.round(sums[i] / counts[i]));
                changed = true;
            }
            if (!changed) return;
            summary.put("hr48", series);

            // **The range is the app's to state, and this does not touch it.**
            //
            // It used to, twice, and both were wrong in the same way. First it
            // widened the printed figures against whatever was there, which made
            // them a ratchet: once a bad reading got in, nothing could bring it
            // down. Then it recomputed them from this series - honest about the
            // line, but the line here is half-hourly means taken from a wider
            // window than the app has ingested, so the widget printed a MIN and
            // MAX that HeartPage disagreed with. Reported as exactly that.
            //
            // The app publishes the day's true extremes from the archive, which
            // is what the page shows and what the chart is now scaled to.
            // Carrying the line forward is honest, because it is chart the app
            // has not seen yet. Restating the day's extremes from a partial view
            // is not.
        } catch (final Exception e) {
            android.util.Log.w("HelioBle", "[bg] could not extend the heart series: " + e);
        }
    }

    /**
     * Carry the steps the band just handed over into the published total.
     *
     * <p><b>A sum of increments, which is the only reason this is allowed.</b>
     * The band reports steps as one byte per minute - an increment, not a
     * running total - so adding the minutes in this batch to the total the app
     * last published gives exactly what the app would compute over the same
     * samples. No baseline, no percentile, no rounding rule.
     *
     * <p><b>Two guards, and both are about which day it is.</b> Samples before
     * local midnight belong to yesterday and must not be added to today; and a
     * summary the app published yesterday is a yesterday total, so adding to it
     * would invent a figure rather than extend one. In that case nothing is
     * carried and the widget keeps saying what it said until the app runs, which
     * is the honest answer for a day this service cannot total on its own.
     *
     * <p>Adding the batch once per fetch is correct because the batch is what is
     * new past the watermark. Two background syncs before the app opens each add
     * their own new minutes; the app then overwrites the whole summary from the
     * archive and the carried figure stops existing.
     */
    private void extendSteps(final org.json.JSONObject summary) {
        try {
            if (summary.isNull("steps")) return;

            final java.util.Calendar midnight = java.util.Calendar.getInstance();
            midnight.set(java.util.Calendar.HOUR_OF_DAY, 0);
            midnight.set(java.util.Calendar.MINUTE, 0);
            midnight.set(java.util.Calendar.SECOND, 0);
            midnight.set(java.util.Calendar.MILLISECOND, 0);
            final long from = midnight.getTimeInMillis();

            // A total the app published before midnight is yesterday's. Extending
            // it would put this morning's steps on the end of last night's count.
            if (summary.optLong("at", 0L) < from) return;

            long batch = 0;
            final long bucketMs = 30 * 60_000L;
            final org.json.JSONArray series = summary.optJSONArray("steps48");
            final long[] perBucket = new long[series == null ? 0 : series.length()];
            for (final HelioFetch.Sample sample : samples) {
                if (!"steps".equals(sample.metric) || sample.v <= 0) continue;
                if (sample.t < from) continue;
                batch += (long) sample.v;
                final int index = (int) ((sample.t - from) / bucketMs);
                if (index >= 0 && index < perBucket.length) perBucket[index] += (long) sample.v;
            }
            if (batch <= 0) return;

            // **The larger of the two, never the sum.** A batch that covers the
            // whole day IS the day, so its sum is the answer; a batch that
            // covers part of it is worth less than the total the app already
            // published from the archive. Taking the larger is right in both
            // cases, is the same answer however many times it runs, and matches
            // what a step count can do - a day's total only ever rises.
            final long published = summary.optLong("steps");
            final long total = Math.max(published, batch);
            if (total <= published) return;
            summary.put("steps", total);

            // **The fill has to move with the figure.** Leaving it is the one
            // outcome worse than not carrying at all: a gauge that disagrees with
            // the number printed above it. This is the same division the app does
            // in `fillPct`, which is the rule this payload exists to keep out of
            // native - carved here for the same reason and on the same terms as
            // the heart series, and unwound by the app's next publish.
            if (!summary.isNull("stepsGoal")) {
                final long goal = summary.optLong("stepsGoal");
                if (goal > 0) {
                    summary.put(
                            "stepsPct",
                            (int) Math.max(0, Math.min(100, Math.round((total * 100.0) / goal))));
                }
            }

            // The curve is cumulative, so it is rebuilt from the batch rather
            // than nudged: the running total at each half hour is what the shape
            // means. Each point takes the larger of what was published and what
            // the batch says, for the same reason the total does - a partial
            // batch must not pull the curve down under itself.
            if (series != null) {
                long running = 0;
                for (int i = 0; i < series.length(); i++) {
                    running += perBucket[i];
                    if (running <= 0) continue;
                    series.put(i, Math.max(series.isNull(i) ? 0 : series.optLong(i), running));
                }
                summary.put("steps48", series);
            }
            android.util.Log.i(
                    "HelioBle",
                    "[bg] carried steps " + published + " -> " + total + " (batch " + batch + ")");
        } catch (final Exception e) {
            android.util.Log.w("HelioBle", "[bg] could not carry the steps forward: " + e);
        }
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

        // DEFAULT so it reaches the lock screen, silent so it does not announce
        // itself every time a sync re-posts it. See CHANNEL_SESSION_LIVE.
        final NotificationChannel live = new NotificationChannel(
                CHANNEL_SESSION_LIVE, "Session in progress", NotificationManager.IMPORTANCE_DEFAULT);
        live.setDescription("Shows a session you started in Atlas while it is running");
        live.setSound(null, null);
        live.enableVibration(false);
        live.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(live);
    }

    /**
     * The shade while a session Atlas started is running.
     *
     * <p><b>Atlas cannot stop it from here and does not pretend to.</b> The
     * session record lives in localStorage, which Java cannot reach, so STOP
     * opens the app at the session sheet and the app ends it. That is the same
     * division the widgets already run on: the app is the authority and native
     * restates it. An action that wrote a "stop requested" flag for the app to
     * pick up later was the alternative, and it would put a second author on the
     * one record whose start time nobody can reconstruct.
     *
     * <p>The elapsed time is a {@link android.widget.Chronometer} with its base
     * set to the real start, so SystemUI counts it in its own process. Nothing
     * here wakes to keep it moving, which is the only way a live clock is
     * affordable on a notification that may sit there for an hour.
     */
    private Notification buildSessionNotification(final JSONObject session) {
        final long startedAt = session.optLong("startedAt");
        final String typeName = session.isNull("typeName") ? null : session.optString("typeName");
        final String label = typeName == null || typeName.trim().isEmpty()
                ? "Session in progress"
                : typeName;

        final Intent stopIntent = new Intent(this, MainActivity.class)
                .putExtra("atlas_open", "session")
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        final PendingIntent stop = PendingIntent.getActivity(
                this, 1, stopIntent,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

        final RemoteViews view = new RemoteViews(getPackageName(), R.layout.notif_session);
        view.setTextViewText(R.id.session_label, label.toUpperCase(Locale.getDefault()));
        // The wall-clock start, which the counting clock beside it cannot say.
        view.setTextViewText(
                R.id.session_started,
                String.format(Locale.getDefault(), "Started %tR", startedAt));

        // **The heart rate, and whether it is current.** The stream only runs
        // while the screen is on, so a reading here is either live or it is a
        // memory - and the difference has to be on the card. A figure with no age
        // beside it silently becomes a claim about now the moment the screen goes
        // off, which is the whole reason the timestamp is stored with it.
        // **The same line the widget prints**, from one implementation, so the
        // two surfaces cannot disagree about whether the strap is connected.
        final String hr = liveHeartRateLabel(this, startedAt);
        if (hr != null) {
            final int dot = hr.indexOf(" · ");
            view.setViewVisibility(R.id.session_bpm, android.view.View.VISIBLE);
            view.setTextViewText(R.id.session_bpm, dot < 0 ? hr : hr.substring(0, dot));
            view.setViewVisibility(
                    R.id.session_zone,
                    dot < 0 ? android.view.View.GONE : android.view.View.VISIBLE);
            if (dot >= 0) view.setTextViewText(R.id.session_zone, hr.substring(dot + 3));
        } else {
            view.setViewVisibility(R.id.session_bpm, android.view.View.GONE);
            view.setViewVisibility(R.id.session_zone, android.view.View.GONE);
        }
        // **elapsedRealtime, not currentTimeMillis.** Chronometer counts against
        // the monotonic clock, so a base taken from wall time is out by however
        // long the phone has been up - which on a phone that has been awake for
        // days is a clock reading in years.
        view.setChronometer(
                R.id.session_clock,
                android.os.SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startedAt),
                null,
                true);

        return new Notification.Builder(this, CHANNEL_SESSION_LIVE)
                // Re-posted after every sync and every live reading, so without
                // this the lock screen would light up each time.
                .setOnlyAlertOnce(true)
                .setContentTitle(label)
                .setContentText(String.format(Locale.getDefault(), "Started %tR", startedAt))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(stop)
                .setOngoing(true)
                .setShowWhen(false)
                // **Readable on the lock screen, unlike the ordinary one.** The
                // day's notification stays PRIVATE because it carries a Recovery
                // score and a protein total, which are nobody else's business on
                // a phone lying face up on a desk. A session in progress is a
                // different kind of fact: it is the thing you most want to see
                // without unlocking, it is the only way to notice you left one
                // running, and "Indoor Climbing, 42 minutes" says nothing about
                // your health. Split rather than raised for both.
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setStyle(new Notification.DecoratedCustomViewStyle())
                .setCustomContentView(view)
                .addAction(new Notification.Action.Builder(null, "STOP", stop).build())
                .build();
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

        // **The rows follow the dials Home is showing, in their order.**
        // They used to be a fixed five, so somebody whose chosen dials were
        // Recovery, Steps and Weight got a shade about protein they had never
        // logged. The app already publishes the dials it is drawing - the widgets
        // read the same field - so the shade reads them too rather than keeping a
        // second opinion about what matters.
        final org.json.JSONArray dials = summary.optJSONArray("dials");
        boolean stepsIsADial = false;
        for (int slot = 0; slot < DIAL_ROW_IDS.length; slot++) {
            final org.json.JSONObject dial =
                    dials == null ? null : dials.optJSONObject(slot);
            if (dial == null) {
                views.setViewVisibility(DIAL_ROW_IDS[slot][0], View.GONE);
                continue;
            }
            if ("steps".equals(dial.optString("key"))) stepsIsADial = true;
            views.setViewVisibility(DIAL_ROW_IDS[slot][0], View.VISIBLE);
            views.setTextViewText(
                    DIAL_ROW_IDS[slot][1],
                    dial.optString("label", "").toUpperCase(Locale.getDefault()));
            // The dial's own text, which is the figure the app decided to show:
            // a second formatting here is how a shade ends up disagreeing with
            // the screen it mirrors.
            final String sub = dial.isNull("sub") ? null : dial.optString("sub");
            final String text = dial.optString("text", "--");
            // -1 rather than null: a negative is how a missing percentage is
            // said here. A boxed null compiles and throws on unboxing, which in
            // a foreground service is Android killing the process.
            final int pct = dial.isNull("pct") ? -1 : dial.optInt("pct");
            views.setTextViewText(
                    DIAL_ROW_IDS[slot][3],
                    sub == null || sub.isEmpty() ? text : text + " · " + sub);
            // **Drawn rather than tinted, so it keeps its family colour.** A
            // ProgressBar's tint is not remotable below API 31, so an assignable
            // row could only ever be grey - which threw away the one thing the
            // colour was doing. Spark draws every mark in the widget set for the
            // same reason.
            if (pct < 0) {
                views.setViewVisibility(DIAL_ROW_IDS[slot][2], View.INVISIBLE);
            } else {
                views.setViewVisibility(DIAL_ROW_IDS[slot][2], View.VISIBLE);
                views.setImageViewBitmap(
                        DIAL_ROW_IDS[slot][2],
                        io.github.atlashealthapp.atlas.widget.Spark.bar(
                                pct, BAR_WIDTH_PX, BAR_HEIGHT_PX, toneColour(dial)));
            }
        }

        // **Steps only when it is not already up there.** It is the one metric
        // worth stating whether or not it was chosen, because it accumulates
        // whether or not you look - but saying it twice is just saying it twice.
        views.setViewVisibility(R.id.row_steps, stepsIsADial ? View.GONE : View.VISIBLE);
        if (!stepsIsADial) {
            mark(views, R.id.row_bar_steps, R.id.row_val_steps, fill(summary, "stepsPct"),
                    summary.isNull("steps")
                            ? null
                            : String.format(Locale.getDefault(), "%,d", summary.optLong("steps")));
        }

        // The routine keeps its dots. Nine things you have to do is not a
        // proportion, and which ones are empty is the part worth seeing.
        final int due = summary.optInt("routineDue", 0);
        final int done = summary.optInt("routineDone", 0);
        // A routine nobody has set up is not a routine you are failing, so the
        // row goes rather than showing an empty rank of dots.
        views.setViewVisibility(R.id.row_routine, due > 0 ? View.VISIBLE : View.GONE);
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

    /**
     * The running session, as a notification of its own.
     *
     * <p><b>Its own id, and that is the whole fix.</b> It was returned from
     * {@link #buildNotification()} and posted under {@code NOTIFICATION_ID},
     * which is the foreground service's notification - and a foreground service
     * notification is bound to the channel it was started with. Re-posting the
     * same id on a different channel does not move it, so which channel you got
     * depended on which path last touched it, and the lock screen showed it or
     * did not depending on nothing the user could see. Reported exactly that way:
     * inconsistent, and seemingly dependent on what screen you locked from.
     *
     * <p>So the service keeps its own notification saying what the day looks
     * like, and a session in progress is a second one on a channel that reaches
     * the lock screen. It also reads better: the two are different kinds of
     * thing, and the session no longer hides the day's figures.
     */
    /**
     * Hold a live heart-rate stream while the screen is on and a session is
     * running, and drop it the moment either stops being true.
     *
     * <p><b>Screen-on rather than a timer, and continuous rather than bursts.</b>
     * A burst pays the full connect-and-authenticate cost every time - seconds,
     * not milliseconds - to deliver one reading that is immediately going stale,
     * so it is the worst of both. Tying it to the screen spends the radio only
     * while somebody is actually looking, which on a 45-minute session is a small
     * fraction of it, and gives a genuinely live figure for that whole time.
     *
     * <p><b>It must yield to a sync and never compete with one.</b> The strap
     * takes one BLE central at a time, and a stream held while the app tries to
     * sync is the link-busy failure this codebase has already been bitten by. So
     * nothing is opened while a sync is in flight, and a sync starting stands the
     * stream down first.
     */
    private void updateLiveStream() {
        final boolean wanted = screenOn && sessionRunning();
        if (!wanted) {
            stopLiveStream("no longer wanted");
            return;
        }
        // A sync owns the link while it runs and will call back here when it is
        // done, so there is nothing to do but wait.
        if (liveLink != null || syncing || HelioLink.isLinkActive()) return;

        final String authKey = prefs().getString(KEY_AUTH, null);
        if (authKey == null || authKey.isEmpty()) return;
        final byte[] liveKey;
        try {
            liveKey = HelioBlePlugin.parseAuthKey(authKey);
        } catch (final IllegalArgumentException e) {
            return;
        }

        liveLink = new HelioLink(this, new HelioLink.Listener() {
            @Override
            public void onLog(final String message) {
            }

            @Override
            public void onReady() {
            }

            @Override
            public void onAuthResult(final boolean success, final String detail) {
            }

            @Override
            public void onBattery(final int levelPercent, final boolean charging) {
            }

            @Override
            public void onSleepSessions(final List<byte[]> sessions) {
            }

            @Override
            public void onWorkouts(final List<HelioFetch.Workout> found) {
            }

            @Override
            public void onSamples(final List<HelioFetch.Sample> found) {
            }

            @Override
            public void onFetchComplete() {
            }

            @Override
            public void onHeartRate(final int bpm) {
                if (!HelioFetch.isRealHeartRate(bpm)) return;
                final long now = System.currentTimeMillis();
                prefs().edit()
                        .putInt(KEY_LIVE_HR, bpm)
                        .putLong(KEY_LIVE_HR_AT, now)
                        .apply();
                appendTrail(now, bpm);
                updateSessionNotification();
                io.github.atlashealthapp.atlas.widget.AtlasWidgets.refreshAll(HelioSyncService.this);
            }

            @Override
            public void onClosed(final String reason) {
                liveLink = null;
            }
        }, liveKey);

        // sinceDays 0: this link fetches nothing at all. It exists to stream.
        liveLink.connect(0, true);
        trail(System.currentTimeMillis(), "live stream opened");
    }

    /**
     * The live heart-rate line, as the shade and the widget both print it.
     *
     * <p><b>One implementation, because two would drift.</b> The widget is a
     * different process's RemoteViews and the notification is this one's, but
     * they are describing the same reading, and a card saying ZONE 3 beside a
     * shade saying "4 min ago" would be the app disagreeing with itself about
     * whether the strap is connected.
     *
     * <p>Returns null when there is nothing worth saying: no reading, one from
     * before this session started, or one old enough to belong to a different
     * part of the day. A caller hides its row on null rather than printing a
     * dash, which reads as a reading that failed rather than one not taken.
     */
    public static String liveHeartRateLabel(final Context context, final long sessionStartedAt) {
        final SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        final int bpm = prefs.getInt(KEY_LIVE_HR, -1);
        final long at = prefs.getLong(KEY_LIVE_HR_AT, 0);
        if (bpm <= 0 || at <= 0) return null;
        if (sessionStartedAt > 0 && at < sessionStartedAt) return null;
        final long ageMs = System.currentTimeMillis() - at;
        if (ageMs > 30 * 60_000L) return null;
        // Under fifteen seconds the stream is up and the reading describes what
        // you are doing, so it earns a zone. Past that it is a memory, and how
        // old it is matters more than which band it was in.
        if (ageMs < 15_000L) {
            final int zone = zoneForStatic(context, bpm);
            return zone > 0 ? bpm + " BPM · ZONE " + zone : bpm + " BPM";
        }
        return bpm + " BPM · " + agoLabelStatic(ageMs);
    }

    /**
     * Where the newest reading sits across the zone gauge, 0 to 1, or null.
     *
     * <p>Measured from half of maximum to maximum, which is the gauge's own span
     * and the same one {@code zonePosition} uses in the app. Null when there is
     * no usable reading, so the gauge draws its scale with no caret rather than
     * parking one at zero and claiming a heart rate of nothing.
     */
    public static Float liveZoneFraction(final Context context, final long sessionStartedAt) {
        final SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        final int bpm = prefs.getInt(KEY_LIVE_HR, -1);
        final long at = prefs.getLong(KEY_LIVE_HR_AT, 0);
        if (bpm <= 0 || at <= 0) return null;
        if (sessionStartedAt > 0 && at < sessionStartedAt) return null;
        if (System.currentTimeMillis() - at > 30 * 60_000L) return null;
        final int age = profileAge(context);
        if (age <= 0) return null;
        final double max = Math.round(208 - 0.7 * age);
        final double from = max * 0.5;
        if (max <= from) return null;
        return (float) Math.max(0, Math.min(1, (bpm - from) / (max - from)));
    }

    /** The age the app publishes, or 0. */
    private static int profileAge(final Context context) {
        try {
            final String raw = context
                    .getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                    .getString("atlas_summary_native", null);
            if (raw == null || raw.isEmpty()) return 0;
            final JSONObject profile = new JSONObject(raw).optJSONObject("profile");
            return profile == null ? 0 : profile.optInt("age", 0);
        } catch (final Exception e) {
            return 0;
        }
    }

    /**
     * The two ends of the zone scale, or null without an age to derive them.
     *
     * <p>Half of maximum to maximum, matching {@code zones()} in the app. Printed
     * under the gauge because the scale does not begin at zero, and a gauge whose
     * axis is hidden is five coloured boxes.
     */
    public static int[] zoneScale(final Context context) {
        final int age = profileAge(context);
        if (age <= 0) return null;
        final int max = (int) Math.round(208 - 0.7 * age);
        return new int[] {(int) Math.round(max * 0.5), max};
    }

    /** The zone the newest reading is in, in words, or null. */
    public static String liveZoneName(final Context context, final long sessionStartedAt) {
        final Float fraction = liveZoneFraction(context, sessionStartedAt);
        if (fraction == null) return null;
        final SharedPreferences prefs = context.getSharedPreferences(PREFS, MODE_PRIVATE);
        final int zone = zoneForStatic(context, prefs.getInt(KEY_LIVE_HR, -1));
        return zone > 0 ? "Zone " + zone : null;
    }

    /** Static twin of {@link #zoneFor}, for callers with no service instance. */
    private static int zoneForStatic(final Context context, final int bpm) {
        try {
            final String raw = context
                    .getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                    .getString("atlas_summary_native", null);
            if (raw == null || raw.isEmpty()) return 0;
            final JSONObject profile = new JSONObject(raw).optJSONObject("profile");
            final int age = profile == null ? 0 : profile.optInt("age", 0);
            if (age <= 0 || bpm <= 0) return 0;
            final double fraction = bpm / (double) Math.round(208 - 0.7 * age);
            if (fraction < 0.5) return 0;
            if (fraction >= 0.9) return 5;
            if (fraction >= 0.8) return 4;
            if (fraction >= 0.7) return 3;
            if (fraction >= 0.6) return 2;
            return 1;
        } catch (final Exception e) {
            return 0;
        }
    }

    private static String agoLabelStatic(final long ageMs) {
        final long mins = Math.max(0, ageMs / 60_000L);
        if (mins < 1) return "MOMENTS AGO";
        if (mins == 1) return "1 MIN AGO";
        return mins + " MIN AGO";
    }

    /**
     * Keep a live reading for the recap, thinned and bounded.
     *
     * <p>Read-modify-write on a preferences string, which is affordable because
     * it happens at most once every five seconds and only while a session is
     * running with the screen on.
     */
    private void appendTrail(final long at, final int bpm) {
        try {
            final SharedPreferences prefs = prefs();
            final org.json.JSONArray trail =
                    new org.json.JSONArray(prefs.getString(KEY_LIVE_TRAIL, "[]"));
            if (trail.length() > 0) {
                final org.json.JSONArray last = trail.optJSONArray(trail.length() - 1);
                if (last != null && at - last.optLong(0) < TRAIL_MIN_GAP_MS) return;
            }
            // [time, bpm] pairs rather than objects: this string is re-read on
            // every redraw, and the keys would be most of its bytes.
            final org.json.JSONArray point = new org.json.JSONArray();
            point.put(at);
            point.put(bpm);
            trail.put(point);

            final org.json.JSONArray trimmed;
            if (trail.length() > HR_TRAIL_MAX) {
                trimmed = new org.json.JSONArray();
                for (int i = trail.length() - HR_TRAIL_MAX; i < trail.length(); i++) {
                    trimmed.put(trail.get(i));
                }
            } else {
                trimmed = trail;
            }
            prefs.edit().putString(KEY_LIVE_TRAIL, trimmed.toString()).apply();
        } catch (final org.json.JSONException e) {
            // A corrupt trail is a missing chart, not a reason to stop streaming.
            prefs().edit().remove(KEY_LIVE_TRAIL).apply();
        }
    }

    private void stopLiveStream(final String why) {
        if (liveLink == null) return;
        final HelioLink closing = liveLink;
        liveLink = null;
        closing.disconnect("live: " + why);
        // The reading stays in prefs with its timestamp, so whatever draws it can
        // say how old it is rather than pretending it is current.
        updateSessionNotification();
    }

    /** Whether the app has published a session in progress. */
    private boolean sessionRunning() {
        final JSONObject summary = summary();
        final JSONObject session = summary == null ? null : summary.optJSONObject("session");
        return session != null && session.optLong("startedAt", 0) > 0;
    }

    /**
     * The colour a dial's bar takes, from the family the app said it belongs to.
     *
     * <p>Resolved against {@code notif_*}, which follow the SHADE's night mode
     * rather than Atlas's theme - the same rule the rest of this notification
     * obeys, and the reason nothing here reads {@code atlas_theme_native}.
     *
     * <p>Recovery's tone arrives banded ({@code recovery-good}), because on the
     * widgets the band changes the colour. Here it does not: the shade has one
     * gold for Recovery and the band is already in the value beside it.
     */
    private int toneColour(final JSONObject dial) {
        final String tone = dial.optString("tone", "");
        final int res;
        if (tone.startsWith("recovery")) res = R.color.notif_recovery;
        else if ("body".equals(tone)) res = R.color.notif_body;
        else if ("intake".equals(tone)) res = R.color.notif_intake;
        else if ("activity".equals(tone)) res = R.color.notif_activity;
        else res = R.color.notif_accent;
        return getResources().getColor(res, getTheme());
    }

    private void updateSessionNotification() {
        final NotificationManager manager = getSystemService(NotificationManager.class);
        final JSONObject summary = summary();
        final JSONObject session = summary == null ? null : summary.optJSONObject("session");
        if (session == null || session.optLong("startedAt", 0) <= 0) {
            manager.cancel(NOTIFICATION_ID_SESSION_LIVE);
            return;
        }
        manager.notify(NOTIFICATION_ID_SESSION_LIVE, buildSessionNotification(session));
    }

    private void updateNotification() {
        updateSessionNotification();
        // A session may have just started or stopped, which changes whether a
        // stream is wanted at all.
        updateLiveStream();
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
        // The widget renders from the same published summary, so it goes stale in
        // exactly the same way and is redrawn at exactly the same moment.
        io.github.atlashealthapp.atlas.widget.AtlasWidgets.refreshAll(this);
    }
}
