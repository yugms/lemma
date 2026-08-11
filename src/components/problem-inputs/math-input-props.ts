/**
 * What a phone keyboard has to be told before it can be used to type maths.
 *
 * `autoCapitalize="none"` is the load-bearing one, and it is a grading fix
 * rather than a nicety: iOS capitalises the first letter of a text field, and
 * `normalizeMath` deliberately does not fold case — variables are
 * case-sensitive, and it says so. So a student who typed a correct `x^2 + 1`
 * submitted `X^2 + 1` and was marked wrong for it, with nothing on either
 * side of the wire to suggest the answer had been altered on the way out.
 *
 * `autoCorrect`/`spellCheck` off because iOS otherwise rewrites `sqrt` into a
 * word, and `enterKeyHint="go"` because the card submits on Enter and the key
 * should say so — on a phone that return key is the shortest path to an
 * answer, and by default it reads "return" and looks like a newline.
 *
 * Shared rather than repeated so a new answer format cannot quietly ship
 * without it; every `.field` a student types maths into spreads this.
 */
export const MATH_INPUT_PROPS = {
  inputMode: "text",
  enterKeyHint: "go",
  autoCapitalize: "none",
  autoCorrect: "off",
  autoComplete: "off",
  spellCheck: false,
} as const;
