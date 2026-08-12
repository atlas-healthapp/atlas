package io.github.atlashealthapp.atlas.ble;

import android.content.SharedPreferences;

import java.util.Calendar;
import java.util.List;

/**
 * Deciding whether to wake someone early, on the phone, while they are asleep.
 *
 * <p>The app cannot make this call: it is not running overnight. So the rule
 * lives here, and the WebView's copy in {@code src/utils/smartAlarm.js} is the
 * one with the reasoning and the tests. <b>The two must agree.</b> They are kept
 * apart deliberately rather than one calling the other, because the alternative
 * is waking the WebView every ten minutes all night.
 *
 * <p><b>Everything here can only ever wake you EARLIER than the time on the
 * strap's own face.</b> The strap holds the hard time itself and always has, so
 * a bug in this file, a failed connect, a dead phone or an app that was
 * reinstalled all produce the same outcome: your normal alarm. That is what
 * makes the feature safe to ship before it has been through a morning.
 *
 * <p>Byte offsets mirror {@code src/utils/huamiSleep.js}, which is where they
 * were derived and cross-checked against real device data. Only the few needed
 * to answer "what stage is he in right now" are read here; the app does the full
 * decode when it next runs.
 */
final class SmartAlarm {

    /** Mirrored from the app whenever an alarm is written. See HelioBlePlugin. */
    static final String KEY_MODE = "alarm_mode";
    static final String KEY_HOUR = "alarm_hour";
    static final String KEY_MINUTE = "alarm_minute";
    static final String KEY_DAYS = "alarm_days";
    static final String KEY_ENABLED = "alarm_enabled";
    static final String KEY_ONSET_HOURS = "alarm_onset_hours";
    static final String KEY_LATEST_HOUR = "alarm_latest_hour";
    static final String KEY_LATEST_MINUTE = "alarm_latest_minute";
    /** The morning an early wake was last written, so it fires once a night. */
    static final String KEY_FIRED_ON = "alarm_fired_on";

    /** Minutes before the set time that the window opens. Matches the JS. */
    static final int WINDOW_MINUTES = 20;

    /** How often to look while inside it. Deliberately not smaller: see the JS. */
    static final long CHECK_INTERVAL_MS = 10 * 60 * 1000L;

    /** Older than this and the reading is not describing now. */
    private static final int MAX_STALE_MINUTES = 15;

    /** How far ahead the replacement alarm is set, allowing for the connect. */
    static final int FIRE_LEAD_MINUTES = 2;

    // Offsets into the sleep blob, from huamiSleep.js.
    private static final int OFF_MIDNIGHT = 0x04;
    private static final int OFF_SLEEP_START = 0x0a;
    private static final int OFF_SEGMENT_COUNT = 0x54;
    private static final int OFF_SEGMENTS = 0x56;
    private static final int SEGMENT_BYTES = 5;
    private static final int MIN_BLOB = 0x252;

    private static final int STAGE_LIGHT = 4;
    private static final int STAGE_AWAKE = 7;

    private SmartAlarm() {}

    private static int u16(final byte[] b, final int at) {
        return (b[at] & 0xff) | ((b[at + 1] & 0xff) << 8);
    }

    private static long u32(final byte[] b, final int at) {
        return (b[at] & 0xffL)
                | ((b[at + 1] & 0xffL) << 8)
                | ((b[at + 2] & 0xffL) << 16)
                | ((b[at + 3] & 0xffL) << 24);
    }

    /**
     * Whether the mode set in the app wants a window watched at all.
     *
     * <p>Read every tick rather than captured, so changing the alarm in the app
     * takes effect without the service being restarted.
     */
    static boolean watching(final SharedPreferences prefs) {
        if (!prefs.getBoolean(KEY_ENABLED, false)) return false;
        final String mode = prefs.getString(KEY_MODE, "fixed");
        return "smart".equals(mode) || "onset".equals(mode);
    }

    /** Milliseconds until the set time today, or a large number when it has passed. */
    static long millisUntilAlarm(final SharedPreferences prefs, final long now) {
        final int hour = prefs.getInt(KEY_HOUR, -1);
        final int minute = prefs.getInt(KEY_MINUTE, 0);
        if (hour < 0) return Long.MAX_VALUE;

        final Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        c.set(Calendar.HOUR_OF_DAY, hour);
        c.set(Calendar.MINUTE, minute);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis() - now;
    }

