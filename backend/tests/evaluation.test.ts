import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { openDatabase, migrate, seed } from "../src/db/index.js";
import { completePurchase } from "../src/transactions/service.js";

describe("deterministic money evaluation: 100% invariant pass threshold", () => {
  it("conserves balances and totals over 80 varied valid carts and reordered retries", () => {
    for (let scenario = 1; scenario <= 80; scenario++) {
      const db = openDatabase(":memory:");
      try {
        migrate(db);
        seed(db);
        const quantity = (scenario % 9) + 1;
        const deduction = scenario * 101;
        const payload = {
          items: [
            {
              productId: 1,
              quantity,
              expectedUnitPriceMinor: 150000,
              deductionMinor: deduction,
            },
            {
              productId: 2,
              quantity: 2,
              expectedUnitPriceMinor: 30000,
              deductionMinor: scenario * 17,
            },
          ],
          expectedDeductionTotalMinor: deduction + scenario * 17,
        };
        const key = randomUUID();
        const { transaction: t } = completePurchase(
          db,
          "demo-dealer",
          payload,
          key,
          randomUUID(),
        );
        expect(t.purchaseTotalMinor).toBe(quantity * 150000 + 60000);
        expect(t.walletBeforeMinor - t.walletAfterMinor).toBe(
          t.deductionTotalMinor,
        );
        expect(t.customerDueMinor + t.deductionTotalMinor).toBe(
          t.purchaseTotalMinor,
        );
        expect(
          t.items.reduce((sum, item) => sum + item.deductionMinor, 0),
        ).toBe(t.deductionTotalMinor);
        const repeated = completePurchase(
          db,
          "demo-dealer",
          { ...payload, items: [...payload.items].reverse() },
          key,
          randomUUID(),
        );
        expect(repeated.replayed).toBe(true);
        expect(repeated.transaction).toEqual(t);
        expect(
          (
            db.prepare("SELECT count(*) AS n FROM transactions").get() as {
              n: number;
            }
          ).n,
        ).toBe(1);
      } finally {
        db.close();
      }
    }
  });
});
