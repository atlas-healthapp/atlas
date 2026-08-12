import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { load, persist } from "@/utils/storage";

// Who the app belongs to. Local only: there is no account and no server, so
// this is a name Atlas addresses you by, not an identity it authenticates.
// Kept in its own store because the header, the settings page and first-run all
// read it, and because a sync backend later would replace the source of these
// fields without touching any of those consumers.
const KEY = "atlas_profile";

export const useProfileStore = defineStore("profile", () => {
  const stored = load(KEY, null);

  const name = ref(stored?.name ?? "");
  /**
   * Date of birth as `YYYY-MM-DD`, or "" if never given.
   *
   * Asked for at first run because two things need it and neither can ask later
   * without feeling like an interrogation: an age-referenced resting heart rate
   * comparison, and the biological-age figure. **Nothing scores against it yet**,
   * and Recovery deliberately does not: its vitals are judged against your own
   * baseline, not a population. See docs/backlog.md.
   */
  const dob = ref(stored?.dob ?? "");

  /**
   * "male", "female", or "" when not given.
   *
   * Asked for the same reason and at the same moment as date of birth, and for
   * one purpose only: resting heart rate norms differ by sex by several beats in
   * every age band, so without it the age comparison has to use the midpoint of
   * the two tables and say it is approximate.
   *
   * Skippable, and nothing else reads it. Two options plus skip rather than a
   * longer list, because the published tables this feeds have two columns and
   * offering categories the data cannot honour would be a promise Atlas cannot
   * keep.
   */
  const sex = ref(stored?.sex ?? "");

  /**
   * Height in centimetres, or null.
   *
   * **A fact, not a measurement, which is the whole reason it is here and a
   * waist circumference is not.** The fitness age needs a body-size term. The
   * model it is built on offers two forms: waist, which is more accurate but has
   * to be re-taken with a tape every few months forever, and BMI, which needs
   * only this typed once and the weight already being recorded. The user's call
   * was that Atlas may not ask for repeated physical measurements, and a height
   * asked once beside a date of birth is not one.
   *
   * The cost is real and is written down rather than hidden: BMI cannot tell
   * muscle from fat, so on a heavily built body it reports a worse figure than
   * the waist form would. See `docs/backlog.md`.
   */
  const heightCm = ref(stored?.heightCm ?? null);
  // Separate from "has a name": someone can skip the question and still be
  // through onboarding, and asking again every launch would be worse than
  // showing a blank chip.
  const onboarded = ref(stored?.onboarded ?? false);

  function _save() {
    persist(KEY, {
      name: name.value,
      dob: dob.value,
      sex: sex.value,
      heightCm: heightCm.value,
      onboarded: onboarded.value,
    });
  }

  /**
   * Range-checked rather than trusted, because a typed height is the one input
   * here nothing else can sanity check. 120 to 230 cm covers every adult; a
   * figure outside it is a slip (a height in inches, or a stray digit) and
   * storing it would put a fitness age decades out with nothing on screen to
   * explain why.
   */
  function setHeight(cm) {
    const n = Number(cm);
    heightCm.value = Number.isFinite(n) && n >= 120 && n <= 230 ? Math.round(n) : null;
    _save();
  }

  /**
   * First letters of the first and last words: "Ada Lovelace" gives AL, a
   * single "Josh" gives J. Falls back to a dash rather than empty so the chip
   * keeps its shape and stays a visible tap target with no name set.
   */
  const initials = computed(() => {
    const parts = name.value.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "–";
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  });

  function setName(value) {
    name.value = (value ?? "").trim();
    _save();
  }

  /** Only the two the norm tables have columns for, or "" to clear it. */
  function setSex(value) {
    sex.value = value === "male" || value === "female" ? value : "";
    _save();
  }

  function setDob(value) {
    // Stored as given or cleared entirely; a half-parsed date is worse than none.
    dob.value = /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") ? value : "";
    _save();
  }

  /**
   * Whole years, or null with no date of birth.
   *
   * Computed rather than stored, because an age stored on the day it was asked
   * for is wrong within a year and nothing would ever correct it.
   */
  const age = computed(() => {
    if (!dob.value) return null;
    const born = new Date(`${dob.value}T00:00:00`);
    if (Number.isNaN(born.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - born.getFullYear();
    const beforeBirthday =
      now.getMonth() < born.getMonth() ||
      (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
    if (beforeBirthday) years -= 1;
    return years >= 0 && years < 130 ? years : null;
  });

  function completeOnboarding() {
    onboarded.value = true;
    _save();
  }

  return {
    name,
    initials,
    dob,
    sex,
    heightCm,
    age,
    onboarded,
    setName,
    setDob,
    setSex,
    setHeight,
    completeOnboarding,
  };
});
