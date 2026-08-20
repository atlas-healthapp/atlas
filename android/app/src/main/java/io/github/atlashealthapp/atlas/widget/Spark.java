package io.github.atlashealthapp.atlas.widget;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;

import java.util.List;

/**
 * A published series, painted into a bitmap for RemoteViews.
 *
 * <p><b>A bitmap because RemoteViews cannot draw.</b> There is no path, no
 * canvas and no way to add views dynamically in a widget: the inflatable set is
 * a fixed whitelist, which the notification already taught us the hard way when
 * a plain {@code View} divider got a foreground service killed. So the chart is
 * rendered here and set with {@code setImageViewBitmap}.
 *
 * <p>Deliberately thin. Everything about where a point goes is in
 * {@link SparkGeometry}, which the JVM test suite can reach; this is the half
 * that can only be checked by looking at a phone.
 *
 * <p><b>Kept small on purpose.</b> A RemoteViews update travels through a binder
 * transaction with about a megabyte to spend for everything on screen, so the
 * bitmap is capped rather than drawn at whatever density the launcher reports.
 */
public final class Spark {

    private Spark() {}

    /** Beyond this the extra pixels are invisible and the transaction is not. */
    private static final int MAX_WIDTH_PX = 640;
    private static final int MAX_HEIGHT_PX = 200;

    /**
     * The cap for a <b>mark</b> - a bar, a stack of bars, a composition strip.
     *
     * <p><b>Much smaller than a chart's, and the reason is a real failure.</b>
     * A RemoteViews update travels through a binder transaction with about a
     * megabyte to spend for everything on screen, and past that the update is
     * dropped: the launcher goes on showing the layout as it was last built,
     * which for a widget is its <i>initial</i> layout. Measured on the phone on
     * 2026-08-19, the sleep card at its tallest reported <b>527KB of bitmap
     * memory on its own</b> - a composition strip, four row bars and a week of
     * columns, each drawn at full device density - and it drew as its initial
     * layout with everything below the strip missing. It read as a rendering
     * bug and was none: the drawing never arrived.
     *
     * <p>A mark is rectangles. Nothing in one has an edge that a stretch across
     * a few hundred pixels can spoil, and every one of them sits in an ImageView
     * set to {@code fitXY}, so drawing at a third of the pixels costs nothing
     * visible and buys back most of the transaction. Line charts keep the
     * larger cap, since a diagonal is where resampling actually shows.
     */
    private static final int MAX_MARK_WIDTH_PX = 384;

    private static final int MAX_MARK_HEIGHT_PX = 96;

    /**
     * A filled area under the series, for a count that runs forward all day.
     *
     * <p>Steps are cumulative, so the shape itself is the reading: a flat
     * stretch is sitting still and a climb is a walk. That is what makes this
     * worth a chart rather than a second copy of the number above it.
     */
    public static Bitmap area(
            final Integer[] series,
            final int widthPx,
            final int heightPx,
            final int color,
            final Integer floor,
            final Integer ceiling) {
        final int w = clampSize(widthPx, MAX_WIDTH_PX);
        final int h = clampSize(heightPx, MAX_HEIGHT_PX);
        final Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        if (series == null || series.length == 0) return bitmap;

        final Canvas canvas = new Canvas(bitmap);
        final float[] fractions = SparkGeometry.fractions(series, floor, ceiling);
        final List<SparkGeometry.Run> runs = SparkGeometry.runs(series);

        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setStyle(Paint.Style.FILL);
        fill.setColor(withAlpha(color, 46));

        final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(Math.max(2f, h * 0.06f));
        stroke.setStrokeJoin(Paint.Join.ROUND);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setColor(color);

        // **Vertical inset only.** The stroke's own width used to inset both
        // axes, which pushed the first point a few pixels right of the bitmap's
        // edge - and this chart sits directly above a full-width gauge, so the
        // day started at a different x from the day it was drawing. Reported as
        // exactly that. Vertically the inset stays: it is what keeps the peak
        // and the floor from being sliced in half.
        final float pad = stroke.getStrokeWidth();
        final float xPad = 0f;
        for (final SparkGeometry.Run run : runs) {
            final Path line = new Path();
            final Path under = new Path();
            for (int i = run.from; i <= run.to; i++) {
                final float x = SparkGeometry.xFraction(i, series.length) * (w - xPad * 2) + xPad;
                final float y = h - pad - fractions[i] * (h - pad * 2);
                if (i == run.from) {
                    line.moveTo(x, y);
                    under.moveTo(x, h);
                    under.lineTo(x, y);
                } else {
                    line.lineTo(x, y);
                    under.lineTo(x, y);
                }
                if (i == run.to) {
                    under.lineTo(x, h);
                    under.close();
                }
            }
            canvas.drawPath(under, fill);
            if (run.from == run.to) {
                // One reading has no line to draw, so it draws as the dot it is.
                final float x =
                        SparkGeometry.xFraction(run.from, series.length) * (w - xPad * 2) + xPad;
                final float y = h - pad - fractions[run.from] * (h - pad * 2);
                canvas.drawPoint(x, y, stroke);
            } else {
                canvas.drawPath(line, stroke);
            }
        }
        return bitmap;
    }

