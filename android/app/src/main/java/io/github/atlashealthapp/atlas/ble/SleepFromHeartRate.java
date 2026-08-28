package io.github.atlashealthapp.atlas.ble;

import java.util.List;

/**
 * Heart-rate evidence about whether somebody is asleep. <b>Recorded, never
 * acted on.</b>
 *
 * <p><b>Read this before wiring it into a decision, because it was measured
 * and it does not work yet.</b>
 *
 * <h2>What it was for</h2>
 *
 * <p>{@link SmartAlarm#currentStage} refuses any reading older than fifteen
 * minutes, which is right: acting on a stale stage is how you wake somebody out
 * of a phase they left half an hour ago. But the band stops publishing sleep
 * revisions while you are awake, so after a long waking it has nothing recent
 * to say - and a long waking followed by dozing off again is exactly the
 * morning where an early wake is worth most.
 *
 * <p>2026-08-21 is the case: awake from 06:26, back asleep 08:24, genuinely in
 * light sleep at 08:40 when the window checked. The band's newest segment ended
 * at 06:15, 145 minutes stale, so the alarm correctly declined and the hard
 * 09:00 rang instead. Atlas's own archive had a heart rate every minute
 * throughout, so the idea was to read that instead.
 *
 * <h2>Why it is not a decision</h2>
 *
 * <p>Swept over 220 fifteen-minute windows across 20 real mornings inside the
 * 08:15-09:05 window, each labelled by the band's own finished record:
 *
 * <pre>
 *   mean/resting   called asleep when asleep   called asleep when awake
 *       1.05             115/169 (68%)                0/51 ( 0%)
 *       1.10             138/169 (82%)                1/51 ( 2%)
 *       1.20             160/169 (95%)               13/51 (25%)
 *       1.30             162/169 (96%)               27/51 (53%)
 * </pre>
 *
 * <p>1.10 looks like a clean knee, and on the aggregate it is. <b>But on the
 * morning this was built for it fires nothing.</b> That night's resting rate
 * was 47 and the dozing ran 61 to 63, a ratio of 1.30 - sitting inside the
 * awake distribution, because two hours awake leaves the rate elevated and
 * dozing off does not bring it back to resting. Firing at 1.30 means being
 * wrong on more than half of the genuinely-awake windows.
 *
 * <p>So the aggregate hid the target case, which is the whole lesson here.
 *
 * <p>Two other features were measured and are worse. <b>Spread</b> was the
 * first idea, from eyeballing 21 August where the dozing block held a 3 bpm
 * range against 17 while awake: over 20 days asleep windows have a median range
 * of 8 and awake windows 10, which is noise. <b>Rate against the previous
 * hour</b> rather than against resting is worse than resting at every
 * threshold. Both are written down so the next reader does not spend the
 * afternoon rediscovering them.
 *
 * <h2>What it does now</h2>
 *
 * <p>Computes the same figures and hands them to {@link AlarmLog}, so every
 * in-window check records what the heart rate was doing beside what the band
 * said. That costs nothing - the sync already happened and the samples are
 * already in hand - and it is the measurement that was missing. When enough
 * stale mornings have been recorded, the log will say whether any threshold
 * separates them; until then {@link Verdict#asleep} is an observation and the
 * service must not branch on it.
 *
 * <p>The likelier fix is not here at all: the band clearly knows about the
 * 08:24 doze by the time its record is read later, so the open question is how
 * far behind its revisions run. {@code SleepProbe} exists to measure exactly
 * that and has never been run over a night with a long waking in it.
 *
 * <p><b>Java only, with no JavaScript twin.</b> {@code src/utils/smartAlarm.js}
 * holds the reasoning for the stage decision and must stay in step with
 * {@link SmartAlarm}, but nothing in the app performs this one. Same precedent
 * as the mode gate fixed on 2026-08-17.
 */
final class SleepFromHeartRate {

    /**
     * How far back to look. Matches {@code SmartAlarm.MAX_STALE_MINUTES}: the
     * two are answering the same question about the same moment, and a
     * different window here would mean the fallback describes a different
     * fifteen minutes from the one the band was asked about.
     */
    static final int WINDOW_MINUTES = 15;

