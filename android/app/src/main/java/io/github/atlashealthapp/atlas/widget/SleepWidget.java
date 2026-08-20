package io.github.atlashealthapp.atlas.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONObject;

import io.github.atlashealthapp.atlas.MainActivity;
import io.github.atlashealthapp.atlas.R;
import io.github.atlashealthapp.atlas.ble.HelioSyncService;

/**
 * Last night, at whatever depth the card has room for.
 *
 * <p><b>Height buys depth, and each rung answers the question the one below it
 * raised.</b> Short: how long. Taller: and what it was made of, and when it ran.
 * Tallest: and how that compares with the week. The subject never changes, so
 * nothing has to be learned twice when the card is resized.
 *
 * <p><b>It renders and never computes.</b> The stage totals arrive already
 * reconciled (the stored record calls the awake stage {@code wake} and the
 * decoder calls it {@code awake}, which {@code sleepStages.js} settles for every
 * screen), the window arrives as text, and each night's band arrives as one
 * character. Sleep's band boundaries are 85, 70 and 50 and they are <i>not</i>
 * Recovery's - a copy of that table here could not be checked against the one in
 * {@code sleepScore.js}, and the same change-both-or-neither hazard already
 * exists once in this app for the smart alarm, which is once too many.
 *
 * <p><b>An unmeasured night is a gap, never a zero.</b> A composition bar of
 * four zeros is an empty track, and an empty track says the night went badly.
 */
public class SleepWidget extends AppWidgetProvider {

    private static final String ACTION_SYNC_NOW =
            "io.github.atlashealthapp.atlas.SLEEP_WIDGET_SYNC_NOW";

    private static final String PRESS_KEY = "sleep_sync_pressed_at";

    /**
     * Where the night's facts appear, and where the week does.
     *
     * <p>Read from the launcher's reported dp rather than a cell count, because
     * a cell is a launcher decision and differs by device. Measured against the
     * card as actually drawn, which needs {@link AtlasWidgets#heightDp} rather
     * than MIN_HEIGHT: in portrait the launcher reports minWidth by
     * <b>maxHeight</b>, and reading the wrong one of that pair returned 107dp
     * for a card drawn at 206.
     */
    private static final int FACTS_MIN_DP = 110;

    private static final int ROWS_MIN_DP = 200;

    private static final int WEEK_MIN_DP = 260;

    /** Depth order, the same one the app lays every stage mark out along. */
    private static final int[] STAGE_NAME = {
        R.id.stage_name_1, R.id.stage_name_2, R.id.stage_name_3, R.id.stage_name_4
    };
    private static final int[] STAGE_BAR = {
        R.id.stage_bar_1, R.id.stage_bar_2, R.id.stage_bar_3, R.id.stage_bar_4
    };
    private static final int[] STAGE_MINS = {
        R.id.stage_mins_1, R.id.stage_mins_2, R.id.stage_mins_3, R.id.stage_mins_4
    };
    private static final String[] STAGE_KEY = {"deep", "light", "rem", "awake"};
    private static final int[] STAGE_LABEL = {
        R.string.widget_stage_deep,
        R.string.widget_stage_light,
        R.string.widget_stage_rem,
        R.string.widget_stage_awake
    };
    private static final int[] STAGE_COLOR = {
        R.color.widget_stage_deep,
        R.color.widget_stage_light,
        R.color.widget_stage_rem,
        R.color.widget_stage_awake
    };

    /** The same four in the light themes' own values, paired by index. */
    private static final int[] STAGE_COLOR_LIGHT = {
        R.color.widget_stage_deep_light,
        R.color.widget_stage_light_light,
        R.color.widget_stage_rem_light,
        R.color.widget_stage_awake_light
    };

