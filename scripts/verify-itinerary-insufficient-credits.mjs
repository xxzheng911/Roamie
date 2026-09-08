import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  INSUFFICIENT_CREDITS_ERROR_CODE,
  InsufficientCreditsError,
  isInsufficientCreditsError,
} from "../src/lib/credits/errors";

assert.equal(isInsufficientCreditsError(new InsufficientCreditsError()), true);
assert.equal(isInsufficientCreditsError({ errorCode: INSUFFICIENT_CREDITS_ERROR_CODE }), true);
assert.equal(isInsufficientCreditsError(new Error("generation_unavailable")), false);

const middleware = readFileSync(
  new URL("../src/integrations/supabase/security-middleware.ts", import.meta.url),
  "utf8",
);
const reservationFailure = middleware.indexOf("throw new InsufficientCreditsError()");
const upstreamInvocation = middleware.indexOf("const result = await next(");
assert.ok(reservationFailure >= 0 && reservationFailure < upstreamInvocation);
assert.ok(
  middleware.indexOf('throw new Error("Credit reservation unavailable")') < reservationFailure,
);
assert.match(middleware, /parsePlusEntitlementSnapshot\(entitlement\)\.hasPlus/);
assert.match(middleware, /result = await next/);
assert.match(middleware, /credits_rollback/);

const api = readFileSync(
  new URL("../src/routes/api/generate-itinerary.ts", import.meta.url),
  "utf8",
);
assert.match(api, /insufficientCredits \? 402 : 500/);
assert.match(api, /INSUFFICIENT_CREDITS_ERROR_CODE/);

const stateMachine = readFileSync(
  new URL("../src/lib/ai/ai-itinerary-state-machine.ts", import.meta.url),
  "utf8",
);
assert.match(stateMachine, /isInsufficientCreditsError\(rawGenerateResult\)/);
assert.match(stateMachine, /INSUFFICIENT_CREDITS_ITINERARY_MESSAGE/);

const chat = readFileSync(new URL("../src/routes/_app.chat.tsx", import.meta.url), "utf8");
assert.doesNotMatch(chat, /beginItineraryGenerationCredits/);

console.log("verify-itinerary-insufficient-credits: ok");
