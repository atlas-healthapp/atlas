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

import org.json.JSONArray;
import org.json.JSONObject;

import io.github.atlashealthapp.atlas.MainActivity;
import io.github.atlashealthapp.atlas.R;
import io.github.atlashealthapp.atlas.ble.HelioSyncService;

/**
 * The Atlas card: the three dials Home is showing, whichever they are.
 *
 * <p><b>It renders, it does not compute.</b> Every figure, fill and colour comes
 * from the summary the app publishes, and the payload carries percentages and
 * tone names precisely so this surface never divides a reading by a goal or
 * picks a colour from a score. Two implementations of one rounding rule is how a
 * widget ends up disagreeing with the screen it mirrors.
 *
 * <p><b>It follows the app's own choice.</b> Home's dial row has been
 * user-selectable since 2026-08-12; this used to draw Recovery, steps and sleep
 * regardless, so a phone whose Home showed Recovery, sleep and protein had a
 * widget showing something else. Reported as exactly that. There is no
 * configuration screen because there is no second choice to make.
 *
 * <p><b>Two bodies, one visible.</b> Columns when the card is wide and short,
 * rows when it is narrow or tall. RemoteViews cannot build views at runtime, so
 * both live in the layout and one is hidden.
 */
public class AtlasWidget extends AppWidgetProvider {

    private static final String ACTION_SYNC_NOW =
            "io.github.atlashealthapp.atlas.WIDGET_SYNC_NOW";

    private static final String PRESS_KEY = "today_sync_pressed_at";

    /**
     * Where columns give way to rows, and it is <b>width alone that decides</b>.
     *
     * <p>Three columns of 23sp figures need width; below this they truncate and
     * the labels wrap, so a narrow card gets a row each instead. Height has
     * nothing to do with it: a wide card stays columns however tall it is, and
     * fills the extra height by spacing the column out rather than changing
     * shape under the reader.
     *
     * <p>This was briefly gated on height as well, which made a 373x206dp card
     * fall to rows because it was tall - the opposite of what was asked for.
     */
    private static final int COLUMNS_MIN_WIDTH_DP = 250;

    private static final int[] COL_VAL = {R.id.col_val_1, R.id.col_val_2, R.id.col_val_3};
    private static final int[] COL_KEY = {R.id.col_key_1, R.id.col_key_2, R.id.col_key_3};
    private static final int[] COL_BAR = {R.id.col_bar_1, R.id.col_bar_2, R.id.col_bar_3};
    private static final int[] ROW_VAL = {R.id.row_val_1, R.id.row_val_2, R.id.row_val_3};
    private static final int[] ROW_KEY = {R.id.row_key_1, R.id.row_key_2, R.id.row_key_3};
    private static final int[] ROW_BAR = {R.id.row_bar_1, R.id.row_bar_2, R.id.row_bar_3};
    private static final int[] COL_SUB = {R.id.col_sub_1, R.id.col_sub_2, R.id.col_sub_3};
    private static final int[] ROW_SUB = {R.id.row_sub_1, R.id.row_sub_2, R.id.row_sub_3};
    private static final int[] ROW_HEAD = {R.id.row_head_1, R.id.row_head_2, R.id.row_head_3};

    /**
     * How many dials a card this short can carry without lying about them.
     *
     * <p><b>Dragged to its smallest, the card used to draw all three anyway</b>
     * and the launcher clipped whatever did not fit - reported as looking bad
     * and bugged, which is what a half-cut third row is. A row is a figure, a
     * label, a bar and a line under it, and three of those need real height.
     *
     * <p>Dropping from the bottom rather than shrinking all three is deliberate:
     * the dial order is the one chosen on Home, so the first is the one that was
     * put first. A card too small for three shows the two that lead, and a card
     * too small for two shows the one.
     */
    private static final int TWO_ROWS_MIN_DP = 120;

    /**
     * Below this a column is a figure and its name, and nothing else.
     *
     * <p>The bar and the line under it are the first things to go, in that
     * order, because they are the parts that explain a reading rather than being
     * one. At the launcher's smallest a card was still drawing all four - a
     * figure, a label, a gauge and a sub-line, inside about 70dp - and every one
     * of them came out clipped or touching. What a card this size is for is the
     * number.
     */
    private static final int BARS_MIN_DP = 92;

    private static final int SUBS_MIN_DP = 118;


    private static final int THREE_ROWS_MIN_DP = 168;

