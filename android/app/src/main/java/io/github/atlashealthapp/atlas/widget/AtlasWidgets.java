package io.github.atlashealthapp.atlas.widget;

import android.content.Context;
import android.content.SharedPreferences;

import io.github.atlashealthapp.atlas.R;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * What every Atlas widget shares: where the summary lives, and redrawing them
 * all when it changes.
 *
 * <p><b>One publish has to reach every provider.</b> Each widget is a separate
 * {@link android.appwidget.AppWidgetProvider}, so the app publishing a new
 * summary and refreshing only the one it happens to name is how a home screen
 * ends up with a fresh Recovery beside yesterday's steps. The publish path calls
 * {@link #refreshAll} and this is the only list of providers.
 */
public final class AtlasWidgets {

    private AtlasWidgets() {}

    /** Where the app mirrors its summary. Capacitor Preferences live in this file. */
    private static final String PREFS = "CapacitorStorage";
    private static final String SUMMARY_KEY = "atlas_summary_native";

    /** Where a press is remembered until the sync it asked for lands. */
    private static final String WIDGET_PREFS = "atlas_widget";

    /**
     * How long a press may claim to be syncing if nothing ever completes.
     *
     * <p>A backstop rather than the mechanism: the spinner normally stops
     * because the service records a sync NEWER than the press. Without the
     * backstop, a sync that never happens - band out of range, link held by the
     * app - would leave a widget spinning on the home screen for ever.
     */
    private static final long SYNCING_BACKSTOP_MS = 90_000L;

    /** Remember that a refresh was pressed, so the widget can whir. */
    public static void markPressed(final Context context, final String key) {
        try {
            context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putLong(key, System.currentTimeMillis())
                    .apply();
        } catch (final Exception e) {
            // The spinner is not worth a crash.
        }
    }

    /**
     * Is a press still outstanding?
     *
     * <p><b>Cleared by the sync landing, not by a timer.</b> The first version
     * only counted seconds, so the spinner kept turning for the full window even
     * though the fetch had finished - reported as "it is stuck showing syncing,
     * and it wasn't until I opened the app that it completed", when in fact the
     * sync had completed and only the label was lying. The service stamps
     * {@code last_sync} when it finishes, so a stamp newer than the press is the
     * sync this press asked for.
     */
    public static boolean isSyncing(final Context context, final String key) {
        try {
            final long pressed =
                    context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE)
                            .getLong(key, 0L);
            if (pressed <= 0) return false;
            final long since = System.currentTimeMillis() - pressed;
            if (since < 0 || since > SYNCING_BACKSTOP_MS) return false;
            final long lastSync =
                    context.getSharedPreferences(
                                    io.github.atlashealthapp.atlas.ble.HelioSyncService.PREFS,
                                    Context.MODE_PRIVATE)
                            .getLong(io.github.atlashealthapp.atlas.ble.HelioSyncService.KEY_LAST_SYNC, 0L);
            return lastSync < pressed;
        } catch (final Exception e) {
            return false;
        }
    }

    /**
     * Wide enough for the wordmark to sit in the middle of a header.
     *
     * <p>Three slots need room for three things. Below this the wordmark goes
     * first, then the sync stamp, and the metric and the refresh are what a
     * narrow widget keeps - the user's own priority: the logo before the control.
     *
     * <p>Chosen from the launcher's reported dp rather than a cell count, because
     * a cell is a launcher decision and differs by device.
     */
    public static final int WORDMARK_MIN_DP = 250;

    /**
     * Tall enough to be worth spending a line on the sync stamp.
     *
     * <p>A <b>height</b>, because the stamp moved out of the header and into the
     * footer on 2026-08-19: in the header it competed with the wordmark for
     * width, which is exactly why the wordmark could never be centred. In the
     * footer the only thing it can crowd is the reading above it, so what
     * decides is how short the card is.
     */
    public static final int STAMP_MIN_HEIGHT_DP = 100;

    /** What the launcher says it has given this instance, in dp. */
    public static int widthDp(final android.appwidget.AppWidgetManager manager, final int widgetId) {
        try {
            return manager.getAppWidgetOptions(widgetId)
                    .getInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
        } catch (final Exception e) {
            return 0;
        }
    }

    /**
     * And how tall, in the orientation it is being drawn in.
     *
     * <p><b>MAX_HEIGHT, not MIN_HEIGHT, and the difference is the whole bug.</b>
     * A launcher reports a widget's size as two pairs: portrait is minWidth by
     * maxHeight, landscape is maxWidth by minHeight. Reading MIN_HEIGHT in
     * portrait therefore returns the height it would have on its SIDE - measured
     * on the real phone, 107dp for a card actually drawn about 180 tall. The
     * layout concluded it was short, kept the columns, and left the dead space
     * that got reported twice.
     */
    public static int heightDp(final android.appwidget.AppWidgetManager manager, final int widgetId) {
        try {
            final android.os.Bundle options = manager.getAppWidgetOptions(widgetId);
            final int max =
                    options.getInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
            if (max > 0) return max;
            return options.getInt(android.appwidget.AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
        } catch (final Exception e) {
            return 0;
        }
    }

    /**
     * When the strap was last talked to, by either of the two things that talk
     * to it: the app, which stamps the summary, and this service, which stamps
     * its own preferences. Whichever ran later is the truth.
     */
    public static String syncedLabel(final Context context, final JSONObject summary) {
        final Double appAt = num(summary, "syncedAt");
        long last = appAt == null ? 0L : (long) (double) appAt;
        try {
            final long serviceAt =
                    context.getSharedPreferences(
                                    io.github.atlashealthapp.atlas.ble.HelioSyncService.PREFS,
                                    Context.MODE_PRIVATE)
                            .getLong(
                                    io.github.atlashealthapp.atlas.ble.HelioSyncService
                                            .KEY_LAST_SYNC,
                                    0L);
            if (serviceAt > last) last = serviceAt;
        } catch (final Exception e) {
            // The app's own stamp is still worth showing.
        }
        if (last <= 0) return "";
        final java.util.Calendar c = java.util.Calendar.getInstance();
        c.setTimeInMillis(last);
        final String stamp =
                String.format(
                        java.util.Locale.UK,
                        "SYNCED %02d:%02d",
                        c.get(java.util.Calendar.HOUR_OF_DAY),
                        c.get(java.util.Calendar.MINUTE));

        return stamp;
    }

    /**
     * The strap's charge, for the other end of the footer.
     *
     * <p>Beside the sync stamp rather than inside it: the two answer one
     * question between them - is this reading current, and will the next one
     * arrive - but run together as one string the stamp got hard to find. One
     * at each end, on equal weights, so neither moves when the other changes
     * length.
     *
     * <p>Empty rather than a dash when the strap has never reported, since a
     * footer is not the place to explain an absence.
     */
    public static String batteryLabel(final JSONObject summary) {
        final Double battery = num(summary, "strapBattery");
        return battery == null ? "" : "STRAP " + Math.round(battery) + "%";
    }

    /**
     * Fill in the footer both ends of, and say whether it is worth showing.
     *
     * <p>Shared because four cards had four copies of it and the stamp had
     * already drifted into two different places once.
     */
    public static void footer(
            final Context context,
            final android.widget.RemoteViews views,
            final JSONObject summary,
            final int footerId,
            final int batteryId,
            final int syncedId,
            final boolean show) {
        views.setViewVisibility(
                footerId, show ? android.view.View.VISIBLE : android.view.View.GONE);
        if (!show) return;
        views.setTextViewText(batteryId, batteryLabel(summary));
        views.setTextViewText(syncedId, syncedLabel(context, summary));
    }

    /**
     * The same footer, while a sync is running.
     *
     * <p><b>It keeps its place.</b> Hiding it during a sync let everything above
     * it grow into the space and spring back when the sync finished, so pressing
     * refresh made the whole card jump - reported as the syncing state pushing
     * things down. A widget that moves while it works is harder to read than one
     * that changes a word.
     */
    public static void footerBusy(
            final Context context,
            final android.widget.RemoteViews views,
            final JSONObject summary,
            final int footerId,
            final int batteryId,
            final int syncedId,
            final boolean busy,
            final boolean roomForIt) {
        if (!busy) {
            footer(context, views, summary, footerId, batteryId, syncedId, roomForIt);
            return;
        }
        views.setViewVisibility(
                footerId, roomForIt ? android.view.View.VISIBLE : android.view.View.GONE);
        if (!roomForIt) return;
        views.setTextViewText(batteryId, batteryLabel(summary));
        views.setTextViewText(syncedId, context.getString(R.string.widget_syncing));
    }

    // ── Theme ────────────────────────────────────────────────────────────
    //
    // **The widgets follow the app's chosen theme, not the system's.** Option A
    // of three (2026-08-19): the theme store already mirrors the choice into
    // this same SharedPreferences group for MainActivity's launch background, so
    // it costs one read and a widget can never disagree with the app it belongs
    // to. The alternative, a values-night/ qualifier like the notification's,
    // follows the *shade's* night mode - and a widget sits on the wallpaper,
    // where the system's idea of night says nothing about what is behind it.
    //
    // A per-widget override is the sensible next step if anyone ever wants their
    // widget to differ from their app; it layers on top of this by storing a
    // choice that falls back to the theme, and needs a configuration activity
    // that TODAY was deliberately built not to need.

    /** Is the app's own theme one of the two light ones? */
    public static boolean isLight(final Context context) {
        try {
            final String theme =
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                            .getString("atlas_theme_native", "sentinel");
            return "paper".equals(theme) || "mission".equals(theme);
        } catch (final Exception e) {
            // Sentinel is the default everywhere else, including resolveTheme().
            return false;
        }
    }

    /**
     * Where a reading sits across the zone gauge, 0 to 1, or null.
     *
     * <p><b>One implementation for every card that draws the strip.</b> The
     * session widget and the heart widget both place a caret on the same scale,
     * and two copies of "half of maximum to maximum" would be two chances to
     * disagree about where zone one starts.
     *
     * <p>Null without an age to compute a maximum from, which a caller hides the
     * strip for rather than drawing a scale it cannot justify. The band's own
     * reported peaks are deliberately never used: they claim maxima the stored
     * samples contradict, which is what {@code hrZones.js} refuses them for.
     */
    public static Float zoneFraction(final Context context, final Double bpm) {
        if (bpm == null || bpm <= 0) return null;
        final org.json.JSONObject summary = summary(context);
        final org.json.JSONObject profile =
                summary == null ? null : summary.optJSONObject("profile");
        final int age = profile == null ? 0 : profile.optInt("age", 0);
        if (age <= 0) return null;
        final double max = Math.round(208 - 0.7 * age);
        final double from = max * 0.5;
        if (max <= from) return null;
        return (float) Math.max(0, Math.min(1, (bpm - from) / (max - from)));
    }

    /** A colour from whichever palette the app is in. */
    public static int color(final Context context, final int darkRes, final int lightRes) {
        return context.getResources().getColor(isLight(context) ? lightRes : darkRes, null);
    }

    /**
     * Paint a card: its ground, its quiet text and its loud text.
     *
     * <p>Every colour in these layouts is baked into the XML, which is right for
     * one palette and useless for two, so the provider restates them. Shared
     * because four cards restating the same three colours four different ways is
     * how the set would drift apart the first time one of them changed.
     */
    public static void applyTheme(
            final Context context,
            final android.widget.RemoteViews views,
            final int rootId,
            final int refreshId,
            final int[] dimIds,
            final int[] inkIds) {
        final boolean light = isLight(context);
        views.setInt(
                rootId,
                "setBackgroundResource",
                light ? R.drawable.widget_bg_light : R.drawable.widget_bg);
        final int dim =
                context.getResources()
                        .getColor(light ? R.color.widget_dim_light : R.color.widget_dim, null);
        final int ink =
                context.getResources()
                        .getColor(light ? R.color.widget_ink_light : R.color.widget_ink, null);
        for (final int id : dimIds) views.setTextColor(id, dim);
        for (final int id : inkIds) views.setTextColor(id, ink);
        // **The control is tinted, not left to the drawable.** Its glyph carries
        // a fixed colour chosen for a dark card, which on a light one is the
        // faintest thing on screen - and it is the one thing on a widget you can
        // press. Tinted to the same ink as the reading, so it reads as available
        // rather than as disabled.
        if (refreshId != 0) views.setInt(refreshId, "setColorFilter", dim);
    }

    /**
     * How big a card's headline reading is set, given the size it was given.
     *
     * <p><b>No fixed size fits a variable box.</b> Dragged to the launcher's
     * smallest, a 32sp figure is taller than the space between the header and
     * whatever is under it, and Android clips rather than shrinks - the tops of
     * the numbers come off, which reads as broken rather than as small.
     *
     * <p>Bounded by width as well as height, because a reading can be five
     * characters (1,026) or two (76), and on TODAY three of them share the card.
     */
    public static float figureSp(final int widthDp, final int heightDp, final float widthShare) {
        if (widthDp <= 0 && heightDp <= 0) return 32f;
        final float byHeight = heightDp <= 0 ? 999f : heightDp * 0.24f;
        final float byWidth = widthDp <= 0 ? 999f : widthDp * widthShare;
        return Math.max(15f, Math.min(46f, Math.min(byHeight, byWidth)));
    }

    /** Redraw every placed widget of every kind. */
    public static void refreshAll(final Context context) {
        AtlasWidget.refresh(context);
        StepsWidget.refresh(context);
        HeartWidget.refresh(context);
        SessionWidget.refresh(context);
        SleepWidget.refresh(context);
    }

    /**
     * The published summary, or null when the app has never written one.
     *
     * <p>Null rather than an empty object, so a caller draws dashes rather than
     * zeros: an empty track says the day went badly, and "no reading yet" is not
     * a bad day.
     */
    public static JSONObject summary(final Context context) {
        try {
            final SharedPreferences prefs =
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            final String raw = prefs.getString(SUMMARY_KEY, null);
            if (raw == null || raw.isEmpty()) return null;
            return new JSONObject(raw);
        } catch (final Exception e) {
            return null;
        }
    }

    /** A number from the summary, or null when it is absent or withheld. */
    public static Double num(final JSONObject summary, final String key) {
        if (summary == null || summary.isNull(key)) return null;
        final double v = summary.optDouble(key, Double.NaN);
        return Double.isNaN(v) ? null : v;
    }

    /** A published text field, or null. */
    public static String text(final JSONObject summary, final String key) {
        if (summary == null || summary.isNull(key)) return null;
        final String v = summary.optString(key, null);
        return v == null || v.isEmpty() ? null : v;
    }

    /**
     * A published series, as a nullable array.
     *
     * <p>The nulls are load-bearing: a bucket with nothing in it is the strap off
     * the wrist, and the chart breaks its line there rather than drawing a
     * reading of zero. Boxed {@code Integer} rather than {@code int} for exactly
     * that reason.
     */
    public static Integer[] series(final JSONObject summary, final String key) {
        if (summary == null || summary.isNull(key)) return null;
        final JSONArray array = summary.optJSONArray(key);
        if (array == null || array.length() == 0) return null;
        final Integer[] out = new Integer[array.length()];
        for (int i = 0; i < array.length(); i++) {
            out[i] = array.isNull(i) ? null : array.optInt(i);
        }
        return out;
    }
}
