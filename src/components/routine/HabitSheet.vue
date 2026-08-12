<template>
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>{{ habit ? "EDIT HABIT" : "NEW HABIT" }}</span
          ><span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <input
          ref="nameEl"
          v-model="name"
          class="field mono"
          type="text"
          placeholder="NAME"
          autocomplete="off"
          @keydown.enter="save"
        />

        <div class="cadence mono">
          <span>ON</span><span>{{ cadenceLabel }}</span>
        </div>
        <div class="daystrip">
          <button
            v-for="d in DAYS"
            :key="d.key"
            type="button"
            class="mono"
            :class="{ on: days.includes(d.key) }"
            @click="toggleDay(d.key)"
          >
            {{ d.label }}
          </button>
        </div>

        <!-- Which part of the day it belongs to. Not a time of day and not a
             reminder: it is where the habit sits in the sequence the routine
             page draws. -->
        <div class="cadence mono">
          <span>PART OF THE DAY</span>
        </div>
        <div class="daystrip">
          <button
            v-for="b in BANDS"
            :key="b.id"
            type="button"
            class="mono"
            :class="{ on: band === b.id }"
            @click="band = b.id"
          >
            {{ b.label }}
          </button>
        </div>

        <button class="save mono" type="button" :disabled="!canSave" @click="save">
          {{ habit ? "SAVE" : "+ ADD" }}
        </button>

        <!-- Both ways out live here rather than on the row: a destructive
             control beside a tick you press every morning is a control you
             press by accident. Archive keeps the history and can be undone;
             delete cannot, which is why only it asks twice. -->
        <template v-if="habit">
          <button class="archive mono" type="button" @click="archive">
            ARCHIVE (KEEPS ITS HISTORY)
          </button>
          <button
            v-if="!confirmingDelete"
            class="delete mono"
            type="button"
            @click="confirmingDelete = true"
          >
            DELETE
          </button>
          <div v-else class="confirm">
            <div class="warn mono">{{ deleteWarning }}</div>
            <div class="btnrow">
              <button class="delete danger mono" type="button" @click="destroy">
                DELETE FOR GOOD
              </button>
              <button
                class="cancel mono"
                type="button"
                @click="confirmingDelete = false"
              >
                CANCEL
              </button>
            </div>
          </div>
        </template>

        <!-- Archived habits have nowhere else to be restored from now that the
             manager page is gone, so the add sheet carries them. -->
        <div v-if="!habit && archived.length" class="arch">
          <div class="panel-hd">
            <span>ARCHIVED // {{ archived.length }}</span>
          </div>
          <div v-for="h in archived" :key="h.id" class="arow">
            <span class="anm">{{ h.name }}</span>
            <button class="restore mono" type="button" @click="restore(h.id)">
              RESTORE
            </button>
            <!-- The pile of archived habits is where a delete is most wanted,
                 so it is offered here too, on the same two taps. -->
            <button
              class="adel mono"
              type="button"
              :class="{ armed: confirmingArchivedId === h.id }"
              @click="deleteArchived(h)"
            >
              {{ confirmingArchivedId === h.id ? "SURE?" : "DELETE" }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import { useHabitsStore } from "@/stores/habits";
import { BANDS, bandForHour, bandOf } from "@/utils/bands";

// null = adding. Otherwise the habit definition being edited.
const props = defineProps({
  habit: { type: Object, default: null },
});
const emit = defineEmits(["close"]);
useBackClose(() => emit("close"));

const store = useHabitsStore();

// Monday-first display over the store's native getDay() keys (0 = Sunday).
// 3-letter codes, matching ScheduleEditor's day strip: single letters made
// Tue/Thu and Sat/Sun visually identical.
const DAYS = [
  { key: 1, label: "MON" },
  { key: 2, label: "TUE" },
  { key: 3, label: "WED" },
  { key: 4, label: "THU" },
  { key: 5, label: "FRI" },
  { key: 6, label: "SAT" },
  { key: 0, label: "SUN" },
];

const name = ref(props.habit?.name ?? "");
const days = ref([...(props.habit?.days ?? [0, 1, 2, 3, 4, 5, 6])]);
// An existing habit shows the band it has (or the fallback); a new one is
// proposed the band the clock is in right now.
const band = ref(
  props.habit ? bandOf(props.habit) : bandForHour(new Date().getHours())
);
const nameEl = ref(null);

// Autofocused only when adding: there is nothing to do in that state except
// type, and the keyboard covering the day strip is fine when the strip already
// says DAILY. Editing usually means changing the cadence, not the name.
onMounted(async () => {
  await nextTick();
  if (!props.habit) nameEl.value?.focus();
});

const archived = computed(() => store.habits.filter((h) => h.archived));

const cadenceLabel = computed(() => {
  if (days.value.length === 7) return "EVERY DAY";
  if (!days.value.length) return "PICK AT LEAST ONE DAY";
  return DAYS.filter((d) => days.value.includes(d.key))
    .map((d) => d.label)
    .join(" ");
});

const canSave = computed(() => Boolean(name.value.trim()) && days.value.length > 0);

function toggleDay(key) {
  days.value = days.value.includes(key)
    ? days.value.filter((d) => d !== key)
    : [...days.value, key];
}

function save() {
  if (!canSave.value) return;
  const sorted = [...days.value].sort();
  if (props.habit) {
    store.updateHabit(props.habit.id, {
      name: name.value.trim(),
      days: sorted,
      band: band.value,
    });
  } else {
    store.addHabit(name.value.trim(), sorted, band.value);
  }
  emit("close");
}

function archive() {
  store.archiveHabit(props.habit.id);
  emit("close");
}

const confirmingDelete = ref(false);
const confirmingArchivedId = ref(null);

// Says what is actually about to be lost. "This cannot be undone" is true of
// every delete and tells you nothing; the number of ticks is the part that
// decides whether you mind.
const deleteWarning = computed(() => {
  const ticks = store.tickCount(props.habit.id);
  if (!ticks) return "NOTHING TICKED YET. NO HISTORY TO LOSE.";
  return `TAKES ${ticks} TICKED ${ticks === 1 ? "DAY" : "DAYS"} WITH IT. ARCHIVE KEEPS THEM.`;
});

function destroy() {
  store.deleteHabit(props.habit.id);
  emit("close");
}

function restore(id) {
  store.unarchiveHabit(id);
}

// Two taps on the one button: the second is a different word, so nothing is
// deleted by a double tap on the first.
function deleteArchived(h) {
  if (confirmingArchivedId.value !== h.id) {
    confirmingArchivedId.value = h.id;
    return;
  }
  store.deleteHabit(h.id);
  confirmingArchivedId.value = null;
}
</script>

<style scoped>
.sheetwrap {
  position: fixed;
  inset: 0;
  background: rgba(2, 5, 9, 0.55);
  z-index: 700;
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  max-height: 88%;
  overflow-y: auto;
  background: var(--bg1);
  border-top: 1px solid color-mix(in srgb, var(--fam-activity) 30%, transparent);
  padding: 16px 18px calc(20px + env(safe-area-inset-bottom));
  color: var(--body);
  font-family: var(--font-sans);
}
.field {
  width: 100%;
  margin-top: 12px;
  padding: 12px 13px;
  min-height: 46px;
  background: color-mix(in srgb, var(--fam-activity) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--fam-activity) 30%, transparent);
  border-radius: 7px;
  color: var(--ink);
  font-size: 14px;
  letter-spacing: 1px;
}
.field::placeholder {
  color: var(--dim);
  letter-spacing: 1.4px;
  font-size: 12px;
}
.field:focus {
  outline: none;
  border-color: var(--fam-activity);
}
.cadence {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin: 16px 0 6px;
  font-size: var(--fs-micro);
  letter-spacing: 1.6px;
  color: var(--dim);
}
.daystrip {
  display: flex;
  gap: 4px;
}
.daystrip button {
  flex: 1;
  min-height: 44px;
  border: 1px solid color-mix(in srgb, var(--fam-activity) 30%, transparent);
  border-radius: 6px;
  background: none;
  color: var(--dim);
  font-size: 10.5px;
  letter-spacing: 1px;
  cursor: pointer;
}
.daystrip .on {
  color: var(--bg1);
  background: var(--fam-activity);
  border-color: var(--fam-activity);
}
.save {
  width: 100%;
  min-height: 48px;
  margin-top: 16px;
  border: 0;
  border-radius: 7px;
  background: var(--fam-activity);
  color: var(--bg1);
  font-size: 12.5px;
  letter-spacing: 2px;
  cursor: pointer;
}
.save:disabled {
  opacity: 0.35;
  cursor: default;
}
.archive {
  width: 100%;
  min-height: 46px;
  margin-top: 10px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--bad) 40%, transparent);
  border-radius: 7px;
  color: var(--bad);
  font-size: 11.5px;
  letter-spacing: 1.8px;
  cursor: pointer;
}
/* Quieter than ARCHIVE until it is armed: the reversible way out should be the
   one that catches the eye first. */
