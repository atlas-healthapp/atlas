package io.github.atlashealthapp.atlas.ble;

/**
 * The alarm message for endpoint 0x000f.
 *
 * The first thing in this codebase that changes a setting on the band rather
 * than asking it for data, which is why the byte building is a separate pure
 * class with its own test: everything else here fails visibly (a sync that
 * returns nothing), and a malformed message on this endpoint fails as an alarm
 * that simply never goes off. The band does not validate and complain, it drops
 * a frame it cannot parse without any reply at all, so the guards below are the
 * only thing standing between a typo and a missed morning.
 *
 * Layout verified against Gadgetbridge's ZeppOsAlarmsService, the same source
 * the workout protobuf and the sleep blob offsets came from. Twelve bytes: the
 * command, a constant 0x01, the flags, the slot, hour, minute, the repeat mask
 * and five bytes of padding whose meaning is unknown and which Gadgetbridge
 * also sends as zero.
 *
 * Endpoint 0x000f is listed by this band's own service inventory as *plain*,
 * so unlike the config endpoint no per-message encryption is involved.
 */
final class HelioAlarm {

    static final short ENDPOINT = 0x000f;

    private static final byte CMD_CREATE = 0x03;
    static final byte CMD_CREATE_ACK = 0x04;

    /**
     * Ask the band to find a light phase near the set time rather than firing on
     * it exactly. Whether this firmware honours the bit is unknown: in
     * Gadgetbridge smart wake is a per-device capability in their own code, not
     * something the band advertises over the wire, and Zepp does not offer the
     * option for this strap. Sending it costs nothing, so it stays available and
     * the answer comes from the device.
     */
    private static final byte FLAG_SMART = 0x01;
    private static final byte FLAG_ENABLED = 0x04;

    /** No repeat: the alarm fires once and then stops. */
    static final int REPEAT_ONCE = 0;

    /** Monday is the low bit, through to Sunday at 0x40. */
    private static final int REPEAT_ALL_DAYS = 0x7f;

    private HelioAlarm() {
    }

    /**
     * @param slot       which of the band's alarm slots to overwrite. Slots are
     *                   shared with whatever else has written to this band, so a
     *                   slot Zepp is using is a slot this replaces.
     * @param repeatMask days of the week, Monday as the low bit, or
     *                   {@link #REPEAT_ONCE} for a one-off.
     */
    static byte[] create(final int slot, final int hour, final int minute,
                         final boolean enabled, final boolean smart, final int repeatMask) {
        // Range-checked rather than masked into place. A silently truncated hour
        // is an alarm at the wrong time, which is worse than a rejected call:
        // the caller hears nothing wrong and the band says nothing either.
        if (slot < 0 || slot > 0xff) {
            throw new IllegalArgumentException("alarm slot out of range: " + slot);
        }
        if (hour < 0 || hour > 23) {
            throw new IllegalArgumentException("alarm hour out of range: " + hour);
        }
        if (minute < 0 || minute > 59) {
            throw new IllegalArgumentException("alarm minute out of range: " + minute);
        }
        if (repeatMask < 0 || repeatMask > REPEAT_ALL_DAYS) {
            throw new IllegalArgumentException("alarm repeat mask out of range: " + repeatMask);
        }

        byte flags = 0;
        if (enabled) {
            flags |= FLAG_ENABLED;
        }
        if (smart) {
            flags |= FLAG_SMART;
        }

        return new byte[]{
                CMD_CREATE,
                0x01,
                flags,
                (byte) slot,
                (byte) hour,
                (byte) minute,
                (byte) repeatMask,
                0x00, 0x00, 0x00, 0x00, 0x00
        };
    }
}
