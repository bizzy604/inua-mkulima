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
const flagPath = resolvePath(projectRoot, "frontend/public/assets/Group 2.png");

/** Renders only immutable saved details; product or wallet changes cannot rewrite a receipt. */
/** Returns a PDF buffer using immutable transaction and receipt-party snapshots. */
export function createReceipt(transaction: SavedTransaction): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 42,
      info: { Title: "Inua Mkulima purchase receipt", Author: "Inua Mkulima" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    const pageWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const green = "#006b2d";
    const gold = "#f4c400";
    logo ??= readFileSync(
      resolvePath(projectRoot, "frontend/public/assets/Logo.svg"),
      "utf8",
    );

    doc.rect(left, 42, 150, 34).fill(green);
    doc.rect(left + 147, 42, 3, 34).fill(gold);
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Transaction Receipt", left + 14, 54);
    SVGtoPDF(doc, logo, right - 115, 44, {
      width: 42,
      height: 42,
      preserveAspectRatio: "xMidYMid meet",
    });
    doc.image(flagPath, right - 48, 47, { width: 30, height: 24 });
    doc
      .strokeColor(green)
      .lineWidth(1.2)
      .moveTo(left, 92)
      .lineTo(right, 92)
      .stroke();
    doc
      .fillColor("#777")
      .font("Helvetica")
      .fontSize(7)
      .text("PAGE 1 OF 1", right - 38, 98);

    const detailY = 118;
    const label = (text: string, x: number, y: number) =>
      doc.fillColor("#222").font("Helvetica-Bold").fontSize(8).text(text, x, y);
    const value = (text: string, x: number, y: number, width = 125) =>
      doc
        .fillColor(green)
        .font("Helvetica-Bold")
        .fontSize(8)
        .text(text, x, y, { width });
    label("Date:", left, detailY);
    value(
      new Date(transaction.createdAt).toLocaleDateString("en-GB", {
        dateStyle: "medium",
      }),
      left + 52,
      detailY,
    );
    label("Reference:", left, detailY + 14);
    value(transaction.id.slice(0, 18), left + 52, detailY + 14);
    label("Wallet:", left, detailY + 28);
    value(transaction.receiptParties.walletName, left + 52, detailY + 28);
    label("Farmer Name/ID:", left, detailY + 42);
    value(
      `${transaction.receiptParties.farmer.name} / ${transaction.receiptParties.farmer.reference}`,
      left + 82,
      detailY + 42,
      145,
    );
    label("Farmer Phone No:", left, detailY + 56);
    value(transaction.receiptParties.farmer.phone, left + 82, detailY + 56);
    label("Agro-dealer Name:", left + 315, detailY);
    value(transaction.receiptParties.dealer.name, left + 397, detailY, 110);
    label("Merchant ID:", left + 315, detailY + 14);
    value(transaction.receiptParties.dealer.id, left + 397, detailY + 14, 110);
    label("Phone Number:", left + 315, detailY + 28);
    value("Demo contact", left + 397, detailY + 28, 110);

    const tableTop = 215;
    const columns = [0, 150, 235, 315, 410, pageWidth];
    const headers = [
      "Product Code",
      "Quantity",
      "Price",
      "Total Amount",
      "Deduction",
    ];
    doc.rect(left, tableTop, pageWidth, 22).fill(green);
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#fff");
    headers.forEach((header, index) =>
      doc.text(header, left + columns[index] + 8, tableTop + 8, {
        width: columns[index + 1] - columns[index] - 16,
        align: index ? "center" : "left",
      }),
    );
    let y = tableTop + 22;
    transaction.items.forEach((item, index) => {
      // Keep pagination deterministic without repeatedly measuring long labels.
      const wrappedLines = Math.max(1, Math.ceil(item.productName.length / 32));
      const rowHeight = Math.max(20, wrappedLines * 9 + 10);
      if (y + rowHeight > doc.page.height - 100) {
        doc.addPage();
        y = 60;
      }
      if (index % 2 === 1)
        doc.rect(left, y, pageWidth, rowHeight).fill("#fff7df");
      doc
        .fillColor("#333")
        .font("Helvetica")
        .fontSize(7)
        .text(item.productName, left + 6, y + 7, { width: columns[1] - 12 });
      doc.text(String(item.quantity), left + columns[1], y + 7, {
        width: columns[2] - columns[1],
        align: "center",
      });
      doc.text(money(item.unitPriceMinor), left + columns[2], y + 7, {
        width: columns[3] - columns[2] - 6,
        align: "right",
      });
      doc.text(money(item.lineTotalMinor), left + columns[3], y + 7, {
        width: columns[4] - columns[3] - 6,
        align: "right",
      });
      doc.text(money(item.deductionMinor), left + columns[4], y + 7, {
        width: columns[5] - columns[4] - 6,
        align: "right",
      });
      doc
        .strokeColor("#ead9a1")
        .lineWidth(0.4)
        .rect(left, y, pageWidth, rowHeight)
        .stroke();
      y += rowHeight;
    });
    doc.rect(left, y, pageWidth, 24).fill(green);
    doc
      .fillColor("#fff")
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("TOTAL", left + 350, y + 8, { width: 65, align: "right" });
    doc
      .rect(right - 92, y + 3, 88, 18)
      .fill("#fff")
      .stroke(green);
    doc
      .fillColor(green)
      .text(money(transaction.deductionTotalMinor), right - 87, y + 8, {
        width: 78,
        align: "right",
      });
    doc
      .fillColor(green)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("Thank you for banking with us.", left, doc.page.height - 100, {
        width: pageWidth,
        align: "center",
      });
    doc
      .fillColor("#eef3ef")
      .rect(0, doc.page.height - 70, doc.page.width, 70)
      .fill();
    doc
      .fillColor(green)
      .rect(0, doc.page.height - 60, 20, 38)
      .fill();
    doc
      .fillColor(green)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text("Note:", left, doc.page.height - 53);
    doc
      .font("Helvetica")
      .fontSize(7)
      .text(
        "This document is computer generated and therefore not signed.",
        left,
        doc.page.height - 41,
      );
    doc.end();
  });
}