.delete {
  width: 100%;
  min-height: 46px;
  margin-top: 8px;
  background: none;
  border: 0;
  color: var(--dim);
  font-size: 11.5px;
  letter-spacing: 1.8px;
  cursor: pointer;
}
.delete.danger {
  flex: 1;
  margin-top: 0;
  border: 1px solid var(--bad);
  border-radius: 7px;
  color: var(--bad);
}
.confirm {
  margin-top: 10px;
}
.warn {
  font-size: 11px;
  letter-spacing: 1.2px;
  line-height: 1.5;
  color: var(--bad);
  margin-bottom: 8px;
}
.btnrow {
  display: flex;
  gap: 8px;
}
.cancel {
  flex: 1;
  min-height: 46px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 40%, transparent);
  border-radius: 7px;
  color: var(--dim);
  font-size: 11.5px;
  letter-spacing: 1.8px;
  cursor: pointer;
}
.arch {
  margin-top: 22px;
}
.arow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 46px;
}
.anm {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  color: var(--dim);
  text-decoration: line-through;
}
.restore {
  min-height: 40px;
  padding: 0 12px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--fam-activity) 40%, transparent);
  border-radius: 6px;
  color: var(--fam-activity);
  font-size: 10.5px;
  letter-spacing: 1.4px;
  cursor: pointer;
}
.adel {
  min-height: 40px;
  padding: 0 12px;
  background: none;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--dim);
  font-size: 10.5px;
  letter-spacing: 1.4px;
  cursor: pointer;
}
.adel.armed {
  border-color: var(--bad);
  color: var(--bad);
}
</style>