    /**
     * Whether today is a day this alarm runs.
     *
     * <p>Days are stored the way the app counts them, Sunday as 0, matching
     * {@code Date.getDay()}. An empty list is a one-off, which counts as every
     * day for the purpose of watching a window.
     */
    static boolean dueToday(final SharedPreferences prefs, final long now) {
        final String days = prefs.getString(KEY_DAYS, "");
        if (days == null || days.isEmpty()) return true;
        final Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        final int today = c.get(Calendar.DAY_OF_WEEK) - 1;
        for (final String part : days.split(",")) {
            try {
                if (Integer.parseInt(part.trim()) == today) return true;
            } catch (final NumberFormatException ignored) {
                // A malformed list is not a reason to fire on the wrong day.
            }
        }
        return false;
    }

    /**
     * How long until the window opens, or -1 when there is no window to wait for.
     *
     * <p><b>This exists because the first version silently never ran.</b> The
     * service picks its next tick at the end of the current one, so a tick that
     * landed at 06:53 with a half-hour interval booked itself for 07:23 - three
     * minutes after a 07:20 alarm had already gone off. The window opened and
     * closed between two ticks and nothing ever looked inside it. Measured on
     * 2026-08-11: the service was up for eight hours and its last sync of the
     * night was at 07:23:30.
     *
     * <p>So the scheduler has to look ahead rather than only at the clock now.
     */
    static long millisUntilWindow(final SharedPreferences prefs, final long now) {
        if (!watching(prefs) || !dueToday(prefs, now)) return -1;
        final long until = millisUntilAlarm(prefs, now);
        if (until == Long.MAX_VALUE) return -1;
        final long opens = until - WINDOW_MINUTES * 60_000L;
        return opens > 0 ? opens : -1;
    }

    /** True while the clock is inside the window before the set time. */
    static boolean insideWindow(final SharedPreferences prefs, final long now) {
        if (!watching(prefs) || !dueToday(prefs, now)) return false;
        final long until = millisUntilAlarm(prefs, now);
        return until > 0 && until <= WINDOW_MINUTES * 60_000L;
    }

    /** A day key, so an early wake can only happen once per night. */
    static String dayKey(final long now) {
        final Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        return c.get(Calendar.YEAR) + "-" + c.get(Calendar.DAY_OF_YEAR);
    }

    /**
     * The stage the band currently has this person in, or -1 when it cannot say.
     *
     * <p>Returns -1 for every unusable case rather than guessing, and the caller
     * must treat that as "do nothing". A missing reading is the commonest
     * outcome of all: about a quarter of overnight syncs come back with no
     * session whatsoever, and that is not the same claim as being awake.
     */
    static int currentStage(final List<byte[]> sessions, final long now) {
        if (sessions == null) return -1;
        int best = -1;
        long bestEnd = Long.MIN_VALUE;

        for (final byte[] blob : sessions) {
            if (blob == null || blob.length < MIN_BLOB) continue;
            final int count = blob[OFF_SEGMENT_COUNT] & 0xff;
            if (count == 0) continue;
            if (OFF_SEGMENTS + count * SEGMENT_BYTES > blob.length) continue;

            // The blob counts minutes from the day before its own midnight
            // stamp, which is what huamiSleep.js does when it derives bedTime.
            final long dayBase = (u32(blob, OFF_MIDNIGHT) - 24 * 3600L) * 1000L;
            final int sleepStart = u16(blob, OFF_SLEEP_START);

            for (int i = 0; i < count; i++) {
                final int at = OFF_SEGMENTS + i * SEGMENT_BYTES;
                final int from = u16(blob, at);
                final int to = u16(blob, at + 2);
                if (to < from) break;
                final int stage = blob[at + 4] & 0xff;
                final long startMs = dayBase + (long) from * 60_000L;
                final long endMs = dayBase + ((long) to + 1) * 60_000L;
                if (startMs > now) continue;
                if (endMs > bestEnd) {
                    bestEnd = endMs;
                    best = stage;
                }
            }
            // Referenced so the offset is not silently unused if the layout ever
            // changes; the app's decoder uses it to place the timeline.
            if (sleepStart < 0) return -1;
        }

        if (best < 0) return -1;
        final long staleMinutes = (now - bestEnd) / 60_000L;
        if (staleMinutes > MAX_STALE_MINUTES) return -1;
        return best;
    }

