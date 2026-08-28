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
    :summary="closedSummary"
    :danger="needsExact"
    :open="open"
    @toggle="$emit('toggle')"
  >

    <!-- Above everything, and shown while editing as well: without this the
         smart modes silently degrade to firing at the set time, and the phone is
         the only thing that knows. It says what still works, because "cannot
         run" on its own reads as an alarm that will not go off at all. -->
    <div v-if="needsExact" class="permbox">
      <div class="permhd mono">SMART WAKE CANNOT RUN</div>
      <div class="modenote mono">
        ANDROID IS NOT LETTING ATLAS SET AN EXACT ALARM, SO THE PHONE CANNOT WAKE UP
        IN TIME TO CHECK WHETHER YOU ARE IN LIGHT SLEEP. YOUR ALARM STILL GOES OFF
        AT {{ fallbackTime }}.
      </div>
      <button class="databtn primary mono" type="button" @click="helio.requestExactAlarm()">
        ALLOW EXACT ALARMS
      </button>
    </div>

    <!-- The strap keeps its own clock and Atlas cannot set it, so a band left in
         another zone rings every alarm at the wrong local time. The band reports
         its offset in every fetch reply, which is how this can be seen at all -
         and it is the same field that once made workouts decode ten hours out.

         Said only when the two actually disagree, and it names both, because
         "your strap is in the wrong timezone" without the numbers is not
         something anybody can act on. -->
    <div v-if="!editing && zoneDrift" class="permbox">
      <div class="permhd mono">THE STRAP IS IN ANOTHER TIME ZONE</div>
      <div class="modenote mono">
        THE STRAP THINKS IT IS {{ zoneDrift.band }} AND THIS PHONE IS
        {{ zoneDrift.phone }}, SO YOUR ALARMS RING {{ zoneDrift.gap }} OUT.
        OPEN ZEPP ONCE TO PUT THE STRAP'S CLOCK RIGHT.
      </div>
    </div>

    <!-- A list, since 2026-08-24. The ask was a weekday alarm and a different
         weekend one, and a list is the model every phone already uses - "the
         weekend" is an arbitrary split to bake into an app.

         Each alarm owns a band slot, which is why they are never reordered: a
         slot is a physical thing on the strap and shuffling would write over an
         alarm nobody touched. -->
    <template v-if="!editing">
      <!-- **The next alarm sorts to the top and says so.** A rail down its row
           was the first attempt and it marked the row without ever naming what
           the mark meant. Position plus a heading is the obvious version: the
           one that matters is first, under a word that says why.

           Display order only. `helio.alarms` is never reordered, because the
           list index IS the band slot - sorting the real array would write over
           an alarm nobody touched. -->
      <template v-for="(group, gi) in alarmGroups" :key="group.label">
        <div class="alarmgroup mono" :class="{ later: gi > 0 }">{{ group.label }}</div>
        <div
          v-for="a in group.alarms"
          :key="a.id"
          class="arow"
        >
          <div class="left">
            <span class="t" :class="{ off: !a.enabled }">{{ rowTime(a) }}</span>
            <span class="d mono">{{ rowDays(a) }}</span>
            <!-- The countdown, not the word NEXT. That repeated what the day
                 letters already imply; what nobody can work out at 23:00 on a
                 Sunday is how long they have got. -->
            <span v-if="isNext(a) && nextText" class="countdown mono">{{ nextText }}</span>
          </div>
          <button class="edit mono" type="button" @click="openEditor(a)">EDIT</button>
        </div>
      </template>

      <button
        v-if="helio.alarms.length < MAX_ALARMS"
        class="addalarm mono"
        type="button"
        @click="openEditor(null)"
      >
        + ADD AN ALARM
      </button>
      <!-- Named rather than silently missing. How many slots this firmware
           actually has has never been read off the band, so five is a figure
           Atlas chose to stay inside any plausible count. -->
      <div v-else class="repeat mono">ATLAS HOLDS {{ MAX_ALARMS }} ALARMS</div>
    </template>

    <!-- `v-if`, not `v-else`. The list above is its own `v-if` block, and while
         the mornings readout still sat between them a `v-else` here chained onto
         *that* instead - so the editor rendered under the list whenever there
         were no mornings yet. The readout moved to LOGS on 2026-08-25; the
         `v-if` stays, because the reason it is safer has not changed. -->
    <template v-if="editing">
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
          :class="{ on: days.includes(d.value), taken: takenDays.has(d.value) }"
          type="button"
          :aria-label="d.name"
          :aria-pressed="days.includes(d.value)"
          :disabled="takenDays.has(d.value)"
          @click="toggleDay(d.value)"
        >
          {{ d.label }}
        </button>
      </div>
      <div class="repeat mono">{{ repeatNote }}</div>
      <!-- The rule the whole model rests on, said at the point it applies, and
           it NAMES the alarm holding those days. "Belong to another alarm"
           raised the question it did not answer, and the only way to find out
           was to back out of the editor and look. -->
      <div v-for="note in ownerNotes" :key="note" class="ownerchip mono">
        {{ note }}
      </div>

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

      <!-- Removing only takes it out of Atlas. Nothing can clear a band slot,
           so the strap keeps whatever was last written there until something
           overwrites it - which is a thing to say plainly rather than let
           somebody discover at 07:00. -->
      <div v-if="editingId" class="removerow">
        <button v-if="!confirmRemove" class="removelink mono" type="button" @click="confirmRemove = true">
          REMOVE THIS ALARM
        </button>
        <template v-else>
          <div class="modenote mono">
            THE STRAP KEEPS THE TIME ALREADY ON IT UNTIL SOMETHING OVERWRITES
            THAT SLOT. SWITCH THE ALARM OFF AND SEND IF YOU WANT IT SILENT.
          </div>
          <div class="btnrow">
            <button class="databtn mono" type="button" @click="confirmRemove = false">
              KEEP IT
            </button>
            <button class="databtn mono" type="button" @click="removeAlarm">
              REMOVE ANYWAY
            </button>
          </div>
        </template>
      </div>
    </template>

    <Transition name="toast">
      <div v-if="message" class="msg mono" :class="{ err: failed }">{{ message }}</div>
    </Transition>
  </SettingsSection>
