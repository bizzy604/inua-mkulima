/** Defines strict economic-input schemas shared by preview and payment requests. */
import { z } from 'zod';

export const safeMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const cartShape = {
  items: z.array(z.object({
    productId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    quantity: z.number().int().min(1).max(999),
    expectedUnitPriceMinor: safeMinor.refine((value) => value > 0, 'Price must be positive.'),
    deductionMinor: safeMinor,
  }).strict()).min(1).max(50),
  expectedDeductionTotalMinor: safeMinor.refine((value) => value > 0, 'The total deduction must be positive.'),
};
function uniqueProducts(cart: { items: { productId: number }[] }, context: z.RefinementCtx): void {
  const seen = new Set<number>();
  cart.items.forEach((item, index) => {
    if (seen.has(item.productId)) context.addIssue({ code: 'custom', path: ['items', index, 'productId'], message: 'Each product may appear only once.' });
    seen.add(item.productId);
  });
}
export const cartSchema = z.object(cartShape).strict().superRefine(uniqueProducts);
export const paymentSchema = z.object({ ...cartShape, verificationCode: z.string().regex(/^\d{6}$/, 'Enter the six-digit demo verification code.') }).strict().superRefine(uniqueProducts);
export const idempotencyKeySchema = z.string().uuid();
export type CartPayload = z.infer<typeof cartSchema>;

