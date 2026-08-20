package io.github.atlashealthapp.atlas.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.RemoteViews;

import org.json.JSONObject;

import java.util.Locale;

import io.github.atlashealthapp.atlas.MainActivity;
import io.github.atlashealthapp.atlas.R;
import io.github.atlashealthapp.atlas.ble.HelioSyncService;

/**
 * A session in progress, on the home screen.
 *
 * <p><b>The only widget in the set about something that is happening rather than
 * something that has happened.</b> The other four report a day already lived, and
 * are equally correct at any hour. This one is live while a session runs and has
 * nothing to say the rest of the time, which is what gives it a second state the
 * others do not need: a card that is blank most of the day reads as broken, so
 * when nothing is running it offers the thing you would open the app to do.
 *
 * <p><b>No refresh control.</b> Every other card has one, because a day's figures
 * go stale and pressing it is how you find out. This one has nothing to refresh:
 * the clock is ticked by the system, and the heart rate is streamed only while
 * the screen is on and cannot be conjured by a press. A button that did nothing
 * would be worse than no button, and the space goes to the reading instead.
 */
public class SessionWidget extends AppWidgetProvider {

    /** Below this there is no room for the heart rate line under the clock. */
    private static final int HR_MIN_DP = 100;

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
                    manager.getAppWidgetIds(new ComponentName(context, SessionWidget.class));
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
                new RemoteViews(context.getPackageName(), R.layout.widget_session);
        final JSONObject summary = AtlasWidgets.summary(context);

        AtlasWidgets.applyTheme(
                context,
                views,
                R.id.session_root,
                0,
                new int[] {
                    R.id.session_label, R.id.session_mark, R.id.session_what,
                    R.id.session_idle_hint, R.id.session_battery, R.id.session_synced
                },
                new int[] {R.id.session_bpm, R.id.session_idle_line});

        // **Tapping opens the session sheet, whichever state the card is in.**
        // Running, that is where STOP lives; idle, it is where START does. One
        // target either way, because the card is about one thing.
        final Intent open = new Intent(context, MainActivity.class)
                .putExtra("atlas_open", "session")
                .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        views.setOnClickPendingIntent(
                R.id.session_root,
                PendingIntent.getActivity(
                        context, 3, open,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));

        final JSONObject session = summary == null ? null : summary.optJSONObject("session");
        final long startedAt = session == null ? 0 : session.optLong("startedAt", 0);
        final boolean running = startedAt > 0;

        views.setViewVisibility(
                R.id.session_live, running ? android.view.View.VISIBLE : android.view.View.GONE);
        views.setViewVisibility(
                R.id.session_idle, running ? android.view.View.GONE : android.view.View.VISIBLE);

        if (running) {
            final String typeName =
                    session.isNull("typeName") ? null : session.optString("typeName");
            // **elapsedRealtime, not wall time.** Chronometer counts against the
            // monotonic clock, so a base taken from currentTimeMillis is out by
            // however long the phone has been up - on a phone awake for days,
            // that reads in years.
            views.setChronometer(
                    R.id.session_clock,
                    android.os.SystemClock.elapsedRealtime()
                            - (System.currentTimeMillis() - startedAt),
                    null,
                    true);

            final String since = String.format(Locale.getDefault(), "started %tR", startedAt);
            views.setTextViewText(
                    R.id.session_what,
                    typeName == null || typeName.trim().isEmpty()
                            ? since
                            : typeName + " · " + since);

            // The heart rate the service last streamed, beside the clock so it
            // survives the card being made small, with the gauge under it.
            final String hr = HelioSyncService.liveHeartRateLabel(context, startedAt);
            final String bpmOnly = hr == null ? null
                    : (hr.indexOf(" · ") < 0 ? hr : hr.substring(0, hr.indexOf(" · ")));
            views.setViewVisibility(
                    R.id.session_bpm,
                    bpmOnly != null ? android.view.View.VISIBLE : android.view.View.GONE);
            if (bpmOnly != null) views.setTextViewText(R.id.session_bpm, bpmOnly);

            // The gauge is drawn whenever there is room, with or without a
            // caret: the scale itself is information, and a card that loses the
            // whole strip the moment the strap stops reporting changes shape for
            // a reason nobody can see.
            final int widthDp = AtlasWidgets.widthDp(manager, widgetId);
            final boolean room = AtlasWidgets.heightDp(manager, widgetId) >= HR_MIN_DP;
            views.setViewVisibility(
                    R.id.session_zonebar,
                    room ? android.view.View.VISIBLE : android.view.View.GONE);
            views.setViewVisibility(
                    R.id.session_zone_lo, room ? android.view.View.VISIBLE : android.view.View.GONE);
            views.setViewVisibility(
                    R.id.session_zone_name, room ? android.view.View.VISIBLE : android.view.View.GONE);
            views.setViewVisibility(
                    R.id.session_zone_hi, room ? android.view.View.VISIBLE : android.view.View.GONE);
            if (room) {
                // Both ends of the scale, because it starts at half of maximum
                // rather than at zero, and the zone in words in the middle.
                final int[] ends = HelioSyncService.zoneScale(context);
                views.setTextViewText(R.id.session_zone_lo, ends == null ? "" : String.valueOf(ends[0]));
                views.setTextViewText(R.id.session_zone_hi, ends == null ? "" : String.valueOf(ends[1]));
                final String zoneName = HelioSyncService.liveZoneName(context, startedAt);
                views.setTextViewText(R.id.session_zone_name, zoneName == null ? "" : zoneName);
                views.setImageViewBitmap(
                        R.id.session_zonebar,
                        Spark.zoneGauge(
                                HelioSyncService.liveZoneFraction(context, startedAt),
                                Math.round((widthDp - 24) * context.getResources()
                                        .getDisplayMetrics().density),
                                Math.round(18 * context.getResources()
                                        .getDisplayMetrics().density),
                                AtlasWidgets.color(
                                        context, R.color.widget_ink, R.color.widget_ink_light)));
            }
        }

        AtlasWidgets.footer(
                context,
                views,
                summary,
                R.id.session_footer,
                R.id.session_battery,
                R.id.session_synced,
                AtlasWidgets.heightDp(manager, widgetId) >= HR_MIN_DP);

        return views;
    }
}
