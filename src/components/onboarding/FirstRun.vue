<template>
  <!-- Covers everything: there is nothing useful to do behind it, and the boot
       sequence should not play to someone the app has never met. -->
  <div class="firstrun grid-bg">
    <div class="inner">
      <!-- Above the wordmark and always in the same spot, so it does not move
           between steps. Absent on the first, where there is nothing behind it:
           a disabled BACK is a control that looks broken.

           **The drafts are refs that outlive the step**, so going back and
           forward again finds what you typed still there. Nothing is committed
           until its own step's button, apart from the strap, which cannot be
           uncommitted and is why BACK does not undo a connect. -->
      <button v-if="canGoBack && !helio.busy" class="frback mono" type="button" @click="back">
        ‹ BACK
      </button>
      <!-- **Hidden while the strap is being paired**, along with the question and
           the LATER button below. `StrapConnect` shows the wordmark itself once it
           starts working, so leaving this one up stacked two ATLASes, and a
           question you can no longer answer is just noise above a progress bar.
           The condition is `helio.busy` rather than a local copy, so this and the
           panel cannot disagree by a frame. -->
      <div v-if="!helio.busy" class="logo">ATLAS</div>

      <!-- **First, before the name, and pairing happens here rather than in
           settings.** The strap is what makes the rest of the app say anything:
           without it Recovery, sleep and every vital have nothing to read, and a
           first run that asked for a name before mentioning it left people at a
           Home screen of empty rings with no idea why.

           `StrapConnect` is the same component the settings panel uses, not a
           copy - two sets of instructions, two validators and two pairs of
           failure messages would be two things to keep in step. -->
      <template v-if="step === 'strap'">
        <p v-if="!helio.busy" class="lead">Do you have an Amazfit Helio Strap?</p>
        <p v-if="!helio.busy" class="hint mono">IT NEEDS A PAIRING KEY, ONCE.</p>
        <div class="strapbox">
          <StrapConnect @connected="go('name')" />
        </div>
        <!-- Gone while it works, not disabled. A first connect runs for minutes
             and LATER, FROM SETTINGS is an escape hatch from a decision that has
             already been made; leaving it there invites a tap that would strand a
             half-finished import behind the next step. -->
        <div v-if="!helio.busy" class="btns">
          <button class="btn" @click="go('name')">LATER, FROM SETTINGS</button>
        </div>
      </template>

      <template v-else-if="step === 'name'">
        <p class="lead">What should Atlas call you?</p>
        <input
          ref="nameInput"
          v-model="draft"
          class="field"
          type="text"
          autocomplete="name"
          placeholder="Your name"
          maxlength="40"
          @keyup.enter="next"
        />
        <p class="hint mono">
          USED FOR THE INITIALS IN THE HEADER. STORED ON THIS PHONE ONLY.
        </p>
        <div class="btns">
          <button class="btn primary" @click="next">
            {{ draft.trim() ? "CONTINUE" : "SKIP" }}
          </button>
        </div>
      </template>

      <template v-else-if="step === 'dob'">
        <p class="lead">When were you born?</p>
        <input
          ref="dobInput"
          v-model="dobDraft"
          class="field"
          type="date"
          :max="today"
          min="1900-01-01"
        />
        <p class="hint mono">
          SO AGE-BASED COMPARISONS MEAN SOMETHING. YOUR RECOVERY AND SLEEP SCORES
          DO NOT USE IT: THOSE JUDGE YOU AGAINST YOUR OWN BASELINE, NOT A
          POPULATION.
        </p>
        <div class="btns">
          <button class="btn primary" @click="nextFromDob">
            {{ dobDraft ? "CONTINUE" : "SKIP" }}
          </button>
        </div>
      </template>

      <!-- Only asked when a date of birth was given, because it exists solely to
           sharpen an age comparison that cannot happen without one. Asking
           anyway would be collecting something for nothing. -->
      <template v-else-if="step === 'sex'">
        <p class="lead">Were you born male or female?</p>
        <div class="sexrow">
          <button
            v-for="opt in ['male', 'female']"
            :key="opt"
            class="btn sexbtn"
            :class="{ on: sexDraft === opt }"
            type="button"
            @click="sexDraft = sexDraft === opt ? '' : opt"
          >
            {{ opt.toUpperCase() }}
          </button>
        </div>
        <p class="hint mono">
          RESTING HEART RATE NORMS DIFFER BY SEX BY A FEW BEATS IN EVERY AGE BAND.
          WITHOUT IT THE COMPARISON USES THE MIDPOINT OF BOTH AND SAYS SO.
        </p>
        <div class="btns">
          <button class="btn primary" @click="nextFromSex">
            {{ sexDraft ? "CONTINUE" : "SKIP" }}
          </button>
        </div>
      </template>

      <!-- **Height and weight together, because they answer one question.**
           Neither is useful alone: the fitness age needs body size, and body
           size is the two of them. Asking them on separate screens would make a
           four-step first run feel like a form.

           Height is asked once and never again, which is exactly what makes it
           acceptable where a waist measurement was not: a waist has to be
           re-taken with a tape every few months forever, and the rule set here
           is that Atlas does not ask for repeated physical measurements. Weight
           IS re-recorded, but through the body metrics you were already going to
           keep, not through a reminder from this. -->
      <template v-else-if="step === 'body'">
        <p class="lead">How tall are you?</p>
        <div class="bodyrow">
          <!-- Feet and inches is two fields, not one, because that is how the
               number exists: 5'10" is not five point something. This is the one
               place the unit choice changes a control rather than a suffix. -->
          <label v-if="heightUnit === 'ftin'" class="bodyfield">
            <span class="blabel mono">HEIGHT</span>
            <span class="binput ftin">
              <input
                ref="heightInput"
                v-model="feetDraft"
                class="field"
                type="number"
                inputmode="numeric"
                min="3"
                max="7"
                placeholder="5"
              />
              <span class="bunit mono">FT</span>
              <input
                v-model="inchesDraft"
                class="field"
                type="number"
                inputmode="numeric"
                min="0"
                max="11"
                placeholder="10"
              />
              <span class="bunit mono">IN</span>
            </span>
          </label>
          <label v-else class="bodyfield">
            <span class="blabel mono">HEIGHT</span>
            <span class="binput">
              <input
                ref="heightInput"
                v-model="heightDraft"
                class="field"
                type="number"
                inputmode="numeric"
                min="120"
                max="230"
                placeholder="178"
              />
              <span class="bunit mono">CM</span>
            </span>
          </label>
          <label class="bodyfield">
            <span class="blabel mono">WEIGHT</span>
            <span class="binput">
              <input
                v-model="weightDraft"
                class="field"
                type="number"
                inputmode="decimal"
                min="30"
                max="300"
                step="0.1"
                :placeholder="weightUnit === 'kg' ? '78' : '172'"
              />
              <span class="bunit mono">{{ weightUnitLabel }}</span>
            </span>
          </label>
        </div>
        <p class="hint mono">
          FOR A FITNESS AGE: HOW YOUR HEART AND BODY COMPARE WITH OTHERS YOUR
          AGE. HEIGHT IS ASKED ONCE. WEIGHT YOU CAN UPDATE WHENEVER YOU LIKE.
        </p>
        <div class="btns">
          <button class="btn primary" @click="nextFromBody">
            {{ heightDraft || weightDraft ? "CONTINUE" : "SKIP" }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="avatar">{{ profile.initials }}</div>
        <p class="lead">
          <template v-if="profile.name">Hello, {{ firstName }}.</template>
          <template v-else>Ready.</template>
        </p>
        <!-- Where everything asked above can be changed, said once and plainly.
             Without it every skip on the way here is a decision that feels
             permanent, and the questions get answered carefully rather than
             quickly.

             **The strap half only shows when there is no strap.** Telling
             somebody who has just connected one to go and connect one is the
             kind of line that makes the rest of the screen read as boilerplate
             nobody checked. -->
        <p class="hint mono">
          <template v-if="!helio.connected"
            >CONNECT THE STRAP TO PULL IN YOUR DATA. EVERYTHING YOU JUST
            ANSWERED, AND YOUR GOALS AND UNITS, CAN BE CHANGED IN SETTINGS
            WHENEVER YOU LIKE.</template
          >
          <template v-else
            >YOU CAN CHANGE ANYTHING IN SETTINGS WHENEVER YOU LIKE.</template
          >
        </p>
        <div class="btns">
          <button class="btn primary" @click="finish">START</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useProfileStore } from "@/stores/profile";
