// Internal HTTP API for the gateway (blueprint §12.3 constant-time Bearer auth).
//
// All routes EXCEPT /health are guarded by a Bearer token equal to
// INTERNAL_GATEWAY_SECRET, compared with crypto.timingSafeEqual (constant-time,
// length-mismatch-safe). /health is intentionally unguarded for the container
// healthcheck.

import crypto from "node:crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import type { WaEngine } from "./engine";

/**
 * Constant-time comparison of a presented token against the expected secret.
 * Handles length mismatch without leaking timing (hashes both sides to a fixed
 * length before comparing, so timingSafeEqual never sees unequal buffers).
 */
export function safeTokenEqual(presented: string, expected: string): boolean {
  if (!expected) return false; // misconfigured secret → deny everything
  const a = crypto.createHash("sha256").update(presented).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/** Express middleware factory enforcing the Bearer secret. */
export function bearerGuard(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const prefix = "Bearer ";
    const token = header.startsWith(prefix) ? header.slice(prefix.length) : "";
    if (!token || !safeTokenEqual(token, secret)) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export interface HttpDeps {
  engine: WaEngine;
  secret: string;
}

export function createApp(deps: HttpDeps): Express {
  const { engine, secret } = deps;
  const app = express();
  app.use(express.json());

  // Unguarded healthcheck for the container.
  app.get("/health", (_req: Request, res: Response) => {
    res.status(200).send("ok");
  });

  // Everything below requires the internal Bearer secret.
  app.use(bearerGuard(secret));

  app.post("/session/start", async (req: Request, res: Response) => {
    const { sessionId } = req.body ?? {};
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    try {
      const result = await engine.startSession(sessionId);
      res.status(200).json(result);
    } catch (err) {
      console.error("[http] session/start error:", err);
      res.status(500).json({ error: "session start failed" });
    }
  });

  app.post("/session/stop", async (req: Request, res: Response) => {
    const { sessionId } = req.body ?? {};
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    try {
      await engine.stopSession(sessionId);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[http] session/stop error:", err);
      res.status(500).json({ error: "session stop failed" });
    }
  });

  app.get("/session/:id/qr", async (req: Request, res: Response) => {
    const sessionId = req.params.id;
    try {
      const { qr, status } = await engine.startSession(sessionId);
      res.status(200).json({ qr: qr ?? null, status });
    } catch (err) {
      console.error("[http] session/qr error:", err);
      res.status(500).json({ error: "qr fetch failed" });
    }
  });

  app.post("/send", async (req: Request, res: Response) => {
    const { sessionId, waId, text } = req.body ?? {};
    if (
      !sessionId ||
      typeof sessionId !== "string" ||
      !waId ||
      typeof waId !== "string" ||
      typeof text !== "string"
    ) {
      res.status(400).json({ error: "sessionId, waId and text required" });
      return;
    }
    try {
      const result = await engine.sendText(sessionId, waId, text);
      res.status(200).json(result);
    } catch (err) {
      console.error("[http] send error:", err);
      res.status(500).json({ error: "send failed" });
    }
  });

  return app;
}
