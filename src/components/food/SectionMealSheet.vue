<!--
  Saving a section of the diary as one reusable meal (option C of three mocked
  up 2026-08-24).

  The case: lunch was beans, bread and eggs on two days, added as three separate
  items each time. The composite machinery already existed twice - Library's
  SELECT mode and `batchMeal.js` - and neither could start from *logged* rows.

  **Why the section rather than a select mode.** A SELECT mode over the whole
  diary was drawn first (option A) and puts a mode on a surface that is mostly
  for reading, growing a tick target on every row for the sake of a thing done
  monthly. The section is the meal in the case that actually came up, so opening
  with its rows already ticked makes the common path zero ticks. Untick anything
  that does not belong. The cost is that it cannot combine across sections,
  which on the evidence has never come up.

  All the arithmetic is in `sectionMeal.js` and tested there; this file is
  template-shaped and can only be checked by running it.
-->
<template>
  <div class="scrim" @click.self="$emit('close')">
    <div class="sheet">
      <div class="hd">
        <span class="mono ttl">SAVE {{ sectionLabel }} AS A MEAL</span>
        <button class="mono close" type="button" @click="$emit('close')">[ CLOSE ]</button>
      </div>

      <input
        v-model="name"
        class="namefield"
        type="text"
        placeholder="What is it called?"
        aria-label="Meal name"
      />

      <div class="rows">
        <button
          v-for="c in list"
          :key="c.row.key"
          class="row"
          type="button"
          :disabled="!c.usable"
          :aria-pressed="picked.includes(c.row.key)"
          @click="toggle(c.row.key)"
        >
          <span class="tick" :class="{ on: picked.includes(c.row.key) }" />
          <span class="nm">
            {{ c.row.name }}
            <!-- Named rather than hidden. A quick-added row has no library item
                 to point at, and a meal that silently came out one item short
                 is worse than one that says why. -->
            <i v-if="!c.usable" class="mono sub">{{ c.why }}</i>
          </span>
          <span class="mono amt">{{ amountFor(c.row) }}</span>
        </button>
      </div>

      <!-- Two choices, and the default is the safe one. Rewriting a day you
           have already logged is the destructive half, and the value asked for
           was next time. Same shape as batch scan's SAVE THE ITEMS ONLY. -->
      <button
        class="choice"
        :class="{ on: !tidy }"
        type="button"
        :aria-pressed="!tidy"
        @click="tidy = false"
      >
        <b class="mono">SAVE FOR NEXT TIME</b>
        <span>Today's rows stay exactly as they are.</span>
      </button>
      <button
        class="choice"
        :class="{ on: tidy }"
        type="button"
        :aria-pressed="tidy"
        @click="tidy = true"
      >
        <b class="mono">SAVE AND TIDY TODAY</b>
        <span>Replaces the {{ picked.length }} rows with the new meal.</span>
      </button>

      <button class="save mono" type="button" :disabled="!canSaveNow" @click="save">
        {{ tidy ? "SAVE AND TIDY" : "SAVE" }}
      </button>
      <div v-if="!canSaveNow" class="mono hint">{{ blockedWhy }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { useFoodStore } from "@/stores/food";
import {
  candidates,
  canSave,
  canTidy,
  ingredientsFrom,
  removalOrder,
  suggestedName,
} from "./sectionMeal";
import { formatAmount } from "./rowDetail";

const props = defineProps({
  /** The section's rows, in the order the diary draws them. */
  rows: { type: Array, required: true },
  sectionLabel: { type: String, required: true },
  date: { type: String, required: true },
});
const emit = defineEmits(["close", "saved"]);

const food = useFoodStore();

const list = computed(() => candidates(props.rows));
const name = ref(suggestedName(props.sectionLabel, props.date));
const tidy = ref(false);
// Everything usable starts ticked, which is the whole point of option C: the
// common case is the section as it stands.
const picked = ref(list.value.filter((c) => c.usable).map((c) => c.row.key));

const pickedRows = computed(() =>
  props.rows.filter((r) => picked.value.includes(r.key))
);

const canSaveNow = computed(() => canSave(name.value, pickedRows.value));

const blockedWhy = computed(() => {
  if (!name.value.trim()) return "GIVE IT A NAME";
  if (ingredientsFrom(pickedRows.value).length < 2) return "PICK AT LEAST TWO";
  return "";
});

function toggle(key) {
  picked.value = picked.value.includes(key)
    ? picked.value.filter((k) => k !== key)
    : [...picked.value, key];
}

/**
 * The same formatter every other screen prints an amount with.
 *
 * It takes the unit and the portion separately, not the item: base units are
 * two different kinds of thing and `formatAmount` is the one place that knows
 * the difference. Passing the item gave `1 [OBJECT OBJECT]`.
 */
function amountFor(row) {
  const item = food.itemById(row.mealId);
  return formatAmount(row.quantity ?? 1, item?.baseUnit, item?.portion);
}

function save() {
  if (!canSaveNow.value) return;
  const rows = pickedRows.value;
  // A composite never stores its own macros: they are the live sum of the
  // ingredients, so the meal cannot drift from the list it is made of.
  const newId = food.addLibraryItem({
    name: name.value.trim(),
    kind: "meal",
    protein: null,
    kcal: null,
    ingredients: ingredientsFrom(rows),
  });

  // `canTidy` asserts that everything going into the meal can also be taken
  // out again. It is true by construction today, but the failure it guards is
  // silent and destructive - rows deleted, one left behind, nothing said - and
  // that is exactly what the first version of this did with a legacy slot.
  if (tidy.value && canTidy(rows)) {
    // Remove from the end, or every later index shifts under us and the wrong
    // rows go. `removalOrder` sorts for exactly this and has the test.
    for (const { index } of removalOrder(rows)) {
      food.removeSnack(props.date, index);
    }
    food.addSnack(props.date, newId, 1, props.rows[0]?.sectionKey);
  }

  emit("saved", { newId, name: name.value.trim(), tidied: tidy.value });
}
</script>

<style scoped>
/* Same overlay shape as the other food sheets: a scrim you can tap out of and a
   panel raised on --bg2, which is the treatment sheets use app-wide. */
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
  gap: 10px;
}
.hd {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.ttl {
  font-size: var(--fs-micro);
  letter-spacing: 1.4px;
  color: var(--acc);
}
.close {
  background: none;
  border: 0;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  padding: 4px;
}
.namefield {
  background: transparent;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  padding: 11px;
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--fs-prose);
}
.namefield::placeholder {
  color: var(--dim);
}
.rows {
  display: flex;
  flex-direction: column;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  /* The 44pt minimum every tappable row in Atlas keeps. */
  min-height: 44px;
  padding: 8px 0;
  background: none;
  border: 0;
  border-top: 1px solid var(--panel-line);
  text-align: left;
}
.row:first-child {
  border-top: 0;
}
.row:disabled {
  opacity: 0.5;
}
.tick {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  border: 1.5px solid var(--dim);
  border-radius: 4px;
  position: relative;
}
.tick.on {
  border-color: var(--acc);
  background: var(--acc);
}
/* Drawn rather than a glyph, so it is centred on its own ink at any size. */
.tick.on::after {
  content: "";
  position: absolute;
  inset: 3px 3px 5px 3px;
  border-left: 2px solid var(--bg2);
  border-bottom: 2px solid var(--bg2);
  transform: rotate(-45deg);
}
.nm {
  flex: 1;
  color: var(--ink);
  font-size: var(--fs-second);
  line-height: 1.35;
}
.sub {
  display: block;
  font-style: normal;
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
}
.amt {
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
}
.choice {
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;
  padding: 10px;
  border: 1px solid var(--panel-line);
  border-radius: 8px;
  background: none;
}
.choice.on {
  border-color: var(--acc);
}
.choice b {
  font-size: var(--fs-micro);
  letter-spacing: 1.2px;
  font-weight: 500;
  color: var(--ink);
}
.choice span {
  font-size: var(--fs-micro);
  line-height: 1.45;
  color: var(--dim);
}
.save {
  margin-top: 4px;
  padding: 12px;
  border-radius: 8px;
  border: 0;
  background: var(--acc);
  color: var(--bg1);
  font-size: var(--fs-label);
  letter-spacing: 1.2px;
}
.save:disabled {
  background: transparent;
  border: 1px solid var(--panel-line);
  color: var(--dim);
}
.hint {
  font-size: var(--fs-micro);
  letter-spacing: 1px;
  color: var(--dim);
  text-align: center;
}
</style>
