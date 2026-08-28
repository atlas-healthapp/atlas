package io.github.atlashealthapp.atlas.ble;

import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One record per morning, saying what the alarm did and why.
 *
 * <p><b>Why this exists beside the tick trail rather than inside it.</b> The
 * trail in {@link HelioSyncService} is capped at 120 lines and everything the
 * service does writes to it. Measured on 2026-08-21, thirteen of those 120
 * lines were about the alarm and the other 107 were half-hourly ticks, service
 * starts and live-stream opens - the last of which did not exist when the cap
 * was sized. The morning worth reading is evicted by the ticks of the day
 * after it, so how much history survives depends on how often the phone's
 * screen came on, which has nothing to do with the alarm.
 *
 * <p>So this keeps one compact record per morning, thirty of them, and nothing
 * else may write here. That is about a month, and it cannot be flushed by
 * anything the service does in between.
 *
 * <p><b>It answers four questions, because those are the four that were asked:
 * did it fire, what stage was I in, what was the alarm set for against when it
 * actually went off, and was it in smart mode at all.</b> A record is built up
 * across a morning rather than written once, since the answer to "what stage"
 * comes twenty minutes before the answer to "did the band accept it".
 *
 * <p>Format is one record per morning separated by {@code ;}, fields inside it
 * separated by {@code |}, the first field being the day key. Deliberately flat
 * text rather than JSON: it is read by {@code run-as cat} as often as by the
 * app, and a person reading it over somebody's shoulder is a supported use.
 */
final class AlarmLog {

    /** Lives in {@link HelioSyncService#PREFS} beside the tick trail. */
    static final String KEY_LOG = "alarm_log";

    /** About a month. Small enough that the whole thing is one screen of text. */
    static final int MAX_MORNINGS = 30;

    private AlarmLog() {}

    // ── the fields a record may carry ───────────────────────────────────────

    /** "smart", "onset" or "fixed" - what the alarm was set to be that night. */
    static final String F_MODE = "mode";
    /** The time the user's own alarm was set for, HH:MM. */
    static final String F_SET = "set";
    /** How many times the window was actually looked inside. */
    static final String F_CHECKS = "checks";
    /** The band's stage code at the last look, or -1 when it could not say. */
    static final String F_STAGE = "stage";
    /** How old that reading was, in minutes. -1 means there was no reading. */
    static final String F_STALE = "stale";
    /** How many sleep sessions the band handed over at the last look. */
    static final String F_SESSIONS = "sessions";
    /** What the decision was made from: "band" or "hr". */
    static final String F_SOURCE = "source";
    /** The heart rate evidence, when the fallback looked at it. */
    static final String F_HR = "hr";
    /** When an early wake was written to fire, HH:MM. */
    static final String F_FIRED = "fired";
    /** Whether the band acknowledged that write. */
    static final String F_ACK = "ack";
    /** Whether the user's recurring alarm was put back afterwards. */
    static final String F_REARM = "rearm";
    /** An onset alarm's computed time, once it commits to one. */
    static final String F_RETIME = "retime";

    /**
     * Merge fields into a morning's record, creating it if this is the first
     * thing said about that day.
     *
     * <p>Merging rather than appending because a morning is one event with
     * several things learned about it at different times, and three lines
     * saying {@code stage=-1} at ten minute intervals is the noise this class
     * exists to get away from. The last look wins, which is the one that
     * decided.
     */
    static void note(final SharedPreferences prefs, final String day, final Map<String, String> fields) {
        if (day == null || fields == null || fields.isEmpty()) return;
        try {
            final List<String> records = records(prefs);
            final int at = indexOf(records, day);
            final Map<String, String> merged =
                    at < 0 ? new LinkedHashMap<>() : parse(records.get(at));
            merged.putAll(fields);
            final String rebuilt = render(day, merged);
            if (at < 0) {
                records.add(rebuilt);
            } else {
                records.set(at, rebuilt);
            }
            while (records.size() > MAX_MORNINGS) {
                records.remove(0);
            }
            prefs.edit().putString(KEY_LOG, String.join(";", records)).apply();
        } catch (final Exception ignored) {
            // A diagnostic must never be the thing that breaks the alarm. Same
            // rule the tick trail follows.
        }
    }

    /** Every morning on record, oldest first. */
    static List<String> records(final SharedPreferences prefs) {
        final String raw = prefs.getString(KEY_LOG, "");
        final List<String> out = new ArrayList<>();
        if (raw == null || raw.isEmpty()) return out;
        for (final String part : raw.split(";")) {
            if (!part.isEmpty()) out.add(part);
        }
        return out;
    }

    /** One morning's record, or null when nothing was recorded for that day. */
    static String forDay(final SharedPreferences prefs, final String day) {
        final List<String> records = records(prefs);
        final int at = indexOf(records, day);
        return at < 0 ? null : records.get(at);
    }

    /** A field out of a record, or null. */
    static String field(final String record, final String name) {
        return parse(record).get(name);
    }

    private static int indexOf(final List<String> records, final String day) {
        for (int i = 0; i < records.size(); i++) {
            if (records.get(i).equals(day) || records.get(i).startsWith(day + "|")) return i;
        }
        return -1;
    }

    private static Map<String, String> parse(final String record) {
        final Map<String, String> out = new LinkedHashMap<>();
        if (record == null || record.isEmpty()) return out;
        final String[] parts = record.split("\\|");
        // parts[0] is the day, which is not a field.
        for (int i = 1; i < parts.length; i++) {
            final int eq = parts[i].indexOf('=');
            if (eq > 0) out.put(parts[i].substring(0, eq), parts[i].substring(eq + 1));
        }
        return out;
    }

    private static String render(final String day, final Map<String, String> fields) {
        final StringBuilder out = new StringBuilder(day);
        for (final Map.Entry<String, String> e : fields.entrySet()) {
            // A value carrying a separator would split into gibberish on the
            // way back, and there is nothing here worth escaping for.
            final String value = e.getValue() == null
                    ? ""
                    : e.getValue().replace('|', '/').replace(';', ',');
            out.append('|').append(e.getKey()).append('=').append(value);
        }
        return out.toString();
    }

    /** Convenience for the common one-field case. */
    static void note(
            final SharedPreferences prefs, final String day, final String field, final String value) {
        final Map<String, String> one = new LinkedHashMap<>();
        one.put(field, value);
        note(prefs, day, one);
    }
}