    /**
     * A line through the series, with a break wherever the strap was off.
     *
     * <p>The same geometry as {@link #area}, without the fill: a heart rate is a
     * level rather than a total, so there is nothing under the curve to shade.
     * The breaks are the point - an hour with no readings must not draw as an
     * hour of steady heart rate, which is the rule the app's own charts follow.
     */
    public static Bitmap line(
            final Integer[] series,
            final int widthPx,
            final int heightPx,
            final int color,
            final Integer floor,
            final Integer ceiling) {
        final int w = clampSize(widthPx, MAX_WIDTH_PX);
        final int h = clampSize(heightPx, MAX_HEIGHT_PX);
        final Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        if (series == null || series.length == 0) return bitmap;

        final Canvas canvas = new Canvas(bitmap);
        final float[] fractions = SparkGeometry.fractions(series, floor, ceiling);
        final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
        stroke.setStyle(Paint.Style.STROKE);
        // **Capped, so a tall card does not draw a fat line.** The width was a
        // fraction of the height alone, which is right for a small chart and
        // wrong once the card is dragged tall: the same day came out drawn in a
        // stroke thick enough to swallow its own detail. A heart rate line is
        // read for its shape, and the shape is in the wiggles.
        stroke.setStrokeWidth(Math.min(3.5f, Math.max(2f, h * 0.035f)));
        stroke.setStrokeJoin(Paint.Join.ROUND);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setColor(color);

        final float pad = stroke.getStrokeWidth();
        for (final SparkGeometry.Run run : SparkGeometry.runs(series)) {
            if (run.from == run.to) {
                canvas.drawPoint(
                        SparkGeometry.xFraction(run.from, series.length) * (w - pad * 2) + pad,
                        h - pad - fractions[run.from] * (h - pad * 2),
                        stroke);
                continue;
            }
            final Path path = new Path();
            for (int i = run.from; i <= run.to; i++) {
                final float x = SparkGeometry.xFraction(i, series.length) * (w - pad * 2) + pad;
                final float y = h - pad - fractions[i] * (h - pad * 2);
                if (i == run.from) path.moveTo(x, y);
                else path.lineTo(x, y);
            }
            canvas.drawPath(path, stroke);
        }
        return bitmap;
    }

