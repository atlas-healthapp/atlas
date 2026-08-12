package io.github.atlashealthapp.atlas.ble;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.TimeZone;

/**
 * Regression test for the 2026-07-29 bug: a session recorded that evening never
 * reached Atlas, no matter how many times the band was synced.
 *
 * Root cause was the shape of the WORKOUT fetch, not the tab that displays it.
 * The band returns the EARLIEST session at or after the date it is asked for,
 * one per round. Every other data type asks for "the last N days" and gets the
 * whole window, so re-asking is harmless; a workout fetch asking for the last
 * three days lands on the oldest session in those three days, hands that back,
 * and does the same again on the next sync - never reaching the newest. Logged
 * on-device: a sync asking since 26 Jul returned the 27 Jul session while a
 * session from that same evening sat unfetched.
 *
 * These tests drive the real control conversation through a fake transport, so
 * what is asserted is the actual bytes sent to the band rather than a mock's
 * idea of them.
 */
public class HelioFetchWorkoutLoopTest {

    private static final byte RESPONSE = 0x10;
    private static final byte COMMAND_START_DATE = 0x01;
    private static final byte COMMAND_FETCH_DATA = 0x02;
    private static final byte COMMAND_ACK = 0x03;
    private static final byte SUCCESS = 0x01;

    private static final byte WORKOUT_CODE = 0x05;
    private static final long MINUTE = 60_000L;

    /**
     * Answers the fetch the way the band does, from a scripted list of workout
     * start times, and records every since-date it was asked for.
     */
    private static final class FakeBand implements HelioFetch.Transport {
        private final List<Long> available = new ArrayList<>();
        final List<Long> workoutSinceAsked = new ArrayList<>();
        final List<Long> delivered = new ArrayList<>();
        int allFinished;
        private HelioFetch fetch;
        /** Guards the test itself against the very loop it is checking for. */
        private int sends;

        FakeBand(final long... starts) {
            for (final long start : starts) {
                available.add(start);
            }
        }

        void run(final long workoutSinceMillis) {
            fetch = new HelioFetch(this);
            fetch.startAll(3, workoutSinceMillis);
        }

        @Override
        public void sendActivityControl(final byte[] command) {
            if (++sends > 500) {
                throw new IllegalStateException("fetch never terminated");
            }
            switch (command[0]) {
                case COMMAND_START_DATE:
                    onStartDateRequest(command);
                    return;
                case COMMAND_FETCH_DATA:
                    // Two version bytes and an empty WorkoutSummary: every
                    // optional field absent, which is what parseWorkout must
                    // already tolerate for an indoor session with no distance.
                    fetch.onData(new byte[]{0x00, 0x00, (byte) 0x80});
                    fetch.onControl(new byte[]{RESPONSE, COMMAND_FETCH_DATA, SUCCESS});
                    return;
                case COMMAND_ACK:
                    fetch.onControl(new byte[]{RESPONSE, COMMAND_ACK, SUCCESS});
                    return;
                default:
                    throw new IllegalStateException("unexpected command " + command[0]);
            }
        }

        private void onStartDateRequest(final byte[] command) {
            final long since = HelioFetch.parseStartDate(command, 2);
            if (command[1] != WORKOUT_CODE) {
                // Nothing to say about any other type; keeps the test focused.
                fetch.onControl(startDateResponse(0, since));
                return;
            }
            workoutSinceAsked.add(since);

            Long next = null;
            for (final Long start : available) {
                if (start >= since && (next == null || start < next)) {
                    next = start;
                }
            }
            if (next == null) {
                fetch.onControl(startDateResponse(0, since));
                return;
            }
            fetch.onControl(startDateResponse(3, next));
        }

