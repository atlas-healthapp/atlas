package io.github.atlashealthapp.atlas.ble;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.os.Build;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * BLE connection lifecycle for the Amazfit Helio Strap, and the transport the
 * authentication handshake runs over.
 *
 * Nothing here scans. The strap is already bonded to the phone, and an Android
 * bond is held by the OS rather than by the app that created it, so Atlas can
 * look it up directly. That avoids a scan, the location permission a scan drags
 * in, and a whole class of discovery timing bugs.
 */
@SuppressLint("MissingPermission") // gated by HelioBlePlugin's BLUETOOTH_CONNECT check
public class HelioLink implements HelioAuth.Transport, HelioFetch.Transport {

    /** Exactly as the band advertises it, with no MAC address suffix. */
    private static final String DEVICE_NAME = "Amazfit Helio Strap";

    // Deliberately not scoped to a service. The spike's first on-device run found
    // both chunked characteristics under FEE0, not the FEE1 the design assumed;
    // on this unit FEE1 is an unrelated two-characteristic stub. Gadgetbridge
    // never hit this because it resolves characteristics across every discovered
    // service, so the service a characteristic lives under simply never mattered.
    // Doing the same here means a firmware update that moves them again costs
    // nothing.
    private static final UUID CHAR_CHUNKED_WRITE =
            UUID.fromString("00000016-0000-3512-2118-0009af100700");
    private static final UUID CHAR_CHUNKED_READ =
            UUID.fromString("00000017-0000-3512-2118-0009af100700");
    private static final UUID CCCD =
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");

    // Bulk activity data does not travel over the chunked layer at all. It comes
    // as raw notifications on 0x0005, which is why these two are needed on top of
    // the chunked pair above.
    private static final UUID CHAR_ACTIVITY_CONTROL =
            UUID.fromString("00000004-0000-3512-2118-0009af100700");
    private static final UUID CHAR_ACTIVITY_DATA =
            UUID.fromString("00000005-0000-3512-2118-0009af100700");

    /** ZeppOS devices negotiate up from the 23-byte default; Gadgetbridge asks for this. */
    private static final int DESIRED_MTU = 247;

    // Whether a given endpoint is encrypted is not ours to decide: the band
    // reports it, per endpoint, in a service list requested on endpoint 0x0000.
    // Gadgetbridge's per-service defaults are only defaults, and it overwrites
    // them with whatever the band answers. Assuming instead of asking is what
    // made the first attempt at this fail, silently: an encrypted frame sent to
    // an endpoint expecting plaintext is dropped without any reply at all.
    private static final short ENDPOINT_SERVICES = 0x0000;
    private static final byte CMD_SERVICES_GET = 0x03;
    private static final byte CMD_SERVICES_LIST = 0x04;

    // Battery is the cheapest real reading to ask for once the service list says
    // how to address it. It separates "the band accepted our session key" from
    // "the session key actually works".
    private static final short ENDPOINT_BATTERY = 0x0029;
    private static final byte CMD_BATTERY_REQUEST = 0x03;
    private static final byte CMD_BATTERY_REPLY = 0x04;

    // Config capabilities: a single read-only byte with a guaranteed reply, on an
    // endpoint this band declares encrypted. It is asked on every session on
    // purpose. The encrypted chunked path (sequence number, CRC, block padding)
    // is otherwise never exercised, since every endpoint used for data is plain,
    // and it is load-bearing for the workout service later. A silent break would
    // then surface as a mysterious workout failure rather than here.
    private static final short ENDPOINT_CONFIG = 0x000a;
    private static final byte CMD_CAPABILITIES_REQUEST = 0x01;
    private static final byte CMD_CAPABILITIES_RESPONSE = 0x02;

    // Live heart rate. The command goes to endpoint 0x001d, but the readings come
    // back on the standard Bluetooth heart-rate characteristic rather than
    // through the endpoint, so both have to be wired up.
    private static final short ENDPOINT_HEART_RATE = 0x001d;
    private static final byte CMD_REALTIME_SET = 0x04;
    private static final byte REALTIME_STOP = 0x00;
    private static final byte REALTIME_START = 0x01;
    private static final byte REALTIME_CONTINUE = 0x02;
    private static final UUID CHAR_HR_MEASUREMENT =
            UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb");

    /**
     * The band stops measuring unless told to carry on. One second is what
     * Gadgetbridge uses; a longer gap lets the sensor lapse between readings.
     */
    private static final long REALTIME_KEEPALIVE_MS = 1000L;

    public interface Listener {
        void onLog(String message);

        /** Link is up: services discovered, MTU negotiated, notifications live. */
        void onReady();

        void onAuthResult(boolean success, String detail);

        /** A real reading, decrypted with the negotiated session key. */
        void onBattery(int levelPercent, boolean charging);

