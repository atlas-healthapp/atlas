<!--
  Option B into A (mocked up 2026-08-07): a settings row that opens into the
  editor. Settings is a list of rows, and this is touched about once a month, so
  holding a panel of steppers open for it was most of what made the first version
  read as clutter.

  The heading is ALARM with no qualifier, because this app is the strap's app and
  the alarm has nowhere else to live. Closed, the row carries the time and days,
  which is the whole of what an alarm row needs to say.

  **Comments live outside <template>, not inside it.** A comment node beside the
  component makes this a multi-root fragment, and a fragment does not inherit the
  parent's attributes - which is how the open/close binding stopped working.
-->
<template>
  <SettingsSection
    title="ALARM"
    :summary="`${setTime} · ${setDays}`"
    :open="open"
    @toggle="$emit('toggle')"
  >

    <div v-if="!editing" class="arow">
      <div class="left">
        <span class="t">{{ setTime }}</span>
        <span class="d mono">{{ setDays }}</span>
      </div>
      <button class="edit mono" type="button" @click="openEditor">
        {{ helio.alarm ? "EDIT" : "SET" }}
      </button>
    </div>

    <template v-else>
      <div class="timerow">
        <!-- The platform's own time picker behind Atlas's typography. A pair of
             steppers was drawn first and cut: two of them is four controls for
             one value, and the system picker is both fewer taps and the widget
             everyone already knows. The input covers the text and is invisible,
             so tapping the number opens the picker while the number stays set in
             the app's own face at the app's own size. -->
        <label class="bigtime">
          <span aria-hidden="true">{{ pad(hour) }}<i>:{{ pad(minute) }}</i></span>
          <input
            :value="timeValue"
            class="timeinput"
            type="time"
            aria-label="Alarm time"
            @input="onTime"
          />
        </label>
        <button class="onoff mono" type="button" @click="enabled = !enabled">
          <span class="pip" :class="{ off: !enabled }" />{{ enabled ? "ON" : "OFF" }}
        </button>
      </div>

      <!-- How the time is decided. Three rows rather than a segmented control,
           because each one has to explain itself: "8 hours after you fall asleep"
           is not a word, it is a sentence, and a three-way switch with a caption
           underneath would put the explanation further from the choice than the
           choice is from its neighbours. -->
      <div class="modes">
        <button
          v-for="m in MODES"
          :key="m.key"
          class="mode"
          :class="{ on: mode === m.key }"
          type="button"
          :aria-pressed="mode === m.key"
          @click="mode = m.key"
        >
          <span class="mname mono">{{ m.label }}</span>
          <span class="mwhy">{{ m.why }}</span>
        </button>
      </div>

      <!-- Only the chosen mode's own control, so the editor never shows a field
           that does not apply to the setting in front of you. -->
      <div v-if="mode === 'smart'" class="modenote mono">
        WAKES YOU AT THE FIRST LIGHT SLEEP IN THE {{ SMART_WINDOW_MINUTES }} MINUTES
        BEFORE {{ pad(hour) }}:{{ pad(minute) }}, AND NEVER AFTER IT. IF THE STRAP
        CANNOT BE REACHED YOU GET {{ pad(hour) }}:{{ pad(minute) }} AS USUAL.
      </div>

      <template v-if="mode === 'onset'">
        <div class="onsetrow">
          <button class="step" type="button" aria-label="Less sleep" @click="onsetHours = Math.max(4, +(onsetHours - 0.5).toFixed(1))">
            −
          </button>
          <div class="onsetval">
            <span class="onsetnum">{{ onsetHours }}</span>
            <span class="onsetunit mono">HOURS AFTER YOU FALL ASLEEP</span>
          </div>
          <button class="step" type="button" aria-label="More sleep" @click="onsetHours = Math.min(12, +(onsetHours + 0.5).toFixed(1))">
            +
          </button>
        </div>
        <!-- The cap, and it is not optional. A late night must not push the
             alarm past the time you actually have to be up, and without this the
             mode is unusable on exactly the night it matters most. -->
        <label class="latestrow">
          <span class="mono">AND NEVER LATER THAN</span>
          <span class="latestval mono">{{ pad(latestHour) }}:{{ pad(latestMinute) }}</span>
          <input
            :value="latestValue"
            class="timeinput latestinput"
            type="time"
            aria-label="Latest the alarm may go off"
            @input="onLatest"
          />
        </label>
        <div class="modenote mono">
          THE STRAP IS GIVEN {{ pad(latestHour) }}:{{ pad(latestMinute) }}, SO THAT
          IS THE LATEST IT CAN GO OFF WHATEVER HAPPENS. THE EARLIER TIME IS WORKED
          OUT ON THE PHONE AND CAN MOVE WHILE THE STRAP IS STILL DECIDING WHEN YOU
          FELL ASLEEP.
        </div>
      </template>

      <!-- Days as type with the live ones underlined, not seven boxed chips.
           Boxes made a week read as a row of buttons; underlined letters keep the
           shape of a week, and an unlit day still holds its place. Monday first. -->
      <div class="dayletters mono">
        <button
          v-for="(d, i) in dayLetters"
          :key="i"
          class="dl"
          :class="{ on: days.includes(d.value) }"
          type="button"
          :aria-label="d.name"
          :aria-pressed="days.includes(d.value)"
          @click="toggleDay(d.value)"
        >
          {{ d.label }}
        </button>
      </div>
      <div class="repeat mono">{{ repeatNote }}</div>

      <div class="btnrow">
        <!-- Only present when there is something unsent. A write is a real BLE
             connect that spends the strap's battery and can fail, so it stays an
             action you take rather than something that happens as you tap: five
             day letters would otherwise be five writes. -->
        <button
          v-if="dirty"
          class="databtn primary mono"
          type="button"
          :disabled="helio.alarmSending"
          @click="send"
        >
          {{ sendLabel }}
        </button>
        <button class="databtn mono" type="button" @click="editing = false">
          {{ dirty ? "CANCEL" : "DONE" }}
        </button>
      </div>
    </template>

    <Transition name="toast">
      <div v-if="message" class="msg mono" :class="{ err: failed }">{{ message }}</div>
    </Transition>
  </SettingsSection>