import { useCheckinStore } from "@/stores/checkin";
import { useUnitsStore } from "@/stores/units";
import StrapConnect from "@/components/settings/StrapConnect.vue";
import { useHelioStore } from "@/stores/helio";
import { heightToCm, weightToKg } from "@/utils/unitConvert";

const profile = useProfileStore();
const checkin = useCheckinStore();
const units = useUnitsStore();
const helio = useHelioStore();

// Starts on the strap rather than the name: see the template.
const step = ref("strap");
const draft = ref(profile.name);
const dobDraft = ref(profile.dob);
const nameInput = ref(null);
const dobInput = ref(null);
const sexDraft = ref(profile.sex);
const heightInput = ref(null);
const heightDraft = ref(profile.heightCm ?? "");
const weightDraft = ref("");
const feetDraft = ref("");
const inchesDraft = ref("");

const heightUnit = computed(() => units.values.height);
const weightUnit = computed(() => units.values.weight);
// Stones is typed in pounds and displayed split, since a stone-and-pound entry
// would need two fields for a number people mostly know as one.
const weightUnitLabel = computed(() =>
  weightUnit.value === "kg" ? "KG" : weightUnit.value === "st" ? "LB" : "LB"
);

/** No future birthdays, and the native picker enforces it rather than a message. */
const today = new Date().toISOString().slice(0, 10);

