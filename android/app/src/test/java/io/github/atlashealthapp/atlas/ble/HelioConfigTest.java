package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The band's own settings, on the wire.
 *
 * <p>Same reasoning as {@code HelioAlarmTest}: the band drops a frame it cannot
 * parse <b>without replying</b>, so a wrong byte here is a setting that silently
 * did not change. That is why the layout is asserted byte for byte rather than
 * round-tripped through the class's own reader.
 */
public class HelioConfigTest {

    @Test
    public void theRequestAsksForTheThreeDetectionSettings() {
        assertArrayEquals(
                new byte[]{
                        0x03, // CMD_REQUEST
                        0x00, // no constraints: Atlas offers three fixed choices
                        0x09, // WORKOUT
                        0x03, // three args
                        0x40, 0x41, 0x42,
                },
                HelioConfig.requestWorkoutDetection());
    }

    @Test
    public void aSetCarriesTheGroupVersionBackVerbatim() {
        assertArrayEquals(
                new byte[]{
                        0x05, // CMD_SET
                        0x09, // WORKOUT
                        0x07, // whatever version the band reported
                        0x00,
                        0x01, // one config
                        0x42, // sensitivity
                        0x10, // BYTE
                        0x00, // HIGH
                },
                HelioConfig.setSensitivity((byte) 0x07, HelioConfig.SENSITIVITY_HIGH));
    }

    // Range-checked rather than masked, for the same reason the alarm's hour is:
    // an unparseable frame is dropped in silence.
    @Test
    public void anImpossibleSensitivityIsRefusedRatherThanSent() {
        assertThrows(
                IllegalArgumentException.class,
                () -> HelioConfig.setSensitivity((byte) 1, (byte) 9));
        assertThrows(
                IllegalArgumentException.class,
                () -> HelioConfig.setSensitivity((byte) 1, (byte) -1));
    }

    /** The reply this was built for: detection on, sensitivity Low. */
    @Test
    public void readsTheSettingsOutOfAResponse() {
        final byte[] reply = {
                0x04, 0x01, 0x09, 0x07, 0x00, 0x03,
                0x40, 0x11, 0x02, 0x01, 0x02, // BYTE_LIST of two categories
                0x41, 0x0b, 0x01, //             BOOL, alerts on
                0x42, 0x10, 0x02, //             BYTE, LOW
        };
        final HelioConfig.Reply out = HelioConfig.parse(reply);

        assertTrue(out.ok);
        assertEquals(0x07, out.version);
        assertEquals(HelioConfig.SENSITIVITY_LOW, out.sensitivity());
        assertEquals(Boolean.TRUE, out.alert());
        assertEquals("LOW", HelioConfig.sensitivityName(out.sensitivity()));
    }

    /**
     * A length-prefixed list has to be stepped over properly.
     *
     * <p>Reading one byte and moving on would leave the cursor inside the list,
     * and every argument after it would be decoded from the wrong bytes - which
     * is the failure that reports a plausible number for the wrong setting.
     */
    @Test
    public void aByteListDoesNotSwallowTheArgumentsAfterIt() {
        final byte[] reply = {
                0x04, 0x01, 0x09, 0x01, 0x00, 0x02,
                0x40, 0x11, 0x05, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, // five categories
                0x42, 0x10, 0x00, //                              HIGH
        };
        final HelioConfig.Reply out = HelioConfig.parse(reply);
        assertTrue(out.ok);
        assertEquals(HelioConfig.SENSITIVITY_HIGH, out.sensitivity());
    }

    // Constraints put a min and a max behind each value. Asked for or not, the
    // parser has to agree with the flag or it reads the bounds as the next arg.
    @Test
    public void constraintsAreSteppedOverWhenTheBandSaysTheyArePresent() {
        final byte[] reply = {
                0x04, 0x01, 0x09, 0x01, 0x01, 0x02,
                0x42, 0x10, 0x02, 0x00, 0x02, // LOW, min 0, max 2
                0x41, 0x0b, 0x01, 0x00, 0x01, // alerts on, min 0, max 1
        };
        final HelioConfig.Reply out = HelioConfig.parse(reply);
        assertTrue(out.ok);
        assertEquals(HelioConfig.SENSITIVITY_LOW, out.sensitivity());
        assertEquals(Boolean.TRUE, out.alert());
    }

    // A settings screen that cannot read the band must say so. A throw inside a
    // BLE callback takes the foreground service down with it.
    @Test
    public void anythingUnreadableComesBackNotOkRatherThanThrowing() {
        assertFalse(HelioConfig.parse(null).ok);
        assertFalse(HelioConfig.parse(new byte[0]).ok);
        assertFalse(HelioConfig.parse(new byte[]{0x04, 0x01}).ok);
        // Status byte other than success.
        assertFalse(HelioConfig.parse(new byte[]{0x04, 0x00, 0x09, 0x01, 0x00, 0x00}).ok);
        // A different command entirely.
        assertFalse(HelioConfig.parse(new byte[]{0x02, 0x01, 0x09, 0x01, 0x00, 0x00}).ok);
    }

    @Test
    public void aTruncatedEntryStopsRatherThanReadingPastTheEnd() {
        final byte[] cut = {0x04, 0x01, 0x09, 0x01, 0x00, 0x02, 0x42, 0x10, 0x01, 0x41};
        final HelioConfig.Reply out = HelioConfig.parse(cut);
        // What was read before the cut still stands.
        assertEquals(HelioConfig.SENSITIVITY_STANDARD, out.sensitivity());
    }

    /**
     * An unknown type has an unknown width, so the cursor cannot move past it.
     *
     * <p>Everything already read stays; guessing a length would report values
     * taken from the middle of some other field.
     */
    @Test
    public void anUnknownTypeStopsTheWalkWithoutDiscardingWhatCameBefore() {
        final byte[] reply = {
                0x04, 0x01, 0x09, 0x01, 0x00, 0x02,
                0x42, 0x10, 0x01, //       STANDARD
                0x41, 0x7f, 0x00, 0x00, // a type this build has never heard of
        };
        final HelioConfig.Reply out = HelioConfig.parse(reply);
        assertTrue(out.ok);
        assertEquals(HelioConfig.SENSITIVITY_STANDARD, out.sensitivity());
        assertNull(out.alert());
    }

    @Test
    public void anAbsentSettingReadsAsAbsentRatherThanAsZero() {
        final HelioConfig.Reply out =
                HelioConfig.parse(new byte[]{0x04, 0x01, 0x09, 0x01, 0x00, 0x00});
        assertTrue(out.ok);
        // -1 rather than 0, because 0 is HIGH and would be a confident lie.
        assertEquals(-1, out.sensitivity());
        assertNull(out.alert());
        assertEquals("UNKNOWN", HelioConfig.sensitivityName(out.sensitivity()));
    }

    @Test
    public void anAckIsOnlyAnAckWhenItSaysSo() {
        assertTrue(HelioConfig.accepted(new byte[]{0x06, 0x01}));
        assertFalse(HelioConfig.accepted(new byte[]{0x06, 0x00}));
        assertFalse(HelioConfig.accepted(new byte[]{0x04, 0x01}));
        assertFalse(HelioConfig.accepted(null));
        assertFalse(HelioConfig.accepted(new byte[]{0x06}));
    }
}
