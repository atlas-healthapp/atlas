package io.github.atlashealthapp.atlas.widget;

import java.util.ArrayList;
import java.util.List;

/**
 * Where a published series lands in a box, and nothing else.
 *
 * <p><b>Pure, and separate from the drawing, because the drawing cannot be
 * tested here.</b> Canvas is Android's and this module's suite runs on the JVM,
 * so everything that can be arithmetic instead of a paint call lives here where
 * a test can reach it. The same split the app makes between its chart geometry
 * and its Vue components, for the same reason.
 *
 * <p><b>The app computes, native renders</b>, so this scales an already
 * downsampled series and never derives one: the 48 half-hourly points arrive in
 * the summary, computed by {@code nativeSummary.js}. Two implementations of one
 * average is how a widget ends up disagreeing with the screen it mirrors.
 */
public final class SparkGeometry {

    private SparkGeometry() {}

    /** A run of consecutive readings, as indices into the series. */
    public static final class Run {
        public final int from;
        public final int to;

        Run(final int from, final int to) {
            this.from = from;
            this.to = to;
        }
    }

    /**
     * The stretches that actually have readings.
     *
     * <p><b>A gap breaks the line rather than being drawn across.</b> A null is
     * the strap off the wrist, and a segment joining the reading before it to
     * the reading after looks exactly like a steady heart rate for those hours.
     * The app's own {@code historyChart.js} draws lines the same way, and this
     * is the native half of that rule.
     *
     * <p>A lone reading between two gaps is returned as a run of one, because it
     * is a real measurement: the renderer draws it as a dot rather than dropping
     * it for want of a second point to join to.
     */
    public static List<Run> runs(final Integer[] series) {
        final List<Run> out = new ArrayList<>();
        if (series == null) return out;
        int start = -1;
        for (int i = 0; i < series.length; i++) {
            final boolean present = series[i] != null;
            if (present && start < 0) start = i;
            if (!present && start >= 0) {
                out.add(new Run(start, i - 1));
                start = -1;
            }
        }
        if (start >= 0) out.add(new Run(start, series.length - 1));
        return out;
    }

    /**
     * Each reading as a fraction of the box's height, 0 at the bottom.
     *
     * <p><b>The floor is not zero unless the caller says so.</b> A day of heart
     * rates between 44 and 111 drawn from zero is a flat line across the top
     * third, which is the same argument {@code nightlyBars.js} makes in the app:
     * scaling to the series' own range is what makes the variation visible, and
     * the cost is that both ends of the range have to be printed beside it.
     * Steps pass a floor of zero, because a count genuinely starts there.
     *
     * <p>A flat series draws at the top rather than dividing by nothing: every
     * reading was the same, which is a true thing to show.
     */
    public static float[] fractions(final Integer[] series, final Integer floor, final Integer ceiling) {
        if (series == null || series.length == 0) return new float[0];

        int lo = floor == null ? Integer.MAX_VALUE : floor;
        int hi = ceiling == null ? Integer.MIN_VALUE : ceiling;
        if (floor == null || ceiling == null) {
            for (final Integer v : series) {
                if (v == null) continue;
                if (floor == null && v < lo) lo = v;
                if (ceiling == null && v > hi) hi = v;
            }
        }
        if (lo == Integer.MAX_VALUE || hi == Integer.MIN_VALUE) return new float[series.length];

        final float span = hi - lo;
        final float[] out = new float[series.length];
        for (int i = 0; i < series.length; i++) {
            if (series[i] == null) {
                out[i] = Float.NaN;
                continue;
            }
            out[i] = span <= 0 ? 1f : clamp((series[i] - lo) / span);
        }
        return out;
    }

    /**
     * The four stage segments of a night, as widths that sum to exactly the box.
     *
     * <p><b>Accumulated and differenced rather than rounded one at a time.</b>
     * Four independently rounded widths can fall a pixel short or a pixel long,
     * and on a composition bar that is a hairline of background showing through
     * the end of the night or a segment clipped off the edge. Carrying the
     * running total and taking the difference makes every rounding error land
     * inside the bar rather than at its end, which is the same trick the app's
     * own stacked marks use.
     *
     * <p>A stage of zero minutes gets a width of zero and draws nothing: a night
     * with no REM is a real night, and a minimum-width sliver would say it had
     * some.
     *
     * <p>Returns an empty array for a night with no minutes in it at all, since
     * a bar of four zeros is an empty track, and an empty track says the night
     * went badly rather than that nothing was recorded.
     */
    public static int[] stageWidths(final int[] minutes, final int widthPx) {
        if (minutes == null || minutes.length == 0 || widthPx <= 0) return new int[0];
        long total = 0;
        for (final int m : minutes) total += Math.max(0, m);
        if (total <= 0) return new int[0];

        final int[] out = new int[minutes.length];
        long running = 0;
        int placed = 0;
        for (int i = 0; i < minutes.length; i++) {
            running += Math.max(0, minutes[i]);
            final int edge = (int) Math.round((running / (double) total) * widthPx);
            out[i] = Math.max(0, edge - placed);
            placed = edge;
        }
        return out;
    }

    /** One column of a bar chart: where it starts, how wide, how tall. */
    public static final class Slot {
        public final float x;
        public final float width;
        public final float height;

        Slot(final float x, final float width, final float height) {
            this.x = x;
            this.width = width;
            this.height = height;
        }
    }

    /**
     * A short series of scores as columns, evenly pitched across the box.
     *
     * <p><b>Scaled to the scale's own top, not to the series' own maximum</b>,
     * which is the opposite of what {@link #fractions} does by default and the
     * difference matters: a sleep score is a number out of 100, so a week of
     * scores between 58 and 92 drawn from its own low would put a bad night on
     * the floor and a good one at the ceiling and claim the week was a
     * catastrophe followed by a triumph. The app's own {@code recoveryHistory}
     * fixes its axis at 0-100 for the same reason. A heart rate has no such
     * ceiling, which is why that one scales to its own spread and prints both
     * ends.
     *
     * <p>A missing night gets a height of zero and draws as a gap in the row.
     * Nothing is inferred across it: an unworn night is not a bad night.
     *
     * <p>The columns take a fraction of their slot so there is a gutter between
     * them. Bars touching along their whole height read as one filled area with
     * a jagged top rather than as seven separate nights.
     */
    public static List<Slot> barSlots(
            final Integer[] scores, final float widthPx, final float heightPx, final int ceiling) {
        final List<Slot> out = new ArrayList<>();
        if (scores == null || scores.length == 0 || widthPx <= 0 || heightPx <= 0) return out;
        final int top = ceiling <= 0 ? 100 : ceiling;
        final float pitch = widthPx / scores.length;
        final float width = pitch * 0.62f;
        for (int i = 0; i < scores.length; i++) {
            final float height =
                    scores[i] == null ? 0f : clamp(scores[i] / (float) top) * heightPx;
            out.add(new Slot(i * pitch + (pitch - width) / 2f, width, height));
        }
        return out;
    }

    /** Where a point sits across the box, 0 at the left edge and 1 at the right. */
    public static float xFraction(final int index, final int count) {
        if (count <= 1) return 0f;
        return clamp(index / (float) (count - 1));
    }

    private static float clamp(final float v) {
        if (v < 0f) return 0f;
        if (v > 1f) return 1f;
        return v;
    }
}