</template>

<script setup>
import { computed, ref, watch, onUnmounted } from "vue";
import { useHelioStore } from "@/stores/helio";
import SettingsSection from "./SettingsSection.vue";
import { SMART_WINDOW_MINUTES } from "@/utils/smartAlarm";

// Owned by the settings page so only one section is ever open.
const props = defineProps({ open: { type: Boolean, default: false } });
defineEmits(["toggle"]);
import { describeDays, formatTime, repeatMask } from "@/utils/strapAlarm";
import {
  MAX_ALARMS,
  daysTakenBy,
  describeDayRun,
  describeNext,
  hardTime,
  ownerOfDays,
  planSummary,
} from "@/utils/alarmPlan";

const helio = useHelioStore();

// ── the list ───────────────────────────────────────────────────────────────

/** Which alarm the editor is on, or null while adding a new one. */
const editingId = ref(null);
const confirmRemove = ref(false);

const editingAlarm = computed(
  () => helio.alarms.find((a) => a.id === editingId.value) ?? null
);

/**
 * A clock that ticks while the panel is open, so the countdown ages.
 *
 * A minute is plenty: this counts down in minutes and a faster tick would
 * re-render the whole list for nothing. Started and stopped with the panel,
 * because a timer running behind a closed section is a timer nobody asked for.
 */
const now = ref(new Date());
let clock = null;
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !clock) {
      now.value = new Date();
      clock = setInterval(() => (now.value = new Date()), 60_000);
    } else if (!isOpen && clock) {
      clearInterval(clock);
      clock = null;
    }
  },
  { immediate: true }
);
onUnmounted(() => clock && clearInterval(clock));

const next = computed(() => describeNext(helio.alarms, now.value));
const nextText = computed(() => next.value?.text ?? "");

/** The alarm that will actually ring next, so the list can mark it. */
function isNext(a) {
  return a.enabled && next.value?.alarm?.id === a.id;
}

/**
 * The list as it is SHOWN: the next alarm first under UP NEXT, the rest under
 * LATER in slot order.
 *
 * **A display order, never the stored one.** `helio.alarms` keeps its order
 * because the index is the band slot; sorting the real array would move alarms
 * between slots and write over ones the user never touched. The rows key off
 * `a.id` and `openEditor` takes the alarm itself, so nothing downstream depends
 * on where a row sits.
 *
 * A single alarm gets no headings at all - "UP NEXT" over a list of one is a
 * label for a distinction that does not exist.
 */