    @Override
    public void onReceive(final Context context, final Intent intent) {
        super.onReceive(context, intent);
        if (intent == null || !ACTION_SYNC_NOW.equals(intent.getAction())) return;
        android.util.Log.i("AtlasWidget", "sleep refresh pressed, asking the service to sync");
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

    /** Resizing changes which depth is drawn, so it redraws. */
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
                    manager.getAppWidgetIds(new ComponentName(context, SleepWidget.class));
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
                new RemoteViews(context.getPackageName(), R.layout.widget_sleep);
        final JSONObject summary = AtlasWidgets.summary(context);

        AtlasWidgets.applyTheme(
                context,
                views,
                R.id.sleep_root,
                R.id.sleep_refresh,
                new int[] {
                    R.id.sleep_label, R.id.sleep_mark, R.id.sleep_score, R.id.sleep_window,
                    R.id.sleep_headline_stages, R.id.sleep_week_label, R.id.sleep_battery,
                    R.id.sleep_synced, R.id.stage_name_1, R.id.stage_name_2, R.id.stage_name_3,
                    R.id.stage_name_4, R.id.stage_mins_1, R.id.stage_mins_2, R.id.stage_mins_3,
                    R.id.stage_mins_4
                },
                new int[] {R.id.sleep_value});

        final int widthDp = AtlasWidgets.widthDp(manager, widgetId);
        final int heightDp = AtlasWidgets.heightDp(manager, widgetId);
        android.util.Log.i(
                "AtlasWidget", "sleep id=" + widgetId + " drawing at " + widthDp + "x" + heightDp);

        // An em dash rather than a zero, the rule the summary itself follows
        // when it withholds a reading.
        // **Printed exactly as the app prints it.** `fmtHoursMins` is the one
        // formatter for a duration in Atlas and it gives "8h 06m"; the space was
        // being stripped here to save width, which made "8h06m" - a string that
        // appears nowhere else in the app and reads as one token rather than two
        // quantities. The card has the width.
        final String hours = AtlasWidgets.text(summary, "sleepText");
        views.setTextViewText(R.id.sleep_value, hours == null ? "—" : hours);

        final Double score = AtlasWidgets.num(summary, "sleepScore");
        final JSONObject stages = summary == null ? null : summary.optJSONObject("sleepStages");
        final String window = AtlasWidgets.text(summary, "sleepWindow");

        // Shrinks with the card rather than being clipped by it. One
        // reading across the card, so it may take a wider slice of the width
        // than one of TODAY's three columns.
        views.setTextViewTextSize(
                R.id.sleep_value,
                android.util.TypedValue.COMPLEX_UNIT_SP,
                AtlasWidgets.figureSp(
                        AtlasWidgets.widthDp(manager, widgetId),
                        AtlasWidgets.heightDp(manager, widgetId),
                        0.20f));

        final boolean busy = AtlasWidgets.isSyncing(context, PRESS_KEY);
        views.setTextViewText(
                R.id.sleep_label,
                context.getString(busy ? R.string.widget_syncing : R.string.widget_sleep_label));
        views.setViewVisibility(R.id.sleep_refresh, busy ? View.GONE : View.VISIBLE);
        views.setViewVisibility(R.id.sleep_spinner, busy ? View.VISIBLE : View.GONE);

        // **The header sheds parts as the card narrows**, and the wordmark is
        // the first to go: the user's rule is the logo before the control.
        final boolean roomForMark = widthDp <= 0 || widthDp >= AtlasWidgets.WORDMARK_MIN_DP;
        views.setViewVisibility(
                R.id.sleep_mark, roomForMark && !busy ? View.VISIBLE : View.GONE);

        drawStageBar(context, views, stages, widthDp);
        drawDepth(context, views, summary, stages, score, window, widthDp, heightDp);

        // The stamp is in the footer rather than the header, which is the whole
        // reason the wordmark can be centred at all.
        final boolean roomForStamp = heightDp <= 0 || heightDp >= FACTS_MIN_DP;
        AtlasWidgets.footerBusy(
                context,
                views,
                summary,
                R.id.sleep_footer,
                R.id.sleep_battery,
                R.id.sleep_synced,
                busy,
                roomForStamp);

        final Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // **The card opens what it is about.** Tapping any of them used to land
        // on whichever tab the app was last left on, which makes a widget a
        // shortcut to the app rather than to the thing it is showing.
        open.putExtra("atlas_open", "sleep");
        views.setOnClickPendingIntent(
                R.id.sleep_root,
                PendingIntent.getActivity(
                        context,
                        14,
                        open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        final Intent sync = new Intent(context, SleepWidget.class).setAction(ACTION_SYNC_NOW);
        views.setOnClickPendingIntent(
                R.id.sleep_refresh,
                PendingIntent.getBroadcast(
                        context,
                        4,
                        sync,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return views;
    }

    /**
     * The night's composition, at every size including the smallest.
     *
     * <p>It is what makes the small card worth placing over a number in a
     * notification: eight hours of mostly light sleep and eight hours with two
     * long deep stretches are different nights, and the duration alone cannot
     * tell them apart.
     */
    private static void drawStageBar(
            final Context context,
            final RemoteViews views,
            final JSONObject stages,
            final int widthDp) {
        if (stages == null) {
            views.setViewVisibility(R.id.sleep_stagebar, View.GONE);
            return;
        }
        views.setViewVisibility(R.id.sleep_stagebar, View.VISIBLE);
        try {
            final DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            final int widthPx =
                    Math.round(((widthDp <= 0 ? 300 : widthDp) - 24) * metrics.density);
            views.setImageViewBitmap(
                    R.id.sleep_stagebar,
                    Spark.stages(
                            minutes(stages),
                            colors(context),
                            widthPx,
                            Math.round(8 * metrics.density)));
        } catch (final Exception e) {
            views.setViewVisibility(R.id.sleep_stagebar, View.GONE);
        }
    }

    /** Everything below the composition bar, shown only when there is room. */
    private static void drawDepth(
            final Context context,
            final RemoteViews views,
            final JSONObject summary,
            final JSONObject stages,
            final Double score,
            final String window,
            final int widthDp,
            final int heightDp) {
        // 0 means the launcher has not said yet, and the placed default is four
        // by two, so an unknown size gets the facts and nothing more.
        final boolean facts = heightDp <= 0 || heightDp >= FACTS_MIN_DP;
        final boolean rows = heightDp >= ROWS_MIN_DP && stages != null;
        final boolean week = heightDp >= WEEK_MIN_DP;

        // **The score shows at every height.** It was gated behind the same
        // threshold as the night's facts, so shortening the card dropped it -
        // and it costs no line of its own: it sits on the baseline beside the
        // hours, in space the card already has. The things that need room are
        // the rows and the week, not this.
        views.setViewVisibility(R.id.sleep_score, score != null ? View.VISIBLE : View.GONE);
        if (score != null) {
            views.setTextViewText(R.id.sleep_score, "SCORE " + Math.round(score));
        }

        views.setViewVisibility(R.id.sleep_facts, facts && stages != null ? View.VISIBLE : View.GONE);
        if (facts && stages != null) {
            views.setTextViewText(R.id.sleep_window, window == null ? "" : window);
            // Deep and REM named without a legend, because those are the two
            // people look for; light is most of every night and awake is the
            // remainder. On the tall card the rows name all four, so this line
            // stands down rather than saying the same thing twice.
            views.setTextViewText(
                    R.id.sleep_headline_stages,
                    rows
                            ? ""
                            : "DEEP " + stages.optInt("deep") + "M · REM " + stages.optInt("rem") + "M");
        }

        views.setViewVisibility(R.id.sleep_rows, rows ? View.VISIBLE : View.GONE);
        if (rows) drawStageRows(context, views, stages, widthDp);

        final Integer[] scores = AtlasWidgets.series(summary, "trend7");
        final String bands = AtlasWidgets.text(summary, "trend7Bands");
        final boolean drawWeek = week && scores != null && scores.length > 1;
        views.setViewVisibility(R.id.sleep_week_label, drawWeek ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.sleep_week, drawWeek ? View.VISIBLE : View.GONE);
        // Exactly one weighted child at any size: the week when it is drawn, the
        // filler when it is not. Two would split the slack and the columns would
        // lose half their height to hold a stamp down that the filler holds down
        // on its own.
        views.setViewVisibility(R.id.sleep_filler, drawWeek ? View.GONE : View.VISIBLE);
        if (drawWeek) drawWeek(context, views, scores, bands, widthDp);
    }

    /** Every stage named, with its own minutes, on the tallest card only. */
    private static void drawStageRows(
            final Context context,
            final RemoteViews views,
            final JSONObject stages,
            final int widthDp) {
        final int[] minutes = minutes(stages);
        int max = 0;
        for (final int m : minutes) max = Math.max(max, m);

        final DisplayMetrics metrics = context.getResources().getDisplayMetrics();
        // The row's bar sits between a 52dp label and a 44dp figure, inside the
        // card's own 12dp padding either side.
        final int barWidthPx =
                Math.round(Math.max(60, (widthDp <= 0 ? 300 : widthDp) - 24 - 96) * metrics.density);

        for (int i = 0; i < STAGE_KEY.length; i++) {
            views.setTextViewText(STAGE_NAME[i], context.getString(STAGE_LABEL[i]));
            views.setTextViewText(STAGE_MINS[i], minutes[i] + "M");
            // **Scaled to the longest stage, not to the night.** Light sleep is
            // most of every night, so against the total the other three rows are
            // slivers and the card says only what the composition bar above it
            // already said. Against the longest, each row is readable as a
            // quantity of its own - and the proportions are the bar's job.
            final Integer pct =
                    max <= 0 ? null : (int) Math.round((minutes[i] / (double) max) * 100);
            try {
                views.setImageViewBitmap(
                        STAGE_BAR[i],
                        Spark.bar(
                                pct,
                                barWidthPx,
                                Math.round(6 * metrics.density),
                                AtlasWidgets.color(context, STAGE_COLOR[i], STAGE_COLOR_LIGHT[i])));
            } catch (final Exception e) {
                // One row without its bar still has its name and its minutes.
            }
        }
    }

    /** The week behind last night, each column in its own band's colour. */
    private static void drawWeek(
            final Context context,
            final RemoteViews views,
            final Integer[] scores,
            final String bands,
            final int widthDp) {
        try {
            final DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            final int[] colors = new int[scores.length];
            for (int i = 0; i < scores.length; i++) {
                colors[i] = bandColor(context, bands == null || i >= bands.length() ? '0' : bands.charAt(i));
            }
            views.setImageViewBitmap(
                    R.id.sleep_week,
                    Spark.bars(
                            scores,
                            colors,
                            Math.round(((widthDp <= 0 ? 300 : widthDp) - 24) * metrics.density),
                            Math.round(46 * metrics.density),
                            100));
        } catch (final Exception e) {
            views.setViewVisibility(R.id.sleep_week, View.GONE);
            views.setViewVisibility(R.id.sleep_week_label, View.GONE);
        }
    }

    /**
     * A published band character, resolved against this surface's own colours.
     *
     * <p><b>A lookup, not a rule.</b> The app decides which band a score is in,
     * from the one table that defines it, and sends the answer. Sleep reuses
     * Recovery's colour ramp deliberately - it is a semantic ramp rather than a
     * family, and the two scores never share a screen.
     */
    private static int bandColor(final Context context, final char code) {
        switch (code) {
            case '4':
                return AtlasWidgets.color(
                        context, R.color.widget_rec_great, R.color.widget_rec_great_light);
            case '3':
                return AtlasWidgets.color(
                        context, R.color.widget_rec_good, R.color.widget_rec_good_light);
            case '2':
                return AtlasWidgets.color(
                        context, R.color.widget_rec_normal, R.color.widget_rec_normal_light);
            case '1':
                return AtlasWidgets.color(
                        context, R.color.widget_rec_low, R.color.widget_rec_low_light);
            default:
                return AtlasWidgets.color(context, R.color.widget_dim, R.color.widget_dim_light);
        }
    }

    /** The four stage totals in depth order, or four zeros. */
    private static int[] minutes(final JSONObject stages) {
        final int[] out = new int[STAGE_KEY.length];
        if (stages == null) return out;
        for (int i = 0; i < STAGE_KEY.length; i++) out[i] = stages.optInt(STAGE_KEY[i], 0);
        return out;
    }

    private static int[] colors(final Context context) {
        final int[] out = new int[STAGE_COLOR.length];
        for (int i = 0; i < STAGE_COLOR.length; i++) {
            out[i] = AtlasWidgets.color(context, STAGE_COLOR[i], STAGE_COLOR_LIGHT[i]);
        }
        return out;
    }
}
