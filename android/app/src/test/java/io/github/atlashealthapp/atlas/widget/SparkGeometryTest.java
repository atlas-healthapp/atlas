package io.github.atlashealthapp.atlas.widget;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;

/**
 * The half of a sparkline that can be checked without a device.
 *
 * <p>The paint calls cannot be tested here at all, which is exactly why the
 * arithmetic is in its own class: what a chart gets wrong is nearly always where
 * a point sits, not what colour it is.
 */
public class SparkGeometryTest {

    private static Integer[] series(final Integer... values) {
        return values;
    }

    @Test
    public void aGapBreaksTheLineRatherThanBeingDrawnAcross() {
        // The strap comes off for an hour. Joining 58 to 61 across that hour
        // draws a steady heart rate through a window nothing was measured in.
        final List<SparkGeometry.Run> runs =
                SparkGeometry.runs(series(52, 58, null, null, 61, 64));

        assertEquals(2, runs.size());
        assertEquals(0, runs.get(0).from);
        assertEquals(1, runs.get(0).to);
        assertEquals(4, runs.get(1).from);
        assertEquals(5, runs.get(1).to);
    }

    @Test
    public void aLoneReadingIsStillARun() {
        // One measurement between two gaps is a measurement. Dropping it for
        // want of a neighbour to join to would lose the only thing recorded.
        final List<SparkGeometry.Run> runs = SparkGeometry.runs(series(null, 71, null));

        assertEquals(1, runs.size());
        assertEquals(1, runs.get(0).from);
        assertEquals(1, runs.get(0).to);
    }

    @Test
    public void aSeriesThatNeverStopsIsOneRun() {
        assertEquals(1, SparkGeometry.runs(series(1, 2, 3)).size());
        assertTrue(SparkGeometry.runs(null).isEmpty());
        assertTrue(SparkGeometry.runs(series()).isEmpty());
    }

    @Test
    public void scalesToTheSeriesOwnRangeWhenNoFloorIsGiven() {
        // Measured on a real day: heart rate ran 44 to 111. From zero that is a
        // flat line across the top third, and the variation is the whole point.
        final float[] f = SparkGeometry.fractions(series(44, 77, 111), null, null);

        assertEquals(0f, f[0], 0.001f);
        assertEquals(0.5f, f[1], 0.02f);
        assertEquals(1f, f[2], 0.001f);
    }

    @Test
    public void honoursAFloorOfZeroForACount() {
        // Steps genuinely start at nothing, so a count is drawn from zero and
        // half the goal draws at half height.
        final float[] f = SparkGeometry.fractions(series(0, 4000, 8000), 0, 8000);

        assertEquals(0f, f[0], 0.001f);
        assertEquals(0.5f, f[1], 0.001f);
        assertEquals(1f, f[2], 0.001f);
    }

    @Test
    public void marksAMissingReadingRatherThanPlacingItAtZero() {
        final float[] f = SparkGeometry.fractions(series(50, null, 70), null, null);

        assertTrue(Float.isNaN(f[1]));
        assertEquals(0f, f[0], 0.001f);
    }

    @Test
    public void drawsAFlatSeriesRatherThanDividingByNothing() {
        final float[] f = SparkGeometry.fractions(series(60, 60, 60), null, null);

        assertEquals(1f, f[0], 0.001f);
        assertEquals(1f, f[2], 0.001f);
    }

    @Test
    public void survivesASeriesWithNothingInIt() {
        assertEquals(0, SparkGeometry.fractions(null, null, null).length);
        assertEquals(3, SparkGeometry.fractions(series(null, null, null), null, null).length);
    }

    @Test
    public void spreadsPointsAcrossTheWholeBox() {
        assertEquals(0f, SparkGeometry.xFraction(0, 48), 0.001f);
        assertEquals(1f, SparkGeometry.xFraction(47, 48), 0.001f);
        assertEquals(0.5f, SparkGeometry.xFraction(24, 49), 0.001f);
        // One point has nowhere to be but the start, and must not divide by zero.
        assertEquals(0f, SparkGeometry.xFraction(0, 1), 0.001f);
    }

    @Test
    public void stageWidthsSumToTheBoxExactly() {
        // Four independently rounded widths can miss the end of the bar by a
        // pixel, which draws as background showing through the end of the
        // night. Real minutes from the archive, deliberately awkward.
        final int[] widths = SparkGeometry.stageWidths(new int[] {66, 283, 137, 5}, 317);

        int sum = 0;
        for (final int w : widths) sum += w;
        assertEquals(317, sum);
    }

    @Test
    public void aStageOfNoMinutesDrawsNothing() {
        // A night with no REM in it is a real night. A minimum-width sliver
        // would say it had some.
        final int[] widths = SparkGeometry.stageWidths(new int[] {60, 300, 0, 10}, 200);

        assertEquals(0, widths[2]);
    }

    @Test
    public void aNightWithNoMinutesDrawsNoBarAtAll() {
        // An empty track says the night went badly. Nothing recorded is not a
        // bad night, so there is no bar to draw.
        assertEquals(0, SparkGeometry.stageWidths(new int[] {0, 0, 0, 0}, 200).length);
    }

    @Test
    public void barsAreScaledToTheScaleNotToTheWeeksOwnBest() {
        // The whole point of a score out of 100. Scaled to its own maximum, the
        // best night of any week would touch the ceiling and the worst would sit
        // on the floor, so every week would look identical.
        final List<SparkGeometry.Slot> slots =
                SparkGeometry.barSlots(new Integer[] {60, 92}, 100f, 50f, 100);

        assertEquals(30f, slots.get(0).height, 0.01f);
        assertEquals(46f, slots.get(1).height, 0.01f);
    }

    @Test
    public void aNightWithNoScoreIsAGapNotAZero() {
        // An unworn night draws nothing. A zero-height column is indistinguishable
        // from one, which is why nothing else is inferred across it either.
        final List<SparkGeometry.Slot> slots =
                SparkGeometry.barSlots(new Integer[] {60, null, 80}, 90f, 50f, 100);

        assertEquals(3, slots.size());
        assertEquals(0f, slots.get(1).height, 0.01f);
        assertTrue(slots.get(2).x > slots.get(1).x);
    }

    @Test
    public void barsLeaveAGutterBetweenThem() {
        // Columns touching along their height read as one filled area with a
        // jagged top rather than as seven separate nights.
        final List<SparkGeometry.Slot> slots =
                SparkGeometry.barSlots(new Integer[] {50, 50}, 100f, 20f, 100);

        assertTrue(slots.get(1).x > slots.get(0).x + slots.get(0).width);
    }
}