const alarmGroups = computed(() => {
  const all = helio.alarms;
  if (all.length < 2) return all.length ? [{ label: "ALARM", alarms: all }] : [];
  const nextId = next.value?.alarm?.id;
  const first = all.filter((a) => a.id === nextId);
  const rest = all.filter((a) => a.id !== nextId);
  if (!first.length) return [{ label: "ALARMS", alarms: rest }];
  return [
    { label: "UP NEXT", alarms: first },
    { label: "LATER", alarms: rest },
  ];
});

/**
 * One line per alarm holding days this one cannot have, naming it.
 *
 * Grouped by owner rather than by day, so five weekdays held by one alarm are
 * one line rather than five.
 */
const ownerNotes = computed(() => {
  const owners = ownerOfDays(helio.alarms, editingId.value);
  const byAlarm = new Map();
  for (const [day, a] of owners) {
    if (!byAlarm.has(a.id)) byAlarm.set(a.id, { alarm: a, days: [] });
    byAlarm.get(a.id).days.push(day);
  }
  return [...byAlarm.values()].map(
    ({ alarm: a, days: d }) =>
      `${describeDayRun(d)} BELONG${d.length === 1 ? "S" : ""} TO YOUR ${rowTime(a)} ALARM`
  );
});

function rowTime(a) {
  const t = hardTime(a);
  return `${pad(t.hour)}:${pad(t.minute)}`;
}

function rowDays(a) {
  const when = a.days?.length ? describeDays(a.days) : "ONCE";
  const mode = (a.mode ?? "fixed").toUpperCase();
  return a.enabled ? `${when} · ${mode}` : `${when} · OFF`;
}

/**
 * Whether the strap's clock is in a different zone from the phone's.
 *
 * **Detection only, and that is a real limit rather than an oversight.** An
 * alarm is written to the band as a bare wall-clock hour and rung against the
 * band's own clock. Atlas does not speak the endpoint that would set that
 * clock, so it can see the problem without fixing it - still far better than
 * the alternative, where the symptom is an alarm at the wrong hour and nothing
 * anywhere saying why.
 *
 * Withheld until a sync has actually reported an offset: absent is not the same
 * claim as zero, and UTC is a real zone somebody might be in.
 */
const zoneDrift = computed(() => {
  const band = history.value?.bandOffsetMinutes;
  const phone = history.value?.phoneOffsetMinutes;
  if (band == null || phone == null) return null;
  // The plugin sends Integer.MIN_VALUE when no sync has ever reported one.
  if (band < -24 * 60 || band === phone) return null;
  const diff = Math.abs(phone - band);
  const hours = Math.floor(diff / 60);
  const mins = diff % 60;
  return {
    band: offsetText(band),
    phone: offsetText(phone),
    gap: mins ? `${hours}H ${mins}M` : `${hours} HOURS`,
  };
});

function offsetText(minutes) {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  const mins = abs % 60;
  return `UTC${sign}${Math.floor(abs / 60)}${mins ? ":" + pad(mins) : ""}`;
}

/**
 * Days another alarm already owns, greyed rather than allowed to clash.
 *
 * The rule is enforced here, at the point of editing, because the alternative
 * is enforcing it overnight: two alarms due on one night would give the smart
 * window two answers, and the service's fired-once mark and re-arm debt are
 * single values. `alarmPlan.js` carries the reasoning and the tests.
 */
const takenDays = computed(() => daysTakenBy(helio.alarms, editingId.value));

function removeAlarm() {
  helio.removeAlarm(editingId.value);
  confirmRemove.value = false;
  editing.value = false;
}

// ── what the service knows ─────────────────────────────────────────────────
//
// The same call `MorningsPanel` makes, kept here because `alarmHistory()`
// answers with the band's and the phone's UTC offsets as well as the mornings,
// and the timezone warning above is this panel's own. **RECENT MORNINGS itself
// moved to LOGS on 2026-08-25** and took its formatting, its fold and its copy
// button with it; only the offsets are read here now.
//
// Loaded when the panel opens rather than on mount, since Settings mounts every
// section and this one costs a plugin call.
const history = ref(null);

