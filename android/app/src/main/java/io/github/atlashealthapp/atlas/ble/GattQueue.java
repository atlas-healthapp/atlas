package io.github.atlashealthapp.atlas.ble;

import android.os.Handler;
import android.os.Looper;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Serialises GATT operations.
 *
 * Android's BLE stack permits exactly one outstanding GATT operation per
 * connection. A second one issued before the first completes is not queued and
 * does not error: it returns false, or is simply dropped, and the callback for
 * it never arrives. That failure mode is why BLE code so often "works
 * sometimes" - the race is won or lost on timing that varies with the phone,
 * the peer and the MTU.
 *
 * So every operation goes through here, and every completion callback must call
 * {@link #complete()} exactly once, including the failure paths. Missing one
 * stalls the queue permanently, which is why the watchdog below exists: it is
 * far easier to debug a logged timeout than a connection that silently stops
 * making progress.
 */
class GattQueue {
    interface Log {
        void line(String message);
    }

    private static final long OP_TIMEOUT_MS = 5000;

    private final Deque<Op> pending = new ArrayDeque<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Log log;

    private Op running;

    GattQueue(final Log log) {
        this.log = log;
    }

    private static final class Op {
        final String name;
        final Runnable action;

        Op(final String name, final Runnable action) {
            this.name = name;
            this.action = action;
        }
    }

    /** Timeouts fire on the main thread, so this needs no extra synchronisation. */
    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (running != null) {
                log.line("! " + running.name + " timed out after " + OP_TIMEOUT_MS + "ms");
                running = null;
                drain();
            }
        }
    };

    void submit(final String name, final Runnable action) {
        handler.post(() -> {
            pending.addLast(new Op(name, action));
            drain();
        });
    }

    /** Call from every GATT callback, on every path, exactly once. */
    void complete() {
        handler.post(() -> {
            if (running == null) {
                // A duplicate completion would otherwise pop the *next* operation
                // off the queue as though it had finished, which is far harder to
                // spot than the warning.
                log.line("! completion with no operation in flight, ignoring");
                return;
            }
            handler.removeCallbacks(watchdog);
            running = null;
            drain();
        });
    }

    void clear() {
        handler.post(() -> {
            handler.removeCallbacks(watchdog);
            pending.clear();
            running = null;
        });
    }

    private void drain() {
        if (running != null || pending.isEmpty()) {
            return;
        }
        running = pending.pollFirst();
        handler.postDelayed(watchdog, OP_TIMEOUT_MS);
        try {
            running.action.run();
        } catch (final Exception e) {
            log.line("! " + running.name + " threw: " + e.getMessage());
            handler.removeCallbacks(watchdog);
            running = null;
            drain();
        }
    }
}
