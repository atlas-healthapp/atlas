package io.github.atlashealthapp.atlas.ble;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

/**
 * A measurement, not a feature.
 *
 * The open question it exists to answer: **what does an in-progress night
 * actually contain?** The band is known to write revisions of a sleep session
 * while the night is still running, but nobody has measured their *lag* - whether
 * a session fetched at 03:00 has classified the stages up to 02:55, or stops well
 * short while the band is still deciding. That gap is the difference between
 * being able to wake someone inside a light phase and acting on twenty-minute-old
 * information, so it gates two features rather than being idle curiosity.
 *
 * **It records what arrived and when, and decodes nothing.** The blobs are
 * appended as base64 with the wall-clock time they were fetched, exactly as the
 * plugin already hands sleep to the WebView, so the tested `huamiSleep.js`
 * decoder does the reading in the morning. A second decoder in Java would be a
 * second thing to keep correct, and this one only has to survive one night.
 *
 * **A sync that returned no sessions is still written.** "At 03:00 the band had
 * nothing to give" is a result, and a file with a hole in it cannot be told apart
 * from a service that stopped running.
 *
 * Off by default and enabled per device, because it shortens the sync interval
 * and a BLE connect every ten minutes all night is a real cost to the strap's
 * battery. It writes to app-private storage, read back on a debug build with
 * `adb exec-out run-as io.github.atlashealthapp.atlas cat files/sleep-probe.jsonl`.
 */
final class SleepProbe {

    private static final String FILE_NAME = "sleep-probe.jsonl";
    static final String KEY_ENABLED = "sleep_probe";

    /**
     * How often to sync while probing.
     *
     * Ten minutes is the resolution the question needs: a smart alarm choosing a
     * moment inside a window is worthless if the picture it works from is half an
     * hour old, and the ordinary interval is thirty.
     */
    static final long INTERVAL_MS = 10 * 60 * 1000L;

    private SleepProbe() {
    }

    static boolean enabled(final SharedPreferences prefs) {
        return prefs.getBoolean(KEY_ENABLED, false);
    }

    /**
     * One line per sync: when it ran, how many sessions came back, and each of
     * them base64'd.
     *
     * Failures are swallowed to a log line on purpose. This is a diagnostic
     * riding along inside the sync that keeps the app's data current, and a full
     * disk must not be able to take that down.
     */
    static void record(final Context context, final long fetchedAt, final List<byte[]> sessions) {
        final StringBuilder line = new StringBuilder(256);
        line.append("{\"fetchedAt\":").append(fetchedAt)
                .append(",\"count\":").append(sessions.size())
                .append(",\"sessions\":[");
        for (int i = 0; i < sessions.size(); i++) {
            if (i > 0) {
                line.append(',');
            }
            line.append('"').append(Base64.encodeToString(sessions.get(i), Base64.NO_WRAP)).append('"');
        }
        line.append("]}\n");

        try {
            final File file = new File(context.getFilesDir(), FILE_NAME);
            try (FileOutputStream out = new FileOutputStream(file, true)) {
                out.write(line.toString().getBytes(StandardCharsets.UTF_8));
            }
            android.util.Log.i("HelioBle", String.format(Locale.US,
                    "[probe] %d session(s) at %d, log now %d bytes",
                    sessions.size(), fetchedAt, file.length()));
        } catch (final IOException e) {
            android.util.Log.w("HelioBle", "[probe] could not write: " + e);
        }
    }
}
