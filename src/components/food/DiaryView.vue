<template>
  <div>
    <div class="daynav">
      <span class="spacer"></span>
      <div class="daynav-center">
        <span class="arrow" @click="prevDay" :class="{ disabled: !canGoBack }"
          >◂</span
        >
        <span class="date mono" :class="{ past: !isToday }">{{
          dateLabel
        }}</span>
        <span
          class="arrow"
          @click="nextDay"
          :class="{ disabled: !canGoForward }"
          >▸</span
        >
      </div>
      <span
        class="pill mono"
        :class="{ active: !isToday }"
        @click="!isToday && jumpToday()"
        >{{ isToday ? "" : "TODAY" }}</span
      >
    </div>

    <!-- M3. Two kinds of number, told apart instead of shuffled into one list.
         The split is where the day's energy came from - the big three only,
         since fibre contributes nothing to it and padding it in would misstate
         every other share. Underneath, the two things actually being chased get
         bars of their own. Protein appears in both on purpose: it is both a
         third of the energy and the number the day is judged on. -->
    <div class="panel macropanel">
      <div class="bigrow">
        <span class="big">{{ energy.kcalText }}</span>
        <span class="u mono">{{ isToday ? "KCAL TODAY" : "KCAL" }}</span>
      </div>

      <!-- One tile per macro, each carrying its own share. There used to be a
           stacked bar here with three bar-less rows under it, and the two
           disagreed: the bar's segments move with the day while the rows sat at
           a fixed width, so on a low-carb day a 9% segment had a full-width row
           beneath it. Proportion lives inside each tile now, and nothing above
           them competes to state it a second time. -->
      <div class="tiles">
        <div v-for="part in energy.parts" :key="part.key" class="tile">
          <div class="k mono" :style="{ color: part.color }">{{ part.label }}</div>
          <div class="g">{{ part.grams }}G</div>
          <!-- Withheld rather than drawn at zero when the day's items carry no
               carb or fat figures: not knowing the split is different from the
               day having none. -->
          <!-- A number, not a bar. The three shares are one pie split three
               ways, so a 0-100 bar can only ever fill to about half its length
               and the top of it is unreachable by construction. More than that,
               a share has no target, and a bar is the mark this app uses for a
               number that does: protein and fibre keep theirs below because
               they are measured against something. -->
          <div v-if="energy.split" class="p mono">{{ part.pct }}%</div>
        </div>
      </div>

      <div class="sechd mono"><span>GOALS</span><span class="ln"></span></div>
      <!-- The goals open the same metric page Home's rows do. A goal is a
           thing you are tracking over time, and the history behind it should be
           reachable from wherever the goal is shown rather than from Home
           alone. -->
      <button
        v-for="g in goalRows"
        :key="g.key"
        type="button"
        class="mrow goalrow"
        @click="openMetric = metricDef(g.key)"
      >
        <span class="k mono" :style="{ color: g.color }">{{ g.label }}</span>
        <span class="t"
          ><i :style="{ width: g.pct + '%', background: g.color }"></i
        ></span>
        <span class="v mono">{{ g.value }}</span>
        <span class="chev" aria-hidden="true">›</span>
      </button>
    </div>

    <div
      v-for="section in sections"
      :key="section.key"
      class="panel sectionpanel"
    >
      <div class="panel-hd">
        <span>{{ section.label }}</span
        ><span class="sectotal">{{ totalsLabel(section.totals) }}</span>
      </div>
      <!-- A template wrapper, because each row owns the extra lines beneath it
           and they have to share its scope. -->
      <template v-for="row in section.items" :key="row.key">
        <div
          class="diaryrow"
          @click.stop="row.logged ? (rowActions = row) : null"
        >
          <span class="name">{{ row.name }}</span>
          <span class="macro mono"
            >{{ row.protein }}G{{
              row.fibre != null ? " · " + row.fibre + "G FIBRE" : ""
            }}</span
          >
          <button
            v-if="!row.logged"
            class="log mono"
            @click.stop="food.confirmSlot(date, row.index, true)"
          >
            LOG
          </button>
        </div>
        <!-- Added to this one meal on this one day. Its own line rather than
             folded into the total above, so the meal keeps saying what the meal
             was. -->
        <div
          v-for="(ex, i) in row.extras"
          :key="row.key + '-x' + i"
          class="diaryrow extrarow"
          @click.stop="rowActions = row"
        >
          <span class="name">+ {{ ex.name }}</span>
          <span class="macro mono">{{ Math.round(ex.protein ?? 0) }}G</span>
        </div>
      </template>
      <div v-if="!section.items.length" class="emptyrow dim-text mono">
        NOTHING LOGGED YET
      </div>
      <!-- A row of its own, because the whole panel used to be the tap target and
           every logged row stopped the click. With one thing logged, "add another"
           meant hitting the strip of padding around it, which is what made a second
           snack fiddly to add. This is the 44pt minimum and cannot be missed. -->
      <button class="addrow mono" type="button" @click.stop="addingFor = section.key">
        + ADD TO {{ section.label }}
      </button>
    </div>

    <DiaryRowActions
      v-if="activeRow"
      :row="activeRow"
      @add-extra="addingExtraTo = rowActions"
      @remove-extra="onRemoveExtra"
      @set-component="onSetComponent"
      @remove-component="onRemoveComponent"
      @close="rowActions = null"
      @delete="onRowDelete"
      @move="onRowMove"
      @save-to-library="onSaveToLibrary"
    />

    <!-- Says it happened, since the library is a screen away and a button that
         appears to do nothing is a button you press twice. -->
    <Transition name="toast">
      <div v-if="savedToLibrary" class="savedtoast mono">
        {{ savedToLibrary.toUpperCase() }} SAVED TO THE LIBRARY
      </div>
    </Transition>

    <MetricPage v-if="openMetric" :def="openMetric" from="FOOD" @close="openMetric = null" />

    <MealPickSheet
      v-if="addingFor"
      :kinds="addKinds"
      :meal-type="addingFor"
      title="ADD"
      @close="addingFor = null"
      @pick="onAddPick"
    />

    <!-- Anything is addable as an extra, including a whole meal: what you put
         on top of a breakfast is not restricted to the things filed as snacks. -->
    <MealPickSheet
      v-if="addingExtraTo"
      :kinds="['meal', 'snack', 'takeaway']"
      title="ADD TO THIS MEAL"
      @close="addingExtraTo = null"
      @pick="onExtraPick"
    />
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useFoodStore, mealTypeFromTime } from "@/stores/food";
import { useCheckinStore } from "@/stores/checkin";
import { useGoalsStore } from "@/stores/goals";
import { today, addDays } from "@/utils/date";
import MealPickSheet from "./MealPickSheet.vue";
import DiaryRowActions from "./DiaryRowActions.vue";
import MetricPage from "@/components/metrics/MetricPage.vue";
import { metric as metricDef } from "@/utils/metricRegistry";

