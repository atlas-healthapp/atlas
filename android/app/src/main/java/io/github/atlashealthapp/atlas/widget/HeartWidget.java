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
 * Heart rate: where it is now, and where it has been today.
 *
 * <p><b>The one reading that moves while you sit still</b>, which makes it the
 * only honest test of whether a refresh did anything - steps cannot tell you,
 * because pressing a button does not walk anywhere.
 *
 * <p>The line is drawn from 48 half-hourly means the app publishes, and it
 * <b>breaks wherever the strap was off</b> rather than joining across the gap:
 * a straight segment over the hours the band recorded nothing looks exactly like
 * an hour of steady heart rate.
 *
 * <p>The axis never starts at zero. A day between 44 and 111 drawn from nothing
 * is a flat line across the top third, so both ends are printed under the chart -
 * the same bargain {@code nightlyBars.js} strikes in the app, where scaling to
 * the series' own range is what makes the variation visible at all.
 */
public class HeartWidget extends AppWidgetProvider {

    private static final String ACTION_SYNC_NOW =
            "io.github.atlashealthapp.atlas.HEART_WIDGET_SYNC_NOW";

    private static final String PRESS_KEY = "heart_sync_pressed_at";

    /** Below this the chart is a scribble, and the figures carry the widget alone. */
    private static final int CHART_MIN_DP = 96;

    @Override
    public void onReceive(final Context context, final Intent intent) {
        super.onReceive(context, intent);
        if (intent == null || !ACTION_SYNC_NOW.equals(intent.getAction())) return;
        android.util.Log.i("AtlasWidget", "heart refresh pressed, asking the service to sync");
        AtlasWidgets.markPressed(context, PRESS_KEY);
        HelioSyncService.syncNow(context);
        refresh(context);
    }

    @Override
    public void onUpdate(
            final Context context, final AppWidgetManager manager, final int[] widgetIds) {
        for (final int id : widgetIds) {
            manager.updateAppWidget(id, build(context, manager, id));
        }
    }

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
                    manager.getAppWidgetIds(new ComponentName(context, HeartWidget.class));
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
                new RemoteViews(context.getPackageName(), R.layout.widget_heart);
        final JSONObject summary = AtlasWidgets.summary(context);

        AtlasWidgets.applyTheme(
                context,
                views,
                R.id.heart_root,
                R.id.heart_refresh,
                new int[] {
                    R.id.heart_label, R.id.heart_mark, R.id.heart_resting, R.id.heart_range,
                    R.id.heart_battery, R.id.heart_synced,
                    R.id.heart_axis_1, R.id.heart_axis_2, R.id.heart_axis_3, R.id.heart_axis_4
                },
                new int[] {R.id.heart_value});

        final Double now = AtlasWidgets.num(summary, "hrNow");
        final Double resting = AtlasWidgets.num(summary, "restingHr");
        final Double low = AtlasWidgets.num(summary, "hrLow");
        final Double high = AtlasWidgets.num(summary, "hrHigh");

        views.setTextViewText(R.id.heart_value, now == null ? "—" : String.valueOf(Math.round(now)));
        views.setTextViewText(
                R.id.heart_resting,
                resting == null ? "BPM" : "BPM · " + Math.round(resting) + " RESTING");
        // **Each end says what it is.** "44-111 TODAY" is a range with no
        // names on it, and the axis it belongs to is not drawn from zero, so
        // which end is which is exactly the thing a reader has to be told.
        views.setTextViewText(
                R.id.heart_range,
                low == null || high == null
                        ? ""
                        : Math.round(low) + " MIN · " + Math.round(high) + " MAX");

        // Shrinks with the card rather than being clipped by it. One
        // reading across the card, so it may take a wider slice of the width
        // than one of TODAY's three columns.
        views.setTextViewTextSize(
                R.id.heart_value,
                android.util.TypedValue.COMPLEX_UNIT_SP,
                AtlasWidgets.figureSp(
                        AtlasWidgets.widthDp(manager, widgetId),
                        AtlasWidgets.heightDp(manager, widgetId),
                        0.20f));

        final boolean busy = AtlasWidgets.isSyncing(context, PRESS_KEY);
        views.setTextViewText(
                R.id.heart_label,
                context.getString(busy ? R.string.widget_syncing : R.string.widget_heart_label));
        views.setViewVisibility(
                R.id.heart_refresh, busy ? android.view.View.GONE : android.view.View.VISIBLE);
        views.setViewVisibility(
                R.id.heart_spinner, busy ? android.view.View.VISIBLE : android.view.View.GONE);

