<template>
  <div>
    <div v-if="refreshPrompt" class="panel confirm-panel">
      <div class="dim-text mono">
        THIS ITEM IS USED IN {{ refreshPrompt.count }} ALREADY-LOGGED
        ENTR{{ refreshPrompt.count === 1 ? "Y" : "IES" }}. UPDATE THOSE TO THE
        NEW NUMBERS TOO?
      </div>
      <div class="scanrow">
        <button class="scanbtn mono" @click="declineRefresh">
          NO, FUTURE ONLY
        </button>
        <button class="save mono" @click="confirmRefresh">
          YES, UPDATE ALL
        </button>
      </div>
    </div>

    <button class="addbtn mono" @click="openAdd()">+ ADD TO LIBRARY</button>

    <div class="panel" v-if="quickAccess.length">
      <div class="panel-hd">
        <span>QUICK ACCESS</span><span>MOST LOGGED</span>
      </div>
      <LibraryRow
        v-for="m in quickAccess"
        :key="m.id"
        :item="m"
        @edit="openEdit(m)"
      />
    </div>
    <div class="panel" v-if="allItems.length">
      <div class="panel-hd">
        <span>LIBRARY // A-Z</span><span>{{ allItems.length }}</span>
      </div>
      <template v-for="letter in letters" :key="letter">
        <div class="indexletter mono">{{ letter }}</div>
        <LibraryRow
          v-for="m in grouped[letter]"
          :key="m.id"
          :item="m"
          :max-protein="maxProtein"
          @edit="openEdit(m)"
        />
      </template>
    </div>
    <div class="panel" v-if="!food.library.length">
      <div class="panel-hd"><span>LIBRARY EMPTY</span></div>
      <div class="emptyrow dim-text mono">
        ADD YOUR REGULAR MEALS ABOVE TO START BUILDING TODAY'S PLAN.
      </div>
    </div>

    <ItemFormSheet
      v-if="formOpen"
      :item="editingItem"
      :auto-scan="autoScan"
      @close="formOpen = false"
      @saved="onFormSaved"
    />
  </div>
</template>

<script setup>
// Logging happens exclusively through the Food tab's shared FAB (ADD FOOD)
// now, not from a per-row LOG button here - a flat accent-filled LOG button
// sitting near the FAB (Atlas is one-accent-does-everything, see DESIGN.md)
// made the FAB read as just another same-colored button instead of the one
// elevated control. Every row here just opens edit.
import { computed, ref } from "vue";
import { useFoodStore } from "@/stores/food";
import LibraryRow from "./LibraryRow.vue";
import ItemFormSheet from "./ItemFormSheet.vue";

const food = useFoodStore();

const formOpen = ref(false);
const editingItem = ref(null); // item being edited, null = adding new
const autoScan = ref(false); // opens ItemFormSheet straight into the scanner
const refreshPrompt = ref(null); // { itemId, count } while the opt-in fix prompt is showing

function openAdd(scan = false) {
  editingItem.value = null;
  autoScan.value = scan;
  formOpen.value = true;
}
function openEdit(item) {
  editingItem.value = item;
  autoScan.value = false;
  formOpen.value = true;
}
function onFormSaved({ editingId, count }) {
  formOpen.value = false;
  if (editingId && count > 0) {
    refreshPrompt.value = { itemId: editingId, count };
  }
}

// Ingredient-only staples are folded in here too now (previously a separate,
// hidden-by-default panel) - rows are lean enough now that the original
// "don't clutter the main list" reasoning carries less weight.
const allItems = computed(() => food.library);

// Ranked by actual log count, not just "in the library" - a stale item
// scanned once months ago shouldn't crowd out what's actually eaten often.
const quickAccess = computed(() =>
  allItems.value
    .map((item) => ({ item, count: food.logCountForItem(item.id) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((x) => x.item)
);

const grouped = computed(() => {
  const sorted = [...allItems.value].sort((a, b) => a.name.localeCompare(b.name));
  const buckets = {};
  for (const item of sorted) {
    const first = item.name.trim()[0]?.toUpperCase() ?? "#";
    const letter = /[A-Z]/.test(first) ? first : "#";
    (buckets[letter] ??= []).push(item);
  }
  return buckets;
});
const letters = computed(() => Object.keys(grouped.value).sort());

function declineRefresh() {
  refreshPrompt.value = null;
}
function confirmRefresh() {
  food.refreshSnapshotsForItem(refreshPrompt.value.itemId);
  refreshPrompt.value = null;
}
</script>

<style scoped>
.emptyrow {
  padding: 6px 0;
}
.dim-text {
  color: var(--dim);
  font-size: 12.5px;
  font-weight: 400;
}
.confirm-panel {
  margin-bottom: 14px;
}
.confirm-panel .dim-text {
  margin-bottom: 8px;
  line-height: 1.5;
}
.scanrow {
  display: flex;
  gap: 8px;
}
.scanrow .scanbtn {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--fam-intake);
  font-size: 12px;
  letter-spacing: 2px;
  padding: 10px 0;
}
.scanrow .save {
  flex: 2;
  text-align: center;
  font-size: 12px;
  letter-spacing: 2px;
  color: var(--bg1);
  background: var(--fam-intake);
  padding: 10px 0;
}
.addbtn {
  width: 100%;
  text-align: center;
  border: 1px solid color-mix(in srgb, var(--fam-intake) 45%, transparent);
  color: var(--fam-intake);
  font-size: 12px;
  letter-spacing: 2px;
  padding: 12px 0;
  margin-bottom: 14px;
}
.indexletter {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--dim);
  padding: 8px 0 4px;
}
.indexletter:first-child {
  padding-top: 0;
}
</style>