    /**
     * A goal bar, drawn rather than tinted.
     *
     * <p><b>Because the colour is not known until the payload is read.</b> The
     * dials are whatever the user chose on Home, so each bar's colour arrives at
     * runtime - and a ProgressBar's tint is only remotable from API 31, while
     * Atlas supports 26. Drawing it is the one approach that works everywhere
     * and gives the exact family colour rather than an approximation.
     *
     * <p>A null fill draws the track alone: no reading is not a reading of zero,
     * which is the rule the summary follows when it withholds a percentage.
     */
    public static Bitmap bar(
            final Integer pct, final int widthPx, final int heightPx, final int color) {
        final int w = clampSize(widthPx, MAX_MARK_WIDTH_PX);
        final int h = Math.max(2, Math.min(heightPx, 24));
        final Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        final Canvas canvas = new Canvas(bitmap);
        final float r = h / 2f;

        final Paint track = new Paint(Paint.ANTI_ALIAS_FLAG);
        track.setColor(withAlpha(color, 56));
        canvas.drawRoundRect(0, 0, w, h, r, r, track);

        if (pct == null || pct <= 0) return bitmap;
        final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
        fill.setColor(color);
        final float end = Math.max(h, w * Math.min(100, pct) / 100f);
        canvas.drawRoundRect(0, 0, end, h, r, r, fill);
        return bitmap;
    }

    /**
     * The five heart-rate zones as a gauge, with a caret where you are.
     *
     * <p><b>A gauge rather than a label, and that is the whole design.</b> "ZONE
     * 3" printed as text appears and disappears as a reading crosses a boundary,
     * which draws the eye to the change instead of to the position - and says
     * nothing about how close to the next band you are. Drawing the whole scale
     * and marking a point on it answers "where am I" without changing shape, the
     * same argument {@code RangeMark} makes in the app.
     *
     * <p>The scale runs from half of maximum, not from zero, because below that
     * is not a zone, it is sitting down. That is the same span {@code hrZones.js}
     * defines and it must stay in step with it.
     *
     * <p>The colours are the conventional five, measured as the most separable
     * ramp available: 58 apart between adjacent zones under the worst of the
     * three colour blindnesses, against 11 for every single-hue alternative. They
     * overlap Recovery's band tokens deliberately, which the shipped stress ramp
     * already does, and the caret is a third channel on top of colour and
     * position.
     *
     * @param fraction where the reading sits across the whole gauge, 0 to 1, or
     *                 null to draw the scale with no caret on it - which is what
     *                 an idle or unread strap looks like, rather than a caret
     *                 parked at zero claiming a heart rate of nothing.
     */
    public static Bitmap zoneGauge(
            final Float fraction, final int widthPx, final int heightPx, final int inkColor) {
        final int w = clampSize(widthPx, MAX_MARK_WIDTH_PX);
        final int h = Math.max(6, Math.min(heightPx, 48));
        final Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        final Canvas canvas = new Canvas(bitmap);

        // The caret needs headroom above the bar, so the bar takes the lower part
        // of the box and the mark sits over it.
        final float caretH = Math.min(h * 0.45f, 9f);
        final float barTop = caretH + 1f;
        final float barH = Math.max(3f, h - barTop);

        final int[] colours = {0xFF60A5FA, 0xFF4ADE80, 0xFFFBBF24, 0xFFFB923C, 0xFFEF4444};
        final float segW = w / (float) colours.length;
        final Paint seg = new Paint(Paint.ANTI_ALIAS_FLAG);
        for (int i = 0; i < colours.length; i++) {
            seg.setColor(colours[i]);
            // A hairline gap between segments, so five bands read as five rather
            // than as one gradient.
            final float left = i * segW;
            final float right = left + segW - (i == colours.length - 1 ? 0 : 1.5f);
            canvas.drawRect(left, barTop, right, barTop + barH, seg);
        }

        if (fraction == null) return bitmap;
        final float x = Math.max(0f, Math.min(1f, fraction)) * w;
        final Paint caret = new Paint(Paint.ANTI_ALIAS_FLAG);
        caret.setColor(inkColor);
        final android.graphics.Path path = new android.graphics.Path();
        // Clamped inward by half its own width so a reading at either end draws a
        // whole triangle rather than half of one falling off the bitmap.
        final float half = caretH * 0.62f;
        final float cx = Math.max(half, Math.min(w - half, x));
        path.moveTo(cx, barTop);
        path.lineTo(cx - half, 0f);
        path.lineTo(cx + half, 0f);
        path.close();
        canvas.drawPath(path, caret);
        return bitmap;
    }

