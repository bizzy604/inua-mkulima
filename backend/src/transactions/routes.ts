/** Exposes preview, payment, history, detail, and receipt endpoints. */
import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import type Database from "better-sqlite3";
import type { Config } from "../config.js";
import { AppError } from "../middleware/errors.js";
import { cartSchema, paymentSchema } from "./schemas.js";
import {
  previewPurchase,
  completePurchase,
  getTransaction,
  listTransactions,
} from "./service.js";
import { createReceipt } from "./receipt.js";

export function transactionRoutes(
  db: Database.Database,
  config: Config,
  onPurchase: () => void,
) {
  const router = Router();
  router.post("/preview", (req, res) => {
    res.json({
      data: previewPurchase(
        db,
        req.session.dealerId!,
        cartSchema.parse(req.body),
      ),
    });
  });
  router.post(
    "/",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 30,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(
          new AppError(
            429,
            "TOO_MANY_ATTEMPTS",
            "Too many payment attempts. Try again shortly.",
          ),
        ),
    }),
    (req, res) => {
      const payload = paymentSchema.parse(req.body);
      if (payload.verificationCode !== config.demoVerificationCode)
        throw new AppError(
          400,
          "INVALID_VERIFICATION_CODE",
          "Enter the six-digit demo verification code.",
        );
      const key = z.uuid().parse(req.get("Idempotency-Key"));
      const result = completePurchase(
        db,
        req.session.dealerId!,
        payload,
        key,
        res.locals.requestId,
      );
      res.locals.transactionId = result.transaction.id;
      res.locals.purchaseOutcome = result.replayed ? "replayed" : "committed";
      // Publication is retried from persisted markers; it must never fail a committed payment.
      try {
        onPurchase();
      } catch {
        /* The background loop will retry. */
      }
      res
        .status(result.replayed ? 200 : 201)
        .json({ data: result.transaction });
    },
  );
  router.get("/", (req, res) => {
    const query = z
      .object({
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER)
          .default(20),
        offset: z.coerce
          .number()
          .int()
          .min(0)
          .max(Number.MAX_SAFE_INTEGER)
          .default(0),
      })
      .strict()
      .parse(req.query);
    res.json({
      data: listTransactions(
        db,
        req.session.dealerId!,
        query.limit,
        query.offset,
      ),
    });
  });
  router.get("/:id/receipt", async (req, res) => {
    const saved = getTransaction(
      db,
      req.session.dealerId!,
      z.uuid().parse(req.params.id),
    );
    const pdf = await createReceipt(saved);
    res.type("application/pdf").attachment(`receipt-${saved.id}.pdf`).send(pdf);
  });
  router.get("/:id", (req, res) =>
    res.json({
      data: getTransaction(
        db,
        req.session.dealerId!,
        z.uuid().parse(req.params.id),
      ),
    }),
  );
  return router;
}