const firstName = computed(() => profile.name.trim().split(/\s+/)[0]);

onMounted(async () => {
  await nextTick();
  nameInput.value?.focus();
});

/**
 * Where you came from, so BACK works.
 *
 * A trail rather than a fixed order, because the route is conditional: skipping
 * the date of birth skips the sex and body steps with it, so "the step before
 * this one" is a property of the path taken and not of the step.
 */
const trail = ref([]);
const canGoBack = computed(() => trail.value.length > 0);

function go(to) {
  trail.value.push(step.value);
  step.value = to;
}

function back() {
  const prev = trail.value.pop();
  if (prev) step.value = prev;
}

function next() {
  profile.setName(draft.value);
  go("dob");
  nextTick(() => dobInput.value?.focus());
}

function nextFromDob() {
  profile.setDob(dobDraft.value);
  // Straight past the sex question when there is no date of birth: it exists
  // only to sharpen an age comparison, and without an age there is none.
  go(dobDraft.value ? "sex" : "done");
}

function nextFromSex() {
  profile.setSex(sexDraft.value);
  // Body size only where there is an age to compare it against, the same rule
  // the sex question follows one step earlier. Height and weight feed a fitness
  // age and nothing else, and a fitness age needs a date of birth.
  go(dobDraft.value ? "body" : "done");
  nextTick(() => heightInput.value?.focus());
}

function nextFromBody() {
  // Converted here, once, on the way in. Both fields are stored metric like
  // everything else in Atlas, so nothing downstream has to know what was typed.
  const cm =
    heightUnit.value === "ftin"
      ? heightToCm(feetDraft.value, inchesDraft.value, "ftin")
      : Number(heightDraft.value) || null;
  if (cm) profile.setHeight(cm);

  // Straight onto today's entry rather than into the profile: weight is a
  // reading that changes, and every other reading in Atlas lives on a dated
  // checkin. Putting a starting weight in the profile would create a second
  // place to keep it and the two would drift.
  // Stones is a *display* choice. Typing it would need two fields for a number
  // most people know as one, so the field takes pounds and the readout splits
  // it: 182 in, 13ST 0LB back out.
  const typedIn = weightUnit.value === "st" ? "lb" : weightUnit.value;
  const kg = weightToKg(weightDraft.value, typedIn);
  if (Number.isFinite(kg) && kg >= 30 && kg <= 300) {
    checkin.logMetric({ weight: kg });
  }
  go("done");
}

function finish() {
  profile.completeOnboarding();
}
</script>

<style scoped>
.frback {
  align-self: flex-start;
  min-height: 40px;
  padding: 0 2px;
  background: none;
  border: 0;
  color: var(--dim);
  font-size: 13.5px;
  letter-spacing: 1.8px;
  cursor: pointer;
}

/* The pairing block gets a box of its own, so it reads as the task on this
   screen rather than as more of the paragraph above it. Scrolls, because the
   instructions plus a field is taller than a phone with the keyboard up. */
