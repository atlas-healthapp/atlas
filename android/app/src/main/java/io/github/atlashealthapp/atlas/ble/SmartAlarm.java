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
    /**
     * When the user's own alarm is owed back on the band, or 0.
     *
     * <p><b>Waking you early spends the alarm.</b> Both the early wake and the
     * onset retime work by overwriting the one slot the app wrote with a
     * {@code REPEAT_ONCE} alarm a couple of minutes out. That is what makes them
     * safe to fail - a write that does not land leaves the original time sitting
     * there - but it also means that once one lands, the recurring alarm the user
     * set is gone. Nothing put it back until 2026-08-14, so the first smart wake
     * silently disarmed every following night, and the only way to get it back
     * was opening Settings and pressing SEND.
     */
    static final String KEY_REARM_AFTER = "alarm_rearm_after";

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
        // **Smart only, and onset used to be here.** The three modes are offered
        // as alternatives and only one of them mentions light sleep, so only one
        // of them does it. Onset asks for a duration - "eight hours from when I
        // fell asleep" - and spending twenty minutes of that duration to land in
        // a light phase was never what was offered.
        //
        // It cost somebody forty minutes on 2026-08-16: nothing in the firing
        // path re-checked the mode, so an onset night ran the early wake too, and
        // the window was built from KEY_HOUR (a leftover 08:45 from fixed mode)
        // while the strap held 09:07. Fired at 08:27, from a feature promising
        // twenty minutes early, in a mode that never claimed to do it at all.
        //
        // This also disposes of that wrong-anchor bug rather than fixing it:
        // millisUntilAlarm reads KEY_HOUR, which is right for smart (where
        // hardHour returns the same field) and was only ever wrong for onset,
        // which no longer has a window to anchor. onsetTarget keeps its own mode
        // check and never called this, so the retime is untouched - see
        // SmartAlarmModeTest.theRetimeHasItsOwnModeGate.
        return "smart".equals(prefs.getString(KEY_MODE, "fixed"));
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
        final Reading reading = newestReading(sessions, now);
        if (reading == null) return -1;
        if (reading.ageMinutes(now) > MAX_STALE_MINUTES) return -1;
        return reading.stage;
    }

    /**
     * How old the freshest reading is, in minutes, or -1 when there is none.
     *
     * <p><b>For the trail, not for the decision.</b> {@link #currentStage}
     * answers -1 for three different reasons - the band handed over nothing, the
     * blobs were unreadable, or the newest reading is too old to describe now -
     * and a morning that did not wake you cannot be explained without knowing
     * which. This reports the age whatever it is, so a trail line reading
     * {@code stage=-1 sessions=2 stale=41} says the sync was not fresh enough
     * rather than that the band was silent.
     */
    static long readingAgeMinutes(final List<byte[]> sessions, final long now) {
        final Reading reading = newestReading(sessions, now);
        return reading == null ? -1 : reading.ageMinutes(now);
    }

    /** The newest stage segment at or before a moment, with when it ended. */
    private static final class Reading {
        final int stage;
        final long endMillis;

        Reading(final int stage, final long endMillis) {
            this.stage = stage;
            this.endMillis = endMillis;
        }

        long ageMinutes(final long now) {
            return (now - endMillis) / 60_000L;
        }
    }

    /**
     * The freshest thing the band has said, with no judgement applied.
     *
     * <p>Staleness is deliberately not checked here: this is the measurement and
     * {@link #currentStage} is the decision. Keeping them apart is what lets the
     * trail record an age for a reading the decision then rejects.
     */
    private static Reading newestReading(final List<byte[]> sessions, final long now) {
        if (sessions == null) return null;
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
            if (sleepStart < 0) return null;
        }

        return best < 0 ? null : new Reading(best, bestEnd);
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

    // ── putting the user's own alarm back ───────────────────────────────────

    /**
     * How long after the one-off goes off before the recurring alarm goes back.
     *
     * <p>Measured from when the one-off <i>fires</i>, not from when it is
     * written, and the difference is the whole correctness of this. An early
     * wake is written two minutes out; an onset retime is written as early as
     * 02:00 for an alarm at 07:30. Counting from the write would put the
     * recurring alarm back over the top of a retimed alarm five hours before it
     * was due to go off, which is the same disarming bug in a new place.
     *
     * <p>Fifteen minutes past the buzz, which also clears the ten-minute check
     * spacing, so the re-arm lands on a later tick rather than racing the fire
     * inside one.
     */
    static final int REARM_DELAY_MINUTES = 15;

    /**
     * Note that the slot holds a one-off, and when the user's alarm is owed back.
     *
     * @param firesAtMillis when the one-off just written will actually go off.
     */
    static void markRearmOwed(final SharedPreferences prefs, final long firesAtMillis) {
        markRearmAt(prefs, firesAtMillis + REARM_DELAY_MINUTES * 60_000L);
    }

    /** The same debt, at an explicit time. Used to back off after an attempt. */
    static void markRearmAt(final SharedPreferences prefs, final long whenMillis) {
        prefs.edit().putLong(KEY_REARM_AFTER, whenMillis).apply();
    }

    /** Forget the debt, whether it was paid or has stopped applying. */
    static void clearRearm(final SharedPreferences prefs) {
        prefs.edit().remove(KEY_REARM_AFTER).apply();
    }

    /**
     * Is the user's alarm owed back, and is it time?
     *
     * <p>Only ever true when the alarm is still enabled. Somebody who turned the
     * alarm off between the buzz and this tick is not owed one, and re-arming
     * anyway would set an alarm they had just cancelled - the one outcome worse
     * than the bug this fixes.
     */
    static boolean rearmDue(final SharedPreferences prefs, final long now) {
        final long after = prefs.getLong(KEY_REARM_AFTER, 0L);
        if (after <= 0L) return false;
        if (!prefs.getBoolean(KEY_ENABLED, false)) return false;
        return now >= after;
    }

    /**
     * The hour to put back on the band, mirroring what the app itself writes.
     *
     * <p>An onset alarm hands the band the <i>latest</i> time the user was
     * willing to accept rather than the computed one, because the strap is
     * holding a backstop rather than the answer. Getting this wrong would put a
     * fixed alarm at the onset cap or vice versa, so it is one function rather
     * than the same conditional in two places. See {@code writeAlarm} in
     * {@code stores/helio.js}, which this has to agree with.
     */
    static int hardHour(final SharedPreferences prefs) {
        final int latest = prefs.getInt(KEY_LATEST_HOUR, -1);
        if ("onset".equals(prefs.getString(KEY_MODE, "fixed")) && latest >= 0) return latest;
        return prefs.getInt(KEY_HOUR, -1);
    }

    /** The minute that goes with {@link #hardHour}. */
    static int hardMinute(final SharedPreferences prefs) {
        final int latest = prefs.getInt(KEY_LATEST_HOUR, -1);
        if ("onset".equals(prefs.getString(KEY_MODE, "fixed")) && latest >= 0) {
            return prefs.getInt(KEY_LATEST_MINUTE, 0);
        }
        return prefs.getInt(KEY_MINUTE, 0);
    }

    /**
     * The band's repeat byte for a stored day list.
     *
     * <p><b>Two week conventions meet here and neither fails loudly.</b> Atlas
     * counts days the way {@code Date.getDay()} does, Sunday as 0, which is what
     * the app mirrors into {@link #KEY_DAYS}. The band counts from Monday as the
     * low bit. Getting it wrong sets the alarm one day out and the first evidence
     * is a Sunday it should not have gone off on, which is why this mirrors
     * {@code repeatMask} in {@code src/utils/strapAlarm.js} exactly and has its
     * own test.
     *
     * <p>An empty list is a one-off, the same reading the app gives it.
     */
    static int repeatMask(final String days) {
        if (days == null || days.trim().isEmpty()) return HelioAlarm.REPEAT_ONCE;
        final int[] mondayFirst = {1, 2, 3, 4, 5, 6, 0};
        int mask = 0;
        for (final String part : days.split(",")) {
            final int day;
            try {
                day = Integer.parseInt(part.trim());
            } catch (final NumberFormatException ignored) {
                // A malformed entry is dropped rather than shifting the rest.
                continue;
            }
            for (int bit = 0; bit < mondayFirst.length; bit++) {
                if (mondayFirst[bit] == day) mask |= 1 << bit;
            }
        }
        return mask;
    }
}
