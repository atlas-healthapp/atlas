package io.github.atlashealthapp.atlas;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.atlashealthapp.atlas.ble.HelioBlePlugin;

public class MainActivity extends BridgeActivity {

    // Must match every [data-theme] block's --bg1 in src/style.css.
    private String bg1For(String theme) {
        switch (theme) {
            case "ember":
                return "#0c0803";
            case "paper":
                return "#f0e7d3";
            case "mission":
                return "#eef2f7";
            default:
                return "#000000"; // sentinel
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must precede super.onCreate: the bridge collects its plugin registry
        // while starting up, and anything registered afterwards is invisible to JS.
        registerPlugin(HelioBlePlugin.class);
        super.onCreate(savedInstanceState);
        // capacitor.config.json's backgroundColor is a static build-time value
        // with no way to know the user's actual saved theme, so the WebView
        // always paints its native background in that one fixed colour for a
        // frame or two before the real theme's CSS loads. Overriding it here,
        // immediately after the bridge/WebView is created but before the
        // first frame is composited, closes that gap - src/stores/theme.js
        // mirrors the chosen theme into this same SharedPreferences group on
        // every change (and on every launch) so it's always reasonably
        // current, even though this specific read can only affect the *next*
        // cold start, not whichever one is already in progress.
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", MODE_PRIVATE);
        String theme = prefs.getString("atlas_theme_native", "sentinel");
        getBridge().getWebView().setBackgroundColor(Color.parseColor(bg1For(theme)));
        recordOpenTarget(getIntent());
    }

    /**
     * A warm start, which is what most widget taps are.
     *
     * <p>onCreate runs once; tapping a widget while Atlas is already in memory
     * delivers here instead, and without this the app would come to the front on
     * whatever tab it was left on - which is the behaviour the target exists to
     * replace.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        recordOpenTarget(intent);
    }

    /**
     * Which page the widget that was tapped is about.
     *
     * <p><b>Left in SharedPreferences rather than handed over directly</b>,
     * because the WebView may not exist yet on a cold start and a bridge call
     * into a page that has not loaded goes nowhere. The app reads it when it is
     * ready and clears it, exactly as it reads the theme from this same group.
     *
     * <p>Written even when null so a plain launch clears a target left over from
     * a tap that was never acted on - otherwise opening Atlas from its icon a
     * day later would still land on somebody's heart page.
     */
    private void recordOpenTarget(Intent intent) {
        String target = intent == null ? null : intent.getStringExtra("atlas_open");
        getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .edit()
                .putString("atlas_widget_open", target == null ? "" : target)
                .apply();
    }
}
