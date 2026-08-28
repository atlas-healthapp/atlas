package io.github.atlashealthapp.atlas.ble;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Reading and writing the band's own settings, starting with workout detection.
 *
 * <p><b>Why this exists.</b> A Sunday walk on 2026-08-16 left no workout record
 * at all. The cause turned out to be Zepp's WORKOUT DETECTION SENSITIVITY set to
 * {@code Low} - a setting on the band that Atlas could neither see nor change,
 * so from inside Atlas the strap simply appeared not to notice a walk.
 *
 * <p><b>The read comes first, unlike the alarm.</b> These settings are shared
 * with Zepp: anything set there is invisible here, and anything written from
 * here replaces what Zepp put. Shipping a write with no read would give the app
 * a screen that could only report what <em>Atlas</em> last wrote, which is a UI
 * asserting state it cannot verify. The alarm got away with that because a slot
 * has no meaningful "current value" to disagree about; a sensitivity does.
 *
 * <p>Protocol from Gadgetbridge's {@code ZeppOsConfigService}, used as
 * documentation exactly as {@code ZeppOsAlarmsService} was for the alarm layout.
 * Endpoint {@code 0x000a} is one Atlas already speaks: {@link HelioLink} asks it
 * for capabilities on every session to keep the encrypted chunked path
 * exercised, so the framing here is already proven on this band.
 *
 * <p><b>Nothing in this class talks to the band.</b> It builds frames and reads
 * replies, which is what makes it testable - the same split that let the alarm's
 * byte layout be verified without a strap. See {@code HelioConfigTest}.
 */
final class HelioConfig {

    /** The config service. Already declared encrypted by this band. */
    static final short ENDPOINT = 0x000a;

    // Commands, from ZeppOsConfigService.
    static final byte CMD_REQUEST = 0x03;
    static final byte CMD_RESPONSE = 0x04;
    static final byte CMD_SET = 0x05;
    static final byte CMD_ACK = 0x06;

    /** Config groups. Only the one Atlas has a reason to touch is named. */
    static final byte GROUP_WORKOUT = 0x09;

    // Workout detection. The three that decide whether a walk becomes a record.
    static final byte ARG_DETECTION_CATEGORY = 0x40;
    static final byte ARG_DETECTION_ALERT = 0x41;
    static final byte ARG_DETECTION_SENSITIVITY = 0x42;

    // Value types.
    static final byte TYPE_BOOL = 0x0b;
    static final byte TYPE_BYTE = 0x10;
    static final byte TYPE_BYTE_LIST = 0x11;
    static final byte TYPE_SHORT = 0x01;
    static final byte TYPE_INT = 0x03;

    /** Sensitivity levels, as Zepp shows them. */
    static final byte SENSITIVITY_HIGH = 0x00;
    static final byte SENSITIVITY_STANDARD = 0x01;
    static final byte SENSITIVITY_LOW = 0x02;

    private HelioConfig() {}

    /**
     * Ask the band for its workout detection settings.
     *
     * <p>Constraints are not requested. They describe the range a value may take
     * and Atlas offers three fixed choices, so asking for them would only make
     * the reply longer and the parser wider for nothing.
     *
     * <pre>
     *   03 | include_constraints | group | num_args | arg...
     * </pre>
     */
    static byte[] requestWorkoutDetection() {
        return new byte[]{
                CMD_REQUEST,
                0x00,
                GROUP_WORKOUT,
                0x03,
                ARG_DETECTION_CATEGORY,
                ARG_DETECTION_ALERT,
                ARG_DETECTION_SENSITIVITY,
        };
    }

    /**
     * Set the detection sensitivity.
     *
     * <pre>
     *   05 | group | version | 00 | num_configs | arg | type | value
     * </pre>
     *
     * @param version the version byte the band reported in its own response. Sent
     *     back rather than assumed: it is the band telling us which shape of this
     *     group it speaks, and inventing a number is how a write gets ignored
     *     without saying so.
     */
    static byte[] setSensitivity(final byte version, final byte level) {
        if (level != SENSITIVITY_HIGH && level != SENSITIVITY_STANDARD && level != SENSITIVITY_LOW) {
            // Range-checked rather than passed through, for the same reason the
            // alarm's hour is: the band drops a frame it cannot parse without
            // replying, so a bad value fails as a setting that silently did not
            // change.
            throw new IllegalArgumentException("sensitivity out of range: " + level);
        }
        return new byte[]{
                CMD_SET, GROUP_WORKOUT, version, 0x00, 0x01, ARG_DETECTION_SENSITIVITY, TYPE_BYTE, level,
        };
    }

