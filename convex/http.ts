import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { hashKey, KEY_PATTERN } from "./inbox";
import { download, preflight, upload } from "./pdfLinks";

const http = httpRouter();
auth.addHttpRoutes(http);

/** The Android app's background check: how many unread messages this phone's person has. */
http.route({
  path: "/app-inbox",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    let key: unknown;
    try {
      key = ((await request.json()) as { key?: unknown }).key;
    } catch {
      key = undefined;
    }
    if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
      return Response.json({ error: "bad key" }, { status: 400 });
    }
    const result = await ctx.runQuery(internal.inbox.forDevice, { keyHash: await hashKey(key) });
    // An unknown key (signed in elsewhere since, or removed) tells the phone to stop checking.
    if (!result) return Response.json({ count: 0, stop: true });
    return Response.json(result);
  })
});

// PDFs some devices cannot save from the page: upload for a short-lived link, then open it.
http.route({ path: "/pdf-link", method: "POST", handler: upload });
http.route({ path: "/pdf-link", method: "OPTIONS", handler: preflight });
http.route({ path: "/pdf-link", method: "GET", handler: download });

export default http;
