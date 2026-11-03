// Tester helper: run an existing verify script whose top-level `await`/`assert` failure makes
// vite-node hang silently in this environment, and print the uncaught error instead.
// Does not change the target script or its assertions; only surfaces its first uncaught error.
//
// Run: npx vite-node scripts/verify-tester-toplevel-error-wrapper.mjs --config scripts/vite.verify.config.mjs -- <target>.mjs
for (const s of [process.stdout, process.stderr]) s._handle?.setBlocking?.(true);
const target = process.argv.find((a) => /verify-[\w.-]+\.mjs$/.test(a) && !a.includes("tester-toplevel"));
if (!target) {
  console.log("WRAPPER usage: pass a scripts/verify-*.mjs target");
  process.exit(2);
}
const watchdog = setTimeout(() => {
  console.log(`WRAPPER watchdog: ${target} did not finish within 300s`);
  process.exit(3);
}, 300_000);
watchdog.unref();
process.on("unhandledRejection", (e) => {
  console.log("WRAPPER unhandledRejection:", e?.stack ?? String(e));
  process.exit(1);
});
try {
  // Absolute path: vite-node cannot resolve a variable relative specifier.
  const path = new URL(target.replace(/^.*\//, ""), import.meta.url).pathname;
  await import(path);
  console.log(`WRAPPER ${target} module finished; exitCode=${process.exitCode ?? 0}`);
} catch (e) {
  console.log(`WRAPPER uncaught top-level error in ${target}:`);
  console.log((e?.stack ?? String(e)).split("\n").slice(0, 12).join("\n"));
  process.exit(1);
}
