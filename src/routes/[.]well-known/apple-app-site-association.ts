import { createFileRoute } from "@tanstack/react-router";

/** iOS Universal Link：只涵蓋 /trip-invite/* */
const APPLE_APP_SITE_ASSOCIATION = {
  applinks: {
    apps: [],
    details: [
      {
        appIDs: ["K88UK4PZ43.com.shuode.roamie"],
        appID: "K88UK4PZ43.com.shuode.roamie",
        components: [{ "/": "/trip-invite/*" }],
        paths: ["/trip-invite/*"],
      },
    ],
  },
} as const;

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(APPLE_APP_SITE_ASSOCIATION), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});