    @Override
    public void onReceive(final Context context, final Intent intent) {
        super.onReceive(context, intent);
        if (intent == null || !ACTION_SYNC_NOW.equals(intent.getAction())) return;
        android.util.Log.i("AtlasWidget", "today refresh pressed, asking the service to sync");
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
                    manager.getAppWidgetIds(new ComponentName(context, AtlasWidget.class));
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
                new RemoteViews(context.getPackageName(), R.layout.widget_readout);
        final JSONObject summary = AtlasWidgets.summary(context);

        AtlasWidgets.applyTheme(
                context,
                views,
                R.id.widget_root,
                R.id.widget_refresh,
                new int[] {
                    R.id.widget_title, R.id.widget_mark, R.id.widget_battery, R.id.widget_synced,
                    R.id.col_key_1, R.id.col_key_2, R.id.col_key_3,
                    R.id.col_sub_1, R.id.col_sub_2, R.id.col_sub_3,
                    R.id.row_key_1, R.id.row_key_2, R.id.row_key_3,
                    R.id.row_sub_1, R.id.row_sub_2, R.id.row_sub_3
                },
                new int[] {});

        final int widthDp = AtlasWidgets.widthDp(manager, widgetId);
        final int heightDp = AtlasWidgets.heightDp(manager, widgetId);
        // Logged because the thresholds are guesses until the launcher says what
        // it actually gives us, and it differs by device and by launcher.
        android.util.Log.i(
                "AtlasWidget",
                "id=" + widgetId + " drawing at " + widthDp + "x" + heightDp + "dp"
                        + " (minH " + manager.getAppWidgetOptions(widgetId).getInt(
                                AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) + ")");
        final boolean columns = widthDp <= 0 || widthDp >= COLUMNS_MIN_WIDTH_DP;
        views.setViewVisibility(R.id.body_columns, columns ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.body_rows, columns ? View.GONE : View.VISIBLE);

        // Columns are side by side, so height costs them nothing and all three
        // always fit. Rows are stacked, so a short card has to drop some.
        // Three columns share the width, so each gets a smaller slice of it.
        final float figureSp = AtlasWidgets.figureSp(widthDp, heightDp, 0.13f);
        final int rows =
                columns || heightDp <= 0
                        ? 3
                        : heightDp >= THREE_ROWS_MIN_DP ? 3 : heightDp >= TWO_ROWS_MIN_DP ? 2 : 1;

        final JSONArray dials = summary == null ? null : summary.optJSONArray("dials");
        final int barWidthPx =
                Math.round(
                        Math.max(90, (columns ? (widthDp <= 0 ? 300 : widthDp) / 3 : widthDp) - 24)
                                * context.getResources().getDisplayMetrics().density);

        for (int i = 0; i < 3; i++) {
            final JSONObject dial = dials == null ? null : dials.optJSONObject(i);
            // An em dash rather than a zero, the rule the summary itself follows
            // when it withholds a reading.
            final String text = dial == null ? "—" : dial.optString("text", "—");
            final String label = dial == null ? "" : dial.optString("label", "");
            final Integer pct =
                    dial == null || dial.isNull("pct") ? null : dial.optInt("pct");
            final int color = colorFor(context, dial == null ? null : dial.optString("tone", null));

            // **What the figure is not saying**, published per dial: the band
            // for Recovery, the hours for a sleep score, the target for anything
            // with one. Without it the card was three bare numbers and a bar
            // each, and 54 alone cannot tell you whether 54 was a good morning.
            // Withheld rather than blanked when the app has none, so the figure
            // sits closer to its bar instead of over an empty line.
            final String sub = dial == null || dial.isNull("sub") ? null : dial.optString("sub", null);
            final boolean roomForSub = heightDp <= 0 || heightDp >= SUBS_MIN_DP;
            views.setViewVisibility(
                    COL_SUB[i], sub == null || !roomForSub ? View.GONE : View.VISIBLE);
            views.setViewVisibility(ROW_SUB[i], sub == null ? View.GONE : View.VISIBLE);
            if (sub != null) {
                views.setTextViewText(COL_SUB[i], sub);
                views.setTextViewText(ROW_SUB[i], sub);
            }

            // The explaining parts go before the reading does.
            final boolean showBars = heightDp <= 0 || heightDp >= BARS_MIN_DP;
            final boolean showSubs = heightDp <= 0 || heightDp >= SUBS_MIN_DP;
            views.setViewVisibility(COL_BAR[i], showBars ? View.VISIBLE : View.GONE);
            if (!showSubs) views.setViewVisibility(COL_SUB[i], View.GONE);

            final int shown = i < rows ? View.VISIBLE : View.GONE;
            views.setViewVisibility(ROW_HEAD[i], shown);
            views.setViewVisibility(ROW_BAR[i], shown);
            if (i >= rows) views.setViewVisibility(ROW_SUB[i], View.GONE);

            views.setTextViewTextSize(
                    COL_VAL[i], android.util.TypedValue.COMPLEX_UNIT_SP, figureSp);

            views.setTextViewText(COL_VAL[i], text);
            views.setTextViewText(COL_KEY[i], label);
            views.setTextViewText(ROW_VAL[i], text);
            views.setTextViewText(ROW_KEY[i], label);
            views.setTextColor(COL_VAL[i], color);
            views.setTextColor(ROW_VAL[i], color);

            final android.graphics.Bitmap bar = Spark.bar(pct, barWidthPx, 8, color);
            views.setImageViewBitmap(COL_BAR[i], bar);
            views.setImageViewBitmap(ROW_BAR[i], bar);
        }

        final boolean busy = AtlasWidgets.isSyncing(context, PRESS_KEY);
        AtlasWidgets.footer(
                context,
                views,
                summary,
                R.id.widget_footer,
                R.id.widget_battery,
                R.id.widget_synced,
                // **The footer goes first when the card runs out of height**,
                // which is the rule the other three already had and this one
                // never got: it drew a footer at every size, so at the smallest
                // the columns above were pushed up and their figures clipped.
                // Reported as the numbers being cut off, with the fix suggested
                // in the same breath.
                heightDp <= 0 || heightDp >= AtlasWidgets.STAMP_MIN_HEIGHT_DP);
        if (busy) {
            // **The footer stays put while a sync runs.** Blanking it or hiding
            // it moves everything above it, so pressing refresh made the card
            // jump and settle back - reported as the syncing state pushing
            // things down. Only the word changes.
            views.setViewVisibility(R.id.widget_footer, View.VISIBLE);
            views.setTextViewText(R.id.widget_synced, context.getString(R.string.widget_syncing));
        }
        views.setViewVisibility(R.id.widget_refresh, busy ? View.GONE : View.VISIBLE);
        views.setViewVisibility(R.id.widget_spinner, busy ? View.VISIBLE : View.GONE);
        // The wordmark is the first thing to go when the card narrows, since the
        // app is named in the picker and on tap; the control never goes.
        views.setViewVisibility(
                R.id.widget_mark,
                widthDp <= 0 || widthDp >= AtlasWidgets.WORDMARK_MIN_DP ? View.VISIBLE : View.GONE);

        final Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        // **The card opens what it is about.** Tapping any of them used to land
        // on whichever tab the app was last left on, which makes a widget a
        // shortcut to the app rather than to the thing it is showing.
        open.putExtra("atlas_open", "home");
        views.setOnClickPendingIntent(
                R.id.widget_root,
                PendingIntent.getActivity(
                        context,
                        11,
                        open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        final Intent sync = new Intent(context, AtlasWidget.class).setAction(ACTION_SYNC_NOW);
        views.setOnClickPendingIntent(
                R.id.widget_refresh,
                PendingIntent.getBroadcast(
                        context,
                        1,
                        sync,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return views;
    }

    /**
     * A published tone, resolved against this surface's own colours.
     *
     * <p>A tone rather than a hex, because a widget paints its own ground and
     * follows the shade's night mode rather than the app's theme: a colour
     * lifted from the WebView would be wrong half the time. Recovery's tones
     * carry their band, since that score is coloured by where it landed rather
     * than by a family.
     */
    private static int colorFor(final Context context, final String tone) {
        final int dark;
        final int light;
        if (tone == null) {
            dark = R.color.widget_dim;
            light = R.color.widget_dim_light;
        } else if (tone.equals("recovery-great")) {
            dark = R.color.widget_rec_great;
            light = R.color.widget_rec_great_light;
        } else if (tone.equals("recovery-good")) {
            dark = R.color.widget_rec_good;
            light = R.color.widget_rec_good_light;
        } else if (tone.equals("recovery-normal")) {
            dark = R.color.widget_rec_normal;
            light = R.color.widget_rec_normal_light;
        } else if (tone.equals("recovery-low")) {
            dark = R.color.widget_rec_low;
            light = R.color.widget_rec_low_light;
        } else if (tone.equals("recovery")) {
            dark = R.color.widget_recovery;
            light = R.color.widget_recovery_light;
        } else if (tone.equals("body")) {
            dark = R.color.widget_body;
            light = R.color.widget_body_light;
        } else if (tone.equals("intake")) {
            dark = R.color.widget_intake;
            light = R.color.widget_intake_light;
        } else if (tone.equals("activity")) {
            dark = R.color.widget_activity;
            light = R.color.widget_activity_light;
        } else {
            dark = R.color.widget_ink;
            light = R.color.widget_ink_light;
        }
        return AtlasWidgets.color(context, dark, light);
    }
}
