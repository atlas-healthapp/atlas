/**
 * What the tour points at, in order.
 *
 * **The first step is the one this was built for.** Settings live behind the
 * initials in the top right, which is not a thing anybody guesses, and every
 * goal, unit and dial choice is behind it. Nothing else in the app can say so:
 * a contextual prompt only appears on a screen you have already found.
 *
 * All on Home, deliberately. A tour that walked between tabs would need to drive
 * navigation, and a step landing on a tab mid-transition points at a moving
 * target. The two things worth knowing about the other tabs are the tab bar and
 * the create button, and both are visible from here.
 *
 * Selectors are the contract. **Anything renaming one of these classes breaks a
 * step silently**, which is why `Tour.vue` skips a step whose target is missing
 * rather than pointing at nothing - a broken tour should lose a step, not put a
 * hole in the middle of the screen.
 */
export const TOUR_STEPS = [
  {
    target: ".chip",
    radius: "50%",
    pad: 8,
    title: "SETTINGS ARE HERE",
    body: "Your initials open the settings page. Goals, units, which rings show on this screen, the strap and your backup all live behind it.",
  },
  {
    target: ".dials",
    title: "THE THREE RINGS",
    body: "Recovery, sleep and steps to begin with. You can swap any of them for calories, protein, water, PAI or your routine in settings.",
  },
  {
    // Several selectors, so the hole spans the cards rather than one row: the
    // point is that all of this is tappable, and highlighting a single line
    // said the opposite about everything around it.
    target: ".verdictrow, .card:nth-of-type(2), .card:nth-of-type(3)",
    pad: 8,
    title: "EVERY NUMBER SHOWS ITS WORKING",
    body: "All of this is tappable. Tap a card or a row and you get the page behind it: what was measured, what it was compared against, and why it scored what it did.",
  },
  {
    target: ".fab-core",
    radius: "50%",
    pad: 10,
    title: "ADD THINGS HERE",
    body: "Food and activities are added from this button, wherever you are in the app.",
  },
  {
    target: ".nav",
    pad: 4,
    title: "FOUR TABS",
    body: "Home answers how you are doing. Food is your day's eating, Body is everything the strap records, and Fitness is your training.",
  },
];
