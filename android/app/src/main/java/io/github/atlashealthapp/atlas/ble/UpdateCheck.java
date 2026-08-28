package io.github.atlashealthapp.atlas.ble;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Is there a newer Atlas than the one running? The pure half.
 *
 * <p><b>The twin of {@code src/utils/updateCheck.js}, and change-both-or-neither.</b>
 * The app asks GitHub while it is open and shows an in-app flag; this service
 * asks while it is closed and posts a notification. Both have to agree about what
 * counts as newer, or the shade offers an update the app does not, or the other
 * way round. {@code updateCheckTwin.test.js} reads this file and checks the two
 * against the same cases.
 *
 * <p><b>Why the service asks at all, having said it should not.</b> The first
 * version read a version string the app mirrored into SharedPreferences, on the
 * argument that one implementation is better than two. That was right about the
 * implementation and wrong about the feature: the mirror is only written while
 * Atlas is open, so the notification could only ever tell you something you had
 * already been shown on Home. The person it exists for is the one who has not
 * opened Atlas in a month. So the service asks for itself, and the mirror stays
 * as the fallback for a tick whose own request failed.
 *
 * <p><b>No {@code org.json}.</b> Under plain JUnit that class is an android.jar
 * stub which throws on every call, so anything parsed with it cannot be tested -
 * the same reason {@link AlarmPlan} is flat text rather than JSON. The one field
 * needed here is a string in a flat object, and a regex reads it honestly.
 */
final class UpdateCheck {

    private UpdateCheck() {
    }

    /**
     * {@code "tag_name": "v1.0.9"} out of the releases API's reply.
     *
     * <p>Deliberately not a general JSON parser. It matches the first
     * {@code tag_name} whose value is a plain string, which is the only shape
     * GitHub returns for it, and returns null for anything else rather than
     * guessing. A body that has changed shape must read as "no answer", never as
     * a version.
     */
    static String tagFromJson(final String body) {
        if (body == null) {
            return null;
        }
        final Matcher m = Pattern
                .compile("\"tag_name\"\\s*:\\s*\"([^\"\\\\]*)\"")
                .matcher(body);
        if (!m.find()) {
            return null;
        }
        final String tag = m.group(1).trim();
        return tag.isEmpty() ? null : tag;
    }

    /**
     * The one spelling of a version that both sources have to agree on.
     *
     * <p><b>This is what stops the notification arriving twice.</b> A release is
     * named twice: the app mirrors it having already stripped the {@code v}, and
     * this service's own fetch reads the raw tag with it still on. Both are
     * announced through the same watermark, so if they spelled the same release
     * differently the watermark would miss and the shade would carry
     * "Atlas 1.0.9 is available" twice over.
     *
     * <p>Returns null for anything that is not a version, so a spelling that
     * cannot be canonicalised is never recorded as one.
     */
    static String normalise(final String value) {
        if (value == null) {
            return null;
        }
        final String trimmed = value.trim();
        final String withoutV = trimmed.replaceFirst("^[vV]", "");
        return parseVersion(withoutV) == null ? null : withoutV;
    }

    /**
     * {@code 1.0.9} to {@code [1, 0, 9]}, or null for anything that is not a
     * version.
     *
     * <p>Tolerates the {@code v} the tags carry, and drops a build suffix so a
     * debug build compares as its base version. Digits only and every part
     * non-empty: in the JS twin an empty string and a leading-dash both parsed as
     * version zero, which would have made any garbage tag newer than everything
     * and nagged every user forever.
     */
    static int[] parseVersion(final String value) {
        if (value == null) {
            return null;
        }
        String cleaned = value.trim();
        if (cleaned.startsWith("v") || cleaned.startsWith("V")) {
            cleaned = cleaned.substring(1);
        }
        // Everything from the first +, - or whitespace is a build suffix.
        final int cut = indexOfAny(cleaned, "+- \t");
        if (cut >= 0) {
            cleaned = cleaned.substring(0, cut);
        }
        if (cleaned.isEmpty()) {
            return null;
        }
        final String[] parts = cleaned.split("\\.", -1);
        if (parts.length == 0 || parts.length > 4) {
            return null;
        }
        final int[] out = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            if (parts[i].isEmpty()) {
                return null;
            }
            for (int j = 0; j < parts[i].length(); j++) {
                if (!Character.isDigit(parts[i].charAt(j))) {
                    return null;
                }
            }
            try {
                out[i] = Integer.parseInt(parts[i]);
            } catch (final NumberFormatException e) {
                return null;
            }
        }
        return out;
    }

    private static int indexOfAny(final String s, final String chars) {
        for (int i = 0; i < s.length(); i++) {
            if (chars.indexOf(s.charAt(i)) >= 0) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Is {@code candidate} newer than {@code current}?
     *
     * <p>Compared part by part rather than as a number, or 1.0.10 sorts below
     * 1.0.9. Unparseable input on either side is never newer: a malformed tag
     * must not nag everybody forever, and a version this build cannot read about
     * itself must not make it think it is out of date with itself.
     */
    static boolean isNewer(final String candidate, final String current) {
        final int[] a = parseVersion(candidate);
        final int[] b = parseVersion(current);
        if (a == null || b == null) {
            return false;
        }
        final int len = Math.max(a.length, b.length);
        for (int i = 0; i < len; i++) {
            final int x = i < a.length ? a[i] : 0;
            final int y = i < b.length ? b[i] : 0;
            if (x != y) {
                return x > y;
            }
        }
        return false;
    }
}
