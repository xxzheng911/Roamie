import assert from "node:assert/strict";
import {
  GOOGLE_MAPS_SERVER_KEY_ENV_NAMES,
  resolveGoogleMapsKeyFromServerEnv,
} from "../src/lib/google-maps-key-resolve.server.ts";
import { createRoamieServerRequestContext } from "../src/lib/server-request-context.ts";

const values = {
  GOOGLE_PLACES_SERVER_API_KEY: "AIza-server-places",
  GOOGLE_MAPS_API_KEY: "AIza-server-maps",
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: "AIza-public-expo",
  VITE_GOOGLE_MAPS_API_KEY: "AIza-public-vite",
};

function resolverFor(environment) {
  return (name) => {
    const value = environment[name];
    return value ? { value, source: "process.env" } : null;
  };
}

function resolveFrom(environment, runtimeEnvironment) {
  return resolveGoogleMapsKeyFromServerEnv(runtimeEnvironment, resolverFor(environment));
}

assert.deepEqual(GOOGLE_MAPS_SERVER_KEY_ENV_NAMES, [
  "GOOGLE_PLACES_SERVER_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "EXPO_PUBLIC_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
]);

assert.deepEqual(resolveFrom(values), {
  key: values.GOOGLE_PLACES_SERVER_API_KEY,
  source: "GOOGLE_PLACES_SERVER_API_KEY",
});
assert.deepEqual(
  resolveFrom({ GOOGLE_PLACES_SERVER_API_KEY: values.GOOGLE_PLACES_SERVER_API_KEY }),
  {
    key: values.GOOGLE_PLACES_SERVER_API_KEY,
    source: "GOOGLE_PLACES_SERVER_API_KEY",
  },
);
assert.deepEqual(
  resolveFrom({
    GOOGLE_MAPS_API_KEY: values.GOOGLE_MAPS_API_KEY,
    EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: values.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
  }),
  {
    key: values.GOOGLE_MAPS_API_KEY,
    source: "GOOGLE_MAPS_API_KEY",
  },
);
assert.deepEqual(resolveFrom({}), { key: null, source: "none" });

const runtimeEnvironment = { GOOGLE_PLACES_SERVER_API_KEY: "AIza-context-places" };
const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
};
const requestContext = createRoamieServerRequestContext(runtimeEnvironment, executionCtx);
assert.equal(requestContext.cloudflareEnv, runtimeEnvironment);
assert.equal(requestContext.executionCtx, executionCtx);
assert.deepEqual(
  resolveGoogleMapsKeyFromServerEnv(requestContext.cloudflareEnv, () => null),
  {
    key: runtimeEnvironment.GOOGLE_PLACES_SERVER_API_KEY,
    source: "GOOGLE_PLACES_SERVER_API_KEY",
  },
);

const runtimeKey = "AIza-runtime-places";
assert.deepEqual(
  resolveFrom(
    { GOOGLE_PLACES_SERVER_API_KEY: "AIza-process-places" },
    { GOOGLE_PLACES_SERVER_API_KEY: runtimeKey },
  ),
  { key: runtimeKey, source: "GOOGLE_PLACES_SERVER_API_KEY" },
);
assert.deepEqual(
  resolveFrom(
    { GOOGLE_MAPS_API_KEY: values.GOOGLE_MAPS_API_KEY },
    { GOOGLE_PLACES_SERVER_API_KEY: runtimeKey },
  ),
  { key: runtimeKey, source: "GOOGLE_PLACES_SERVER_API_KEY" },
);
assert.deepEqual(resolveFrom({ GOOGLE_MAPS_API_KEY: values.GOOGLE_MAPS_API_KEY }, {}), {
  key: values.GOOGLE_MAPS_API_KEY,
  source: "GOOGLE_MAPS_API_KEY",
});

const diagnostic = JSON.stringify({ source: resolveFrom(values).source });
for (const key of Object.values(values)) assert.doesNotMatch(diagnostic, new RegExp(key));

console.log("verify-google-maps-server-key: ok");