    /**
     * A night's four stages as one bar, in the proportions they happened in.
     *
     * <p><b>One bitmap rather than four views.</b> RemoteViews cannot build
     * views at runtime and cannot weight them by a value known only at redraw,
     * so four segments in a layout would have to be four fixed widths. Drawn,
     * the widths are the night's own.
     *
     * <p>Rounded at both ends and square in the middle, which is what makes it
     * read as one object being divided up rather than as four bars sitting next
     * to each other. The rounding is a clip over the whole bar, so a stage
     * landing at either end inherits the curve instead of being drawn with its
     * own.
     *
     * <p>Widths come from {@link SparkGeometry#stageWidths}, which sums them to
     * exactly the box: four independently rounded segments can leave a hairline
     * of nothing showing through the end of the night.
     */
    public static Bitmap stages(
            final int[] minutes, final int[] colors, final int widthPx, final int heightPx) {
        final int w = clampSize(widthPx, MAX_MARK_WIDTH_PX);
        final int h = Math.max(2, Math.min(heightPx, 40));
        final Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        if (minutes == null || colors == null || minutes.length != colors.length) return bitmap;

        final int[] widths = SparkGeometry.stageWidths(minutes, w);
        if (widths.length == 0) return bitmap;

        final Canvas canvas = new Canvas(bitmap);
        final float r = h / 2f;
        final Path clip = new Path();
        clip.addRoundRect(0, 0, w, h, r, r, Path.Direction.CW);
        canvas.clipPath(clip);

        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        float x = 0;
        for (int i = 0; i < widths.length; i++) {
            if (widths[i] <= 0) continue;
            paint.setColor(colors[i]);
            canvas.drawRect(x, 0, x + widths[i], h, paint);
            x += widths[i];
        }
        return bitmap;
    }

    /**
     * A short series of scores as columns, each in its own band's colour.
     *
     * <p><b>The colours arrive already decided.</b> Sleep's band boundaries are
     * 85, 70 and 50, and they are not Recovery's; a copy of that table here
     * could not be checked against the one in {@code sleepScore.js}, so the app
     * publishes one character per night and the caller has already turned those
     * into colours. This only paints them.
     *
     * <p>The last column is the night the card is about and is drawn at full
     * strength; the ones behind it are dimmed, so the week reads as context for
     * tonight rather than as seven equal claims.
     */
    public static Bitmap bars(
            final Integer[] scores,
            final int[] colors,
            final int widthPx,
            final int heightPx,
            final int ceiling) {
        final int w = clampSize(widthPx, MAX_MARK_WIDTH_PX);
        final int h = clampSize(heightPx, MAX_MARK_HEIGHT_PX);
        final Bitmap bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        if (scores == null || colors == null || scores.length != colors.length) return bitmap;

        final Canvas canvas = new Canvas(bitmap);
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        final java.util.List<SparkGeometry.Slot> slots =
                SparkGeometry.barSlots(scores, w, h, ceiling);
        for (int i = 0; i < slots.size(); i++) {
            final SparkGeometry.Slot slot = slots.get(i);
            // A night with no score draws nothing. A one-pixel stub would be a
            // night scored badly rather than a night the strap was not worn.
            if (slot.height <= 0) continue;
            paint.setColor(
                    i == slots.size() - 1 ? colors[i] : withAlpha(colors[i], 178));
            canvas.drawRoundRect(
                    slot.x, h - slot.height, slot.x + slot.width, h, 1.5f, 1.5f, paint);
        }
        return bitmap;
    }

    private static int clampSize(final int requested, final int max) {
        if (requested <= 0) return max / 2;
        return Math.min(requested, max);
    }

    private static int withAlpha(final int color, final int alpha) {
        return Color.argb(alpha, Color.red(color), Color.green(color), Color.blue(color));
    }
}
