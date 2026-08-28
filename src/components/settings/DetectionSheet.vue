<!--
  The strap's workout detection sensitivity, read from the band and settable.

  **Why this exists at all.** A Sunday walk on 2026-08-16 left no workout record.
  The cause was this setting, on LOW in Zepp, which Atlas could neither see nor
  change - so from inside Atlas the strap simply looked as though it had not
  noticed a walk.

  **Why it lives in HELIO STRAP and not in ALARM.** It shipped inside the alarm
  panel because that is where the config read was wired up, and it read as a non
  sequitur: a paragraph about walks above two alarm times. It is a fact about the
  strap, and HELIO STRAP is already a list of those.

  Option A of three mocked up 2026-08-25: a row that opens, matching how ALARM
  already works, so the closed row still states the value and the sheet has room
  to say what each level costs.
-->
<template>
  <div class="scrim" @click.self="$emit('close')">
    <div class="sheet">
      <div class="hd">
        <span class="mono ttl">WORKOUT DETECTION</span>
        <button class="mono close" type="button" @click="$emit('close')">[ CLOSE ]</button>
      </div>

      <!-- What each level costs, not just its name. "HIGH / STANDARD / LOW"
           alone is three words nobody can choose between. -->
      <button
        v-for="lvl in LEVELS"
        :key="lvl.value"
        class="choice"
        type="button"
        :class="{ on: draft === lvl.value }"
        :aria-pressed="draft === lvl.value"
        @click="draft = lvl.value"
      >
        <b class="mono">{{ lvl.label }}</b>
        <span>{{ lvl.why }}</span>
      </button>

      <!-- The strap's own value, named apart from the draft. The two are
           different claims and the screen must not blur them. -->
      <div class="mono note">{{ readNote }}</div>

      <!-- **Only when something is unsent**, the same rule the alarm follows: a
           write is a real BLE connect that spends the strap's battery, so three
           taps between levels must not be three writes. -->
      <button
        v-if="dirty"
        class="send mono"
        type="button"
        :disabled="helio.configSending"
        @click="send"
      >
        {{ helio.configSending ? "SENDING…" : "SEND TO STRAP" }}
      </button>
      <Transition name="toast">
        <div v-if="message" class="mono note" :class="{ err: failed }">{{ message }}</div>
      </Transition>

      <div class="mono note">
        SHARED WITH ZEPP: THIS REPLACES WHAT ZEPP HAS.
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useHelioStore } from "@/stores/helio";

const props = defineProps({
  /** What the band last reported, 0-2, or -1 when it has not answered. */
  current: { type: Number, default: -1 },
});
const emit = defineEmits(["close", "saved"]);

const helio = useHelioStore();

const LEVELS = [
  {
    value: 0,
    label: "HIGH",
    why: "Catches short and gentle sessions. More false starts.",
  },
  { value: 1, label: "STANDARD", why: "The strap's own default." },
  {
    value: 2,
    label: "LOW",
    why: "Only long or hard sessions. A walk may leave no record.",
  },
];

// Opens on what the band last said, so a small change is a small edit.
const draft = ref(props.current);

const dirty = computed(() => draft.value >= 0 && draft.value !== props.current);

const message = ref("");
const failed = ref(false);

const readNote = computed(() => {
  if (props.current < 0) return "THE STRAP HAS NOT REPORTED THIS YET.";
  return `THE STRAP SAID ${LEVELS[props.current].label} ON THE LAST SYNC.`;
});

/**
 * Writes and waits, the same shape as the alarm's SEND.
 *
 * The panel only believes it once the strap has said yes: saying "saved" on a
 * write that never landed is exactly what the read-first design exists to stop.
 */
async function send() {
  message.value = "";
  failed.value = false;
  try {
    await helio.setDetectionSensitivity(draft.value);
    emit("saved", draft.value);
  } catch (e) {
    failed.value = true;
    message.value = "NOT SET: " + (e?.message || String(e)).toUpperCase();
  }
}
</script>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-end;
  z-index: 700;
}
.sheet {
  width: 100%;
  max-height: 88vh;
  overflow-y: auto;
  background: var(--bg2);
  border-radius: 14px 14px 0 0;
  padding: 16px 14px calc(20px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.hd {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 2px;
}
.ttl {
  font-size: var(--set-micro);
  letter-spacing: 1.4px;
  color: var(--acc);
}
.close {
  background: none;
  border: 0;
  font-size: var(--set-micro);
  letter-spacing: 1px;
  color: var(--dim);
  padding: 4px;
}
.choice {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 11px;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  background: none;
}
.choice.on {
  border-color: var(--acc);
}
.choice b {
  font-size: var(--set-micro);
  letter-spacing: 1.2px;
  font-weight: 500;
  color: var(--ink);
}
.choice span {
  font-size: var(--set-summary);
  line-height: 1.45;
  color: var(--dim);
}
.note {
  font-size: var(--set-micro);
  letter-spacing: 1px;
  color: var(--dim);
  line-height: 1.55;
}
.note.err {
  color: var(--bad);
}
.send {
  margin-top: 4px;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid var(--acc);
  background: transparent;
  color: var(--acc);
  font-size: var(--set-micro);
  letter-spacing: 1.2px;
}
</style>
