package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Base64;

import org.junit.Test;

/**
 * Known-answer tests, not self-consistency ones. The three blobs below are
 * real {@code RAW_SUMMARY_DATA} rows pulled from the user's own Gadgetbridge
 * export on 2026-07-28 (workout ids 1, 11 and 15 - the last one labelled
 * "Indoor Climbing" in Gadgetbridge's own UI). Expected values were read off
 * an independent generic protobuf dump of the same bytes and cross-checked
 * against Gadgetbridge's own field numbers in huami.proto, not derived from
 * this reader - a self-consistency test here would happily pass with the
 * wrong field number for every one of these getters at once.
 *
 * Pure JVM, no Robolectric: java.util.Base64 rather than android.util.Base64,
 * matching every other test in this package.
 */
public class HuamiProtobufTest {

    private static final int TYPE = 3;
    private static final int TIME = 7;
    private static final int CALORIES = 16;
    private static final int HEART_RATE = 19;

    private static final int TYPE_CODE = 1;
    private static final int TYPE_AI = 2;
    private static final int TIME_TOTAL_DURATION = 1;
    private static final int TIME_WORKOUT_DURATION = 2;
    private static final int CALORIES_KCAL = 1;
    private static final int HR_AVG = 1;
    private static final int HR_MAX = 2;
    private static final int HR_MIN = 3;

    /** id 15, "Indoor Climbing" per Gadgetbridge, no GPS/altitude (indoor). */
    private static final String WORKOUT_15 =
            "AIAKAzIuMRINCIv/ldMGEAAYUGiBAhoFCN8BEAE6CQiwVRCwVWDgA1oKDby7uz4VAJEeQIIBAwjkCpoBBwh5ELQBGEKqAQwlMzNTQC1mZoZAMHSyARsIARIKXnCDAZYBqQG8ARoL0QK+GOEokQ3qA0A=";

    /** id 1, unlabelled/auto-detected, shorter session. */
    private static final String WORKOUT_1 =
            "AIAKAzIuMRINCKHigdMGEAAYUGiBAhoFCN8BEAE6CQj4AhD4AmC0AVoKDRERET8Vl/8oQIIBAggqmgEHCHcQkQEYYaoBDCXNzIw/Lc3MzD0wB7IBGAgBEgpecIMBlgGpAbwBGggAlwGGAVkAAA==";

    private static HuamiProtobuf.Message summaryOf(final String base64) {
        final byte[] raw = Base64.getDecoder().decode(base64);
        // The first two bytes are a version marker (0x8000 here), not part of
        // the protobuf message - the same split HelioFetch.parseWorkout uses.
        return HuamiProtobuf.parse(raw, 2, raw.length - 2);
    }

    @Test
    public void decodesTypeAndAiFlagForIndoorClimbing() {
        final HuamiProtobuf.Message type = summaryOf(WORKOUT_15).getMessage(TYPE);

        // Not a named type in Gadgetbridge's ~125-entry table - every real
        // session on this band is auto-detected and carries this code.
        assertEquals(Integer.valueOf(223), type.getInt(TYPE_CODE));
        assertEquals(Integer.valueOf(1), type.getInt(TYPE_AI));
    }

    @Test
    public void decodesDurationForIndoorClimbing() {
        final HuamiProtobuf.Message time = summaryOf(WORKOUT_15).getMessage(TIME);

        assertEquals(Integer.valueOf(10928), time.getInt(TIME_TOTAL_DURATION));
        assertEquals(Integer.valueOf(10928), time.getInt(TIME_WORKOUT_DURATION));
    }

    @Test
    public void decodesCaloriesAndHeartRateForIndoorClimbing() {
        final HuamiProtobuf.Message summary = summaryOf(WORKOUT_15);

        assertEquals(Integer.valueOf(1380), summary.getMessage(CALORIES).getInt(CALORIES_KCAL));

        final HuamiProtobuf.Message hr = summary.getMessage(HEART_RATE);
        assertEquals(Integer.valueOf(121), hr.getInt(HR_AVG));
        assertEquals(Integer.valueOf(180), hr.getInt(HR_MAX));
        assertEquals(Integer.valueOf(66), hr.getInt(HR_MIN));
    }

    @Test
    public void decodesAShorterUnlabelledSession() {
        final HuamiProtobuf.Message summary = summaryOf(WORKOUT_1);

        final HuamiProtobuf.Message type = summary.getMessage(TYPE);
        assertEquals(Integer.valueOf(223), type.getInt(TYPE_CODE));

        final HuamiProtobuf.Message time = summary.getMessage(TIME);
        assertEquals(Integer.valueOf(376), time.getInt(TIME_TOTAL_DURATION));

        assertEquals(Integer.valueOf(42), summary.getMessage(CALORIES).getInt(CALORIES_KCAL));

        final HuamiProtobuf.Message hr = summary.getMessage(HEART_RATE);
        assertEquals(Integer.valueOf(119), hr.getInt(HR_AVG));
        assertEquals(Integer.valueOf(145), hr.getInt(HR_MAX));
        assertEquals(Integer.valueOf(97), hr.getInt(HR_MIN));
    }

    /** Neither real session has GPS/altitude data (both indoor), so absence must read as null, not zero. */
    @Test
    public void fieldsAbsentFromTheRealBlobDecodeAsNullNotZero() {
        final HuamiProtobuf.Message summary = summaryOf(WORKOUT_15);

        assertNull("distance", summary.getMessage(4));
        assertNull("altitude", summary.getMessage(13));
    }

    @Test
    public void roundTripsAVarintFieldAtTheThreeByteBoundary() {
        // 300 needs two continuation bytes (0xAC 0x02), the smallest varint
        // that does not fit in a single byte - the actual boundary a
        // single-byte-only bug would miss.
        final byte[] data = {0x08, (byte) 0xAC, 0x02};
        assertEquals(Integer.valueOf(300), HuamiProtobuf.parse(data).getInt(1));
    }

    @Test
    public void roundTripsAFloat32Field() {
        // field 1, wire type 5 (float32), value 2.5f = 0x40200000 little-endian
        final byte[] data = {0x0D, 0x00, 0x00, 0x20, 0x40};
        assertEquals(2.5f, HuamiProtobuf.parse(data).getFloat(1), 0.0001f);
    }
}
