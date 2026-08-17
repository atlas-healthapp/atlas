package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.SharedPreferences;

import org.junit.Test;


/**
 * Putting the user's own alarm back after a one-off has spent the slot.
 *
 * <p>The bug these cover shipped and was silent: both the early wake and the
 * onset retime overwrite the single alarm slot with a {@code REPEAT_ONCE}
 * alarm, and nothing ever wrote the recurring one back. So the first smart wake
 * disarmed every night after it, and the only cure was opening Settings and
 * pressing SEND. Nothing on the phone said so, because nothing can read the
 * band's alarm back to notice it is spent.
 */
public class SmartAlarmRearmTest {

    private static final long MINUTE = 60_000L;
    private static final long NOW = 1_786_000_000_000L;

    private static FakePrefs enabledAlarm() {
        final FakePrefs prefs = new FakePrefs();
        prefs.edit()
                .putBoolean(SmartAlarm.KEY_ENABLED, true)
                .putString(SmartAlarm.KEY_MODE, "smart")
                .putInt(SmartAlarm.KEY_HOUR, 7)
                .putInt(SmartAlarm.KEY_MINUTE, 20)
                .putString(SmartAlarm.KEY_DAYS, "1,2,3,4,5")
                .apply();
        return prefs;
    }

    @Test
    public void nothingIsOwedUntilAOneOffHasBeenWritten() {
        assertFalse(SmartAlarm.rearmDue(enabledAlarm(), NOW));
    }

    @Test
    public void theDebtIsMeasuredFromWhenTheOneOffFiresNotWhenItIsWritten() {
        // An early wake is written two minutes out, so both are nearly the same.
        // An onset retime is written at 02:00 for an alarm at 07:30, and counting
        // from the write would put the recurring alarm back over the top of it
        // five hours before it was due to go off.
        final SharedPreferences prefs = enabledAlarm();
        final long firesAt = NOW + 5 * 60 * MINUTE;
        SmartAlarm.markRearmOwed(prefs, firesAt);

        assertFalse("re-armed before the alarm it would overwrite",
                SmartAlarm.rearmDue(prefs, NOW + 60 * MINUTE));
        assertFalse(SmartAlarm.rearmDue(prefs, firesAt));
        assertTrue(SmartAlarm.rearmDue(prefs, firesAt + SmartAlarm.REARM_DELAY_MINUTES * MINUTE));
    }

    @Test
    public void theDelayClearsTheBuzzAndTheCheckSpacing() {
        // Re-arming inside the window would overwrite the very alarm about to go
        // off, which is the bug this fixes wearing a different hat.
        assertTrue(SmartAlarm.REARM_DELAY_MINUTES > SmartAlarm.FIRE_LEAD_MINUTES);
        assertTrue(SmartAlarm.REARM_DELAY_MINUTES * MINUTE > SmartAlarm.CHECK_INTERVAL_MS);
    }

    @Test
    public void anAlarmTurnedOffIsNotOwedOneBack() {
        // Somebody who cancelled the alarm between the buzz and the re-arm must
        // not have it set again for them.
        final SharedPreferences prefs = enabledAlarm();
        SmartAlarm.markRearmOwed(prefs, NOW);
        prefs.edit().putBoolean(SmartAlarm.KEY_ENABLED, false).apply();

        assertFalse(SmartAlarm.rearmDue(prefs, NOW + 60 * MINUTE));
    }

    @Test
    public void clearingTheDebtStopsIt() {
        final SharedPreferences prefs = enabledAlarm();
        SmartAlarm.markRearmOwed(prefs, NOW);
        SmartAlarm.clearRearm(prefs);

        assertFalse(SmartAlarm.rearmDue(prefs, NOW + 60 * MINUTE));
    }

    @Test
    public void aBackedOffAttemptIsRetriedRatherThanForgotten() {
        // The write is fire-and-forget until the band acknowledges it, so a
        // connect that fails because the strap is out of range in the morning
        // must not leave the alarm unset for the following night.
        final SharedPreferences prefs = enabledAlarm();
        SmartAlarm.markRearmOwed(prefs, NOW);
        final long attemptedAt = NOW + 20 * MINUTE;
        SmartAlarm.markRearmAt(prefs, attemptedAt + 30 * MINUTE);

        assertFalse(SmartAlarm.rearmDue(prefs, attemptedAt + MINUTE));
        assertTrue(SmartAlarm.rearmDue(prefs, attemptedAt + 31 * MINUTE));
    }

    @Test
    public void aFixedAlarmGoesBackAtTheTimeThatWasSet() {
        final SharedPreferences prefs = enabledAlarm();
        assertEquals(7, SmartAlarm.hardHour(prefs));
        assertEquals(20, SmartAlarm.hardMinute(prefs));
    }

    @Test
    public void anOnsetAlarmGoesBackAtItsLatestTimeNotItsComputedOne() {
        // The band holds the backstop rather than the answer, which is what
        // writeAlarm in stores/helio.js sends. Putting the computed time back
        // would quietly turn the cap into the alarm.
        final SharedPreferences prefs = enabledAlarm();
        prefs.edit()
                .putString(SmartAlarm.KEY_MODE, "onset")
                .putInt(SmartAlarm.KEY_LATEST_HOUR, 8)
                .putInt(SmartAlarm.KEY_LATEST_MINUTE, 45)
                .apply();

        assertEquals(8, SmartAlarm.hardHour(prefs));
        assertEquals(45, SmartAlarm.hardMinute(prefs));
    }

    @Test
    public void anOnsetAlarmWithNoCapFallsBackToTheSetTime() {
        final SharedPreferences prefs = enabledAlarm();
        prefs.edit().putString(SmartAlarm.KEY_MODE, "onset").apply();

        assertEquals(7, SmartAlarm.hardHour(prefs));
        assertEquals(20, SmartAlarm.hardMinute(prefs));
    }

    // ── the repeat mask, which fails silently on the wrong day ──────────────

    @Test
    public void theRepeatMaskCountsFromMondayWhileAtlasCountsFromSunday() {
        // Mirrors repeatMask in src/utils/strapAlarm.js. Monday is the low bit
        // and Sunday is 0x40; Atlas passes Date.getDay() numbers, Sunday 0. An
        // off-by-one here sets the alarm on the wrong day and says nothing.
        assertEquals(0x01, SmartAlarm.repeatMask("1"));
        assertEquals(0x40, SmartAlarm.repeatMask("0"));
        assertEquals(0x1f, SmartAlarm.repeatMask("1,2,3,4,5"));
        assertEquals(0x7f, SmartAlarm.repeatMask("0,1,2,3,4,5,6"));
        assertEquals(0x60, SmartAlarm.repeatMask("0,6"));
    }

    @Test
    public void anEmptyDayListIsAOneOff() {
        assertEquals(HelioAlarm.REPEAT_ONCE, SmartAlarm.repeatMask(""));
        assertEquals(HelioAlarm.REPEAT_ONCE, SmartAlarm.repeatMask(null));
        assertEquals(HelioAlarm.REPEAT_ONCE, SmartAlarm.repeatMask("   "));
    }

    @Test
    public void aMalformedEntryIsDroppedRatherThanShiftingTheRest() {
        assertEquals(0x03, SmartAlarm.repeatMask("1, ,2"));
        assertEquals(0x03, SmartAlarm.repeatMask("1,x,2"));
    }
}
