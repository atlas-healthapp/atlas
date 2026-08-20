package io.github.atlashealthapp.atlas.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.widget.RemoteViews;

import org.json.JSONObject;

import io.github.atlashealthapp.atlas.MainActivity;
import io.github.atlashealthapp.atlas.R;
import io.github.atlashealthapp.atlas.ble.HelioSyncService;

/**
 * Steps: the count, the goal, and the shape of the day behind it.
 *
 * <p><b>The chart is why this is a widget of its own rather than a row on
 * TODAY.</b> 1,900 steps at midnight and 1,900 steps that all arrived before
 * nine in the morning are different days, and the count alone cannot tell them
 * apart. The series is published already downsampled to 48 half-hourly
 * cumulative points, so nothing here computes anything.
 *
 * <p><b>The header follows the set's rule</b>: the metric where the eye starts,
 * the refresh in the corner it can be pressed from, and at this size the
 * wordmark and the sync time both go rather than crowd them. The reading and the
 * control are what a small widget is for.
 */
public class StepsWidget extends AppWidgetProvider {

    private static final String ACTION_SYNC_NOW =
            "io.github.atlashealthapp.atlas.STEPS_WIDGET_SYNC_NOW";

    /**
     * The key this widget's press is remembered under. Shared machinery in
     * {@link AtlasWidgets}, so the two widgets cannot drift about what
     * "syncing" means.
     */
    private static final String PRESS_KEY = "steps_sync_pressed_at";

    @Override
    public void onReceive(final Context context, final Intent intent) {
        super.onReceive(context, intent);
        if (intent == null || !ACTION_SYNC_NOW.equals(intent.getAction())) return;
        AtlasWidgets.markPressed(context, PRESS_KEY);
        // **Logged, because the last time this was doubted there was nothing to
        // read.** The tap reaches here or it does not, and that is the one fact
        // worth having when somebody says the button does nothing.
        android.util.Log.i("AtlasWidget", "steps refresh pressed, asking the service to sync");
        HelioSyncService.syncNow(context);
        // Redrawn immediately so the press says something; the service refreshes
        // us again when it has actually finished.
        refresh(context);
    }

    @Override
    public void onUpdate(
            final Context context, final AppWidgetManager manager, final int[] widgetIds) {
        for (final int id : widgetIds) {
            manager.updateAppWidget(id, build(context, manager, id));
        }
    }

    /** Resizing changes how much chart there is room for, so it redraws. */
    @Override
    public void onAppWidgetOptionsChanged(
            final Context context,
            final AppWidgetManager manager,
            final int widgetId,
            final Bundle options) {
        super.onAppWidgetOptionsChanged(context, manager, widgetId, options);
        manager.updateAppWidget(widgetId, build(context, manager, widgetId));
    }

    /** Redraw every placed instance. Called by {@link AtlasWidgets#refreshAll}. */
    public static void refresh(final Context context) {
        try {
            final AppWidgetManager manager = AppWidgetManager.getInstance(context);
            final int[] ids =
                    manager.getAppWidgetIds(new ComponentName(context, StepsWidget.class));
            if (ids == null || ids.length == 0) return;
            for (final int id : ids) {
                manager.updateAppWidget(id, build(context, manager, id));
            }
        } catch (final Exception e) {
            // A widget that cannot redraw is not worth taking anything down for.
        }
    }

