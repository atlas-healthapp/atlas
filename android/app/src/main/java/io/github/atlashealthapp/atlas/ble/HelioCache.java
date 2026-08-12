package io.github.atlashealthapp.atlas.ble;

import android.content.Context;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;

/**
 * Native holding pen for samples fetched while the WebView does not exist.
 *
 * Atlas keeps its samples in IndexedDB, which lives inside the WebView. A
 * background service has no WebView, so it cannot write there at all. Rather
 * than duplicate the storage layer natively, the service parks what it fetched
 * in app-private files and the WebView drains them the next time it runs. The
 * band remains the source of truth throughout; this is a queue, not a database.
 *
 * Each sync writes its own file rather than appending to a shared one. A process
 * killed mid-write then costs at most that one sync, and leaves no half-parsed
 * JSON that would poison every later drain.
 */
final class HelioCache {

    private static final String DIR = "helio-pending";

    private HelioCache() {
    }

    private static File dir(final Context context) {
        final File dir = new File(context.getFilesDir(), DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    static void store(final Context context,
                      final List<HelioFetch.Sample> samples,
                      final List<byte[]> sleepSessions,
                      final List<HelioFetch.Workout> workouts) throws IOException, org.json.JSONException {
        if (samples.isEmpty() && sleepSessions.isEmpty() && workouts.isEmpty()) {
            return;
        }

        final JSONArray sampleArray = new JSONArray();
        for (final HelioFetch.Sample sample : samples) {
            final JSONObject one = new JSONObject();
            one.put("metric", sample.metric);
            one.put("t", sample.t);
            one.put("v", sample.v);
            sampleArray.put(one);
        }

        final JSONArray sleepArray = new JSONArray();
        for (final byte[] session : sleepSessions) {
            sleepArray.put(Base64.encodeToString(session, Base64.NO_WRAP));
        }

        // Already decoded natively (unlike sleep, which hands raw bytes to the
        // JS decoder) - nulls come through as JSONObject.NULL rather than being
        // silently dropped, so an absent field on the JS side still reads absent.
        final JSONArray workoutArray = new JSONArray();
        for (final HelioFetch.Workout w : workouts) {
            final JSONObject one = new JSONObject();
            one.put("startMillis", w.startMillis);
            one.put("endMillis", w.endMillis);
            one.put("typeCode", w.typeCode == null ? JSONObject.NULL : w.typeCode);
            one.put("typeAutoDetected", w.typeAutoDetected);
            one.put("activeSeconds", w.activeSeconds == null ? JSONObject.NULL : w.activeSeconds);
            one.put("caloriesKcal", w.caloriesKcal == null ? JSONObject.NULL : w.caloriesKcal);
            one.put("hrAvg", w.hrAvg == null ? JSONObject.NULL : w.hrAvg);
            one.put("hrMax", w.hrMax == null ? JSONObject.NULL : w.hrMax);
            one.put("hrMin", w.hrMin == null ? JSONObject.NULL : w.hrMin);
            one.put("distanceMeters", w.distanceMeters == null ? JSONObject.NULL : w.distanceMeters);
            one.put("altitudeAvgMeters", w.altitudeAvgMeters == null ? JSONObject.NULL : w.altitudeAvgMeters);
            workoutArray.put(one);
        }

        final JSONObject root = new JSONObject();
        root.put("samples", sampleArray);
        root.put("sessions", sleepArray);
        root.put("workouts", workoutArray);

        // Written to a temporary name and renamed, so a drain running
        // concurrently never sees a partially written file.
        final File target = new File(dir(context),
                String.format(Locale.US, "sync-%d.json", System.currentTimeMillis()));
        final File temp = new File(target.getPath() + ".part");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(root.toString().getBytes(StandardCharsets.UTF_8));
        }
        if (!temp.renameTo(target)) {
            temp.delete();
            throw new IOException("could not commit cache file");
        }
    }

    /**
     * Hand everything cached to the caller and delete it.
     *
     * Deleting here rather than after the WebView confirms storage is a
     * deliberate trade: re-fetching from the band is cheap and idempotent
     * (samples are keyed on metric and timestamp), whereas a file that is never
     * deleted would be re-ingested on every launch forever.
     */
    static JSONObject drain(final Context context) throws org.json.JSONException {
        final JSONArray samples = new JSONArray();
        final JSONArray sessions = new JSONArray();
        final JSONArray workouts = new JSONArray();

        final File[] files = dir(context).listFiles((d, name) -> name.endsWith(".json"));
        if (files != null) {
            java.util.Arrays.sort(files);
            for (final File file : files) {
                try {
                    final byte[] bytes = new byte[(int) file.length()];
                    try (java.io.FileInputStream in = new java.io.FileInputStream(file)) {
                        int read = 0;
                        while (read < bytes.length) {
                            final int n = in.read(bytes, read, bytes.length - read);
                            if (n < 0) break;
                            read += n;
                        }
                    }
                    final JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
                    final JSONArray s = root.optJSONArray("samples");
                    for (int i = 0; s != null && i < s.length(); i++) {
                        samples.put(s.get(i));
                    }
                    final JSONArray z = root.optJSONArray("sessions");
                    for (int i = 0; z != null && i < z.length(); i++) {
                        sessions.put(z.get(i));
                    }
                    final JSONArray w = root.optJSONArray("workouts");
                    for (int i = 0; w != null && i < w.length(); i++) {
                        workouts.put(w.get(i));
                    }
                } catch (final Exception e) {
                    // A corrupt file must not block every other pending sync.
                    android.util.Log.w("HelioBle", "dropping unreadable cache file " + file.getName());
                } finally {
                    file.delete();
                }
            }
        }

        final JSONObject out = new JSONObject();
        out.put("samples", samples);
        out.put("sessions", sessions);
        out.put("workouts", workouts);
        return out;
    }
}
