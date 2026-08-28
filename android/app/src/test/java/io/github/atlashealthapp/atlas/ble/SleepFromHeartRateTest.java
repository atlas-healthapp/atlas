package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.List;

import org.junit.Test;

/**
 * The heart-rate fallback, which only ever runs when the band has gone quiet.
 *
 * <p>Every gate here removed a way of being confidently wrong, so each has a
 * test naming the failure it prevents.
 */
public class SleepFromHeartRateTest {

    private static final long NOW = 1_756_000_000_000L;
    private static final double RESTING = 50;

    /** {@code count} readings a minute apart, the newest {@code ageMin} old. */
    private static List<HelioFetch.Sample> hr(final int count, final double value, final long ageMin) {
        final List<HelioFetch.Sample> out = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            out.add(new HelioFetch.Sample("hr", NOW - (ageMin + i) * 60_000L, value));
        }
        return out;
    }

    @Test
    public void aSteadyRestingRateReadsAsAsleep() {
        // 52 against a resting 50 is a ratio of 1.04, inside the measured knee.
        final SleepFromHeartRate.Verdict v =
                SleepFromHeartRate.verdict(hr(10, 52, 1), RESTING, NOW);
        assertTrue(v.asleep);
        assertEquals(10, v.samples);
        assertTrue(v.summary().contains("ASLEEP"));
    }

    // The measured knee: 1.10 of resting. 55 of 50 is exactly on it and must
    // pass, since the sweep counted it as a fire.
    @Test
    public void theThresholdIsInclusive() {
        assertTrue(SleepFromHeartRate.verdict(hr(10, 55, 1), RESTING, NOW).asleep);
        assertFalse(SleepFromHeartRate.verdict(hr(10, 56, 1), RESTING, NOW).asleep);
    }

    @Test
    public void aWakingRateDoesNotReadAsAsleep() {
        // 68 of 50 is 1.36 - the middle of the measured awake distribution.
        final SleepFromHeartRate.Verdict v =
                SleepFromHeartRate.verdict(hr(10, 68, 1), RESTING, NOW);
        assertFalse(v.asleep);
        assertEquals("rate too high", v.why);
    }

    // Five readings that all arrived twelve minutes ago describe then, not now.
    // Without this gate the fallback repeats the staleness mistake it exists to
    // work around.
    @Test
    public void staleReadingsAreRefusedEvenWhenTheyLookLikeSleep() {
        final SleepFromHeartRate.Verdict v =
                SleepFromHeartRate.verdict(hr(6, 48, 9), RESTING, NOW);
        assertFalse(v.asleep);
        assertEquals("readings too old", v.why);
    }

    // A mean of one reading is not a mean. Same rule as MIN_BUCKET_SAMPLES.
    @Test
    public void tooFewReadingsIsNotAnAverage() {
        final SleepFromHeartRate.Verdict v =
                SleepFromHeartRate.verdict(hr(3, 48, 1), RESTING, NOW);
        assertFalse(v.asleep);
        assertEquals("too few readings", v.why);
    }

    // Without a personal baseline there is no threshold, and a population
    // figure would be one fitted to nobody. Resting ran 46 to 62 over the 20
    // days these constants came from.
    @Test
    public void withoutARestingBaselineItSaysNothing() {
        final SleepFromHeartRate.Verdict v = SleepFromHeartRate.verdict(hr(10, 48, 1), 0, NOW);
        assertFalse(v.asleep);
        assertEquals("no resting baseline", v.why);
    }

    // The band writes 0xff for a minute it has no reading for. Counted, a strap
    // on its charger would put 255 into the mean and nothing would ever fire.
    @Test
    public void theNoReadingSentinelIsNotAHeartRate() {
        final List<HelioFetch.Sample> mixed = hr(8, 50, 1);
        mixed.add(new HelioFetch.Sample("hr", NOW - 30_000L, 255));
        final SleepFromHeartRate.Verdict v = SleepFromHeartRate.verdict(mixed, RESTING, NOW);
        assertTrue(v.asleep);
        assertEquals(8, v.samples);
    }

    @Test
    public void otherMetricsAreIgnored() {
        final List<HelioFetch.Sample> mixed = hr(8, 50, 1);
        for (int i = 0; i < 20; i++) {
            mixed.add(new HelioFetch.Sample("steps", NOW - i * 60_000L, 900));
        }
        assertEquals(8, SleepFromHeartRate.verdict(mixed, RESTING, NOW).samples);
    }

    @Test
    public void readingsOutsideTheWindowAreNotCounted() {
        final List<HelioFetch.Sample> old = hr(10, 50, 30);
        final SleepFromHeartRate.Verdict v = SleepFromHeartRate.verdict(old, RESTING, NOW);
        assertFalse(v.asleep);
        assertEquals(0, v.samples);
        assertEquals("no readings", v.why);
    }

    // A sample stamped after now is a clock that moved, not a reading.
    @Test
    public void futureStampedReadingsAreDropped() {
        final List<HelioFetch.Sample> future = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            future.add(new HelioFetch.Sample("hr", NOW + (i + 1) * 60_000L, 50));
        }
        assertEquals(0, SleepFromHeartRate.verdict(future, RESTING, NOW).samples);
    }

    @Test
    public void nothingAtAllIsSafe() {
        assertFalse(SleepFromHeartRate.verdict(null, RESTING, NOW).asleep);
        assertFalse(SleepFromHeartRate.verdict(new ArrayList<>(), RESTING, NOW).asleep);
    }

    /**
     * The morning this was built for, and <b>it does not catch it</b>.
     *
     * <p>2026-08-21, checked at 08:40, genuinely in light sleep since 08:24.
     * The archive's readings across that window run 60-63 and the night's
     * resting rate was 47, a ratio of about 1.30. That sits inside the awake
     * distribution, so no threshold catches this morning without being wrong on
     * more than half of the genuinely-awake windows.
     *
     * <p>This test exists to pin that failure rather than let a future change
     * quietly assume the fallback works. If it ever starts passing, the
     * threshold has been loosened and the false-positive rate needs re-measuring
     * before anything is allowed to fire on it.
     */
    @Test
    public void theMorningItWasBuiltForIsStillMissed() {
        final List<HelioFetch.Sample> morning = new ArrayList<>();
        final double[] measured = {60, 62, 61, 60, 63, 60, 61, 62, 60, 61, 63, 62, 60, 61};
        for (int i = 0; i < measured.length; i++) {
            morning.add(new HelioFetch.Sample("hr", NOW - (i + 1) * 60_000L, measured[i]));
        }
        final SleepFromHeartRate.Verdict v = SleepFromHeartRate.verdict(morning, 47, NOW);
        assertFalse(v.asleep);
        assertEquals("rate too high", v.why);
        // The evidence is still recorded, which is the point of keeping it.
        assertEquals(14, v.samples);
        assertTrue(v.summary().contains("ratio=1.30"));
    }
}
