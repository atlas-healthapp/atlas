package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Calendar;

/**
 * Which alarm mode is allowed to wake you early, and which is not.
 *
 * <p><b>The bug these exist for shipped and woke somebody forty minutes early.</b>
 * {@code watching()} returned true for {@code onset} as well as {@code smart}, and
 * nothing in the firing path re-checked the mode, so an "N hours after you fall
 * asleep" alarm ran the light-sleep early wake too. Measured on 2026-08-16: the
 * strap was holding 09:07 (onset plus eight hours) while the window was computed
 * from {@code KEY_HOUR}, a leftover 08:45 from the fixed mode, and it fired at
 * 08:27. Forty minutes early from a feature that promises twenty, in a mode whose
 * own description never mentions light sleep at all.
 *
 * <p>The three modes are offered as alternatives, so they behave as alternatives:
 * only {@code smart} watches a window. That also disposes of the wrong-anchor
 * problem rather than fixing it, since onset no longer has a window to anchor.
 *
 * <p><b>There is deliberately no counterpart in {@code src/utils/smartAlarm.js}.</b>
 * That copy is mode-agnostic by design: {@code smartDecision} is handed an alarm
 * time and answers whether to fire, and the caller decides whether to ask. So the
 * usual "change both or neither" rule for these two files does not apply to this
 * one line, and nobody should go hunting for a JS change that does not exist.
 */
public class SmartAlarmModeTest {

    private static final long MINUTE = 60_000L;

    /** A morning at 08:40, fifteen minutes before an 08:55 alarm. */
    private static long insideWindowNow() {
        final Calendar c = Calendar.getInstance();
        c.set(Calendar.YEAR, 2026);
        c.set(Calendar.MONTH, Calendar.AUGUST);
        c.set(Calendar.DAY_OF_MONTH, 18);
        c.set(Calendar.HOUR_OF_DAY, 8);
        c.set(Calendar.MINUTE, 40);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    /**
     * Every day, so the test never depends on which weekday it is run on. An
     * absolute date against a rolling window is how two Java tests in this suite
     * silently became failures a fortnight after they were written.
     */
    private static FakePrefs alarmAt(final String mode, final int hour, final int minute) {
        final FakePrefs prefs = new FakePrefs();
        prefs.edit()
                .putBoolean(SmartAlarm.KEY_ENABLED, true)
                .putString(SmartAlarm.KEY_MODE, mode)
                .putInt(SmartAlarm.KEY_HOUR, hour)
                .putInt(SmartAlarm.KEY_MINUTE, minute)
                .putString(SmartAlarm.KEY_DAYS, "0,1,2,3,4,5,6")
                .apply();
        return prefs;
    }

    @Test
    public void smartModeWatchesItsWindow() {
        final FakePrefs prefs = alarmAt("smart", 8, 55);
        assertTrue("smart is the mode that promises an early wake", SmartAlarm.watching(prefs));
        assertTrue(SmartAlarm.insideWindow(prefs, insideWindowNow()));
    }

    @Test
    public void onsetModeDoesNotWatchAWindow() {
        final FakePrefs prefs = alarmAt("onset", 8, 55);
        assertFalse(
                "onset asks for a duration; spending twenty minutes of it was never offered",
                SmartAlarm.watching(prefs));
        assertFalse(SmartAlarm.insideWindow(prefs, insideWindowNow()));
    }

    /**
     * The composed call the service actually makes, rather than the gate under it.
     *
     * <p>Over-determined on purpose and worth saying so: with no sessions this
     * would be false from the stage check alone, so it is the window assertion in
     * {@link #onsetModeDoesNotWatchAWindow} that carries the proof. This one pins
     * the contract {@code HelioSyncService.maybeWakeEarly} depends on, so a future
     * reordering inside {@code shouldWakeNow} cannot quietly reintroduce the
     * behaviour while the gate test still passes.
     */
    @Test
    public void onsetModeNeverFiresAnEarlyWake() {
        final FakePrefs prefs = alarmAt("onset", 8, 55);
        assertFalse(
                SmartAlarm.shouldWakeNow(
                        prefs, java.util.Collections.emptyList(), insideWindowNow()));
    }

    @Test
    public void fixedModeWatchesNothing() {
        final FakePrefs prefs = alarmAt("fixed", 8, 55);
        assertFalse(SmartAlarm.watching(prefs));
        assertFalse(SmartAlarm.insideWindow(prefs, insideWindowNow()));
    }

    @Test
    public void aDisabledSmartAlarmWatchesNothing() {
        final FakePrefs prefs = alarmAt("smart", 8, 55);
        prefs.edit().putBoolean(SmartAlarm.KEY_ENABLED, false).apply();
        assertFalse(SmartAlarm.watching(prefs));
    }

    /**
     * The retime keeps its own mode gate, which is why taking onset out of
     * {@code watching()} does not disarm the mode.
     *
     * <p>Asserts the discrimination rather than a bare -1: with no sessions every
     * mode returns -1 for want of data, so that on its own would prove nothing.
     * What this pins is that {@code onsetTarget} refuses the *other* modes on the
     * mode alone, which is only possible because it reads {@code KEY_MODE} itself
     * instead of asking {@code watching()}. If somebody ever routes it through
     * {@code watching()}, the smart case below starts returning -1 for the wrong
     * reason and the onset case stops being reachable at all.
     */
    @Test
    public void theRetimeHasItsOwnModeGate() {
        final long earlyHours = insideWindowNow() - 6 * 60 * MINUTE;

        final FakePrefs smart = alarmAt("smart", 8, 55);
        smart.edit().putFloat(SmartAlarm.KEY_ONSET_HOURS, 8f).apply();
        assertTrue(SmartAlarm.watching(smart));
        assertTrue(
                "a smart alarm has no onset target however much data it has",
                SmartAlarm.onsetTarget(smart, java.util.Collections.emptyList(), earlyHours) == -1);

        final FakePrefs onset = alarmAt("onset", 8, 55);
        onset.edit().putFloat(SmartAlarm.KEY_ONSET_HOURS, 8f).apply();
        assertFalse("and onset is no longer watched", SmartAlarm.watching(onset));
        assertTrue(
                "yet its retime is still reached, refusing only for want of sessions",
                SmartAlarm.onsetTarget(onset, java.util.Collections.emptyList(), earlyHours) == -1);
    }
}