async function loadHistory() {
  history.value = await helio.alarmHistory();
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !history.value) loadHistory();
  },
  { immediate: true }
);

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

/**
 * The time actually sitting on the strap, which is what the alarm falls back to
 * when the phone cannot run the smart part.
 *
 * Separate from `setTime` because that one is a label and this one is a claim: it
 * goes into a sentence promising you will still be woken, so it must not carry
 * "SMART · BY" in front of it.
 */
const fallbackTime = computed(() => {
  const a = helio.alarm;
  if (!a) return "--:--";
  if (a.mode === "onset" && a.latestHour != null) {
    return formatTime(a.latestHour, a.latestMinute ?? 0);
  }
  return formatTime(a.hour, a.minute);
});

/**
 * Whether to say anything about the exact-alarm permission.
 *
 * **Gated on the mode, not just on the permission.** A fixed alarm is written to
 * the strap and rung by the strap, so it needs nothing from Android and warning
 * about a permission it does not use would be pure noise. Smart and onset both
 * have the phone decide a time during the night, which is what needs the exact
 * wakeup.
 *
 * `askable` keeps this quiet below Android 12, where there is no such permission
 * and nothing the button could open.
 */
const needsExact = computed(() => {
  const a = helio.alarm;
  if (!a || !a.enabled) return false;
  if ((a.mode ?? "fixed") === "fixed") return false;
  return helio.exactAlarm.askable && !helio.exactAlarm.granted;
});

/**
 * The fault replaces the time rather than joining it. `SMART · BY 08:45 ·
 * PERMISSION NEEDED` is three facts on a single nowrap line with an ellipsis at
 * the end of it, and the one that gets cut is the one worth reading.
 */
const closedSummary = computed(() =>
  needsExact.value ? "PERMISSION NEEDED" : planSummary(helio.alarms)
);

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
function openEditor(target = null) {
  const a = target;
  editingId.value = a?.id ?? null;
  confirmRemove.value = false;
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
  // The alarm being edited, which is not necessarily the one ringing next.
  // Comparing against `helio.alarm` made every edit of a second alarm look
  // dirty the moment it opened.
  const a = editingAlarm.value;
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
      id: editingId.value ?? `alarm-${Date.now()}`,
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
  min-height: var(--set-row-h);
}
.arow .t.off {
  color: var(--dim);
}
/* Which one is next is said by position and a heading now, not by a rail. A
   coloured bar with nothing naming it is a thing people have to ask about. */
/* **Not `.grouphd`.** That name is already taken by a global rule in style.css:
   the drill-through "seam" heading, which carries a 34px top margin and an
   ::after rule running off the word. Reusing the class inherited both, which is
   where the trailing lines and the empty gap under ALARM came from. A group
   heading in a settings panel is a different thing from a seam between halves
   of a page. */
.alarmgroup {
  font-size: var(--set-label);
  letter-spacing: 2px;
  color: var(--acc);
  padding: 2px 0 4px;
}
.alarmgroup.later {
  color: var(--dim);
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--panel-line);
}
/* **No hairline between alarm rows at all** (2026-08-25). Four rules were
   stacking in a short space - the group heading's own, the line between rows,
   the divider above RECENT MORNINGS, and the card edge - which is what made the
   panel read as messy. A heading already says where a group starts; a rule
   under it says the same thing twice.
   The one rule left is above LATER, where it separates two groups rather than
   two rows. Worth revisiting past three alarms, when LATER becomes a stack. */
.countdown {
  /* Forced onto its own line: the time and the days belong together above it. */
  flex-basis: 100%;
  margin-top: 2px;
  font-size: var(--set-label);
  letter-spacing: 1.2px;
  color: var(--acc);
}
/* Names the alarm holding a day rather than saying "another alarm". A pill so
   it reads as a fact about something else, not as another setting. */
