/** Renders a saved transaction without reading mutable product or wallet data. */
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { projectRoot } from "../config.js";
import type { SavedTransaction } from "./service.js";

const money = (value: number) =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(
    value / 100,
  );
let logo: string | undefined;

/** Renders only immutable saved details; product or wallet changes cannot rewrite a receipt. */
/** Returns a PDF buffer using immutable transaction and receipt-party snapshots. */
export function createReceipt(transaction: SavedTransaction): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 45,
      info: { Title: "Inua Mkulima purchase receipt", Author: "Inua Mkulima" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    logo ??= readFileSync(
      resolvePath(projectRoot, "frontend/public/assets/Logo.svg"),
      "utf8",
    );
    SVGtoPDF(doc, logo, 477, 35, {
      width: 65,
      height: 65,
      preserveAspectRatio: "xMidYMid meet",
    });
    doc.fillColor("#166534").fontSize(23).text("Inua Mkulima");
    doc.fillColor("#111111").fontSize(15).text("Purchase receipt").moveDown();
    doc
      .fontSize(10)
      .text(`Reference: ${transaction.id}`)
      .text(`Date (UTC): ${transaction.createdAt}`);
    doc.text(
      `Dealer: ${transaction.receiptParties.dealer.name} (${transaction.receiptParties.dealer.id})`,
    );
    doc
      .text(`Farmer: ${transaction.receiptParties.farmer.name}`)
      .text(`Farmer reference: ${transaction.receiptParties.farmer.reference}`)
      .text(`Contact: ${transaction.receiptParties.farmer.phone}`)
      .moveDown();
    for (const item of transaction.items) {
      // Measure names so long product labels do not orphan their monetary rows.
      doc.font("Helvetica-Bold");
      const rowHeight = doc.heightOfString(item.productName) + 45;
      if (doc.y + rowHeight > doc.page.height - 60) doc.addPage();
      doc.text(item.productName).font("Helvetica");
      doc.text(
        `${item.quantity} x ${money(item.unitPriceMinor)}   |   Line total: ${money(item.lineTotalMinor)}`,
      );
      doc
        .text(`Subsidy deduction: ${money(item.deductionMinor)}`)
        .moveDown(0.7);
    }
    if (doc.y > 620) doc.addPage();
    doc
      .moveDown()
      .font("Helvetica-Bold")
      .text(`Purchase total: ${money(transaction.purchaseTotalMinor)}`);
    doc.text(`Subsidy deduction: ${money(transaction.deductionTotalMinor)}`);
    doc
      .text(`Customer due: ${money(transaction.customerDueMinor)}`)
      .font("Helvetica");
    doc
      .text(`Wallet before: ${money(transaction.walletBeforeMinor)}`)
      .text(`Wallet after: ${money(transaction.walletAfterMinor)}`)
      .moveDown();
    doc
      .fontSize(9)
      .text(
        "The customer settles the uncovered amount outside this application.",
      );
    doc.text("Fictional assessment data. Verification is simulated.");
    doc.end();
  });
}
