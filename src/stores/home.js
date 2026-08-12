import { defineStore } from "pinia";
import { ref } from "vue";
import { load, persist } from "@/utils/storage";
import { DEFAULT_DIALS, DIAL_COUNT } from "@/components/home/dialModel";

const KEY = "atlas_home_layout";

/**
 * What Home is made of, as far as the user gets a say in it.
 *
 * Today that is the three dials and nothing else: the wider modular-Home work
 * (reorder and hide the cards) is parked, and this is deliberately shaped to
 * grow into it rather than being a store for one array. Its stored record is a
 * layout, so adding a `cards` list later needs no migration.
 */
export const useHomeStore = defineStore("home", () => {
  const stored = load(KEY, {});
  const dials = ref(
    Array.isArray(stored.dials) && stored.dials.length ? stored.dials : [...DEFAULT_DIALS]
  );

  const save = () => persist(KEY, { ...stored, dials: dials.value });

  /**
   * Replace one slot. Picking something already on screen swaps the two rather
   * than showing it twice, since three rings of the same metric is never what
   * anybody meant and a silent refusal reads as the tap not registering.
   */
  function setDial(index, key) {
    if (index < 0 || index >= DIAL_COUNT) return;
    const next = [...dials.value];
    const existing = next.indexOf(key);
    if (existing !== -1 && existing !== index) next[existing] = next[index];
    next[index] = key;
    dials.value = next;
    save();
  }

  function resetDials() {
    dials.value = [...DEFAULT_DIALS];
    save();
  }

  return { dials, setDial, resetDials };
});
