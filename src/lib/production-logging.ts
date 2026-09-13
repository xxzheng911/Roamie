/**
 * Keep production WebView consoles focused on actionable warnings and errors.
 * Development builds retain all existing diagnostic traces.
 */
if (import.meta.env.PROD && typeof window !== "undefined") {
  const noop = (): void => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
}