.ownerchip {
  display: inline-block;
  align-self: flex-start;
  margin-top: 6px;
  padding: 3px 8px;
  border: 1px solid var(--panel-line);
  border-radius: 999px;
  font-size: var(--set-label);
  letter-spacing: 1px;
  color: var(--dim);
}
.addalarm {
  display: block;
  width: 100%;
  min-height: var(--set-row-h);
  /* **A rule, and it is not the row hairlines coming back** (2026-08-25). The
     lines between alarm rows were taken out the same day for stacking four
     rules into a short space; this one separates the list from the action under
     it, which is a different job and the only place left in the panel where two
     kinds of thing meet. */
  margin-top: 8px;
  padding: 0;
  border: none;
  border-top: 1px solid var(--panel-line);
  background: none;
  text-align: left;
  font-size: var(--set-label);
  letter-spacing: 1px;
  color: var(--acc);
}
/* A day another alarm owns. Dimmed and unpressable rather than hidden: the week
   keeps its shape, which is the whole reason these are letters and not chips. */
/* Dotted rather than struck through. A strikethrough reads as "broken"; a
   dotted rule reads as "spoken for", which is what these actually are. */
.dl.taken {
  opacity: 0.55;
  border-bottom: 1.5px dotted color-mix(in srgb, var(--dim) 60%, transparent);
}
.removerow {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--panel-line);
}
.removelink {
  background: none;
  border: 0;
  padding: 4px 0;
  font-size: var(--set-micro);
  letter-spacing: 1px;
  color: var(--bad);
}
.arow .left {
  display: flex;
  align-items: baseline;
  gap: 12px;
  /* Wraps, so the countdown can take a line of its own below the time and days
     rather than crowding onto theirs. Without this the third child squeezed in
     beside the second and both wrapped raggedly. */
  flex-wrap: wrap;
  flex: 1;
}
.arow .t {
  font-size: 20px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.arow .d {
  font-size: var(--set-label);
  letter-spacing: 0.12em;
  color: var(--dim);
}
.edit {
  min-height: var(--set-row-h);
  padding: 0 0 0 14px;
  background: none;
  border: none;
  color: var(--acc);
  font-size: var(--set-label);
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
  font-size: 17px;
}
.onoff {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: var(--set-row-h);
  padding: 0 2px;
  background: none;
  border: none;
  color: var(--acc);
  font-size: var(--set-label);
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
  font-size: var(--set-micro);
  letter-spacing: 1.4px;
  color: var(--dim);
}
.mode.on .mname {
  color: var(--acc);
}
.mwhy {
  font-size: var(--set-summary);
  color: var(--body);
  line-height: 1.35;
}
.modenote {
  font-size: var(--set-micro);
  letter-spacing: 1px;
  line-height: 1.5;
  color: var(--dim);
  margin-bottom: 4px;
}
/* No border and no tinted panel: this already sits inside a card, and a box
   drawn inside a box is the treatment the whole app moved off on 2026-08-04.
   Space and one red line do the separating. */
.permbox {
  margin-bottom: 14px;
}
.permhd {
  margin-bottom: 4px;
  font-size: var(--set-micro);
  letter-spacing: 1px;
  color: var(--bad);
}
/* .databtn is built to share a flex row; on its own it needs telling to fill. */
.permbox .databtn {
  width: 100%;
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
  font-size: var(--set-micro);
  letter-spacing: 1.1px;
  color: var(--dim);
  text-align: center;
}
.step {
  width: 44px;
  min-height: var(--set-row-h);
  border: 1px solid var(--panel-line);
  border-radius: 6px;
  background: none;
  color: var(--ink);
  font-size: 19px;
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
  min-height: var(--set-row-h);
  font-size: var(--set-micro);
  letter-spacing: 1.2px;
  color: var(--dim);
}
.latestval {
  font-size: 18px;
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
  min-height: var(--set-row-h);
  background: none;
  border: none;
  color: color-mix(in srgb, var(--dim) 55%, transparent);
  font-size: var(--set-value);
  letter-spacing: 0.04em;
  cursor: pointer;
}
.dl.on {
  color: var(--acc);
  box-shadow: inset 0 -2px 0 var(--acc);
}
.repeat {
  margin-top: 8px;
  font-size: var(--set-label);
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
  min-height: var(--set-row-h);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--dim) 65%, transparent);
  color: var(--ink);
  font-size: var(--set-label);
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
  font-size: var(--set-label);
  letter-spacing: 0.1em;
  color: var(--dim);
}
.msg {
  margin-top: 10px;
  font-size: var(--set-label);
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
