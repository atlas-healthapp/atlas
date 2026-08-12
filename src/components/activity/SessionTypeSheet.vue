<template>
  <Teleport to="body">
    <div class="sheetwrap" @click.self="$emit('close')">
      <div class="sheet grid-bg">
        <div class="panel-hd">
          <span>WHAT WAS THIS?</span><span @click="$emit('close')">[ CLOSE ]</span>
        </div>

        <input
          ref="searchEl"
          v-model="query"
          class="search mono"
          type="text"
          placeholder="SEARCH OR ADD A TYPE"
          autocomplete="off"
          @keydown.enter="onEnter"
        />

        <div class="list">
          <button
            v-for="t in matches"
            :key="t.id"
            type="button"
            class="opt mono"
            :class="{ on: t.id === currentTypeId }"
            @click="$emit('pick', t.id)"
          >
            {{ t.name }}
            <span v-if="t.id === currentTypeId" class="tick">✓</span>
          </button>

          <!-- Common activities nobody should have to type, kept visually
               apart from your own because they are not yours yet: picking one
               is what adds it. Below your list rather than above it, since on
               every launch after the first the thing you want is already up
               there. -->
          <template v-if="suggestions.length">
            <div class="sugghd mono">SUGGESTED</div>
            <button
              v-for="name in suggestions"
              :key="name"
              type="button"
              class="opt sugg mono"
              @click="pickSuggestion(name)"
            >
              {{ name }}
              <span class="plus">+</span>
            </button>
          </template>

          <!-- The food library's move: a search that finds nothing is the
               moment you already know what you want to call it, so the empty
               result is the create button rather than a dead end. -->
          <button
            v-if="canCreate"
            type="button"
            class="opt create mono"
            @click="createFromQuery"
          >
            + ADD "{{ query.trim().toUpperCase() }}"
          </button>

          <div
            v-if="!matches.length && !suggestions.length && !canCreate"
            class="empty mono"
          >
            NO TYPES YET. TYPE A NAME TO ADD ONE.
          </div>
        </div>

        <button
          v-if="currentTypeId"
          type="button"
          class="clear mono"
          @click="$emit('pick', null)"
        >
          REMOVE THE TYPE
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, ref, onMounted } from "vue";
import { useBackClose } from "@/composables/useBackClose";
import { SUGGESTED_TYPES, useSessionsStore } from "@/stores/sessions";

const props = defineProps({
  currentTypeId: { type: String, default: null },
});
const emit = defineEmits(["close", "pick"]);
useBackClose(() => emit("close"));

const store = useSessionsStore();
const query = ref("");
const searchEl = ref(null);

// Not autofocused. On the phone that throws the keyboard up over the list, and
// the common case is picking one of three existing types, not typing a new one.
onMounted(() => nextTick());

/**
 * Every word has to appear somewhere in the name, in any order - the same rule
 * the food library search uses, so "out climb" finds "Outdoor Climbing" while
 * "climb gym" narrows to nothing rather than widening to both.
 */
const matches = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return store.activeTypes;
  return store.activeTypes.filter((t) => {
    const name = t.name.toLowerCase();
    return terms.every((term) => name.includes(term));
  });
});

/** Every name you already hold, archived ones included, lowercased. */
const ownedNames = computed(
  () => new Set(store.types.map((t) => t.name.toLowerCase()))
);

/**
 * Suggestions you have not already got, matched by the same rule as your own
 * types so one query filters both halves of the list together.
 *
 * Archived types count as owned. Someone who archived Gym on purpose should not
 * be offered it back under a different heading on the next open.
 */
const suggestions = computed(() => {
  const terms = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return SUGGESTED_TYPES.filter((name) => {
    if (ownedNames.value.has(name.toLowerCase())) return false;
    if (!terms.length) return true;
    const lower = name.toLowerCase();
    return terms.every((term) => lower.includes(term));
  });
});

const canCreate = computed(() => {
  const trimmed = query.value.trim().toLowerCase();
  if (!trimmed) return false;
  // Against the suggestions too, or typing "yoga" offers both the suggestion
  // and + ADD "YOGA", which are the same act described twice.
  if (suggestions.value.some((name) => name.toLowerCase() === trimmed)) return false;
  return !store.activeTypes.some((t) => t.name.toLowerCase() === trimmed);
});

function createFromQuery() {
  const created = store.addType(query.value);
  if (created) emit("pick", created.id);
}

/**
 * Adds it and picks it in one tap. `addType` already returns an existing type
 * rather than duplicating, and un-archives it, so this is safe even if the
 * ownership check above is ever loosened.
 */
function pickSuggestion(name) {
  const created = store.addType(name);
  if (created) emit("pick", created.id);
}

// Enter picks the only match if there is exactly one, and otherwise creates.
// Typing a full name and pressing enter should not need a second decision.
function onEnter() {
  if (matches.value.length === 1) {
    emit("pick", matches.value[0].id);
    return;
  }
  // A lone suggestion counts as the one match. Typing "swim" and pressing enter
  // should not create a second type called "swim" beside the Swimming sitting
  // right there on screen.
  if (!matches.value.length && suggestions.value.length === 1) {
    pickSuggestion(suggestions.value[0]);
    return;
  }
  if (canCreate.value) createFromQuery();
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
  max-height: 80%;
  overflow-y: auto;
  background: var(--bg1);
  border-top: 1px solid color-mix(in srgb, var(--acc) 30%, transparent);
  padding: 16px 18px calc(20px + env(safe-area-inset-bottom));
  color: var(--body);
  font-family: var(--font-sans);
}
.search {
  width: 100%;
  margin-top: 12px;
  padding: 12px 13px;
  min-height: 46px;
  background: color-mix(in srgb, var(--acc) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--acc) 30%, transparent);
  border-radius: 7px;
  color: var(--ink);
  font-size: 14px;
  letter-spacing: 1px;
}
.search::placeholder {
  color: var(--dim);
  letter-spacing: 1.4px;
  font-size: 12px;
}
.search:focus {
  outline: none;
  border-color: var(--acc);
}
.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 12px;
}
.opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 50px;
  padding: 13px 12px;
  background: none;
  border: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--dim) 14%, transparent);
  color: var(--body);
  font-size: 14px;
  letter-spacing: 0.6px;
  text-align: left;
  cursor: pointer;
}
.opt.on {
  color: var(--fam-activity);
}
.opt.create {
  color: var(--fam-activity);
  letter-spacing: 1.4px;
  font-size: 12.5px;
}
/* Dimmer than your own types, because these are not yours yet. The heading
   carries the whole distinction, so the rows themselves stay the same shape. */
.sugghd {
  margin-top: 16px;
  padding: 0 2px 6px;
  font-size: 10.5px;
  letter-spacing: 1.8px;
  color: var(--dim);
}
.opt.sugg {
  color: var(--dim);
}
.plus {
  color: var(--fam-activity);
  font-size: 15px;
}
.opt:focus-visible {
  outline: 2px solid var(--acc);
  outline-offset: -2px;
}
.tick {
  color: var(--fam-activity);
}
.empty {
  padding: 18px 2px;
  font-size: 12.5px;
  letter-spacing: 1px;
  color: var(--dim);
}
.clear {
  margin-top: 14px;
  width: 100%;
  min-height: 46px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 40%, transparent);
  border-radius: 7px;
  color: var(--dim);
  font-size: 11.5px;
  letter-spacing: 1.8px;
  cursor: pointer;
}
</style>