        // **The header sheds parts as the widget narrows**, the same way the
        // chart goes as it shortens. Three slots need three slots' worth of
        // width; below that the wordmark goes first and the stamp second, and
        // the metric and the control are what a narrow widget keeps.
        final int wDp = AtlasWidgets.widthDp(manager, widgetId);
        final boolean roomForMark = wDp <= 0 || wDp >= AtlasWidgets.WORDMARK_MIN_DP;
        views.setViewVisibility(
                R.id.heart_mark,
                roomForMark && !busy ? android.view.View.VISIBLE : android.view.View.GONE);

        // The stamp is a footer now, so what decides it is height rather than
        // width - it no longer competes with the wordmark for the header.
        final int hDp = AtlasWidgets.heightDp(manager, widgetId);
        AtlasWidgets.footerBusy(
                context,
                views,
                summary,
                R.id.heart_footer,
                R.id.heart_battery,
                R.id.heart_synced,
                busy,
                (hDp <= 0 || hDp >= AtlasWidgets.STAMP_MIN_HEIGHT_DP));

        drawChart(context, manager, widgetId, views, summary, low, high);

        final Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // **The card opens what it is about.** Tapping any of them used to land
        // on whichever tab the app was last left on, which makes a widget a
        // shortcut to the app rather than to the thing it is showing.
        open.putExtra("atlas_open", "heart");
        views.setOnClickPendingIntent(
                R.id.heart_root,
                PendingIntent.getActivity(
                        context,
                        13,
                        open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        final Intent sync = new Intent(context, HeartWidget.class).setAction(ACTION_SYNC_NOW);
        views.setOnClickPendingIntent(
                R.id.heart_refresh,
                PendingIntent.getBroadcast(
                        context,
                        3,
                        sync,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return views;
    }

    private static void drawChart(
            final Context context,
            final AppWidgetManager manager,
            final int widgetId,
            final RemoteViews views,
            final JSONObject summary,
            final Double low,
            final Double high) {
        final Integer[] series = AtlasWidgets.series(summary, "hr48");
        int widthDp = 300;
        int heightDp = 0;
        try {
            final Bundle options = manager.getAppWidgetOptions(widgetId);
            final int w = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
            heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
            if (w > 0) widthDp = w;
        } catch (final Exception e) {
            // The launcher has not said yet; the placed default is four columns.
        }

        // Two readings at minimum: one point is a dot with no shape, and the
        // figures above already say what it was.
        int present = 0;
        if (series != null) {
            for (final Integer v : series) if (v != null) present++;
        }
        if (present < 2 || (heightDp > 0 && heightDp < CHART_MIN_DP)) {
            views.setViewVisibility(R.id.heart_chart, android.view.View.GONE);
            views.setViewVisibility(R.id.heart_axis, android.view.View.GONE);
            views.setViewVisibility(R.id.heart_range, android.view.View.GONE);
            // Nothing else is weighted, so with no chart the filler is what
            // keeps the footer on the floor.
            views.setViewVisibility(R.id.heart_filler, android.view.View.VISIBLE);
            return;
        }
        views.setViewVisibility(R.id.heart_chart, android.view.View.VISIBLE);
        // **Exactly one weighted child.** The chart and the filler both carried
        // a weight, so every extra pixel of height was split between the chart
        // and a blank strip above the footer - reported as dead space, and it
        // was the chart being given half of what it should have had.
        views.setViewVisibility(R.id.heart_filler, android.view.View.GONE);
        // The axis goes with the chart, never on its own: hours under nothing
        // are a row of numbers.
        views.setViewVisibility(R.id.heart_axis, android.view.View.VISIBLE);
        views.setViewVisibility(R.id.heart_range, android.view.View.VISIBLE);

        try {
            final DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            views.setImageViewBitmap(
                    R.id.heart_chart,
                    Spark.line(
                            series,
                            Math.round((widthDp - 24) * metrics.density),
                            Math.round(40 * metrics.density),
                            AtlasWidgets.color(context, R.color.widget_body, R.color.widget_body_light),
                            // **Scaled to the printed range, not to its own.**
                            // The line is half-hourly means and the labels are
                            // the day's true extremes, so left to find its own
                            // floor and ceiling the chart filled the box between
                            // two numbers it never touched. Given the same ends
                            // the labels state, the drawing and the words are
                            // one axis - which is what HeartPage does with its
                            // own, and the reason a widget can be checked
                            // against the page it mirrors.
                            low == null ? null : (int) Math.round(low),
                            high == null ? null : (int) Math.round(high)));
        } catch (final Exception e) {
            views.setViewVisibility(R.id.heart_chart, android.view.View.GONE);
            views.setViewVisibility(R.id.heart_axis, android.view.View.GONE);
        }
    }
}