        private static byte[] startDateResponse(final int length, final long startMillis) {
            final byte[] payload = new byte[15];
            payload[0] = RESPONSE;
            payload[1] = COMMAND_START_DATE;
            payload[2] = SUCCESS;
            payload[3] = (byte) (length & 0xff);
            payload[4] = (byte) ((length >> 8) & 0xff);
            payload[5] = (byte) ((length >> 16) & 0xff);
            payload[6] = (byte) ((length >> 24) & 0xff);

            final Calendar c = Calendar.getInstance();
            c.setTimeInMillis(startMillis);
            final int offsetQuarterHours =
                    c.getTimeZone().getOffset(startMillis) / (1000 * 60 * 15);
            payload[7] = (byte) (c.get(Calendar.YEAR) & 0xff);
            payload[8] = (byte) ((c.get(Calendar.YEAR) >> 8) & 0xff);
            payload[9] = (byte) (c.get(Calendar.MONTH) + 1);
            payload[10] = (byte) c.get(Calendar.DATE);
            payload[11] = (byte) c.get(Calendar.HOUR_OF_DAY);
            payload[12] = (byte) c.get(Calendar.MINUTE);
            payload[13] = (byte) c.get(Calendar.SECOND);
            payload[14] = (byte) offsetQuarterHours;
            return payload;
        }

        @Override
        public void log(final String message) {
        }

        @Override
        public void onSamples(final List<HelioFetch.Sample> samples) {
        }

        @Override
        public void onSleepSessions(final List<byte[]> sessions) {
        }

        @Override
        public void onWorkouts(final List<HelioFetch.Workout> workouts) {
            for (final HelioFetch.Workout w : workouts) {
                delivered.add(w.startMillis);
            }
        }

        @Override
        public void onAllFetchesFinished() {
            allFinished++;
        }
    }

    /** Whole minutes: timeBytes zeroes the seconds field on the wire. */
    private static long at(final int day, final int hour, final int minute) {
        final Calendar c = Calendar.getInstance(TimeZone.getDefault());
        c.set(2026, Calendar.JULY, day, hour, minute, 0);
        c.set(Calendar.MILLISECOND, 0);
        return c.getTimeInMillis();
    }

    @Test
    public void drainsEveryWorkoutAfterTheCursorInOneSync() {
        final long stored = at(27, 18, 20);
        final long first = at(29, 17, 53);
        final long second = at(29, 19, 14);

        final FakeBand band = new FakeBand(at(22, 17, 28), at(26, 13, 31), stored, first, second);
        band.run(stored);

        // The bug: only the already-stored 27 Jul session came back, forever.
        assertEquals(List.of(first, second), band.delivered);
        assertEquals(1, band.allFinished);
    }

    @Test
    public void asksFromAfterTheStoredCursorNotFromAWindowThatIncludesIt() {
        final long stored = at(27, 18, 20);
        final FakeBand band = new FakeBand(stored, at(29, 17, 53));
        band.run(stored);

        // Every since-date must be strictly past the newest session already held,
        // or the band answers with that same session again. This is the assertion
        // the shipped code failed.
        for (final Long asked : band.workoutSinceAsked) {
            assertTrue("asked since " + asked + ", which is not past " + stored,
                    asked > stored);
        }
    }

    @Test
    public void advancesByAWholeMinuteSoTheZeroedSecondsCannotLandBackOnTheSameSession() {
        final long first = at(29, 17, 53);
        final FakeBand band = new FakeBand(first);
        band.run(0L);

        assertEquals(List.of(first), band.delivered);
        // Second round asks from a minute past the one just received. Anything
        // less truncates back onto it, because timeBytes zeroes the seconds.
        assertEquals(2, band.workoutSinceAsked.size());
        assertEquals(first + MINUTE, (long) band.workoutSinceAsked.get(1));
    }

    @Test
    public void stopsWhenTheBandHasNothingNewerRatherThanAskingForever() {
        final FakeBand band = new FakeBand(at(29, 17, 53));
        band.run(0L);

        assertEquals(1, band.allFinished);
    }

    @Test
    public void withNoStoredCursorItStillReachesTheNewestSession() {
        // The background service has no IndexedDB to read a cursor from, so it
        // connects with 0 and relies entirely on the loop.
        final long newest = at(29, 19, 14);
        final FakeBand band = new FakeBand(at(27, 18, 20), at(29, 17, 53), newest);
        band.run(0L);

        assertTrue(band.delivered.contains(newest));
    }
}
