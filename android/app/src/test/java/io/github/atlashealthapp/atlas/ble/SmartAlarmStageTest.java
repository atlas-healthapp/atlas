package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Reading the band's live stage out of a sleep blob, and saying how old it is.
 *
 * <p>These exist because the staleness check moved: it used to sit inside the
 * scan, and now the scan reports the freshest reading and
 * {@link SmartAlarm#currentStage} judges it. That split is what lets the trail
 * record the age of a reading the decision rejected, which is the difference
 * between "the band was silent" and "the sync was half an hour old" on a morning
 * that did not wake you. The decision itself must not have changed.
 */
public class SmartAlarmStageTest {

    private static final int OFF_MIDNIGHT = 0x04;
    private static final int OFF_SLEEP_START = 0x0a;
    private static final int OFF_SEGMENT_COUNT = 0x54;
    private static final int OFF_SEGMENTS = 0x56;
    private static final int BLOB_BYTES = 0x300;

    private static final int STAGE_LIGHT = 4;
    private static final int STAGE_DEEP = 5;

    /** Midnight of the blob's own day. The layout counts from the day before it. */
    private static final long MIDNIGHT_SECONDS = 1_786_000_000L;
    private static final long DAY_BASE_MS = (MIDNIGHT_SECONDS - 24 * 3600L) * 1000L;

    private static void u16(final byte[] b, final int at, final int v) {
        b[at] = (byte) (v & 0xff);
        b[at + 1] = (byte) ((v >> 8) & 0xff);
    }

    private static void u32(final byte[] b, final int at, final long v) {
        for (int i = 0; i < 4; i++) {
            b[at + i] = (byte) ((v >> (8 * i)) & 0xff);
        }
    }

    /** A blob whose segments are {from, to, stage} triples, minutes from dayBase. */
    private static byte[] blob(final int[]... segments) {
        final byte[] b = new byte[BLOB_BYTES];
        u32(b, OFF_MIDNIGHT, MIDNIGHT_SECONDS);
        u16(b, OFF_SLEEP_START, segments.length > 0 ? segments[0][0] : 0);
        b[OFF_SEGMENT_COUNT] = (byte) segments.length;
        for (int i = 0; i < segments.length; i++) {
            final int at = OFF_SEGMENTS + i * 5;
            u16(b, at, segments[i][0]);
            u16(b, at + 2, segments[i][1]);
            b[at + 4] = (byte) segments[i][2];
        }
        return b;
    }

    /** Wall-clock millis for a minute offset from the blob's own day base. */
    private static long at(final int minute) {
        return DAY_BASE_MS + minute * 60_000L;
    }

    private static List<byte[]> one(final byte[] b) {
        return Collections.singletonList(b);
    }

    @Test
    public void readsTheStageCoveringTheMomentAsked() {
        final List<byte[]> sessions = one(blob(new int[]{1800, 1859, STAGE_LIGHT},
                new int[]{1860, 1899, STAGE_DEEP}));

        assertEquals(STAGE_LIGHT, SmartAlarm.currentStage(sessions, at(1850)));
        assertEquals(STAGE_DEEP, SmartAlarm.currentStage(sessions, at(1890)));
    }

    @Test
    public void refusesAReadingTooOldToDescribeNow() {
        // The guard the split had to preserve: the segment ends at 1860 and we
        // ask forty minutes later, so the band has said nothing recent.
        final List<byte[]> sessions = one(blob(new int[]{1800, 1859, STAGE_LIGHT}));

        assertEquals(STAGE_LIGHT, SmartAlarm.currentStage(sessions, at(1865)));
        assertEquals(-1, SmartAlarm.currentStage(sessions, at(1900)));
    }

    @Test
    public void reportsTheAgeOfAReadingTheDecisionRejected() {
        // The whole reason for the split. Same input, same refusal above, but
        // the trail can now say the sync was forty minutes stale rather than
        // leaving "stage=-1" to mean any of three different failures.
        final List<byte[]> sessions = one(blob(new int[]{1800, 1859, STAGE_LIGHT}));

        assertEquals(40, SmartAlarm.readingAgeMinutes(sessions, at(1900)));
        assertEquals(-1, SmartAlarm.currentStage(sessions, at(1900)));
    }

    @Test
    public void saysThereIsNoReadingAtAllWithMinusOne() {
        assertEquals(-1, SmartAlarm.readingAgeMinutes(null, at(1900)));
        assertEquals(-1, SmartAlarm.readingAgeMinutes(new ArrayList<>(), at(1900)));
        // A blob too short to be a sleep session is not a reading either.
        assertEquals(-1, SmartAlarm.readingAgeMinutes(one(new byte[16]), at(1900)));
    }

    @Test
    public void ignoresSegmentsThatHaveNotStartedYet() {
        // The band writes the whole night as it currently believes it, including
        // revisions that run past now. Taking one would report a stage nobody
        // has been in yet.
        final List<byte[]> sessions = one(blob(new int[]{1800, 1859, STAGE_LIGHT},
                new int[]{1860, 1919, STAGE_DEEP}));

        assertEquals(STAGE_LIGHT, SmartAlarm.currentStage(sessions, at(1855)));
    }

    @Test
    public void takesTheLatestEndingSegmentAcrossEverySessionOffered() {
        // A sync hands over several revisions at once and they are not ordered.
        final List<byte[]> sessions = new ArrayList<>(Arrays.asList(
                blob(new int[]{1800, 1899, STAGE_DEEP}),
                blob(new int[]{1800, 1919, STAGE_LIGHT})));

        assertEquals(STAGE_LIGHT, SmartAlarm.currentStage(sessions, at(1921)));
        assertTrue(SmartAlarm.readingAgeMinutes(sessions, at(1921)) <= 1);
    }
}
