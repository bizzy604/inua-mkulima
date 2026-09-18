/** Implements active-product reads and scoped product management operations. */
import { Router } from "express";
import { z } from "zod";
import type Database from "better-sqlite3";
import { AppError } from "../middleware/errors.js";

const productSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    priceMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
export function productRoutes(db: Database.Database) {
  const router = Router();
  const select =
    "SELECT id, name, price_minor AS priceMinor, active, created_at AS createdAt, updated_at AS updatedAt FROM products";
  const get = (id: number) => {
    const product = db.prepare(`${select} WHERE id = ?`).get(id);
    if (!product)
      throw new AppError(
        404,
        "PRODUCT_NOT_FOUND",
        "The product was not found.",
      );
    return product;
  };
  const idFrom = (value: unknown) =>
    z.coerce
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(value);
  router.get("/", (_req, res) =>
    res.json({
      data: db.prepare(`${select} WHERE active = 1 ORDER BY id`).all(),
    }),
  );
  router.post("/", (req, res) => {
    const input = productSchema.parse(req.body);
    const now = new Date().toISOString();
    const result = db
      .prepare(
        "INSERT INTO products (name,price_minor,active,created_at,updated_at) VALUES (?,?,1,?,?)",
      )
      .run(input.name, input.priceMinor, now, now);
    res.status(201).json({ data: get(Number(result.lastInsertRowid)) });
  });
  router.patch("/:id", (req, res) => {
    const id = idFrom(req.params.id);
    const input = productSchema
      .partial()
      .refine(
        (value) => Object.keys(value).length > 0,
        "Provide at least one field.",
      )
      .parse(req.body);
    get(id);
    db.prepare(
      "UPDATE products SET name = COALESCE(?,name), price_minor = COALESCE(?,price_minor), updated_at = ? WHERE id = ?",
    ).run(
      input.name ?? null,
      input.priceMinor ?? null,
      new Date().toISOString(),
      id,
    );
    res.json({ data: get(id) });
  });
  router.delete("/:id", (req, res) => {
    const id = idFrom(req.params.id);
    get(id);
    db.prepare(
      "UPDATE products SET active = 0, updated_at = ? WHERE id = ?",
    ).run(new Date().toISOString(), id);
    res.json({ data: { id, active: false } });
  });
  return router;
}
