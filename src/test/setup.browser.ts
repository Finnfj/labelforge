/**
 * Tells React that `act()` is legitimate here. Without it React logs a warning
 * on every render and, more importantly, does not flush effects synchronously,
 * which would make component tests race against their own mounting.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export {}
