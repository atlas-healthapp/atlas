package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * Which bonded Bluetooth names count as the strap.
 *
 * <p>This exists because of a real report. A public user on 1.0.5 could not
 * connect and their log said {@code no bonded device named "Amazfit Helio Strap"}
 * with a working band on the phone. The lookup was an exact string equality
 * against the one name the author's own unit advertises, and Amazfit devices
 * commonly append a serial or MAC fragment.
 *
 * <p>The matcher is deliberately loose in one direction and tight in the other:
 * it has to survive suffixes, case and punctuation, and it must not claim a car
 * stereo or a pair of earbuds, because a false positive would open a GATT
 * connection to somebody's headphones and fail in a far more confusing way.
 */
public class HelioLinkNameTest {

    @Test
    public void matchesTheNameTheAuthorsBandAdvertises() {
        assertTrue(HelioLink.matchesStrapName("Amazfit Helio Strap"));
    }

    @Test
    public void matchesASerialOrMacSuffix() {
        // The reported failure. Amazfit appends these on plenty of units.
        assertTrue(HelioLink.matchesStrapName("Amazfit Helio Strap A2302"));
        assertTrue(HelioLink.matchesStrapName("Amazfit Helio Strap-1A2B"));
        assertTrue(HelioLink.matchesStrapName("Amazfit Helio Strap 8C:DE:52"));
    }

    @Test
    public void ignoresCaseAndPunctuation() {
        assertTrue(HelioLink.matchesStrapName("amazfit helio strap"));
        assertTrue(HelioLink.matchesStrapName("AMAZFIT HELIO STRAP"));
        assertTrue(HelioLink.matchesStrapName("Amazfit-Helio-Strap"));
        assertTrue(HelioLink.matchesStrapName("Amazfit_Helio_Strap"));
        assertTrue(HelioLink.matchesStrapName("  Amazfit Helio Strap  "));
    }

    @Test
    public void matchesAHelioStrapWithoutTheBrandInFront() {
        assertTrue(HelioLink.matchesStrapName("Helio Strap"));
        assertTrue(HelioLink.matchesStrapName("My Helio Strap"));
    }

    @Test
    public void refusesEverythingElseAPersonHasPaired() {
        // A false positive opens a GATT connection to the wrong device, which
        // fails later and far less legibly than not finding anything at all.
        assertFalse(HelioLink.matchesStrapName("Galaxy Buds Pro"));
        assertFalse(HelioLink.matchesStrapName("Car Audio"));
        assertFalse(HelioLink.matchesStrapName("Amazfit GTR 4"));
        assertFalse(HelioLink.matchesStrapName("Mi Band 7"));
        assertFalse(HelioLink.matchesStrapName("Helios Speaker"));
        assertFalse(HelioLink.matchesStrapName(""));
    }

    @Test
    public void survivesAnUnnamedBondRatherThanThrowing() {
        // getName() is documented as nullable and a bonded device really can
        // report null before its name has been fetched.
        assertFalse(HelioLink.matchesStrapName(null));
    }
}
