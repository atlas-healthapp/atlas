package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

/**
 * The byte layout, pinned.
 *
 * Worth testing precisely because the failure mode is silent: the band drops a
 * message it cannot parse without replying, so a wrong offset here does not
 * throw, log or fail a sync. It just means the alarm never goes off, which is
 * discovered by oversleeping.
 */
public class HelioAlarmTest {

    @Test
    public void buildsAOneOffEnabledAlarm() {
        // 07:05, slot 0, enabled, not smart, no repeat.
        assertArrayEquals(
                new byte[]{0x03, 0x01, 0x04, 0x00, 0x07, 0x05, 0x00, 0, 0, 0, 0, 0},
                HelioAlarm.create(0, 7, 5, true, false, HelioAlarm.REPEAT_ONCE));
    }

    @Test
    public void smartAndEnabledAreSeparateBits() {
        // 0x04 | 0x01 = 0x05. A single combined "on" flag would send 0x01 or
        // 0x04 here and lose one of the two facts.
        assertEquals(0x05, HelioAlarm.create(0, 8, 30, true, true, 0)[2]);
        assertEquals(0x01, HelioAlarm.create(0, 8, 30, false, true, 0)[2]);
        assertEquals(0x00, HelioAlarm.create(0, 8, 30, false, false, 0)[2]);
    }

    @Test
    public void carriesSlotHourMinuteAndRepeatInOrder() {
        // A transposed hour and minute is the mistake this catches: 09:23 and
        // 23:09 are both valid times, so nothing downstream would object.
        final byte[] message = HelioAlarm.create(3, 9, 23, true, false, 0x1f);
        assertEquals(3, message[3]);
        assertEquals(9, message[4]);
        assertEquals(23, message[5]);
        assertEquals(0x1f, message[6]);
    }

    @Test
    public void isAlwaysTwelveBytes() {
        assertEquals(12, HelioAlarm.create(0, 0, 0, true, false, 0).length);
        assertEquals(12, HelioAlarm.create(9, 23, 59, true, true, 0x7f).length);
    }

    @Test
    public void refusesAnImpossibleTimeRatherThanTruncatingIt() {
        // (byte) 24 is a perfectly good byte, which is the whole problem: masked
        // into place it becomes an alarm at a time nobody asked for.
        assertThrows(IllegalArgumentException.class, () -> HelioAlarm.create(0, 24, 0, true, false, 0));
        assertThrows(IllegalArgumentException.class, () -> HelioAlarm.create(0, -1, 0, true, false, 0));
        assertThrows(IllegalArgumentException.class, () -> HelioAlarm.create(0, 8, 60, true, false, 0));
        assertThrows(IllegalArgumentException.class, () -> HelioAlarm.create(0, 8, 0, true, false, 0x80));
        assertThrows(IllegalArgumentException.class, () -> HelioAlarm.create(-1, 8, 0, true, false, 0));
    }
}
