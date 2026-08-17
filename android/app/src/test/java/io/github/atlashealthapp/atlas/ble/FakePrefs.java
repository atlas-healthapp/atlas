package io.github.atlashealthapp.atlas.ble;

import android.content.SharedPreferences;

import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * SharedPreferences over a HashMap.
 *
 * <p>These are plain JUnit tests with no Robolectric, so the android.jar on the
 * test classpath is stubs that throw. SharedPreferences is an interface, which
 * makes standing one up cheaper than pulling in a framework.
 *
 * <p>Lived inside {@code SmartAlarmRearmTest} until a second test class needed
 * it. Shared rather than copied: two prefs fakes drifting apart would make two
 * test classes disagree about what the service reads.
 */
final class FakePrefs implements SharedPreferences {

    private final Map<String, Object> values = new HashMap<>();

    @Override
    public Map<String, ?> getAll() {
        return new HashMap<>(values);
    }

    @Override
    public String getString(final String key, final String def) {
        final Object v = values.get(key);
        return v instanceof String ? (String) v : def;
    }

    @Override
    public Set<String> getStringSet(final String key, final Set<String> def) {
        return def;
    }

    @Override
    public int getInt(final String key, final int def) {
        final Object v = values.get(key);
        return v instanceof Integer ? (Integer) v : def;
    }

    @Override
    public long getLong(final String key, final long def) {
        final Object v = values.get(key);
        return v instanceof Long ? (Long) v : def;
    }

    @Override
    public float getFloat(final String key, final float def) {
        final Object v = values.get(key);
        return v instanceof Float ? (Float) v : def;
    }

    @Override
    public boolean getBoolean(final String key, final boolean def) {
        final Object v = values.get(key);
        return v instanceof Boolean ? (Boolean) v : def;
    }

    @Override
    public boolean contains(final String key) {
        return values.containsKey(key);
    }

    @Override
    public Editor edit() {
        return new FakeEditor(values);
    }

    @Override
    public void registerOnSharedPreferenceChangeListener(
            final OnSharedPreferenceChangeListener listener) {}

    @Override
    public void unregisterOnSharedPreferenceChangeListener(
            final OnSharedPreferenceChangeListener listener) {}

    /** Writes straight through: apply and commit are the same here. */
    private static final class FakeEditor implements SharedPreferences.Editor {
        private final Map<String, Object> values;

        FakeEditor(final Map<String, Object> values) {
            this.values = values;
        }

        @Override
        public SharedPreferences.Editor putString(final String key, final String value) {
            values.put(key, value);
            return this;
        }

        @Override
        public SharedPreferences.Editor putStringSet(final String key, final Set<String> value) {
            values.put(key, value);
            return this;
        }

        @Override
        public SharedPreferences.Editor putInt(final String key, final int value) {
            values.put(key, value);
            return this;
        }

        @Override
        public SharedPreferences.Editor putLong(final String key, final long value) {
            values.put(key, value);
            return this;
        }

        @Override
        public SharedPreferences.Editor putFloat(final String key, final float value) {
            values.put(key, value);
            return this;
        }

        @Override
        public SharedPreferences.Editor putBoolean(final String key, final boolean value) {
            values.put(key, value);
            return this;
        }

        @Override
        public SharedPreferences.Editor remove(final String key) {
            values.remove(key);
            return this;
        }

        @Override
        public SharedPreferences.Editor clear() {
            values.clear();
            return this;
        }

        @Override
        public boolean commit() {
            return true;
        }

        @Override
        public void apply() {}
    }
}