    /** What the band said about itself. */
    static final class Reply {
        /** False when the band reported anything other than success. */
        final boolean ok;
        /** The group's version, needed verbatim by any later write. */
        final byte version;
        /** Arg code to value. A byte list arrives as its first byte only. */
        final Map<Byte, Integer> values;

        Reply(final boolean ok, final byte version, final Map<Byte, Integer> values) {
            this.ok = ok;
            this.version = version;
            this.values = values;
        }

        /** The sensitivity, or -1 when the band did not report one. */
        int sensitivity() {
            final Integer v = values.get(ARG_DETECTION_SENSITIVITY);
            return v == null ? -1 : v;
        }

        /** Whether detection alerts are on, or null when unreported. */
        Boolean alert() {
            final Integer v = values.get(ARG_DETECTION_ALERT);
            return v == null ? null : v != 0;
        }
    }

    /**
     * Read a {@code CMD_RESPONSE}.
     *
     * <pre>
     *   04 | status | group | version | has_constraints | count | (arg type value)...
     * </pre>
     *
     * <p>Returns a not-ok {@link Reply} for anything unreadable rather than
     * throwing. A settings screen that cannot read the band must say so; a crash
     * in a BLE callback takes the whole service with it.
     */
    static Reply parse(final byte[] payload) {
        final Map<Byte, Integer> out = new LinkedHashMap<>();
        if (payload == null || payload.length < 6) return new Reply(false, (byte) 0, out);
        if (payload[0] != CMD_RESPONSE || payload[1] != 0x01) {
            return new Reply(false, (byte) 0, out);
        }
        final byte version = payload[3];
        final boolean constraints = payload[4] == 0x01;
        final int count = payload[5] & 0xff;

        int at = 6;
        for (int i = 0; i < count; i++) {
            // Two header bytes plus at least one of value.
            if (at + 2 > payload.length) break;
            final byte arg = payload[at++];
            final byte type = payload[at++];
            switch (type) {
                case TYPE_BOOL:
                case TYPE_BYTE:
                    if (at >= payload.length) return new Reply(false, version, out);
                    out.put(arg, payload[at++] & 0xff);
                    // A constrained byte carries its min and max behind it.
                    if (constraints) at += 2;
                    break;
                case TYPE_BYTE_LIST:
                    // Length-prefixed. Only the first entry is kept: the category
                    // list is a set of activity codes and Atlas has no use for
                    // them yet, but the bytes still have to be stepped over or
                    // every later arg is read from the middle of this one.
                    if (at >= payload.length) return new Reply(false, version, out);
                    final int len = payload[at++] & 0xff;
                    if (len > 0 && at < payload.length) out.put(arg, payload[at] & 0xff);
                    at += len;
                    break;
                case TYPE_SHORT:
                    if (at + 1 >= payload.length) return new Reply(false, version, out);
                    out.put(arg, (payload[at] & 0xff) | ((payload[at + 1] & 0xff) << 8));
                    at += 2;
                    if (constraints) at += 4;
                    break;
                case TYPE_INT:
                    if (at + 3 >= payload.length) return new Reply(false, version, out);
                    out.put(
                            arg,
                            (payload[at] & 0xff)
                                    | ((payload[at + 1] & 0xff) << 8)
                                    | ((payload[at + 2] & 0xff) << 16)
                                    | ((payload[at + 3] & 0xff) << 24));
                    at += 4;
                    if (constraints) at += 8;
                    break;
                default:
                    // An unknown type has an unknown length, so there is no way
                    // to find the next entry. Everything read so far stands;
                    // guessing a width would report values from the wrong bytes.
                    return new Reply(true, version, out);
            }
        }
        return new Reply(true, version, out);
    }

    /** Whether an ack says the write landed. */
    static boolean accepted(final byte[] payload) {
        return payload != null && payload.length >= 2 && payload[0] == CMD_ACK && payload[1] == 0x01;
    }

    /** The level as a word, for the log and the screen. */
    static String sensitivityName(final int level) {
        switch (level) {
            case SENSITIVITY_HIGH:
                return "HIGH";
            case SENSITIVITY_STANDARD:
                return "STANDARD";
            case SENSITIVITY_LOW:
                return "LOW";
            default:
                return "UNKNOWN";
        }
    }
}
