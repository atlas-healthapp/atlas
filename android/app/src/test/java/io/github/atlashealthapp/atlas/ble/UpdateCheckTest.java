package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The comparison, which is the whole feature, and the reply parsing under it.
 *
 * <p>A wrong answer is worse than no notification in both directions: a false
 * positive puts "Atlas 1.0.9 is available" in the shade of somebody already on
 * 1.0.9 and cannot be dismissed permanently, and a false negative leaves them on
 * a build whose bug is fixed, which is the situation the whole update check was
 * built for.
 */
public class UpdateCheckTest {

    @Test
    public void readsTheTagOutOfTheApiReply() {
        // Trimmed to the shape that matters: the field is a plain string in a
        // flat object, wherever it happens to sit in the body.
        assertEquals("v1.0.9", UpdateCheck.tagFromJson(
                "{\"url\":\"x\",\"tag_name\":\"v1.0.9\",\"name\":\"1.0.9\"}"));
        assertEquals("v1.0.9", UpdateCheck.tagFromJson("{\"tag_name\" : \"v1.0.9\"}"));
    }

    @Test
    public void refusesAReplyItCannotRead() {
        // A body that has changed shape must read as "no answer" rather than as
        // a version, or a GitHub change becomes a notification storm.
        assertNull(UpdateCheck.tagFromJson(null));
        assertNull(UpdateCheck.tagFromJson(""));
        assertNull(UpdateCheck.tagFromJson("{\"message\":\"Not Found\"}"));
        assertNull(UpdateCheck.tagFromJson("{\"tag_name\":\"\"}"));
        assertNull(UpdateCheck.tagFromJson("{\"tag_name\":123}"));
    }

    @Test
    public void readsTheShapesTheReleasesPageProduces() {
        assertArrayEquals(new int[] {1, 0, 9}, UpdateCheck.parseVersion("1.0.9"));
        assertArrayEquals(new int[] {1, 0, 9}, UpdateCheck.parseVersion("v1.0.9"));
        assertArrayEquals(new int[] {1, 0, 9}, UpdateCheck.parseVersion("V1.0.9"));
        assertArrayEquals(new int[] {1, 0, 9}, UpdateCheck.parseVersion(" 1.0.9 "));
    }

    @Test
    public void dropsTheSuffixADebugBuildCarries() {
        // So a debug build is offered the same update a release would be.
        assertArrayEquals(new int[] {1, 0, 8}, UpdateCheck.parseVersion("1.0.8+a1b2c3d-dev"));
        assertArrayEquals(new int[] {1, 0, 8}, UpdateCheck.parseVersion("1.0.8+dev"));
    }

    @Test
    public void refusesAnythingThatIsNotAVersion() {
        // The JS twin's own scar: "" and "-1.0.0" both parsed as version zero,
        // which would have made any garbage tag newer than everything.
        assertNull(UpdateCheck.parseVersion(null));
        assertNull(UpdateCheck.parseVersion(""));
        assertNull(UpdateCheck.parseVersion("   "));
        assertNull(UpdateCheck.parseVersion("-1.0.0"));
        assertNull(UpdateCheck.parseVersion("1..9"));
        assertNull(UpdateCheck.parseVersion("1.0.x"));
        assertNull(UpdateCheck.parseVersion("banana"));
        assertNull(UpdateCheck.parseVersion("1.0.0.0.0"));
    }

    @Test
    public void comparesPartByPartRatherThanAsANumber() {
        // 1.0.10 sorts below 1.0.9 as a decimal, and above it as a version.
        assertTrue(UpdateCheck.isNewer("1.0.10", "1.0.9"));
        assertFalse(UpdateCheck.isNewer("1.0.9", "1.0.10"));
        assertTrue(UpdateCheck.isNewer("1.1.0", "1.0.99"));
    }

    @Test
    public void isNotNewerThanItself() {
        assertFalse(UpdateCheck.isNewer("1.0.9", "1.0.9"));
        assertFalse(UpdateCheck.isNewer("1.0.9", "1.0.9+abc-dev"));
    }

    @Test
    public void treatsAMissingPartAsZero() {
        assertTrue(UpdateCheck.isNewer("1.1", "1.0.9"));
        assertFalse(UpdateCheck.isNewer("1.0", "1.0.1"));
    }

    @Test
    public void neverCallsUnreadableInputNewer() {
        // Either side. A malformed tag must not nag everybody forever, and a
        // build that cannot read its own version must not think it is stale.
        assertFalse(UpdateCheck.isNewer("banana", "1.0.9"));
        assertFalse(UpdateCheck.isNewer("1.0.9", "banana"));
        assertFalse(UpdateCheck.isNewer(null, "1.0.9"));
        assertFalse(UpdateCheck.isNewer("1.0.9", null));
    }

    /**
     * The property that keeps one release to one notification.
     *
     * <p>A release is named twice: the app mirrors it with the {@code v} already
     * stripped, and this service's own fetch reads the raw tag with it on. Both
     * are announced through one watermark, which is a string comparison, so the
     * two spellings have to collapse to the same value or the shade carries the
     * same sentence twice.
     */
    @Test
    public void spellsOneReleaseOneWay() {
        assertEquals("1.0.9", UpdateCheck.normalise("v1.0.9"));
        assertEquals("1.0.9", UpdateCheck.normalise("1.0.9"));
        assertEquals("1.0.9", UpdateCheck.normalise("  V1.0.9  "));
        assertEquals(UpdateCheck.normalise("v1.0.9"), UpdateCheck.normalise("1.0.9"));
    }

    @Test
    public void refusesToCanonicaliseSomethingThatIsNotAVersion() {
        // A spelling that cannot be canonicalised must never be recorded as one,
        // or the watermark fills up with junk that suppresses a real release.
        assertNull(UpdateCheck.normalise(null));
        assertNull(UpdateCheck.normalise(""));
        assertNull(UpdateCheck.normalise("   "));
        assertNull(UpdateCheck.normalise("banana"));
        assertNull(UpdateCheck.normalise("v"));
    }
}