</template>

<script setup>
import { computed, ref } from "vue";
import { useHelioStore } from "@/stores/helio";
import SettingsSection from "./SettingsSection.vue";
import { SMART_WINDOW_MINUTES } from "@/utils/smartAlarm";

// Owned by the settings page so only one section is ever open.
defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);
import { describeDays, formatTime, repeatMask } from "@/utils/strapAlarm";

const helio = useHelioStore();

const editing = ref(false);
const hour = ref(8);
const minute = ref(30);
const days = ref([]);
const enabled = ref(true);
const mode = ref("fixed");
const onsetHours = ref(8);
const latestHour = ref(9);
const latestMinute = ref(0);
const message = ref("");
const failed = ref(false);

/**
 * The three ways the time can be decided.
 *
 * `why` is part of the option rather than a caption under the group, because
 * "eight hours after you fall asleep" is a sentence, not a word, and a
 * segmented control would have put the explanation further from the choice than
 * the choices are from each other.
 */
const MODES = [
  { key: "fixed", label: "SET TIME", why: "The time you choose, every time." },
  {
    key: "smart",
    label: "SMART",
    // The name is the name; the sentence does the explaining. Labelling the
    // option "IN LIGHT SLEEP" described the mechanism where the user was looking
    // for what the mode is called.
    why: `Wakes you in light sleep, up to ${SMART_WINDOW_MINUTES} minutes early. Never later than your time.`,
  },
  {
    key: "onset",
    label: "AFTER YOU FALL ASLEEP",
    why: "A set number of hours from when the strap says you fell asleep.",
  },
];

const dayLetters = [
  { value: 1, label: "M", name: "Monday" },
  { value: 2, label: "T", name: "Tuesday" },
  { value: 3, label: "W", name: "Wednesday" },
  { value: 4, label: "T", name: "Thursday" },
  { value: 5, label: "F", name: "Friday" },
  { value: 6, label: "S", name: "Saturday" },
  { value: 0, label: "S", name: "Sunday" },
];

/**
 * What the closed row says, which has to differ by mode.
 *
 * An onset alarm has no single time to show - that is the point of it - so it
 * says the rule and the cap instead. Showing the cap alone would be a time the
 * alarm will usually NOT go off at, which is worse than saying nothing.
 */
