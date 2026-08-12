import { defineStore } from "pinia";
import { computed, reactive, ref, watchEffect } from "vue";
import { load, persist } from "@/utils/storage";
import { PRESETS, SYSTEMS } from "@/utils/unitConvert";

const KEY = "atlas_units";

/**
 * Which units things are shown in. **Four dimensions, and water is not one of
 * them**: litres for everyone, decided rather than overlooked.
 *
 * A preset writes all four; the four are then independently overridable,
 * because presets are a shortcut and not a claim about how people actually
 * measure. Storing the four rather than the preset name is what makes an
 * override possible at all, and means a preset can be added later without a
 * migration.
 */
export const DIMENSIONS = Object.keys(SYSTEMS);

export const useUnitsStore = defineStore("units", () => {
  const stored = load(KEY, {});
  const chosen = ref({ ...PRESETS.metric, ...stored });

  const save = () => persist(KEY, chosen.value);

  /**
   * Read the same way `goals.values` is, and for the same reason: this is
   * consumed by `formatValue`, which is a plain function called from templates
   * all over the app, and a ref would need `.value` in some of those and not
   * others.
   */
  const values = reactive({});
  watchEffect(() => {
    for (const dim of DIMENSIONS) values[dim] = chosen.value[dim];
  });

  function setDimension(dim, system) {
    if (!SYSTEMS[dim]?.includes(system)) return;
    chosen.value = { ...chosen.value, [dim]: system };
    save();
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    chosen.value = { ...preset };
    save();
  }

  /** Which preset the current four match, or null when they are a mixture. */
  const preset = computed(() => {
    for (const [name, p] of Object.entries(PRESETS)) {
      if (DIMENSIONS.every((dim) => chosen.value[dim] === p[dim])) return name;
    }
    return null;
  });

  return { chosen, values, preset, setDimension, applyPreset };
});

/**
 * The chosen system outside a component, where a store may not be active.
 *
 * `formatValue` is a plain function in `metricRegistry`, called by tests that
 * never create a Pinia. Falling back to metric there keeps every existing test
 * meaningful rather than making all of them set up a store.
 */
export function unitFor(dimension) {
  try {
    return useUnitsStore().values[dimension] ?? PRESETS.metric[dimension];
  } catch {
    return PRESETS.metric[dimension];
  }
}
