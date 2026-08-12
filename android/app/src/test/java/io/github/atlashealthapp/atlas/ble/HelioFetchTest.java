package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/**
 * Regression test for the 2026-07-28 bug: a real workout decoded as 08:20 when
 * it actually happened at 18:20 (AEST, UTC+10). Root cause was
 * {@code parseStartDate} ignoring the response's 8th byte - a quarter-hour UTC
 * offset in the same format {@link HelioFetch}'s own {@code timeBytes} sends on
 * the request - and instead silently treating the raw hour/minute fields as
 * already being in the device's own current zone.
 *
 * Expected values are computed independently via {@code java.time}, not via
 * {@link java.util.Calendar}, so this cannot pass by accident just because it
 * shares Calendar's own bug.
 */
public class HelioFetchTest {

    private static byte[] datePayload(final int year, final int month, final int day,
                                      final int hour, final int minute, final int second,
                                      final Integer offsetQuarterHours) {
        final int length = offsetQuarterHours == null ? 7 : 8;
        final byte[] payload = new byte[length];
        payload[0] = (byte) (year & 0xff);
        payload[1] = (byte) ((year >> 8) & 0xff);
        payload[2] = (byte) month;
        payload[3] = (byte) day;
        payload[4] = (byte) hour;
        payload[5] = (byte) minute;
        payload[6] = (byte) second;
        if (offsetQuarterHours != null) {
            payload[7] = (byte) (int) offsetQuarterHours;
        }
        return payload;
    }

    @Test
    public void decodesFieldsAsWallClockInTheReportedOffsetNotTheDeviceZone() {
        // The band reports this workout in UTC (offset 0): 08:20:41 UTC.
        final byte[] payload = datePayload(2026, 7, 27, 8, 20, 41, 0);
        final long got = HelioFetch.parseStartDate(payload, 0);

        final long expected = OffsetDateTime.of(2026, 7, 27, 8, 20, 41, 0, ZoneOffset.UTC)
                .toInstant().toEpochMilli();
        assertEquals(expected, got);
    }

    @Test
    public void anOffsetOfPlusTenHoursShiftsTheInstantTenHoursEarlierThanUtc() {
        // Same raw wall-clock fields (08:20:41), but the band says AEST (+10)
        // this time: 08:20:41+10:00 is an earlier UTC instant than 08:20:41Z,
        // by exactly ten hours - the direct regression check for the bug,
        // where that offset byte was silently discarded.
        final byte[] utcPayload = datePayload(2026, 7, 27, 8, 20, 41, 0);
        final byte[] aestPayload = datePayload(2026, 7, 27, 8, 20, 41, 40); // 40 * 15min = 10h

        final long utcMillis = HelioFetch.parseStartDate(utcPayload, 0);
        final long aestMillis = HelioFetch.parseStartDate(aestPayload, 0);

        assertEquals(utcMillis - 10L * 60 * 60 * 1000, aestMillis);
    }

    @Test
    public void readsFromTheGivenOffsetWithinALargerPayload() {
        // Mirrors how onStartDateResponse calls this: the date fields start at
        // byte 7 of a longer control-response payload, not at byte 0.
        final byte[] tail = datePayload(2026, 1, 1, 0, 0, 0, 0);
        final byte[] payload = new byte[7 + tail.length];
        System.arraycopy(tail, 0, payload, 7, tail.length);

        final long got = HelioFetch.parseStartDate(payload, 7);
        final long expected = OffsetDateTime.of(2026, 1, 1, 0, 0, 0, 0, ZoneOffset.UTC)
                .toInstant().toEpochMilli();
        assertEquals(expected, got);
    }

    @Test
    public void toleratesA7ByteResponseWithNoOffsetByte() {
        // Some firmwares may omit it; this must not throw an ArrayIndexOutOfBoundsException.
        final byte[] payload = datePayload(2026, 7, 27, 8, 20, 41, null);
        // No assertion on the exact value here (it falls back to the device's
        // own default zone, which is not fixed in a test environment) - only
        // that decoding a short payload does not crash.
        HelioFetch.parseStartDate(payload, 0);
    }

    @Test
    public void handlesANegativeOffsetWestOfUtc() {
        // -20 quarter-hours = -5 hours, e.g. US Eastern-ish. The offset byte is
        // signed, so this must not be misread as a huge positive value.
        final byte[] payload = datePayload(2026, 7, 27, 8, 20, 41, -20);
        final long got = HelioFetch.parseStartDate(payload, 0);

        final long expected = OffsetDateTime.of(2026, 7, 27, 8, 20, 41, 0, ZoneOffset.ofHours(-5))
                .toInstant().toEpochMilli();
        assertEquals(expected, got);
    }
}