    /**
     * The freshest reading must be no older than this.
     *
     * <p>A window can hold five readings that all arrived twelve minutes ago,
     * which describes then rather than now. Without this the fallback would
     * make exactly the mistake it exists to avoid, one metric over.
     */
    static final int MAX_AGE_MINUTES = 5;

    /**
     * Fewer than this and it is not an average.
     *
     * <p>The same figure and the same reasoning as {@code MIN_BUCKET_SAMPLES}:
     * the band reports about once a minute, so a window holding one or two
     * readings is the strap being handled rather than a measurement.
     */
    static final int MIN_SAMPLES = 5;

    /**
     * Mean heart rate as a multiple of resting. See the sweep above.
     *
     * <p><b>This is where the observation is drawn, not where an alarm fires.</b>
     * It is the best-separating threshold on the aggregate and it misses the
     * case the whole thing was built for, so it is recorded and compared rather
     * than obeyed.
     */
    static final double SLEEP_RATIO = 1.10;

    private SleepFromHeartRate() {}

    /** What the fallback concluded, and the evidence, so the log can say why. */
    static final class Verdict {
        /** True only when every gate passed and the mean was low enough. */
        final boolean asleep;
        /** Readings inside the window. */
        final int samples;
        /** Their mean, or 0 when there were none. */
        final double mean;
        /** Age of the freshest, in minutes, or -1 when there were none. */
        final long freshestMinutes;
        /** Mean over resting, or 0 when it could not be computed. */
        final double ratio;
        /** Why it said no, for the morning log. Empty when it said yes. */
        final String why;

        Verdict(
                final boolean asleep,
                final int samples,
                final double mean,
                final long freshestMinutes,
                final double ratio,
                final String why) {
            this.asleep = asleep;
            this.samples = samples;
            this.mean = mean;
            this.freshestMinutes = freshestMinutes;
            this.ratio = ratio;
            this.why = why;
        }

        /** One compact field for {@link AlarmLog}. */
        String summary() {
            if (samples == 0) return "none";
            return String.format(
                    java.util.Locale.US,
                    "n=%d mean=%.0f age=%d ratio=%.2f%s",
                    samples,
                    mean,
                    freshestMinutes,
                    ratio,
                    asleep ? " ASLEEP" : " " + why);
        }
    }

    /**
     * Decide from this sync's own heart rate samples.
     *
     * @param samples everything the band handed over on this run. Filtered
     *     here rather than by the caller so the {@code 0xff} no-reading
     *     sentinel is dropped in the same place for both.
     * @param restingHr the person's own resting rate, as the app published it.
     *     A missing or absurd figure returns "cannot say" rather than falling
     *     back to a population number, which would be a threshold fitted to
     *     nobody.
     */
    static Verdict verdict(
            final List<HelioFetch.Sample> samples, final double restingHr, final long now) {
        if (restingHr <= 0 || !HelioFetch.isRealHeartRate(restingHr)) {
            return new Verdict(false, 0, 0, -1, 0, "no resting baseline");
        }
        final long from = now - WINDOW_MINUTES * 60_000L;
        int n = 0;
        double total = 0;
        long freshest = Long.MIN_VALUE;
        if (samples != null) {
            for (final HelioFetch.Sample s : samples) {
                if (s == null || !"hr".equals(s.metric)) continue;
                if (!HelioFetch.isRealHeartRate(s.v)) continue;
                // A sample stamped in the future is a clock that moved, not a
                // reading; counting it would drag the mean toward nothing.
                if (s.t <= from || s.t > now) continue;
                n++;
                total += s.v;
                if (s.t > freshest) freshest = s.t;
            }
        }
        if (n == 0) return new Verdict(false, 0, 0, -1, 0, "no readings");

        final long ageMinutes = (now - freshest) / 60_000L;
        final double mean = total / n;
        final double ratio = mean / restingHr;

        if (n < MIN_SAMPLES) {
            return new Verdict(false, n, mean, ageMinutes, ratio, "too few readings");
        }
        if (ageMinutes > MAX_AGE_MINUTES) {
            return new Verdict(false, n, mean, ageMinutes, ratio, "readings too old");
        }
        if (ratio > SLEEP_RATIO) {
            return new Verdict(false, n, mean, ageMinutes, ratio, "rate too high");
        }
        return new Verdict(true, n, mean, ageMinutes, ratio, "");
    }
}
