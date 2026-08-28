package io.github.atlashealthapp.atlas.ble;

import android.content.SharedPreferences;

import java.util.Calendar;

/**
 * Several alarms, and which one tonight belongs to.
 *
 * <p>Atlas held exactly one alarm until 2026-08-24. The ask was a weekday alarm
 * and a different weekend one.
 *
 * <p><b>The band really does have slots</b> - proven on the device, not assumed:
 * a write to slot 1 was accepted, the strap buzzed for it, and Zepp showed both
 * alarms afterwards. So each alarm owns a slot and the band rings each one
 * itself. Nothing is rewritten as the week turns.
 *
 * <h2>Why this resolves into the old keys instead of replacing them</h2>
 *
 * <p>{@link SmartAlarm} reads one alarm out of {@code KEY_HOUR} and friends, and
 * every piece of overnight state hangs off that - the window, the fired-once
 * mark, the re-arm debt. Rewriting all of it to be per-alarm would put the
 * riskiest code in the app through a change nobody can test except by sleeping.
 *
 * <p>So this picks tonight's alarm out of the list and writes it into exactly
 * the keys that already existed. {@code SmartAlarm} is untouched and still
 * reasons about one alarm; only the choosing is new. The one addition is
 * {@link #KEY_SLOT}, so a write lands on that alarm's own slot rather than
 * always on slot 0.
 *
 * <p><b>That is only sound because at most one alarm may be due on a night</b>,
 * which {@code alarmPlan.js} enforces at the point of editing. If two alarms
 * ever share a day, the window has two answers and this whole approach stops
 * being safe. The JS has the rule and the tests; this is its twin and the two
 * must agree.
 */
final class AlarmPlan {

    /** The whole list, as the app mirrored it. See {@link Entry} for the shape. */
    static final String KEY_PLAN = "alarm_plan";

    /** The band slot tonight's alarm owns, or -1 when nothing is due. */
    static final String KEY_SLOT = "alarm_slot";

    private AlarmPlan() {}

    /**
     * One alarm, as the app mirrors it.
     *
     * <p>Fixed field order, {@code |} separated, alarms separated by {@code ;}:
     * {@code hour|minute|enabled|mode|days|onsetHours|latestHour|latestMinute},
     * where {@code days} is a comma list with Sunday as 0 and an empty string
     * meaning a one-off.
     *
     * <p><b>Flat text rather than JSON, for two reasons.</b> {@code org.json}
     * is an android.jar stub under plain JUnit, so anything parsing it cannot
     * be unit tested without pulling in a dependency; and the same argument
     * {@link AlarmLog} makes applies here, that this is read by
     * {@code run-as cat} as often as by code.
     */
    private static final class Entry {
        int hour = -1;
        int minute;
        boolean enabled;
        String mode = "fixed";
        String days = "";
        float onsetHours = 8f;
        int latestHour = -1;
        int latestMinute;
    }

    /**
     * Choose tonight's alarm and write it into the single-alarm keys.
     *
     * <p>Called before anything reads those keys, so the service always sees
     * the alarm that applies to the day it is currently in. Cheap enough to run
     * every tick, which is what keeps it correct across midnight without
     * anything having to notice midnight happened.
     *
     * @return the slot written, or -1 when the plan is empty or all-off.
     */
    static int resolveActive(final SharedPreferences prefs, final long now) {
        final String raw = prefs.getString(KEY_PLAN, null);
        if (raw == null || raw.isEmpty()) return prefs.getInt(KEY_SLOT, 0);

        final Entry[] list = parse(raw);
        // A plan that parsed to nothing is a malformed one. Leaving the
        // previous keys in place is the safe failure and the whole reason this
        // feature is safe at all: the strap rings the time on its face
        // regardless, so a bad mirror must never be worse than no mirror.
        if (list.length == 0) return prefs.getInt(KEY_SLOT, 0);

        int slot = dueOn(list, now);
        // Nothing today. Look ahead for something to schedule toward - dueToday
        // reads the days written below and correctly answers false for it.
        for (int ahead = 1; ahead <= 7 && slot < 0; ahead++) {
            final Calendar c = Calendar.getInstance();
            c.setTimeInMillis(now);
            c.add(Calendar.DAY_OF_YEAR, ahead);
            slot = dueOn(list, c.getTimeInMillis());
        }
        if (slot < 0) {
            prefs.edit()
                    .putBoolean(SmartAlarm.KEY_ENABLED, false)
                    .putInt(KEY_SLOT, -1)
                    .apply();
            return -1;
        }
        write(prefs, list[slot], slot);
        return slot;
    }

