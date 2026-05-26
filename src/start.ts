import { createStart, createMiddleware } from "@tanstack/react-start";

import { logAppError } from "@/lib/log-error";
import { renderErrorPageFromUnknown } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    logAppError("SSR_MIDDLEWARE_ERROR", error);
    return new Response(renderErrorPageFromUnknown(error), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  /** Capacitor bundled HTML 無 SSR shell，須走 client render 而非 hydrateRoot(document) */
  defaultSsr: false,
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [attachSupabaseAuth],
}));
