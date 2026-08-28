package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Calendar;

import org.junit.Test;

/**
 * Choosing tonight's alarm out of a list.
 *
 * <p>The twin of {@code alarmPlan.js}. That file has the editing rule ("no two
 * enabled alarms may claim a day") and its tests; this has the overnight half.
 * <b>Change both or neither.</b>
 */
public class AlarmPlanTest {

    /** Weekdays 07:00 smart in slot 0, weekend 09:30 onset in slot 1. */
    private static final String PLAN =
            "7|0|1|smart|1,2,3,4,5|8.0|-1|0" + ";" + "9|30|1|onset|0,6|8.0|10|15";

    /** A millisecond stamp on a named weekday, 06:00 local. */
    private static long at(final int dayOfWeek) {
        final Calendar c = Calendar.getInstance();
        c.set(Calendar.DAY_OF_WEEK, dayOfWeek);
        c.set(Calendar.HOUR_OF_DAY, 6);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    private static FakePrefs withPlan() {
        final FakePrefs prefs = new FakePrefs();
        prefs.edit().putString(AlarmPlan.KEY_PLAN, PLAN).apply();
        return prefs;
    }

    @Test
    public void aWeekdayResolvesToTheWeekdayAlarm() {
        final FakePrefs prefs = withPlan();
        final int slot = AlarmPlan.resolveActive(prefs, at(Calendar.TUESDAY));

        assertEquals(0, slot);
        assertEquals(7, prefs.getInt(SmartAlarm.KEY_HOUR, -1));
        assertEquals("smart", prefs.getString(SmartAlarm.KEY_MODE, null));
        assertTrue(prefs.getBoolean(SmartAlarm.KEY_ENABLED, false));
        // And SmartAlarm, reading the keys it always read, agrees it is due.
        assertTrue(SmartAlarm.dueToday(prefs, at(Calendar.TUESDAY)));
    }

    @Test
    public void aWeekendResolvesToTheWeekendAlarmAndItsOwnSlot() {
        final FakePrefs prefs = withPlan();
        final int slot = AlarmPlan.resolveActive(prefs, at(Calendar.SATURDAY));

        assertEquals(1, slot);
        assertEquals(9, prefs.getInt(SmartAlarm.KEY_HOUR, -1));
        assertEquals("onset", prefs.getString(SmartAlarm.KEY_MODE, null));
        // The cap travels with it, or a re-arm would put the onset alarm back
        // at the computed time instead of the backstop.
        assertEquals(10, prefs.getInt(SmartAlarm.KEY_LATEST_HOUR, -1));
        assertEquals(1, AlarmPlan.activeSlot(prefs));
    }

    // The smart window only watches the smart mode. Resolving the weekend's
    // onset alarm must therefore stop the window watching, which it does purely
    // by writing that alarm's mode.
    @Test
    public void theModeTravelsWithTheAlarm() {
        final FakePrefs prefs = withPlan();
        AlarmPlan.resolveActive(prefs, at(Calendar.TUESDAY));
        assertTrue(SmartAlarm.watching(prefs));

        AlarmPlan.resolveActive(prefs, at(Calendar.SATURDAY));
        assertFalse(SmartAlarm.watching(prefs));
    }

    // A day nothing covers still needs a next alarm to schedule toward, but
    // must not report itself as due today.
    @Test
    public void aDayWithNoAlarmLooksAheadWithoutClaimingToBeDue() {
        final String weekdaysOnly = "7|0|1|smart|1,2,3,4,5|8.0|-1|0";
        final FakePrefs prefs = new FakePrefs();
        prefs.edit().putString(AlarmPlan.KEY_PLAN, weekdaysOnly).apply();

        final long saturday = at(Calendar.SATURDAY);
        AlarmPlan.resolveActive(prefs, saturday);

        assertEquals(7, prefs.getInt(SmartAlarm.KEY_HOUR, -1));
        assertFalse(SmartAlarm.dueToday(prefs, saturday));
        assertFalse(SmartAlarm.insideWindow(prefs, saturday));
    }

    @Test
    public void everythingOffDisarmsAndReportsNoSlot() {
        final String allOff = "7|0|0|smart|1|8.0|-1|0";
        final FakePrefs prefs = new FakePrefs();
        prefs.edit().putString(AlarmPlan.KEY_PLAN, allOff).apply();

        assertEquals(-1, AlarmPlan.resolveActive(prefs, at(Calendar.MONDAY)));
        assertFalse(prefs.getBoolean(SmartAlarm.KEY_ENABLED, true));
        // activeSlot never hands back a negative: a write has to go somewhere,
        // and slot 0 is where every build before this one put it.
        assertEquals(0, AlarmPlan.activeSlot(prefs));
    }

    // An empty day list is a one-off. The band reads it as REPEAT_ONCE and it
    // counts as due whatever day it is.
    @Test
    public void aOneOffIsDueEveryDayUntilItIsSpent() {
        final String oneOff = "7|0|1|smart||8.0|-1|0";
        final FakePrefs prefs = new FakePrefs();
        prefs.edit().putString(AlarmPlan.KEY_PLAN, oneOff).apply();

        assertEquals(0, AlarmPlan.resolveActive(prefs, at(Calendar.SUNDAY)));
        assertTrue(SmartAlarm.dueToday(prefs, at(Calendar.SUNDAY)));
    }

    /**
     * A broken plan must never disarm the alarm the strap is already holding.
     *
     * <p>The whole feature is safe to fail because the band rings the time on
     * its face regardless. Wiping the keys on a parse error would take that
     * away, which would make a bad mirror worse than no mirror.
     */
    @Test
    public void aMalformedPlanLeavesTheExistingAlarmAlone() {
        final FakePrefs prefs = new FakePrefs();
        prefs.edit()
                .putString(AlarmPlan.KEY_PLAN, "this is not a plan")
                .putInt(SmartAlarm.KEY_HOUR, 6)
                .putBoolean(SmartAlarm.KEY_ENABLED, true)
                .apply();

        AlarmPlan.resolveActive(prefs, at(Calendar.MONDAY));

        assertEquals(6, prefs.getInt(SmartAlarm.KEY_HOUR, -1));
        assertTrue(prefs.getBoolean(SmartAlarm.KEY_ENABLED, false));
    }

    // An install that has never mirrored a plan keeps writing to slot 0, where
    // its existing alarm already lives.
    @Test
    public void noPlanAtAllChangesNothing() {
        final FakePrefs prefs = new FakePrefs();
        prefs.edit().putInt(SmartAlarm.KEY_HOUR, 8).apply();

        assertEquals(0, AlarmPlan.resolveActive(prefs, at(Calendar.MONDAY)));
        assertEquals(8, prefs.getInt(SmartAlarm.KEY_HOUR, -1));
    }
}
