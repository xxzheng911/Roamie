#!/usr/bin/env node
// Input is a sanitized generationDiagnostic object, not a raw exception/payload.
// Keep dist/server (including hidden .map files) with the deployed Worker version.
// Usage: node scripts/symbolicate-itinerary-diagnostic.mjs diagnostic.json dist/server
// Query the existing sinks with a UUID, never a raw client-supplied string:
// Supabase:
// SELECT metadata->'generationDiagnostic' FROM analytics_events
// WHERE metadata->'generationDiagnostic'->>'generationId' = '<UUID>'
// ORDER BY occurred_at DESC LIMIT 10;
// Analytics Engine (short time range + sampling index; inspect _sample_interval):
// SELECT timestamp, _sample_interval, blob9 FROM ABUSE_GUARD_ANALYTICS
// WHERE index1 = 'itinerary:<UUID>' AND blob1 = 'itinerary_diagnostic_v1'
// AND timestamp > NOW() - INTERVAL '1' DAY ORDER BY timestamp DESC LIMIT 10;
// AE has a shared 250-point/invocation ceiling. Supabase metadata is the durable
// terminal sink; AE is independent of fetch. Neither can guarantee delivery after
// isolate termination or simultaneous sink failures. Do not infer success from absence.
import { readFileSync, existsSync } from "node:fs";
import { SourceMap } from "node:module";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export function symbolicateDiagnostic(diagnostic, artifactDirectory) {
  const root = resolve(artifactDirectory);
  const result = structuredClone(diagnostic);
  const mapException = (exception) => {
    if (!exception) return;
    exception.sourceFrames = (exception.stack ?? []).slice(0, 6).map((frame) => {
      const match = /^(?:assets\/)?[\w.-]+\.[cm]?js:\d+:\d+$/.test(frame)
        ? frame.match(/^(.*):(\d+):(\d+)$/)
        : null;
      if (!match) return { generated: frame, mapped: false };
      const mapPath = resolve(root, match[1] + ".map");
      if (!mapPath.startsWith(root + sep) || !existsSync(mapPath)) {
        return { generated: frame, mapped: false };
      }
      const map = new SourceMap(JSON.parse(readFileSync(mapPath, "utf8")));
      const entry = map.findEntry(Number(match[2]) - 1, Number(match[3]) - 1);
      const source = entry.originalSource?.split("?")[0].match(/(?:^|\/)(src\/[\w./-]+)$/)?.[1];
      return source
        ? {
            generated: frame,
            mapped: true,
            source,
            line: entry.originalLine + 1,
            column: entry.originalColumn + 1,
          }
        : { generated: frame, mapped: false };
    });
    mapException(exception.cause);
  };
  for (const failure of [result.primary, result.cleanup, ...(result.optional ?? [])]) {
    mapException(failure?.exception);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [file, directory] = process.argv.slice(2);
  if (!file || !directory)
    throw new Error("Usage: symbolicate-itinerary-diagnostic.mjs diagnostic.json dist/server");
  console.log(
    JSON.stringify(
      symbolicateDiagnostic(JSON.parse(readFileSync(file, "utf8")), directory),
      null,
      2,
    ),
  );
}
