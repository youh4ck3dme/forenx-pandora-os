/**
 * Kill-switch service worker: /sw.js musí byť dostupný bez prihlásenia
 * (prehliadač nesmie pri aktualizácii SW dostať redirect), ale iba presná cesta —
 * ostatné chránené cesty ďalej presmerujú na login.
 */
import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware, SERVICE_WORKER_PATH } from "../../../middleware";

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: "No session" } }),
    },
  }),
}));

const call = (path: string) =>
  (middleware as (req: NextRequest, event?: unknown) => Promise<Response>)(
    new NextRequest(`http://localhost${path}`, { method: "GET" }),
    {},
  );

describe("middleware: verejný kill-switch /sw.js", () => {
  test("SERVICE_WORKER_PATH je presne /sw.js", () => {
    expect(SERVICE_WORKER_PATH).toBe("/sw.js");
  });

  test("/sw.js bez session nie je presmerovaný ani odmietnutý", async () => {
    const res = await call("/sw.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  test.each(["/forza/pripady/", "/forza/prehlad/", "/sw.jsx", "/sw.js.map", "/foo/sw.js", "/workbox-4754cb34.js"])(
    "%s bez session ostáva chránený (redirect na login)",
    async (path) => {
      const res = await call(path);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/auth/login/");
    },
  );
});
