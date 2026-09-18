/** Returns the wallet assigned to the authenticated dealer with formatted KES balance. */
import { Router } from "express";
import type Database from "better-sqlite3";
import { AppError } from "../middleware/errors.js";

export function walletRoutes(db: Database.Database) {
  const router = Router();
  router.get("/", (req, res) => {
    const wallet = db
      .prepare(
        "SELECT id,name,currency,balance_minor AS balanceMinor FROM wallets WHERE dealer_id = ?",
      )
      .get(req.session.dealerId) as
      | { id: number; name: string; currency: string; balanceMinor: number }
      | undefined;
    if (!wallet)
      throw new AppError(
        404,
        "WALLET_NOT_FOUND",
        "The assigned wallet was not found.",
      );
    res.json({
      data: {
        ...wallet,
        formattedBalance: new Intl.NumberFormat("en-KE", {
          style: "currency",
          currency: "KES",
        }).format(wallet.balanceMinor / 100),
      },
    });
  });
  return router;
}