const setTime = computed(() => {
  const a = helio.alarm;
  if (!a) return "--:--";
  // The mode is named in the closed row, because "07:20" means three different
  // things depending on which one is running and the row is all you see until
  // you open it.
  if (a.mode === "onset" && a.latestHour != null) {
    return `${a.onsetHours ?? 8}H SLEEP · BY ${formatTime(a.latestHour, a.latestMinute ?? 0)}`;
  }
  const t = formatTime(a.hour, a.minute);
  return a.mode === "smart" ? `SMART · BY ${t}` : t;
});
const setDays = computed(() => {
  if (!helio.alarm) return "NONE SET";
  return helio.alarm.enabled ? describeDays(helio.alarm.days) : "OFF";
});

function pad(n) {
  return String(n).padStart(2, "0");
}

const timeValue = computed(() => formatTime(hour.value, minute.value));

function onTime(event) {
  // An empty value happens when the picker is dismissed without a choice; the
  // draft should stay where it was rather than falling back to midnight.
  const [h, m] = (event.target.value || "").split(":");
  if (h === undefined || m === undefined) return;
  hour.value = Number(h);
  minute.value = Number(m);
}

/** Opens on what is currently set, so a small change is a small edit. */
/**
 * Named `openEditor`, not `open`, and that is not tidiness.
 *
 * A local binding in `<script setup>` SHADOWS a prop of the same name inside the
 * template. While this was called `open`, the section's `:open="open"` bound this
 * function rather than the prop - and a function is always truthy, so the alarm
 * row could be opened and never closed. It rendered `aria-expanded` as the
 * function's own source, which is what finally gave it away.
 */
function openEditor() {
  const a = helio.alarm;
  hour.value = a?.hour ?? 8;
  minute.value = a?.minute ?? 30;
  days.value = [...(a?.days ?? [])];
  enabled.value = a?.enabled ?? true;
  mode.value = a?.mode ?? "fixed";
  onsetHours.value = a?.onsetHours ?? 8;
  // Defaults to an hour past the set time rather than to the set time itself: a
  // cap identical to the alarm would make the onset mode behave exactly like the
  // fixed one, which reads as the setting not working.
  latestHour.value = a?.latestHour ?? Math.min(23, (a?.hour ?? 8) + 1);
  latestMinute.value = a?.latestMinute ?? (a?.minute ?? 30);
  editing.value = true;
}

const latestValue = computed(() => `${pad(latestHour.value)}:${pad(latestMinute.value)}`);

function onLatest(e) {
  const [h, m] = (e.target.value ?? "").split(":").map(Number);
  if (Number.isFinite(h)) latestHour.value = h;
  if (Number.isFinite(m)) latestMinute.value = m;
}

function toggleDay(value) {
  days.value = days.value.includes(value)
    ? days.value.filter((d) => d !== value)
    : [...days.value, value];
}

const repeatNote = computed(() =>
  days.value.length ? "REPEATS WEEKLY" : "FIRES ONCE, THEN STOPS"
);

/**
 * Compared through the repeat mask rather than the day arrays, so tapping a day
 * off and straight back on does not leave the panel claiming a change.
 */
const dirty = computed(() => {
  const a = helio.alarm;
  if (!a) return true;
  return (
    a.hour !== hour.value ||
    a.minute !== minute.value ||
    a.enabled !== enabled.value ||
    (a.mode ?? "fixed") !== mode.value ||
    (mode.value === "onset" &&
      ((a.onsetHours ?? 8) !== onsetHours.value ||
        (a.latestHour ?? null) !== latestHour.value ||
        (a.latestMinute ?? null) !== latestMinute.value)) ||
    repeatMask(a.days ?? []) !== repeatMask(days.value)
  );
});

const sendLabel = computed(() => {
  if (helio.alarmSending) return "SENDING…";
  return "SEND TO STRAP";
});

async function send() {
  message.value = "";
  failed.value = false;
  try {
    // `smart` stays false whatever the mode. That flag is the BAND's own smart
    // wake bit, which this firmware may ignore, and Atlas does not need it: the
    // window is decided on the phone and applied by rewriting the slot. The two
    // are unrelated despite the name, which is worth saying because they read as
    // the same feature.
    await helio.writeAlarm({
      hour: hour.value,
      minute: minute.value,
      mode: mode.value,
      onsetHours: onsetHours.value,
      latestHour: mode.value === "onset" ? latestHour.value : null,
      latestMinute: mode.value === "onset" ? latestMinute.value : null,
      days: days.value,
      enabled: enabled.value,
    });
    message.value = `SET ${setTime.value} ${setDays.value}`;
    editing.value = false;
  } catch (e) {
    failed.value = true;
    message.value = "NOT SET: " + (e?.message || String(e)).toUpperCase();
  }
  setTimeout(() => (message.value = ""), 6000);
}
</script>