.strapbox {
  width: 100%;
  max-width: 340px;
  max-height: 52vh;
  overflow-y: auto;
  padding: 4px 14px 14px;
  background: var(--panel, color-mix(in srgb, var(--acc) 4%, transparent));
  border: 1px solid color-mix(in srgb, var(--dim) 30%, transparent);
  border-radius: 10px;
  text-align: left;
}

/* Stacked, not a row like the sex buttons: each one carries a second line
   naming the four units it sets, and three of those side by side on a phone
   would wrap to two words a line. The sub-line is the whole point of offering
   presets at all - METRIC and IMPERIAL mean different things to different
   people, and "KG · CM · KM · °C" cannot be misread. */
.unitcol {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 320px;
}
.unitbtn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 11px 14px;
  min-height: 52px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--dim) 45%, transparent);
  border-radius: 8px;
  color: var(--body);
  cursor: pointer;
  text-align: left;
}
.unitbtn.on {
  border-color: var(--acc);
  background: color-mix(in srgb, var(--acc) 10%, transparent);
}
.unitbtn .uname {
  font-size: 14px;
  letter-spacing: 1.6px;
  color: var(--ink);
}
.unitbtn.on .uname {
  color: var(--acc);
}
.unitbtn .usub {
  font-size: 13px;
  letter-spacing: 1.2px;
  color: var(--dim);
}
/* Two numbers and two suffixes on one line, so the fields shrink to fit rather
   than the row wrapping under a label that then belongs to nothing. */
.binput.ftin {
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.binput.ftin .field {
  width: 46px;
  min-width: 0;
}
.sexrow {
  display: flex;
  gap: 10px;
  width: 100%;
  max-width: 320px;
}
.bodyrow {
  display: flex;
  gap: 10px;
  width: 100%;
  max-width: 320px;
}
.bodyfield {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.blabel {
  font-size: 13px;
  letter-spacing: 1.4px;
  color: var(--dim);
}
/* The unit rides inside the field rather than in the label, so what is typed
   and what it is measured in read as one thing. */
.binput {
  position: relative;
  display: block;
}
.binput .field {
  width: 100%;
  padding-right: 34px;
}
/* Same reasoning as the settings copy: the spinners are noise on a field whose
   unit is fixed, and on Android they take a third of the width. */
.binput .field::-webkit-outer-spin-button,
.binput .field::-webkit-inner-spin-button {
  appearance: none;
  margin: 0;
}
.binput .field[type="number"] {
  appearance: textfield;
  -moz-appearance: textfield;
}
.bunit {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  letter-spacing: 1.2px;
  color: var(--dim);
  pointer-events: none;
}
.sexbtn {
  flex: 1;
}
.sexbtn.on {
  color: var(--bg1);
  background: var(--acc);
  border-color: var(--acc);
}
.firstrun {
  position: fixed;
  inset: 0;
  z-index: 700;
  background: var(--bg1);
  color: var(--body);
  font-family: var(--font-sans);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: calc(24px + env(safe-area-inset-top)) 26px
    calc(24px + env(safe-area-inset-bottom));
}
.inner {
  width: 100%;
  max-width: 340px;
}
.logo {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 9px;
  color: var(--acc);
  margin-bottom: 34px;
}
.lead {
  font-size: 20px;
  color: var(--ink);
  margin: 0 0 16px;
}
.field {
  width: 100%;
  box-sizing: border-box;
  padding: 11px 12px;
  background: var(--bg0);
  border: 1px solid var(--dim);
  color: var(--ink);
  font-family: inherit;
  font-size: 18px;
}
.field:focus {
  outline: none;
  border-color: var(--acc);
}
.hint {
  font-size: 13px;
  letter-spacing: 1px;
  line-height: 1.7;
  color: var(--dim);
  margin: 12px 0 0;
}
.btns {
  display: flex;
  margin-top: 26px;
}
.btn {
  flex: 1;
  /* 48dp minimum touch target. */
  min-height: 48px;
  background: transparent;
  border: 1px solid var(--dim);
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 13.5px;
  letter-spacing: 2px;
  cursor: pointer;
}
.btn.primary {
  border-color: var(--acc);
  color: var(--acc);
}
.avatar {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  background: var(--acc);
  color: var(--bg1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 20px;
  margin-bottom: 20px;
}
</style>
