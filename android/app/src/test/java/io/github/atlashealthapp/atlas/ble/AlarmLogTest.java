package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

/**
 * The morning log, which exists because the tick trail could not keep one.
 *
 * <p>The behaviour that matters is that a morning is ONE record however many
 * times the window is looked inside, and that thirty of them survive whatever
 * else the service is doing.
 */
public class AlarmLogTest {

    private static Map<String, String> fields(final String... pairs) {
        final Map<String, String> out = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) out.put(pairs[i], pairs[i + 1]);
        return out;
    }

    @Test
    public void aMorningIsOneRecordHoweverManyChecks() {
        final FakePrefs prefs = new FakePrefs();
        AlarmLog.note(prefs, "2026-236", fields(AlarmLog.F_MODE, "smart", AlarmLog.F_SET, "09:00"));
        AlarmLog.note(prefs, "2026-236", fields(AlarmLog.F_CHECKS, "1", AlarmLog.F_STAGE, "-1"));
        AlarmLog.note(prefs, "2026-236", fields(AlarmLog.F_CHECKS, "2", AlarmLog.F_STAGE, "4"));

        assertEquals(1, AlarmLog.records(prefs).size());
        final String record = AlarmLog.forDay(prefs, "2026-236");
        // The last look wins: it is the one that decided.
        assertEquals("4", AlarmLog.field(record, AlarmLog.F_STAGE));
        assertEquals("2", AlarmLog.field(record, AlarmLog.F_CHECKS));
        // And nothing learned earlier is lost.
        assertEquals("smart", AlarmLog.field(record, AlarmLog.F_MODE));
        assertEquals("09:00", AlarmLog.field(record, AlarmLog.F_SET));
    }

    @Test
    public void separateMorningsAreSeparateRecords() {
        final FakePrefs prefs = new FakePrefs();
        AlarmLog.note(prefs, "2026-235", AlarmLog.F_FIRED, "08:42");
        AlarmLog.note(prefs, "2026-236", AlarmLog.F_FIRED, "08:52");

        assertEquals(2, AlarmLog.records(prefs).size());
        assertEquals("08:42", AlarmLog.field(AlarmLog.forDay(prefs, "2026-235"), AlarmLog.F_FIRED));
        assertEquals("08:52", AlarmLog.field(AlarmLog.forDay(prefs, "2026-236"), AlarmLog.F_FIRED));
    }

    @Test
    public void keepsAMonthAndDropsTheOldest() {
        final FakePrefs prefs = new FakePrefs();
        for (int i = 1; i <= AlarmLog.MAX_MORNINGS + 5; i++) {
            AlarmLog.note(prefs, "2026-" + i, AlarmLog.F_FIRED, "08:0" + (i % 10));
        }
        assertEquals(AlarmLog.MAX_MORNINGS, AlarmLog.records(prefs).size());
        // The five oldest fell off the front, not the back.
        assertNull(AlarmLog.forDay(prefs, "2026-1"));
        assertNull(AlarmLog.forDay(prefs, "2026-5"));
        assertTrue(AlarmLog.forDay(prefs, "2026-6") != null);
        assertTrue(AlarmLog.forDay(prefs, "2026-35") != null);
    }

    @Test
    public void aDayWithNothingSaidAboutItIsAbsentRatherThanBlank() {
        final FakePrefs prefs = new FakePrefs();
        AlarmLog.note(prefs, "2026-236", AlarmLog.F_MODE, "smart");
        assertNull(AlarmLog.forDay(prefs, "2026-100"));
    }

    // A day key is matched whole. "2026-2" must not find "2026-236", or a
    // fortnight of records collapses onto one as soon as the day-of-year
    // rolls past 99.
    @Test
    public void aShortDayKeyDoesNotMatchALongerOne() {
        final FakePrefs prefs = new FakePrefs();
        AlarmLog.note(prefs, "2026-236", AlarmLog.F_STAGE, "4");
        AlarmLog.note(prefs, "2026-23", AlarmLog.F_STAGE, "7");

        assertEquals(2, AlarmLog.records(prefs).size());
        assertEquals("4", AlarmLog.field(AlarmLog.forDay(prefs, "2026-236"), AlarmLog.F_STAGE));
        assertEquals("7", AlarmLog.field(AlarmLog.forDay(prefs, "2026-23"), AlarmLog.F_STAGE));
    }

    // The whole record is one line of flat text, so a value carrying a
    // separator would split into gibberish on the way back out.
    @Test
    public void aValueCannotBreakTheFormat() {
        final FakePrefs prefs = new FakePrefs();
        AlarmLog.note(prefs, "2026-236", AlarmLog.F_ACK, "refused|status;7");
        assertEquals(1, AlarmLog.records(prefs).size());
        assertEquals(
                "refused/status,7",
                AlarmLog.field(AlarmLog.forDay(prefs, "2026-236"), AlarmLog.F_ACK));
    }

    @Test
    public void anEmptyLogReadsAsNoMornings() {
        final FakePrefs prefs = new FakePrefs();
        assertEquals(0, AlarmLog.records(prefs).size());
    }
}