const food = useFoodStore();
const checkin = useCheckinStore();
// A plain reactive object, so every GOALS.x below reads live and works the
// same in the template as it does here. See stores/goals.js.
const GOALS = useGoalsStore().values;

const MEAL_TYPES = [
  { key: "breakfast", label: "BREAKFAST" },
  { key: "lunch", label: "LUNCH" },
  { key: "dinner", label: "DINNER" },
  { key: "snack", label: "SNACKS" },
];

// A slot/snack's own mealType if it has one (set at creation time), else a
// guess derived from its time - covers every record stored before this
// field existed with zero migration.
function effectiveMealType(entry, timeStr) {
  return entry.mealType ?? mealTypeFromTime(timeStr);
}

// The date currently being viewed - owned by FoodTab now (not a local ref),
// so the shared Food FAB's ADD FOOD action can log against whatever day
// Diary's browsing instead of always defaulting to today. Diary sections,
// LOG/ADD actions, and the protein/fibre bars all read/write via props.date.
const props = defineProps({ date: { type: String, required: true } });
const emit = defineEmits(["update:date"]);
const isToday = computed(() => props.date === today());

// Earliest date with an actual stored food day-plan - the back arrow's
// floor. Browsing can't wander past this into dates with nothing recorded,
// since the user's food-diary history doesn't go back nearly as far as
// their manual checkin logs do.
const earliestPlanDate = computed(() => {
  if (!food.dayPlans.length) return today();
  return food.dayPlans.reduce(
    (min, p) => (p.date < min ? p.date : min),
    food.dayPlans[0].date
  );
});
const canGoBack = computed(() => props.date > earliestPlanDate.value);
const canGoForward = computed(() => props.date < today());