    private static RemoteViews build(
            final Context context, final AppWidgetManager manager, final int widgetId) {
        final RemoteViews views =
                new RemoteViews(context.getPackageName(), R.layout.widget_steps);
        final JSONObject summary = AtlasWidgets.summary(context);

        AtlasWidgets.applyTheme(
                context,
                views,
                R.id.steps_root,
                R.id.steps_refresh,
                new int[] {
                    R.id.steps_label, R.id.steps_mark, R.id.steps_goal, R.id.steps_battery, R.id.steps_synced
                },
                new int[] {R.id.steps_value});

        final Double steps = AtlasWidgets.num(summary, "steps");
        final Double goal = AtlasWidgets.num(summary, "stepsGoal");
        final Double pct = AtlasWidgets.num(summary, "stepsPct");

        // An em dash rather than a zero, which is the rule the summary itself
        // follows when it withholds a fill.
        views.setTextViewText(
                R.id.steps_value, steps == null ? "—" : format(Math.round(steps)));
        views.setTextViewText(
                R.id.steps_goal, goal == null ? "" : "/ " + format(Math.round(goal)));
        // Drawn at the same width the chart above it is drawn at, which is what
        // makes the two line up. A withheld fill draws the track alone rather
        // than an empty bar: no reading is not a reading of zero.
        try {
            final DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            final int wDpForBar = AtlasWidgets.widthDp(manager, widgetId);
            views.setImageViewBitmap(
                    R.id.steps_bar,
                    Spark.bar(
                            pct == null ? null : (int) Math.round(pct),
                            Math.round(((wDpForBar <= 0 ? 300 : wDpForBar) - 24) * metrics.density),
                            Math.round(4 * metrics.density),
                            AtlasWidgets.color(context, R.color.widget_activity, R.color.widget_activity_light)));
        } catch (final Exception e) {
            // The count above it is the reading; the gauge is the gloss.
        }
        // The glyph and the spinner swap, so a press visibly whirs rather than
        // silently working.
        // Shrinks with the card rather than being clipped by it. One
        // reading across the card, so it may take a wider slice of the width
        // than one of TODAY's three columns.
        views.setTextViewTextSize(
                R.id.steps_value,
                android.util.TypedValue.COMPLEX_UNIT_SP,
                AtlasWidgets.figureSp(
                        AtlasWidgets.widthDp(manager, widgetId),
                        AtlasWidgets.heightDp(manager, widgetId),
                        0.20f));

        final boolean busy = AtlasWidgets.isSyncing(context, PRESS_KEY);
        views.setTextViewText(
                R.id.steps_label,
                context.getString(busy ? R.string.widget_syncing : R.string.widget_steps_label));
        views.setViewVisibility(
                R.id.steps_refresh, busy ? android.view.View.GONE : android.view.View.VISIBLE);
        views.setViewVisibility(
                R.id.steps_spinner, busy ? android.view.View.VISIBLE : android.view.View.GONE);

        // **The header sheds parts as the widget narrows**, the same way the
        // chart goes as it shortens. Three slots need three slots' worth of
        // width; below that the wordmark goes first and the stamp second, and
        // the metric and the control are what a narrow widget keeps.
        final int wDp = AtlasWidgets.widthDp(manager, widgetId);
        final boolean roomForMark = wDp <= 0 || wDp >= AtlasWidgets.WORDMARK_MIN_DP;
        views.setViewVisibility(
                R.id.steps_mark,
                roomForMark && !busy ? android.view.View.VISIBLE : android.view.View.GONE);

        // The stamp is a footer now, so what decides it is height rather than
        // width - it no longer competes with the wordmark for the header.
        final int hDp = AtlasWidgets.heightDp(manager, widgetId);
        AtlasWidgets.footerBusy(
                context,
                views,
                summary,
                R.id.steps_footer,
                R.id.steps_battery,
                R.id.steps_synced,
                busy,
                (hDp <= 0 || hDp >= AtlasWidgets.STAMP_MIN_HEIGHT_DP));

        drawChart(context, manager, widgetId, views, summary, goal);

        final Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // **The card opens what it is about.** Tapping any of them used to land
        // on whichever tab the app was last left on, which makes a widget a
        // shortcut to the app rather than to the thing it is showing.
        open.putExtra("atlas_open", "steps");
        views.setOnClickPendingIntent(
                R.id.steps_root,
                PendingIntent.getActivity(
                        context,
                        12,
                        open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        final Intent sync = new Intent(context, StepsWidget.class).setAction(ACTION_SYNC_NOW);
        views.setOnClickPendingIntent(
                R.id.steps_refresh,
                PendingIntent.getBroadcast(
                        context,
                        2,
                        sync,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return views;
    }

    /**
     * The day's shape, drawn at roughly the size the launcher actually gave us.
     *
     * <p>Sized from the reported dp rather than from a constant, because a
     * bitmap stretched by an ImageView is a blurred chart, and because the same
     * widget is a different number of pixels on every device.
     *
     * <p><b>Scaled to the day's own total, not to the goal.</b> Against an 8,000
     * goal a real morning of 300 steps drew as a line one pixel off the floor,
     * reported as "when the steps is flat only 1 high the chart should go" - and
     * the chart was not the problem, the scale was. This is a shape rather than
     * a level: it says WHEN you walked, and the gauge underneath already says
     * how far through the goal you are. Two marks, two jobs, which is the same
     * split {@code nightlyBars.js} makes in the app when it scales a nightly
     * reading to its own range rather than to zero.
     *
     * <p><b>A day with nothing in it draws no chart at all.</b> One reading, or
     * none, has no shape to show, and an empty box with a flat line in it is a
     * claim about a day rather than a picture of one. The count and the gauge
     * hold the widget on their own until there is something to draw.
     */
    private static void drawChart(
            final Context context,
            final AppWidgetManager manager,
            final int widgetId,
            final RemoteViews views,
            final JSONObject summary,
            final Double goal) {
        final Integer[] series = AtlasWidgets.series(summary, "steps48");
        if (!tallEnoughForAChart(manager, widgetId) || !worthDrawing(series)) {
            views.setViewVisibility(R.id.steps_chart, android.view.View.GONE);
            views.setViewVisibility(R.id.steps_filler, android.view.View.VISIBLE);
            return;
        }
        views.setViewVisibility(R.id.steps_chart, android.view.View.VISIBLE);
        // One weighted child at a time: the chart when it is drawn, the filler
        // when it is not. Both at once splits the height and leaves a blank
        // strip above the footer.
        views.setViewVisibility(R.id.steps_filler, android.view.View.GONE);
        try {
            final DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            int widthDp = 150;
            try {
                final Bundle options = manager.getAppWidgetOptions(widgetId);
                final int reported = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                if (reported > 0) widthDp = reported;
            } catch (final Exception e) {
                // The launcher has not said yet; the default is a 2x2's width.
            }
            final int widthPx = Math.round((widthDp - 24) * metrics.density);
            final int heightPx = Math.round(34 * metrics.density);
            views.setImageViewBitmap(
                    R.id.steps_chart,
                    Spark.area(
                            series,
                            widthPx,
                            heightPx,
                            AtlasWidgets.color(context, R.color.widget_activity, R.color.widget_activity_light),
                            0,
                            null));
        } catch (final Exception e) {
            views.setViewVisibility(R.id.steps_chart, android.view.View.GONE);
        }
    }

    /**
     * Below this the chart is a line, not a picture.
     *
     * <p>At the shortest the launcher allows, there is room for the count and
     * the gauge and nothing else - drawn anyway, the chart is a couple of pixels
     * of ink that says less than the gauge under it. The user's call, having
     * dragged one down to that height: at its lowest, just the gauge.
     */
    private static final int CHART_MIN_DP = 96;

    /** Has the launcher given us enough height for a chart to mean anything? */
    private static boolean tallEnoughForAChart(
            final AppWidgetManager manager, final int widgetId) {
        try {
            final Bundle options = manager.getAppWidgetOptions(widgetId);
            final int minHeight = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            // 0 means the launcher has not said yet, and the placed default is
            // two rows, so an unknown size gets the chart.
            return minHeight <= 0 || minHeight >= CHART_MIN_DP;
        } catch (final Exception e) {
            return true;
        }
    }

    /**
     * Is there a shape here, or just a number drawn sideways?
     *
     * <p>Two readings at minimum, and a total above zero. A cumulative series
     * that never moves is a flat line, which says nothing the count above it has
     * not already said.
     */
    private static boolean worthDrawing(final Integer[] series) {
        if (series == null || series.length < 2) return false;
        int seen = 0;
        int min = Integer.MAX_VALUE;
        int max = 0;
        for (final Integer v : series) {
            if (v == null) continue;
            seen++;
            min = Math.min(min, v);
            max = Math.max(max, v);
        }
        return seen >= 2 && max > 0 && max > min;
    }

    /** Grouped thousands, matching what Home prints. */
    private static String format(final long value) {
        return String.format(java.util.Locale.getDefault(), "%,d", value);
    }
}