        /** Raw 594-byte sleep session blobs, decoded on the JS side. */
        void onSleepSessions(List<byte[]> sessions);

        /** Already decoded natively, unlike sleep - the workout protobuf has no JS-side equivalent. */
        void onWorkouts(List<HelioFetch.Workout> workouts);

        /** Normalised readings, in the same {metric, t, v} shape the JS pipeline already takes. */
        void onSamples(List<HelioFetch.Sample> samples);

        void onFetchComplete();

        /** A live reading, only while live mode is running. Never stored. */
        void onHeartRate(int bpm);

        /**
         * The band's answer to an alarm write, with its raw status byte.
         *
         * Defaulted so the background service, which never sets an alarm, does
         * not have to carry an empty override for it.
         */
        default void onAlarmSet(boolean accepted, int status) {
        }

        void onClosed(String reason);
    }

    private final Context context;
    private final Listener listener;
    private final GattQueue queue;
    private final byte[] authKey;

    private final ChunkedCodec.Encoder encoder = new ChunkedCodec.Encoder(DESIRED_MTU);
    private final ChunkedCodec.Decoder decoder;

    /**
     * The strap accepts roughly one central at a time, and this app can offer it
     * two on its own: {@link HelioBlePlugin} and {@link HelioSyncService} each
     * hold their own separate {@code link} field, so the plugin's own LINK_BUSY
     * guard (a check on its own field) cannot see a connection the background
     * service is holding, or vice versa. Both handshakes then run concurrently
     * against the same physical band, which desyncs the protocol - observed as
     * "wrong auth key" from both sides even though the key is correct. This is
     * the process-wide guard that field-scoped check was missing: one atomic
     * flag both callers check before ever opening a GATT connection.
     */
    private static final java.util.concurrent.atomic.AtomicBoolean LINK_ACTIVE =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    /** True only for the instance that actually set {@link #LINK_ACTIVE}, so a release cannot clear someone else's hold. */
    private boolean holdsLinkLock;

    /** Advisory only: callers should still handle the atomic acquire failing in {@link #connect}. */
    static boolean isLinkActive() {
        return LINK_ACTIVE.get();
    }

    private BluetoothGatt gatt;
    private BluetoothGattCharacteristic writeCharacteristic;
    private BluetoothGattCharacteristic readCharacteristic;
    private HelioAuth auth;
    private boolean linkReady;
    private final HelioFetch fetch = new HelioFetch(this);
    private int fetchSinceDays = 3;
    private long fetchWorkoutSinceMillis = 0L;
    /** Live mode holds the connection open and streams; it deliberately skips the fetch. */
    private boolean liveHeartRate;

    /**
     * A built alarm message waiting for the link to come up, or null on an
     * ordinary session. Set, it replaces the fetch entirely: writing a setting
     * and pulling three days of samples have nothing to do with each other, and
     * a link that did both would make an alarm wait on a fetch that can run for
     * half a minute.
     */
    private byte[] pendingAlarm;
    private boolean loggedFirstHeartRate;
    private final android.os.Handler keepalive = new android.os.Handler(android.os.Looper.getMainLooper());

    /**
     * Which endpoints speak encrypted, as declared by this band rather than
     * assumed from Gadgetbridge's compile-time defaults. Getting this wrong is
     * invisible: a misaddressed frame is dropped with no reply of any kind.
     */
    private final Map<Integer, Boolean> endpointEncrypted = new HashMap<>();

    public HelioLink(final Context context, final Listener listener, final byte[] authKey) {
        this.context = context.getApplicationContext();
        this.listener = listener;
        this.authKey = authKey;
        this.queue = new GattQueue(listener::onLog);
        this.decoder = new ChunkedCodec.Decoder(this::onPayload);
    }

    @Override
    public void log(final String message) {
        listener.onLog(message);
    }