    /**
     * Should an early wake be written right now?
     *
     * <p>Light or awake only. Waking out of REM is close to a natural
     * awakening; waking out of slow-wave sleep is where real grogginess comes
     * from, and on measured data the morning window is almost free of it.
     */
    static boolean shouldWakeNow(
            final SharedPreferences prefs, final List<byte[]> sessions, final long now) {
        if (!insideWindow(prefs, now)) return false;
        if (dayKey(now).equals(prefs.getString(KEY_FIRED_ON, null))) return false;
        final int stage = currentStage(sessions, now);
        return stage == STAGE_LIGHT || stage == STAGE_AWAKE;
    }

    /** The night an onset alarm was last retimed, so it is written once. */
    static final String KEY_RETIMED_ON = "alarm_retimed_on";

    /**
     * The earliest hour an onset alarm may commit to a time.
     *
     * <p>Measured on 2026-08-10: the band moved its idea of when this user fell
     * asleep from 22:01 to 00:19 between 01:38 and 02:08, then by only eleven
     * minutes across the following seven hours. Committing before it settles
     * would have been over two hours wrong.
     */
    static final int ONSET_COMMIT_HOUR = 2;

    /** When the band currently thinks sleep began, or -1. */
    static long onsetMillis(final List<byte[]> sessions, final long now) {
        if (sessions == null) return -1;
        long best = -1;
        for (final byte[] blob : sessions) {
            if (blob == null || blob.length < MIN_BLOB) continue;
            final int count = blob[OFF_SEGMENT_COUNT] & 0xff;
            if (count == 0) continue;
            final long dayBase = (u32(blob, OFF_MIDNIGHT) - 24 * 3600L) * 1000L;
            final long start = dayBase + (long) u16(blob, OFF_SLEEP_START) * 60_000L;
            // The night in progress, not a nap from yesterday still in the buffer.
            if (start > now || now - start > 20 * 3600_000L) continue;
            if (start > best) best = start;
        }
        return best;
    }

    /**
     * The time an onset alarm should be set to, or -1 when it is too early to
     * say or the mode is not in use.
     *
     * <p>Capped at the latest time the user set, which is not optional: a late
     * night must not push the alarm past the time they have to be up.
     */
    static long onsetTarget(
            final SharedPreferences prefs, final List<byte[]> sessions, final long now) {
        if (!prefs.getBoolean(KEY_ENABLED, false)) return -1;
        if (!"onset".equals(prefs.getString(KEY_MODE, "fixed"))) return -1;
        if (!dueToday(prefs, now)) return -1;
        if (dayKey(now).equals(prefs.getString(KEY_RETIMED_ON, null))) return -1;

        final Calendar c = Calendar.getInstance();
        c.setTimeInMillis(now);
        if (c.get(Calendar.HOUR_OF_DAY) < ONSET_COMMIT_HOUR) return -1;

        final long onset = onsetMillis(sessions, now);
        if (onset < 0) return -1;

        final float hours = prefs.getFloat(KEY_ONSET_HOURS, 8f);
        long target = onset + (long) (hours * 3600_000f);

        final int latestHour = prefs.getInt(KEY_LATEST_HOUR, -1);
        if (latestHour >= 0) {
            final Calendar cap = Calendar.getInstance();
            cap.setTimeInMillis(now);
            cap.set(Calendar.HOUR_OF_DAY, latestHour);
            cap.set(Calendar.MINUTE, prefs.getInt(KEY_LATEST_MINUTE, 0));
            cap.set(Calendar.SECOND, 0);
            cap.set(Calendar.MILLISECOND, 0);
            if (target > cap.getTimeInMillis()) target = cap.getTimeInMillis();
        }

        // Already past, so there is nothing left to schedule tonight.
        if (target <= now + 60_000L) return -1;
        return target;
    }

    static void markRetimed(final SharedPreferences prefs, final long now) {
        prefs.edit().putString(KEY_RETIMED_ON, dayKey(now)).apply();
    }

    /** Remember that tonight has had its early wake, so it happens once. */
    static void markFired(final SharedPreferences prefs, final long now) {
        prefs.edit().putString(KEY_FIRED_ON, dayKey(now)).apply();
    }
}