<style scoped>
.arow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 44px;
}
.arow .left {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
.arow .t {
  font-size: 20px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.arow .d {
  font-size: 9.5px;
  letter-spacing: 0.12em;
  color: var(--dim);
}
.edit {
  min-height: 44px;
  padding: 0 0 0 14px;
  background: none;
  border: none;
  color: var(--acc);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  cursor: pointer;
}
.timerow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  /* Wraps rather than pushing past the card. The editor moved inside a padded
     section body, so it has less room than the bare panel it was drawn for. */
  flex-wrap: wrap;
  min-width: 0;
}
.bigtime {
  position: relative;
  display: inline-block;
  font-size: 46px;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.bigtime i {
  font-style: normal;
  color: var(--dim);
}
/* Invisible and on top: the picker is the platform's, the type is Atlas's. */
.timeinput {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: none;
  background: none;
  /* iOS zooms a focused input under 16px; this one is never read anyway. */
  font-size: 16px;
}
.onoff {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 44px;
  padding: 0 2px;
  background: none;
  border: none;
  color: var(--acc);
  font-size: 9.5px;
  letter-spacing: 0.12em;
  cursor: pointer;
}
.onoff .pip {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--acc);
}
.onoff .pip.off {
  background: transparent;
  border: 1px solid var(--dim);
}
/* Rows, not a segmented control: each option carries its own sentence. */
.modes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 4px;
}
.mode {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
  text-align: left;
  min-height: 48px;
  padding: 8px 10px;
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.mode.on {
  border-color: var(--acc);
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.mname {
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  color: var(--dim);
}
.mode.on .mname {
  color: var(--acc);
}
.mwhy {
  font-size: 12.5px;
  color: var(--body);
  line-height: 1.35;
}
.modenote {
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  line-height: 1.5;
  color: var(--dim);
  margin-bottom: 4px;
}
.onsetrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.onsetval {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.onsetnum {
  font-family: var(--font-mono);
  font-size: 26px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.onsetunit {
  overflow-wrap: anywhere;
  font-size: var(--fs-micro);
  letter-spacing: 1.1px;
  color: var(--dim);
  text-align: center;
}
.step {
  width: 44px;
  min-height: 44px;
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  background: none;
  color: var(--ink);
  font-size: 18px;
  cursor: pointer;
}
/* The cap reads as one row you tap, like the big time above it does. */
.latestrow {
  position: relative;
  flex-wrap: wrap;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 44px;
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.latestval {
  font-size: 17px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.latestinput {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
}
.dayletters {
  display: flex;
  gap: 2px;
  margin-top: 14px;
}
.dl {
  /* flex, not width:100%. Seven children each asking for the full width only fit
     because flex-shrink rescued them, which stops being reliable the moment
     anything else in the row has a minimum. */
  flex: 1 1 0;
  min-width: 0;
  min-height: 44px;
  background: none;
  border: none;
  color: color-mix(in srgb, var(--dim) 55%, transparent);
  font-size: 13px;
  letter-spacing: 0.04em;
  cursor: pointer;
}
.dl.on {
  color: var(--acc);
  box-shadow: inset 0 -2px 0 var(--acc);
}
.repeat {
  margin-top: 8px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: color-mix(in srgb, var(--dim) 80%, transparent);
}
.btnrow {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.databtn {
  flex: 1;
  min-height: 44px;
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  color: var(--ink);
  font-size: 10px;
  letter-spacing: 0.1em;
  cursor: pointer;
}
.databtn.primary {
  border-color: var(--acc);
  color: var(--acc);
}
.databtn:disabled {
  opacity: 0.4;
  cursor: default;
}
.databtn:active:not(:disabled) {
  background: color-mix(in srgb, var(--acc) 12%, transparent);
}
.hint {
  margin-top: 8px;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--dim);
}
.msg {
  margin-top: 10px;
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--acc);
}
.msg.err {
  color: var(--bad);
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
</style>
