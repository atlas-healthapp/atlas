package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Regression test for the 2026-08-28 bug: the phone announced a three-minute
 * session that the app then refused to show.
 *
 * <p>{@code resolveSessions.js} hides a band-detected session under five minutes
 * from the list, the week chart, the month totals and Recovery's day markers -
 * they are what the band's detection sensitivity produces when it is turned up.
 * This service announced whatever was newer than its own watermark and knew
 * nothing about that rule, so the one place a three-minute walk DID appear was
 * a notification pointing at an app where it could not be found.
 *
 * <p>The rule here is deliberately the smaller half of the app's. Its other two
 * exemptions are annotations - a session you have named, noted, retimed or
 * duration-corrected is one you clearly want - and a record this service has
 * only just pulled off the band cannot carry one yet.
 */
public class SessionAnnounceNoiseTest {

    private static HelioFetch.Workout workout(final boolean autoDetected, final Integer activeSeconds) {
        return new HelioFetch.Workout(
                1_000L, 2_000L, 223, autoDetected, activeSeconds,
                null, null, null, null, null, null);
    }

    @Test
    public void agreesWithTheAppAboutWhereTheLineIs() {
        // The twin of MIN_AUTO_SESSION_SECONDS in resolveSessions.js. The JS side
        // reads this file and asserts the two match; this states the figure so a
        // reader of the Java alone knows what it is.
        assertEquals(300, HelioSyncService.MIN_AUTO_SESSION_SECONDS);
    }

    @Test
    public void treatsAShortAutoDetectedSessionAsNoise() {
        // The reported case: three minutes, auto detected, announced anyway.
        assertTrue(HelioSyncService.isDetectionNoise(workout(true, 3 * 60)));
    }

    @Test
    public void announcesAnAutoDetectedSessionOnTheLine() {
        // Five minutes exactly is a session, not noise. The next shortest real
        // walks in the archive are 6 and 9 minutes, which is what put the line
        // here rather than at ten.
        assertFalse(HelioSyncService.isDetectionNoise(workout(true, 5 * 60)));
    }

    @Test
    public void announcesAShortSessionYouStartedYourself() {
        // Not auto detected means you pressed start on the band. Three minutes of
        // something you deliberately began is still something you did.
        assertFalse(HelioSyncService.isDetectionNoise(workout(false, 3 * 60)));
    }

    @Test
    public void doesNotTreatAnUnknownDurationAsShort() {
        // No recorded duration is not evidence of being short, which is the
        // app's own wording for the same guard. A record with nothing to measure
        // is announced rather than silently dropped.
        assertFalse(HelioSyncService.isDetectionNoise(workout(true, null)));
        assertFalse(HelioSyncService.isDetectionNoise(workout(true, 0)));
    }

    @Test
    public void survivesAMissingRecord() {
        assertFalse(HelioSyncService.isDetectionNoise(null));
    }
}