    private static Entry[] parse(final String raw) {
        final String[] parts = raw.split(";");
        final java.util.List<Entry> out = new java.util.ArrayList<>();
        for (final String part : parts) {
            if (part.isEmpty()) continue;
            // Split on a literal pipe: it is a regex alternation otherwise, and
            // an unescaped one matches the empty string between every character.
            final String[] f = part.split("\\|", -1);
            if (f.length < 8) return new Entry[0];
            final Entry e = new Entry();
            try {
                e.hour = Integer.parseInt(f[0]);
                e.minute = Integer.parseInt(f[1]);
                e.enabled = "1".equals(f[2]);
                e.mode = f[3];
                e.days = f[4];
                e.onsetHours = Float.parseFloat(f[5]);
                e.latestHour = Integer.parseInt(f[6]);
                e.latestMinute = Integer.parseInt(f[7]);
            } catch (final NumberFormatException bad) {
                // One unreadable alarm makes the whole plan untrustworthy: the
                // rest may still parse, but which alarm owns which slot would
                // be a guess, and a guess here writes over the wrong slot.
                return new Entry[0];
            }
            out.add(e);
        }
        return out.toArray(new Entry[0]);
    }

    /** Index of the enabled alarm covering that day, or -1. */
    private static int dueOn(final Entry[] list, final long millis) {
        final Calendar c = Calendar.getInstance();
        c.setTimeInMillis(millis);
        final int today = c.get(Calendar.DAY_OF_WEEK) - 1;
        for (int i = 0; i < list.length; i++) {
            final Entry e = list[i];
            if (!e.enabled) continue;
            // An empty list is a one-off, which the band reads as REPEAT_ONCE
            // and which counts as due whatever day it is.
            if (e.days.isEmpty()) return i;
            for (final String d : e.days.split(",")) {
                try {
                    if (Integer.parseInt(d.trim()) == today) return i;
                } catch (final NumberFormatException ignored) {
                    // A malformed day is not a reason to fire on the wrong one.
                }
            }
        }
        return -1;
    }

    /** Write one alarm into the keys {@link SmartAlarm} already reads. */
    private static void write(final SharedPreferences prefs, final Entry e, final int slot) {
        prefs.edit()
                .putString(SmartAlarm.KEY_MODE, e.mode)
                .putInt(SmartAlarm.KEY_HOUR, e.hour)
                .putInt(SmartAlarm.KEY_MINUTE, e.minute)
                .putBoolean(SmartAlarm.KEY_ENABLED, e.enabled)
                .putString(SmartAlarm.KEY_DAYS, e.days)
                .putFloat(SmartAlarm.KEY_ONSET_HOURS, e.onsetHours)
                .putInt(SmartAlarm.KEY_LATEST_HOUR, e.latestHour)
                .putInt(SmartAlarm.KEY_LATEST_MINUTE, e.latestMinute)
                .putInt(KEY_SLOT, slot)
                .apply();
    }

    /**
     * The slot a write should land on.
     *
     * <p>Defaults to 0, which is what every Atlas build before this one used, so
     * a phone that has not yet mirrored a plan keeps writing where its existing
     * alarm already lives.
     */
    static int activeSlot(final SharedPreferences prefs) {
        final int slot = prefs.getInt(KEY_SLOT, 0);
        return slot < 0 ? 0 : slot;
    }
}
