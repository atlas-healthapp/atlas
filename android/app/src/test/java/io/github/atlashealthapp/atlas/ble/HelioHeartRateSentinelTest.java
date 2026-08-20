package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Regression test for the 2026-08-19 bug: the HEART widget read 255 BPM while
 * the strap was on its charger.
 *
 * <p>The band writes {@code 0xff} into the heart-rate byte for a minute it has
 * no reading for, exactly as it does for stress. The stress guard existed and
 * the heart-rate one did not, so the sentinel travelled as a real pulse into
 * {@code hrNow} and into the {@code hr48} buckets the widget's chart is drawn
 * from. It never reached the archive, because the app's {@code isMeaningful}
 * drops it on ingest, which is exactly what made it look like a widget defect:
 * the card read 255, opening Atlas corrected it, and the next background sync
 * put it straight back.
 *
 * <p>Measured on the device before the fix: 4,179 heart-rate samples over three
 * days, maximum 165, not one 255. The leak was only ever native.
 */
public class HelioHeartRateSentinelTest {

    @Test
    public void rejectsTheBandsNoReadingSentinel() {
        assertFalse("0xff is the band's \"no reading\", not a 255 BPM pulse",
                HelioFetch.isRealHeartRate(255));
    }

    @Test
    public void rejectsZeroAndNegatives() {
        assertFalse(HelioFetch.isRealHeartRate(0));
        assertFalse(HelioFetch.isRealHeartRate(-1));
    }

    @Test
    public void acceptsBothEndsOfThePlausibleRange() {
        assertTrue(HelioFetch.isRealHeartRate(25));
        assertTrue(HelioFetch.isRealHeartRate(200));
    }

    @Test
    public void rejectsJustOutsideBothEnds() {
        assertFalse(HelioFetch.isRealHeartRate(24));
        assertFalse(HelioFetch.isRealHeartRate(201));
    }

    @Test
    public void acceptsAnOrdinaryReading() {
        // The archive's real maximum over the three days this was measured on.
        assertTrue(HelioFetch.isRealHeartRate(165));
        assertTrue(HelioFetch.isRealHeartRate(47));
    }
}
