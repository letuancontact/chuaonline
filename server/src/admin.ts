import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_POPULATION, DEFAULT_ROOM_NAMES, MAX_MIN_BOTS, MAX_ROOM_NAME_CHARS, ROOM_COUNT } from "@santinh/shared";
import { ADMIN_PAGE_CSP, ADMIN_PAGE_HTML } from "./admin-page.ts";
import { isAllowedOrigin } from "./origin.ts";
import type { PopulationStore } from "./population-store.ts";
import type { RoomNamesStore } from "./room-names-store.ts";

export const ADMIN_MAX_BODY_BYTES = 4096;
export const ADMIN_FAIL_WINDOW_MS = 60_000;
export const ADMIN_MAX_FAILS = 10;

export type AuthResult = "ok" | "unauthorized" | "limited";

function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/** Bearer check + failed attempts per IP in a sliding window. */
export class AdminAuth {
  private readonly hash: Buffer;
  private readonly clock: () => number;
  private readonly fails = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(password: string, clock: () => number = Date.now) {
    this.hash = sha256(password);
    this.clock = clock;
  }

  check(ip: string, authorization: string | undefined): AuthResult {
    const now = this.clock();
    // Locked out even with the right password: otherwise the 429 tells a guesser nothing.
    if (this.recentFails(ip, now).length >= ADMIN_MAX_FAILS) return "limited";
    const m = /^Bearer (.+)$/i.exec(authorization ?? "");
    // Equal-length digests: timingSafeEqual leaks neither the password nor its length.
    if (m?.[1] !== undefined && timingSafeEqual(sha256(m[1]), this.hash)) return "ok";
    this.recordFail(ip, now);
    return "unauthorized";
  }

  /** Seconds until the oldest counted failure leaves the window. */
  retryAfter(ip: string): number {
    const now = this.clock();
    const oldest = this.recentFails(ip, now)[0] ?? now;
    return Math.max(1, Math.ceil((oldest + ADMIN_FAIL_WINDOW_MS - now) / 1000));
  }

  private recentFails(ip: string, now: number): number[] {
    return (this.fails.get(ip) ?? []).filter((t) => now - t < ADMIN_FAIL_WINDOW_MS);
  }

  private recordFail(ip: string, now: number): void {
    // Sweep so IPs that stopped guessing do not pile up; at most once per window, or a flood from many IPs costs O(n²).
    if (now - this.lastSweep >= ADMIN_FAIL_WINDOW_MS) {
      this.lastSweep = now;
      for (const [key, times] of this.fails) {
        const last = times[times.length - 1] ?? 0;
        if (now - last >= ADMIN_FAIL_WINDOW_MS) this.fails.delete(key);
      }
    }
    this.fails.set(ip, [...this.recentFails(ip, now), now]);
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export class BodyTooLarge extends Error {}

export async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > max) throw new BodyTooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export interface AdminDeps {
  password: string;
  store: PopulationStore;
  roomNames: RoomNamesStore;
  capacity: number;
  clientIp: (req: IncomingMessage) => string;
  clock?: () => number;
}

const LIMITS_FOR = (capacity: number) => ({ rooms: ROOM_COUNT, maxBots: capacity - 1, maxMinBots: MAX_MIN_BOTS });

/**
 * `/admin` + `/api/admin/*` (P3-D9). Returns false when the path is not ours.
 * - empty password = admin off → 404 on both;
 * - same origin only: no CORS headers, a foreign `Origin` → 403.
 */
export function createAdminHandler(deps: AdminDeps): (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean> {
  const auth = deps.password === "" ? null : new AdminAuth(deps.password, deps.clock);
  const limits = LIMITS_FOR(deps.capacity);

  return async (req, res, path) => {
    if (path !== "/admin" && path !== "/api/admin" && !path.startsWith("/api/admin/")) return false;
    if (!auth) {
      json(res, 404, { error: "not-found" });
      return true;
    }
    if (path === "/admin") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return true;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": ADMIN_PAGE_CSP,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : ADMIN_PAGE_HTML);
      return true;
    }
    // An empty allow-list means "Origin host equals Host": the public ALLOWED_ORIGINS must not reach admin.
    if (!isAllowedOrigin(req.headers.origin, req.headers.host, [])) {
      json(res, 403, { error: "forbidden" });
      return true;
    }
    // Each setting: what GET shows, the store PUT writes to, the 400 hint.
    const route =
      path === "/api/admin/population"
        ? { store: deps.store, view: () => ({ config: deps.store.current, defaults: DEFAULT_POPULATION, limits }), hint: { limits }, log: "population" }
        : path === "/api/admin/rooms"
          ? {
              store: deps.roomNames,
              view: () => ({ names: deps.roomNames.current, defaults: DEFAULT_ROOM_NAMES, maxChars: MAX_ROOM_NAME_CHARS }),
              hint: { count: ROOM_COUNT, maxChars: MAX_ROOM_NAME_CHARS },
              log: "room names",
            }
          : null;
    if (!route) {
      json(res, 404, { error: "not-found" });
      return true;
    }
    if (req.method !== "GET" && req.method !== "PUT") {
      json(res, 405, { error: "method-not-allowed" }, { allow: "GET, PUT" });
      return true;
    }
    const ip = deps.clientIp(req);
    const result = auth.check(ip, req.headers.authorization);
    if (result === "limited") {
      json(res, 429, { error: "too-many-attempts" }, { "retry-after": String(auth.retryAfter(ip)) });
      return true;
    }
    if (result === "unauthorized") {
      json(res, 401, { error: "unauthorized" }, { "www-authenticate": "Bearer" });
      return true;
    }
    if (req.method === "GET") {
      json(res, 200, route.view());
      return true;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readBody(req, ADMIN_MAX_BODY_BYTES));
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        // Close: the rest of an oversized body is not worth draining.
        json(res, 413, { error: "too-large" }, { connection: "close" });
      } else {
        json(res, 400, { error: "bad-json" });
      }
      return true;
    }
    let saved;
    try {
      saved = await route.store.save(raw);
    } catch (err) {
      console.error(`admin: saving ${route.log} failed`, err);
      json(res, 500, { error: "save-failed" });
      return true;
    }
    if (!saved) {
      json(res, 400, { error: "invalid-config", ...route.hint });
      return true;
    }
    console.log(`admin: ${route.log} updated from ${ip}`);
    json(res, 200, route.view());
    return true;
  };
}