    /**
     * Whether a bonded device's name is this strap.
     *
     * **Not an exact match, because only one band was ever checked.** DEVICE_NAME
     * is how the author's own unit advertises itself, and until 2026-08-13 the
     * lookup was `DEVICE_NAME.equals(name)`. A public user on 1.0.5 then reported
     * `no bonded device named "Amazfit Helio Strap"` with a perfectly good strap:
     * Amazfit units commonly append a serial or MAC fragment, and Gadgetbridge
     * prefix-matches this family for the same reason.
     *
     * Punctuation and case are dropped before comparing, so "Amazfit Helio Strap
     * A2302", "amazfit helio strap" and "Amazfit-Helio-Strap" all match, while
     * nothing else a person has bonded plausibly does - "helio" is distinctive
     * enough that a phone, a car or a pair of earbuds will not collide with it.
     *
     * Static and package-private so it can be tested without a Bluetooth stack.
     */
    static boolean matchesStrapName(final String name) {
        if (name == null) return false;
        final String flat = name.toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9]", "");
        return flat.startsWith("amazfithelio") || flat.contains("heliostrap");
    }

    /** Returns null with a logged reason rather than throwing, so the panel can show it. */
    private BluetoothDevice findBondedStrap() {
        final BluetoothManager manager = context.getSystemService(BluetoothManager.class);
        if (manager == null) {
            log("! no bluetooth manager");
            return null;
        }
        final BluetoothAdapter adapter = manager.getAdapter();
        if (adapter == null) {
            log("! device has no bluetooth adapter");
            return null;
        }
        if (!adapter.isEnabled()) {
            log("! bluetooth is off, turn it on and try again");
            return null;
        }

        final java.util.Set<BluetoothDevice> bonded = adapter.getBondedDevices();

        // **A device the user picked outranks every name rule below.** Names are
        // not a reliable identifier, and no name rule can be widened far enough
        // to cover an arbitrary one without also matching somebody's earbuds,
        // which is the one thing a Bluetooth connect must never do. So the
        // choice is the user's rather than a guess. See KEY_STRAP_ADDRESS.
        final String chosen = context
                .getSharedPreferences(HelioSyncService.PREFS, android.content.Context.MODE_PRIVATE)
                .getString(HelioSyncService.KEY_STRAP_ADDRESS, null);
        if (chosen != null && !chosen.isEmpty()) {
            // **Resolved by address, not looked up among the bonds.** A BLE device
            // can be connected without ever having been bonded, and such a strap
            // never appears in getBondedDevices at all - so searching the bond set
            // would reject the very device the picker exists to let somebody
            // choose. getRemoteDevice works for any valid address regardless of
            // bond state, which is also what connectGatt needs.
            try {
                final BluetoothDevice device = adapter.getRemoteDevice(chosen);
                if (device != null) {
                    log("using the device you chose: \""
                            + (device.getName() == null ? chosen : device.getName()) + "\"");
                    return device;
                }
            } catch (final IllegalArgumentException e) {
                // Only reachable if the stored string is not a MAC address at all.
                // Said out loud rather than silently falling through to the name
                // rules, because "what I picked is wrong" and "I never picked" want
                // different things from the person reading this.
                log("! the device you chose is not a valid address, ignoring it");
            }
        }

        BluetoothDevice loose = null;
        for (final BluetoothDevice device : bonded) {
            final String name = device.getName();
            // An exact hit wins outright; anything looser is remembered in case
            // nothing exact turns up, so a correctly named band is never passed
            // over for one that merely resembles it.
            if (DEVICE_NAME.equals(name)) return device;
            if (loose == null && matchesStrapName(name)) loose = device;
        }
        if (loose != null) {
            log("matched \"" + loose.getName() + "\" as the strap (not the exact name)");
            return loose;
        }

        // **What is bonded, not just what is missing.** One collapsed "device not
        // found" covered four different causes and the first real report of it
        // could not be diagnosed: nothing said whether the phone had no bond at
        // all or a bond under an unexpected name. Those need opposite things from
        // the user, so the log now names them.
        if (bonded.isEmpty()) {
            log("! nothing is paired to this phone in Android's Bluetooth settings");
            log("! pair the strap there first - pairing it only in Zepp is not enough");
            return null;
        }
        final StringBuilder names = new StringBuilder();
        for (final BluetoothDevice device : bonded) {
            if (names.length() > 0) names.append(", ");
            final String name = device.getName();
            names.append(name == null ? "(unnamed)" : name);
        }
        log("! no paired device looks like the strap");
        log("paired on this phone (" + bonded.size() + "): " + names);
        return null;
    }

    public void connect(final int sinceDays) {
        connect(sinceDays, false, 0L);
    }

    public void connect(final int sinceDays, final boolean live) {
        connect(sinceDays, live, 0L);
    }

    /**
     * Opens a link that writes one alarm and nothing else.
     *
     * <p><b>Only when there is no link already.</b> {@link #connect} refuses
     * outright when a GATT is open, so calling this on a live link sets
     * {@code pendingAlarm} and then returns having sent nothing - see
     * {@link #writeAlarmNow}, which is what a caller holding a link must use.
     *
     * @param alarm a message from {@link HelioAlarm#create}, already validated.
     */
    public void connectForAlarm(final byte[] alarm) {
        this.pendingAlarm = alarm;
        connect(0, false, 0L);
    }

    /**
     * Write an alarm over a link that is already open and authenticated.
     *
     * <p><b>This exists because the background service could never write one at
     * all, and the failure was silent.</b> Its early wake, its onset retime and
     * its re-arm all ran from {@code finish()}, which is called on
     * {@code onFetchComplete} while the sync's own GATT is still open. Each one
     * called {@link #connectForAlarm}, which hands the payload to
     * {@link #connect}, which begins "if the GATT is not null, log and return" -
     * so the alarm was parked in {@code pendingAlarm} and thrown away by the
     * {@code link.disconnect()} twenty lines further down the same method.
     * Measured on 2026-08-14: the service correctly found light sleep at 08:25,
     * logged FIRING at 08:27, and the strap went off at 08:45 on the alarm it
     * had been holding all along.
     *
     * <p>Writing over the open link is better than deferring to a new one and
     * not merely easier. The band takes one central at a time, so a second
     * connect has to wait for this one to close; it costs another handshake and
     * several seconds of radio at the exact moment the alarm is meant to be
     * two minutes out. This link is already authenticated and has already read
     * the endpoint inventory, so the write is one message.
     *
     * @return false when there is no usable link, in which case the caller
     *     should fall back to {@link #connectForAlarm}. Never throws: an alarm
     *     failing to send must not take the sync down with it.
     */
    public boolean writeAlarmNow(final byte[] alarm) {
        if (gatt == null || alarm == null) return false;
        // The same check the post-auth path makes. An endpoint this firmware
        // does not list would take the write and drop it, and the caller would
        // be told an alarm was set that was not.
        if (!endpointEncrypted.containsKey((int) HelioAlarm.ENDPOINT)) {
            log("! this firmware does not list the alarm endpoint");
            listener.onAlarmSet(false, -1);
            return true;
        }
        try {
            log("setting alarm on the open link…");
            sendToService(HelioAlarm.ENDPOINT, alarm);
            return true;
        } catch (final Exception e) {
            log("! alarm write failed on the open link: " + e);
            return false;
        }
    }

    /**
     * @param workoutSinceMillis start time of the newest workout already stored.
     *                           Workouts need an absolute cursor rather than a day
     *                           count - see {@link HelioFetch#startAll(int, long)}.
     */
    public void connect(final int sinceDays, final boolean live, final long workoutSinceMillis) {
        this.fetchSinceDays = sinceDays;
        this.fetchWorkoutSinceMillis = workoutSinceMillis;
        this.liveHeartRate = live;
        if (gatt != null) {
            log("already connected, ignoring");
            // **Refusals have to be reported, and this was the one that was not.**
            // The branch below already answers `onClosed("link busy")`; this one
            // returned in silence, so a caller that had just handed over an
            // alarm was told nothing and carried on believing it was sent. That
            // is exactly how the background service spent three weeks writing
            // alarms that never left the phone. Whoever asked for something is
            // told it did not happen, and the pending payload is dropped here
            // rather than left to be picked up by an unrelated later connect.
            if (pendingAlarm != null) {
                pendingAlarm = null;
                listener.onAlarmSet(false, -1);
            } else {
                listener.onClosed("already connected");
            }
            return;
        }
        // The advisory isLinkActive() check happens in each caller before this
        // is even reached; this compareAndSet is the actual enforcement, closing
        // the gap between that check and this call being two different moments.
        if (!LINK_ACTIVE.compareAndSet(false, true)) {
            log("! another connection already holds the strap link, refusing");
            listener.onClosed("link busy");
            return;
        }
        holdsLinkLock = true;

        final BluetoothDevice device = findBondedStrap();
        if (device == null) {
            releaseLinkLock();
            // The log above says which of the four causes it was; this is the one
            // line the person sees, so it names the action rather than the state.
            // "device not found" was the whole content of the first public report
            // of this and left the reporter with nothing to try.
            listener.onClosed(
                    "the strap is not paired to this phone. Pair it in Android's"
                            + " Bluetooth settings first, then try again");
            return;
        }
        log("found bonded " + DEVICE_NAME + ", bond state " + bondStateName(device.getBondState()));
        log("connecting…");
        // autoConnect=false gives a direct connection attempt, which fails fast
        // and loudly. autoConnect=true would wait indefinitely for the band to
        // come into range, hiding exactly the failure this spike is testing for.
        gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE);
    }

    /** Idempotent, and a no-op unless this instance is the one that actually acquired the lock. */
    private void releaseLinkLock() {
        if (holdsLinkLock) {
            holdsLinkLock = false;
            LINK_ACTIVE.set(false);
        }
    }

    public void disconnect() {
        disconnect("closed by user");
    }

    /**
     * @param reason what to report the close as. **It reaches a person**: the JS
     *               side prints it verbatim under COULD NOT CONNECT, so the
     *               single "closed by user" every caller used to share told
     *               somebody whose Activity Android had just destroyed that they
     *               had cancelled their own connect. That was the whole content
     *               of the first public bug report and it pointed at the wrong
     *               thing.
     */
    public void disconnect(final String reason) {
        // Told to stop before the link drops, so the band's sensor is not left
        // running and draining after we walk away.
        stopRealtimeHeartRate();
        liveHeartRate = false;
        // Cleared for the same reason live mode is: a mode left set on a closed
        // link is inherited by the next session, and a stale alarm re-sent on a
        // later connect would be a setting changing itself.
        pendingAlarm = null;
        queue.clear();
        encoder.reset();
        decoder.reset();
        linkReady = false;
        endpointEncrypted.clear();
        if (gatt != null) {
            gatt.disconnect();
            gatt.close();
            gatt = null;
            log("disconnected");
        }
        releaseLinkLock();
        listener.onClosed(reason);
    }

    private static String bondStateName(final int state) {
        switch (state) {
            case BluetoothDevice.BOND_BONDED:
                return "BONDED";
            case BluetoothDevice.BOND_BONDING:
                return "BONDING";
            default:
                return "NONE";
        }
    }

    /* ---------------- transport for the handshake ---------------- */

    @Override
    public void send(final short endpoint, final byte[] payload, final boolean encrypt) {
        encoder.write(this::writeChunk, endpoint, payload, encrypt);
    }

    @Override
    public void onSessionEstablished(final int sequenceNumber, final byte[] sessionKey) {
        encoder.setEncryptionParameters(sequenceNumber, sessionKey);
        decoder.setSessionKey(sessionKey);
    }

    @Override
    public void onAuthResult(final boolean success, final String detail) {
        log(success ? "=== AUTH SUCCESS ===" : "! auth failed: " + detail);
        listener.onAuthResult(success, detail);
        if (success) {
            log("requesting the service list…");
            send(ENDPOINT_SERVICES, new byte[]{CMD_SERVICES_GET}, false);
        }
    }

    private void writeChunk(final byte[] chunk) {
        writeTo(writeCharacteristic, chunk, "writeChunk");
    }

    /**
     * Both chunked characteristics are write-without-response, so the write type
     * has to be set explicitly: the default would be a request the band never
     * answers, and the queue would stall on it.
     */
    private void writeTo(final BluetoothGattCharacteristic characteristic,
                         final byte[] value,
                         final String name) {
        final BluetoothGatt g = gatt;
        if (g == null || characteristic == null) {
            log("! " + name + " with no connection");
            return;
        }
        log("tx " + name + " " + value.length + "B " + hex(value));
        queue.submit(name, () -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeCharacteristic(characteristic, value,
                        BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
            } else {
                characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                characteristic.setValue(value);
                g.writeCharacteristic(characteristic);
            }
        });
    }

    private void onPayload(final short endpoint, final byte[] payload) {
        if (endpoint == HelioAuth.ENDPOINT) {
            if (auth != null) {
                auth.handle(payload);
            }
            return;
        }
        if (endpoint == ENDPOINT_SERVICES) {
            handleServiceList(payload);
            return;
        }
        if (endpoint == ENDPOINT_BATTERY) {
            handleBattery(payload);
            return;
        }
        if (endpoint == ENDPOINT_CONFIG) {
            // Getting anything back at all is the result being tested: the band
            // only answers if it could decrypt our frame, verify its CRC and read
            // the sequence number we derived from the handshake.
            if (payload.length > 0 && payload[0] == CMD_CAPABILITIES_RESPONSE) {
                log("=== ENCRYPTED OK === (" + payload.length + "B capabilities reply)");
            } else {
                log("! encrypted check: unexpected reply " + payload.length + "B");
            }
            return;
        }
        if (endpoint == HelioAlarm.ENDPOINT) {
            handleAlarmAck(payload);
            return;
        }
        if (endpoint == HelioFetch.ENDPOINT_ACTIVITY_FETCH) {
            fetch.onControl(payload);
            return;
        }
        log("rx endpoint " + String.format(Locale.US, "0x%04x", endpoint)
                + ", " + payload.length + " bytes");
    }

    /**
     * Reply layout: command byte, a little-endian service count, then one
     * three-byte entry per service (endpoint as little-endian 16 bits, then a
     * flag saying whether that endpoint speaks encrypted).
     *
     * This is the authoritative answer to a question the code cannot answer for
     * itself, and it is worth logging in full: it is a complete inventory of what
     * this firmware exposes, which is the map any later protocol work needs.
     */
    private void handleServiceList(final byte[] payload) {
        if (payload.length < 3 || payload[0] != CMD_SERVICES_LIST) {
            log("! unexpected service list reply, " + payload.length + " bytes");
            return;
        }
        final int count = (payload[1] & 0xff) | ((payload[2] & 0xff) << 8);
        log("=== " + count + " SERVICES ===");

        endpointEncrypted.clear();
        int p = 3;
        for (int i = 0; i < count && p + 2 < payload.length; i++, p += 3) {
            final int endpoint = (payload[p] & 0xff) | ((payload[p + 1] & 0xff) << 8);
            final boolean encrypted = payload[p + 2] == 0x01;
            endpointEncrypted.put(endpoint, encrypted);
            log(String.format(Locale.US, "  0x%04x %s", endpoint, encrypted ? "encrypted" : "plain"));
        }

        // Proves the encrypted path before anything depends on it.
        if (Boolean.TRUE.equals(endpointEncrypted.get((int) ENDPOINT_CONFIG))) {
            sendToService(ENDPOINT_CONFIG, new byte[]{CMD_CAPABILITIES_REQUEST});
        } else {
            log("config endpoint is not encrypted here, skipping the encrypted check");
        }

        if (liveHeartRate) {
            startRealtimeHeartRate();
            return;
        }
        if (pendingAlarm != null) {
            // Checked against the band's own inventory rather than assumed. An
            // endpoint this firmware does not list would take the write and drop
            // it, and the caller would be told an alarm was set that was not.
            if (!endpointEncrypted.containsKey((int) HelioAlarm.ENDPOINT)) {
                log("! this firmware does not list the alarm endpoint");
                listener.onAlarmSet(false, -1);
                return;
            }
            log("setting alarm…");
            sendToService(HelioAlarm.ENDPOINT, pendingAlarm);
            return;
        }
        if (!endpointEncrypted.containsKey((int) ENDPOINT_BATTERY)) {
            log("! this firmware does not list the battery endpoint");
        } else {
            sendToService(ENDPOINT_BATTERY, new byte[]{CMD_BATTERY_REQUEST});
        }
    }

    private void startRealtimeHeartRate() {
        final BluetoothGatt g = gatt;
        if (g == null) {
            return;
        }
        log("starting live heart rate…");
        loggedFirstHeartRate = false;
        enableNotify(g, CHAR_HR_MEASUREMENT);
        sendToService(ENDPOINT_HEART_RATE, new byte[]{CMD_REALTIME_SET, REALTIME_START});
        keepalive.removeCallbacksAndMessages(null);
        keepalive.postDelayed(continueRealtime, REALTIME_KEEPALIVE_MS);
    }

    private final Runnable continueRealtime = new Runnable() {
        @Override
        public void run() {
            if (gatt == null || !liveHeartRate) {
                return;
            }
            sendToService(ENDPOINT_HEART_RATE, new byte[]{CMD_REALTIME_SET, REALTIME_CONTINUE});
            keepalive.postDelayed(this, REALTIME_KEEPALIVE_MS);
        }
    };

    /**
     * Cancelling the keepalive is what actually stops the band measuring: the
     * sensor only keeps running while it is told to continue every second.
     *
     * No STOP command is sent, because the only caller is disconnect(), which
     * clears the GATT queue immediately afterwards. Queueing a write there was
     * theatre: it was discarded before it could go out, and showed up in the log
     * as a completion arriving with no operation in flight.
     */
    private void stopRealtimeHeartRate() {
        keepalive.removeCallbacksAndMessages(null);
    }

    /**
     * Standard Bluetooth heart-rate measurement: a flags byte, where bit 0 says
     * whether the value that follows is 8 or 16 bits.
     */
    private void handleHeartRate(final byte[] value) {
        if (value.length < 2) {
            return;
        }
        final boolean sixteenBit = (value[0] & 0x01) != 0;
        final int bpm = sixteenBit
                ? ((value[1] & 0xff) | ((value[2] & 0xff) << 8))
                : (value[1] & 0xff);
        // Only the first is logged. At one reading a second the rest would bury
        // everything else, but the first is the one worth confirming.
        if (!loggedFirstHeartRate) {
            loggedFirstHeartRate = true;
            log("first live heart rate: " + bpm + " bpm");
        }
        listener.onHeartRate(bpm);
    }

    /**
     * Send to a service endpoint, encrypting exactly as the band said to. Refuses
     * to guess: an endpoint missing from the service list is one this firmware
     * does not offer, and sending to it anyway would just produce silence.
     */
    private void sendToService(final short endpoint, final byte[] payload) {
        final Boolean encrypted = endpointEncrypted.get((int) endpoint);
        if (encrypted == null) {
            log(String.format(Locale.US, "! endpoint 0x%04x is not offered by this firmware", endpoint));
            return;
        }
        send(endpoint, payload, encrypted);
    }

    /**
     * Reply layout: command byte, one byte Gadgetbridge skips, then level and
     * charging state. Reaching a sensible percentage here means the decryption
     * worked, since a wrong session key yields noise rather than 0-100.
     */
    /**
     * The whole reply is logged in hex, not just interpreted.
     *
     * Success is *assumed* to be a status of 0x01, by analogy with the auth and
     * fetch replies, and that assumption has not been checked against this
     * firmware. Printing the raw bytes is how it gets checked: if an alarm goes
     * off after a status this treats as a refusal, the log says what the band
     * actually answered and the guess gets corrected rather than argued about.
     */
    private void handleAlarmAck(final byte[] payload) {
        if (payload.length < 2 || payload[0] != HelioAlarm.CMD_CREATE_ACK) {
            log("! unexpected alarm reply, " + payload.length + "B " + hex(payload));
            listener.onAlarmSet(false, -1);
            return;
        }
        final int status = payload[1] & 0xff;
        final boolean accepted = status == 0x01;
        log("=== ALARM " + (accepted ? "SET" : "REFUSED") + " === status " + status
                + ", reply " + hex(payload));
        listener.onAlarmSet(accepted, status);
    }

    private void handleBattery(final byte[] payload) {
        if (payload.length < 4 || payload[0] != CMD_BATTERY_REPLY) {
            log("! unexpected battery reply, " + payload.length + " bytes");
            return;
        }
        final int level = payload[2] & 0xff;
        final boolean charging = payload[3] == 0x01;
        log("=== BATTERY " + level + "%" + (charging ? " CHARGING" : "") + " ===");
        listener.onBattery(level, charging);

        // Bulk data bypasses the chunked layer, so its notifications have to be
        // switched on separately before asking for any.
        enableActivityNotifications();
        fetch.startAll(fetchSinceDays, fetchWorkoutSinceMillis);
    }

    /* ---------------- transport for the data fetch ---------------- */

    @Override
    public void sendActivityControl(final byte[] payload) {
        sendToService(HelioFetch.ENDPOINT_ACTIVITY_FETCH, payload);
    }

    @Override
    public void onSamples(final List<HelioFetch.Sample> samples) {
        listener.onSamples(samples);
    }

    @Override
    public void onSleepSessions(final List<byte[]> sessions) {
        listener.onSleepSessions(sessions);
    }

    @Override
    public void onWorkouts(final List<HelioFetch.Workout> workouts) {
        listener.onWorkouts(workouts);
    }

    @Override
    public void onAllFetchesFinished() {
        log("=== FETCH COMPLETE ===");
        listener.onFetchComplete();
    }

    private void onNotification(final UUID source, final byte[] value) {
        if (CHAR_HR_MEASUREMENT.equals(source)) {
            handleHeartRate(value);
            return;
        }
        if (CHAR_ACTIVITY_DATA.equals(source)) {
            // Deliberately not logged per packet: a multi-day fetch is hundreds
            // of these and the log becomes useless.
            fetch.onData(value);
            return;
        }

        log("rx " + value.length + "B " + hex(value));

        if (CHAR_CHUNKED_READ.equals(source)) {
            final boolean needsAck = decoder.decode(value);
            if (needsAck) {
                // Acks go to the notify characteristic, not the write one.
                writeTo(readCharacteristic,
                        ChunkedCodec.ackFrame(decoder.lastHandle(), decoder.lastCount()),
                        "ack");
            }
            return;
        }
        if (CHAR_ACTIVITY_CONTROL.equals(source)) {
            // Only used by firmwares without the 0x004b service, where control
            // responses come back on this characteristic instead.
            fetch.onControl(value);
            return;
        }
        log("rx from unexpected characteristic " + source);
    }

    private void enableActivityNotifications() {
        final BluetoothGatt g = gatt;
        if (g == null) {
            return;
        }
        enableNotify(g, CHAR_ACTIVITY_CONTROL);
        enableNotify(g, CHAR_ACTIVITY_DATA);
    }

    private final BluetoothGattCallback callback = new BluetoothGattCallback() {
        @Override
        public void onConnectionStateChange(final BluetoothGatt g, final int status, final int newState) {
            if (newState == BluetoothGatt.STATE_CONNECTED) {
                log("connected (status " + status + "), discovering services…");
                queue.submit("discoverServices", g::discoverServices);
            } else if (newState == BluetoothGatt.STATE_DISCONNECTED) {
                // status 8 is the common "link supervision timeout", ie the band
                // walked away or dropped us; 133 is Android's catch-all GATT error.
                log("disconnected (status " + status + ")");
                queue.clear();
                if (gatt != null) {
                    gatt.close();
                    gatt = null;
                }
                releaseLinkLock();
                listener.onClosed("status " + status);
            }
        }

        @Override
        public void onServicesDiscovered(final BluetoothGatt g, final int status) {
            queue.complete();
            if (status != BluetoothGatt.GATT_SUCCESS) {
                log("! service discovery failed, status " + status);
                return;
            }
            dumpServices(g);

            writeCharacteristic = findCharacteristic(g, CHAR_CHUNKED_WRITE);
            readCharacteristic = findCharacteristic(g, CHAR_CHUNKED_READ);
            if (writeCharacteristic == null || readCharacteristic == null) {
                log("! chunked transfer characteristics 0x0016/0x0017 absent");
                return;
            }
            log("chunked transfer found under service " + writeCharacteristic.getService().getUuid());
            queue.submit("requestMtu", () -> g.requestMtu(DESIRED_MTU));
        }

        @Override
        public void onMtuChanged(final BluetoothGatt g, final int mtu, final int status) {
            queue.complete();
            // A smaller MTU than asked for is normal and fine: it only means more
            // fragments per message.
            log("MTU now " + mtu + " (status " + status + ")");
            encoder.setMtu(mtu);
            enableNotify(g, CHAR_CHUNKED_READ);
        }

        @Override
        public void onDescriptorWrite(final BluetoothGatt g, final BluetoothGattDescriptor descriptor, final int status) {
            queue.complete();
            if (status != BluetoothGatt.GATT_SUCCESS) {
                log("! enabling notifications failed, status " + status);
                return;
            }
            // Activity notifications are switched on later, mid-session, and land
            // here too. Without this guard that second write would restart the
            // handshake and change the session key underneath the fetch.
            if (linkReady) {
                return;
            }
            linkReady = true;
            log("notifications enabled on 0x0017");
            log("=== LINK READY ===");
            listener.onReady();
            startAuthentication();
        }

        @Override
        public void onCharacteristicWrite(final BluetoothGatt g, final BluetoothGattCharacteristic characteristic, final int status) {
            queue.complete();
            if (status != BluetoothGatt.GATT_SUCCESS) {
                log("! write failed on " + characteristic.getUuid() + ", status " + status);
            }
        }

        // Android 13 replaced the callback that read the value off the
        // characteristic with one that receives it directly. Only one fires on a
        // given release, so both are needed and neither double-handles.
        @Override
        public void onCharacteristicChanged(final BluetoothGatt g, final BluetoothGattCharacteristic characteristic, final byte[] value) {
            onNotification(characteristic.getUuid(), value);
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onCharacteristicChanged(final BluetoothGatt g, final BluetoothGattCharacteristic characteristic) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
                onNotification(characteristic.getUuid(), characteristic.getValue());
            }
        }
    };

    private void startAuthentication() {
        if (authKey == null) {
            log("! no auth key supplied, stopping at link ready");
            return;
        }
        auth = new HelioAuth(this, authKey);
        auth.start();
    }

    private void enableNotify(final BluetoothGatt g, final UUID uuid) {
        final BluetoothGattCharacteristic characteristic = findCharacteristic(g, uuid);
        if (characteristic == null) {
            log("! cannot enable notifications, " + uuid + " missing");
            return;
        }
        // Two separate steps that are easy to mistake for one: this tells the
        // local Android stack to deliver the callbacks…
        if (!g.setCharacteristicNotification(characteristic, true)) {
            log("! setCharacteristicNotification returned false");
            return;
        }
        final BluetoothGattDescriptor cccd = characteristic.getDescriptor(CCCD);
        if (cccd == null) {
            log("! " + uuid + " has no CCCD descriptor");
            return;
        }
        // …and this tells the band to actually send them.
        queue.submit("writeCccd", () -> {
            final byte[] value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                g.writeDescriptor(cccd, value);
            } else {
                cccd.setValue(value);
                g.writeDescriptor(cccd);
            }
        });
    }

    /** Searches every discovered service, since the owning service varies by unit. */
    private static BluetoothGattCharacteristic findCharacteristic(final BluetoothGatt g, final UUID uuid) {
        for (final BluetoothGattService service : g.getServices()) {
            final BluetoothGattCharacteristic characteristic = service.getCharacteristic(uuid);
            if (characteristic != null) {
                return characteristic;
            }
        }
        return null;
    }

    /**
     * A full inventory of what this unit exposes, so the protocol work is written
     * against observed reality rather than against Gadgetbridge's assumptions
     * about the ZeppOS family.
     */
    private void dumpServices(final BluetoothGatt g) {
        log("--- services ---");
        for (final BluetoothGattService service : g.getServices()) {
            log(service.getUuid().toString());
            for (final BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                log(String.format(Locale.US, "    %s  %s",
                        characteristic.getUuid(), properties(characteristic.getProperties())));
            }
        }
        log("--- end services ---");
    }

    /** Truncated: a full activity transfer would otherwise flood the log. */
    private static String hex(final byte[] data) {
        final StringBuilder sb = new StringBuilder();
        final int shown = Math.min(data.length, 48);
        for (int i = 0; i < shown; i++) {
            sb.append(String.format(Locale.US, "%02x", data[i]));
        }
        if (data.length > shown) {
            sb.append("…");
        }
        return sb.toString();
    }

    private static String properties(final int props) {
        final StringBuilder sb = new StringBuilder();
        if ((props & BluetoothGattCharacteristic.PROPERTY_READ) != 0) sb.append('R');
        if ((props & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) sb.append('W');
        if ((props & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) sb.append('w');
        if ((props & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0) sb.append('N');
        if ((props & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0) sb.append('I');
        return sb.length() == 0 ? "-" : sb.toString();
    }
}