function prevDay() {
  if (canGoBack.value) emit("update:date", addDays(props.date, -1));
}
function nextDay() {
  if (canGoForward.value) emit("update:date", addDays(props.date, 1));
}
function jumpToday() {
  emit("update:date", today());
}

const dateLabel = computed(() =>
  new Date(props.date + "T12:00:00")
    .toLocaleDateString("en-AU", {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
    .toUpperCase()
    .replace(",", "")
);

// A snapshot carries its macros already scaled; anything older than the
// snapshot fields has to be resolved live from the library.
function macrosOf(item) {
  if (!item) return {};
  const keys = ["protein", "kcal", "carbs", "fat", "fibre"];
  return Object.fromEntries(keys.map((k) => [k, item[k] ?? null]));
}

const sections = computed(() => {
  const plan = food.planForDate(props.date);
  const buckets = { breakfast: [], lunch: [], dinner: [], snack: [] };

  plan.slots.forEach((s, idx) => {
    const type = effectiveMealType(s, s.time);
    const item = s.protein != null ? s : food.itemById(s.mealId);
    buckets[type].push({
      key: `slot-${idx}`,
      kind: "slot",
      index: idx,
      sectionKey: type,
      name: item?.name ?? "MEAL",
      protein: item?.protein ?? 0,
      fibre: item?.fibre ?? null,
      logged: s.confirmed,
      // Carried so the detail sheet can show every macro and, for a composite,
      // what it was built from. `item` is the snapshot when the slot has one
      // and the live library entry otherwise.
      mealId: s.mealId,
      quantity: s.quantity,
      macros: macrosOf(item),
      extras: s.extras ?? [],
      components: s.components,
    });
  });

  plan.snacks.forEach((sn, idx) => {
    const time = new Date(sn.at).toTimeString().slice(0, 5);
    const type = effectiveMealType(sn, time);
    const item = sn.protein != null ? sn : food.itemById(sn.mealId);
    buckets[type].push({
      key: `snack-${idx}`,
      kind: "snack",
      index: idx,
      sectionKey: type,
      name: item?.name ?? "ITEM",
      protein: item?.protein ?? 0,
      fibre: item?.fibre ?? null,
      logged: true,
      mealId: sn.mealId,
      quantity: sn.quantity,
      macros: macrosOf(item),
      extras: sn.extras ?? [],
      components: sn.components,
    });
  });

  return MEAL_TYPES.map((mt) => ({
    ...mt,
    items: buckets[mt.key],
    totals: macroSum(buckets[mt.key]),
  }));
});

// What a section actually put in you: logged rows only, plus their extras.
// A planned meal you have not confirmed is not food you have eaten, and
// counting it would make the header disagree with the bars above, which have
// always counted confirmed slots only.
function macroSum(rows) {
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
  for (const row of rows) {
    if (!row.logged) continue;
    for (const key of Object.keys(out)) out[key] += row.macros?.[key] ?? 0;
    for (const ex of row.extras ?? []) {
      for (const key of Object.keys(out)) out[key] += ex[key] ?? 0;
    }
  }
  return out;
}

/** A section header's line: only the parts that have a number behind them. */
function totalsLabel(t) {
  if (!t) return "";
  const parts = [];
  if (t.kcal) parts.push(`${Math.round(t.kcal)} KCAL`);
  if (t.protein) parts.push(`${Math.round(t.protein)}G P`);
  if (t.fibre) parts.push(`${Math.round(t.fibre)}G FIBRE`);
  return parts.join(" · ");
}

// Manual-override-additive protein total, same computation as HomeTab.vue's
// proteinTotal - duplicated rather than shared, matching this codebase's
// existing convention of small per-component computeds over a shared util.
const entry = computed(() => checkin.entryFor(props.date) ?? {});
function pctOf(val, goal) {
  // A switched-off goal is null, and dividing by it gives Infinity, which
  // clamps to a full bar on a day nothing was eaten. Guarded here rather than
  // at each call site so a new caller cannot reintroduce it.
  if (!val || !goal) return 0;
  return Math.min(100, Math.round((val / goal) * 100));
}
const proteinTotal = computed(() =>
  Math.round(food.proteinFor(props.date) + (entry.value.protein || 0))
);
const proteinPct = computed(() => pctOf(proteinTotal.value, GOALS.protein));

const fibreTotal = computed(() =>
  Math.round(food.fibreFor(props.date) + (entry.value.fibre || 0))
);
const fibrePct = computed(() => pctOf(fibreTotal.value, GOALS.fibre));

// The day's macros, summed from the same section totals the headers show, so
// the panel and the sections can never disagree. Protein and fibre pick up the
// manual override the way the bars above already do; there is no such field for
// carbs, fat or energy, so those are diary-only.
const dayMacros = computed(() => {
  const out = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
  for (const section of sections.value) {
    for (const key of Object.keys(out)) out[key] += section.totals[key] ?? 0;
  }
  out.protein += entry.value.protein || 0;
  out.fibre += entry.value.fibre || 0;
  return out;
});

// Energy by macro, at the usual 4/4/9 kcal per gram. **Fibre is not in here**:
// it contributes nothing to the day's energy, and including it would misstate
// every other share. It is a goal, and it lives with the goals.
//
// The headline number is the logged kcal rather than this sum: an item's own
// calorie figure is the one it was labelled with.
const ENERGY_PARTS = [
  { key: "protein", label: "PROTEIN", perGram: 4, color: "var(--fam-intake)" },
  { key: "carbs", label: "CARBS", perGram: 4, color: "var(--macro-carbs)" },
  { key: "fat", label: "FAT", perGram: 9, color: "var(--macro-fat)" },
];
const energy = computed(() => {
  const m = dayMacros.value;
  const raw = ENERGY_PARTS.map((p) => ({
    ...p,
    grams: Math.round(m[p.key] ?? 0),
    energy: (m[p.key] ?? 0) * p.perGram,
  }));
  const total = raw.reduce((sum, p) => sum + p.energy, 0);
  // Nobody eats a day of pure protein: carbs and fat both at zero means the
  // items were logged without those figures, not that the food had none. The
  // shares are withheld rather than shown as 100% protein.
  const split = (m.carbs ?? 0) + (m.fat ?? 0) > 0;
  return {
    kcal: Math.round(m.kcal),
    kcalText: m.kcal ? Math.round(m.kcal).toLocaleString() : "—",
    split,
    parts: raw.map((p) => ({
      ...p,
      pct: split && total ? Math.round((p.energy / total) * 100) : 0,
    })),
  };
});

// The two with targets. Fibre keeps the family blue at 62%: it is the same
// family as protein rather than a fourth idea, and tone is all two labelled
// rows a line apart need.
const goalRows = computed(() => {
  const m = dayMacros.value;
  return [
    // First, because it is the number the headline above already states and a
    // reader looking for "am I over" should not have to scan past two others to
    // find it. Full intake colour rather than protein's, since it is the whole
    // of the day's energy and the macros are its parts.
    {
      key: "calories",
      label: "CALORIES",
      color: "var(--fam-intake)",
      pct: pctOf(m.kcal, GOALS.calories),
      value: `${Math.round(m.kcal ?? 0)} / ${GOALS.calories} KCAL`,
    },
    {
      key: "protein",
      label: "PROTEIN",
      color: "var(--fam-intake)",
      pct: pctOf(m.protein, GOALS.protein),
      value: `${Math.round(m.protein ?? 0)} / ${GOALS.protein}G`,
    },
    {
      key: "fibre",
      label: "FIBRE",
      color: "color-mix(in srgb, var(--fam-intake) 62%, transparent)",
      pct: pctOf(m.fibre, GOALS.fibre),
      value: `${Math.round(m.fibre ?? 0)} / ${GOALS.fibre}G`,
    },
    // Filtered on the target rather than each row carrying a v-if, because this
    // list is about to grow a calories row and three near-identical guards in
    // the template is how one of them gets missed. A switched-off goal is null,
    // never 0, so this cannot swallow a real target of zero - there is no such
    // thing, and the store refuses to store one.
  ].filter((g) => GOALS[g.key] != null);
});

// Protein and fibre open their own history, the same page Home's rows open.
const openMetric = ref(null);

const addingFor = ref(null); // meal-type key while the add sheet is open
// SNACKS only offers snack-kind items; breakfast/lunch/dinner offer
// meal+takeaway - same split ScheduleEditor already uses for schedulable
// items, snacks stay quick-add-only rather than scheduled.
const addKinds = computed(() =>
  addingFor.value === "snack" ? ["snack"] : ["meal", "takeaway"]
);
function onAddPick(itemId, quantity, mealType) {
  food.addSnack(props.date, itemId, quantity, mealType);
  addingFor.value = null;
}

// Tapping a LOGGED row opens DiaryRowActions (DELETE / MOVE TO) - replaces
// an earlier long-press-drag attempt that didn't work reliably on a real
// device. Rows still pending (LOG button showing) aren't tappable this way;
// a single tap on LOG just confirms them, no overlay needed.
const rowActions = ref(null);

/**
 * The tapped row, re-found from the live sections every time they rebuild.
 *
 * `sections` is a computed that builds fresh row objects, so holding on to the
 * one that was tapped leaves the sheet describing the meal as it was before an
 * edit: the ingredient list would not change under the + button that changed it.
 * Falls back to the held row so a row that vanishes (unlogged from elsewhere)
 * does not blank the sheet mid-tap.
 */
const activeRow = computed(() => {
  const held = rowActions.value;
  if (!held) return null;
  for (const section of sections.value) {
    for (const row of section.items) {
      if (row.kind === held.kind && row.index === held.index) return row;
    }
  }
  return held;
});
const addingExtraTo = ref(null);

// The row's kind and index are what the store keys an extra off, so both sheets
// close together: leaving the actions sheet open behind would show a stale
// extras list the moment one is added.
function onExtraPick(itemId, quantity) {
  const row = addingExtraTo.value;
  if (row) food.addExtra(props.date, row.kind, row.index, itemId, quantity);
  addingExtraTo.value = null;
  rowActions.value = null;
}

function onRemoveExtra(extraIndex) {
  const row = rowActions.value;
  if (row) food.removeExtra(props.date, row.kind, row.index, extraIndex);
  rowActions.value = null;
}
// Neither of these closes the sheet. Adjusting an ingredient is something you
// do two or three times in a row, and closing after each tap would make the
// second correction cost another journey back into the meal.
function onSetComponent({ index, quantity }) {
  const row = rowActions.value;
  if (row) food.setComponentQuantity(props.date, row.kind, row.index, index, quantity);
}
function onRemoveComponent(index) {
  const row = rowActions.value;
  if (row) food.removeComponent(props.date, row.kind, row.index, index);
}
function onRowDelete() {
  const row = rowActions.value;
  if (row.kind === "slot") food.confirmSlot(props.date, row.index, false);
  else food.removeSnack(props.date, row.index);
  rowActions.value = null;
}
function onRowMove(mealType) {
  const row = rowActions.value;
  if (row.kind === "slot")
    food.setSlotMealType(props.date, row.index, mealType);
  else food.setSnackMealType(props.date, row.index, mealType);
  rowActions.value = null;
}

/**
 * Keep a quick add as a library item.
 *
 * **Copies, and deliberately does not join the two.** The entry keeps its own
 * snapshot and its `mealId` stays null, so this day's record is exactly what it
 * was: history in Atlas is a snapshot on purpose, and linking a past entry to a
 * new item would put it back under the library's control, where a later recipe
 * edit could rewrite a day you already lived.
 *
 * Kind follows the section it was eaten in, since that is the only signal there
 * is, and it is one tap to change in the library if it guessed wrong.
 */
function onSaveToLibrary() {
  const row = activeRow.value;
  if (!row) return;
  const entry = food.planForDate(props.date).snacks[row.index];
  if (!entry) return;
  food.addLibraryItem({
    name: entry.name?.trim() || "Saved item",
    kind: entry.mealType === "snack" ? "snack" : "meal",
    protein: entry.protein ?? null,
    kcal: entry.kcal ?? null,
    carbs: entry.carbs ?? null,
    fat: entry.fat ?? null,
    fibre: entry.fibre ?? null,
  });
  rowActions.value = null;
  savedToLibrary.value = entry.name?.trim() || "Saved item";
  setTimeout(() => {
    savedToLibrary.value = "";
  }, 2600);
}
const savedToLibrary = ref("");
</script>

<style scoped>
/* Above the tab bar rather than at the very bottom: the bar is 61px plus the
   safe-area inset, and a toast under it would be half in the gesture area. */
.savedtoast {
  position: fixed;
  left: 14px;
  right: 14px;
  bottom: calc(72px + env(safe-area-inset-bottom));
  z-index: 600;
  padding: 12px 14px;
  border-radius: 8px;
  background: var(--bg2);
  border: 1px solid color-mix(in srgb, var(--fam-intake) 40%, transparent);
  color: var(--fam-intake);
  font-size: 11px;
  letter-spacing: 1.4px;
  text-align: center;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
}
.daynav {
  display: flex;
  align-items: center;
  padding: 0 0 12px;
}
.daynav .spacer {
  flex: 1;
}
.daynav-center {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
  justify-content: center;
}
.daynav .arrow {
  font-size: 22px;
  line-height: 1;
  color: var(--fam-intake);
  text-shadow: 0 0 8px color-mix(in srgb, var(--fam-intake) 55%, transparent);
  cursor: pointer;
  padding: 6px 10px;
}
.daynav .arrow.disabled {
  color: var(--dim);
  text-shadow: none;
  opacity: 0.28;
  cursor: default;
}
.daynav .date {
  font-size: 11.5px;
  letter-spacing: 2px;
  color: var(--ink);
  min-width: 110px;
  text-align: center;
}
.daynav .date.past {
  color: var(--dim);
}
.daynav .pill {
  flex: 1;
  text-align: right;
  font-size: 9px;
  letter-spacing: 1.5px;
  color: var(--dim);
  cursor: default;
}
.daynav .pill.active {
  color: var(--fam-intake);
  cursor: pointer;
}
.sectionpanel {
  cursor: pointer;
}
.macropanel {
  margin-bottom: 14px;
}
/* Centred, because it is the panel's headline rather than the first item in a
   list. Left-aligned it read as the top row of the tiles below it, which are
   three equal columns starting at the same edge. Its target, when one is set,
   is a bar down in GOALS with the others: all the bars in one place, and the
   headline stays the plain figure it has always been. */
.bigrow {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 9px;
  margin-bottom: 10px;
}
.bigrow .big {
  font-size: 34px;
  font-weight: 300;
  color: var(--ink);
  line-height: 1.1;
  font-variant-numeric: tabular-nums;
}
.bigrow .u {
  font-size: var(--fs-micro);
  letter-spacing: 2px;
  color: var(--dim);
}
/* Three tiles, equal width. Equal width is the point: the tiles are a place to
   read three numbers, not a second drawing of the proportions, so they cannot
   fall out of step with anything above them. The same grid MetricPage's
   summary uses. */
.tiles {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  background: color-mix(in srgb, var(--dim) 14%, transparent);
  border-radius: 7px;
  overflow: hidden;
  margin-top: 10px;
}
/* Tighter than the type inside it would suggest. The figures were sized up
   deliberately; the height came from padding and gaps, and that is what gets
   taken back rather than the reading size. */
.tile {
  background: var(--panel);
  padding: 10px 8px 11px;
  text-align: center;
}
/* On the type scale's own label size rather than under it. Dropping the share
   bars gave the tile back the height these need. */
.tile .k {
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
}
.tile .g {
  margin-top: 3px;
  font-size: 27px;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.tile .p {
  margin-top: 2px;
  font-size: var(--fs-label);
  letter-spacing: 1px;
  color: var(--dim);
  font-variant-numeric: tabular-nums;
}
.sechd {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 16px 0 2px;
  font-size: var(--fs-micro);
  letter-spacing: 2.2px;
  color: var(--dim);
}
.sechd .ln {
  flex: 1;
  height: 1px;
  background: color-mix(in srgb, var(--dim) 22%, transparent);
}
.mrow {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 34px;
}
/* The label carries the macro's colour and the bar repeats it, so the row is
   readable without the legend a stacked bar needed. */
.mrow .k {
  width: 70px;
  flex: none;
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
}
.mrow .t {
  flex: 1;
  min-width: 0;
  height: 6px;
  border-radius: 3px;
  position: relative;
  overflow: hidden;
  background: color-mix(in srgb, var(--dim) 16%, transparent);
}
.mrow .t i {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 3px;
}
.goalrow {
  width: 100%;
  background: none;
  border: 0;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.goalrow .chev {
  flex: none;
  width: 8px;
  text-align: right;
  color: var(--dim);
  font-size: 14px;
}
.mrow .v {
  flex: none;
  margin-left: auto;
  min-width: 88px;
  text-align: right;
  font-size: var(--fs-label);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.diaryrow {
  display: grid;
  grid-template-columns: 1fr auto auto;
  align-items: baseline;
  column-gap: 10px;
  padding: 7px 0;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.6px;
  border-bottom: 1px solid color-mix(in srgb, var(--fam-intake) 10%, transparent);
}
.diaryrow .name {
  overflow-wrap: anywhere;
  min-width: 0;
}
/* Two children, not three: no LOG button on an extra. The grid's third column
   is auto and collapses to nothing, so the macro still lands in the same column
   as its parent's and the numbers stay in line. */
.extrarow {
  padding-left: 14px;
  padding-top: 2px;
  padding-bottom: 9px;
}
.extrarow .name {
  font-size: 13px;
  color: var(--fam-intake);
}
.extrarow .macro {
  color: var(--fam-intake);
}
.diaryrow .macro {
  text-align: right;
  font-size: 9px;
  color: var(--dim);
  white-space: nowrap;
}
/* 44px is the row minimum the rest of the app holds to, and the reason this
   exists at all: it replaced a whole-panel click that every row swallowed. */
.addrow {
  display: block;
  width: 100%;
  min-height: 44px;
  margin-top: 4px;
  padding: 0;
  border: none;
  background: none;
  text-align: left;
  font-size: 9px;
  letter-spacing: 1px;
  color: var(--fam-intake);
}
.diaryrow .log {
  color: var(--bg1);
  background: var(--fam-intake);
  font-size: 9px;
  letter-spacing: 1px;
  padding: 4px 8px;
  border: none;
}
.emptyrow {
  padding: 6px 0;
}
.dim-text {
  color: var(--dim);
  font-size: 12.5px;
  font-weight: 400;
}
</style>
