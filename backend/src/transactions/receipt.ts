/** Receipt layout follows public/screenshots/receipt.png; values are saved snapshots. */
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectRoot } from "../config.js";
import type { SavedTransaction } from "./service.js";

const amount = (minor: number) => new Intl.NumberFormat("en-KE", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(minor / 100);
let marks: { bank: string; county: string; kenya: Buffer } | undefined;
// Let the PDF viewport size the SVG instead of its exported pixel dimensions.
function fitViewport(svg: string) {
  return svg.replace(/<svg\b[^>]*>/, root => root
    .replace(/\bwidth="[^"]+"/, 'width="100%"')
    .replace(/\bheight="[^"]+"/, 'height="100%"'));
}
function receiptMarks() {
  if (!marks) {
    const assets = resolve(projectRoot, "frontend/public/assets");
    // Crop the supplied login-corner SVG viewport to its original county crest.
    const county = readFileSync(resolve(assets, "Logo.svg"), "utf8")
      .replace(/viewBox="[^"]+"/, 'viewBox="163.126 152.136 140.594 159.729"');
    marks = {
      bank: fitViewport(readFileSync(resolve(assets, "white logo (1).svg"), "utf8")),
      county: fitViewport(county),
      kenya: readFileSync(resolve(assets, "Group 2@2x.png")),
    };
  }
  return marks;
}

export function createReceipt(transaction: SavedTransaction): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const doc = new PDFDocument({
      size: "A4", margin: 0, bufferPages: true,
      info: { Title: "Transaction Receipt", Author: "Inua Mkulima" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);
    const logos = receiptMarks();
    const green = "#006729", gold = "#e8c34b";
    const left = 22, width = doc.page.width - left * 2, right = left + width;
    const columns = [0, 168, 262, 355, 448, width];
    const headers = ["Product name", "Quantity", "Price", "Total Amount", "Deduction"];
    const bodyBottom = 685;

    function text(value: string, x: number, y: number, w: number, options: {
      bold?: boolean; size?: number; color?: string; align?: "left" | "right" | "center";
    } = {}) {
      doc.font(options.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(options.size ?? 8.5).fillColor(options.color ?? "#252525")
        .text(value, x, y, { width: w, align: options.align ?? "left", lineGap: 2 });
    }
    function header() {
      doc.rect(0, 44, 185, 39).fill(green);
      doc.rect(183, 44, 2, 39).fill(gold);
      text("Transaction Receipt", 34, 57, 146, { size: 13, color: "#fff" });
      SVGtoPDF(doc, logos.bank, right - 168, 45, { width: 47, height: 39 });
      SVGtoPDF(doc, logos.county, right - 96, 44, { width: 34, height: 40 });
      doc.image(logos.kenya, right - 39, 45, { fit: [39, 39] });
      doc.moveTo(left, 103).lineTo(right, 103).lineWidth(0.8).strokeColor(green).stroke();
    }
    function details(rows: [string, string][], x: number, y: number, labelWidth: number, valueWidth: number) {
      for (const [label, value] of rows) {
        text(label, x, y, labelWidth - 5, { size: 8 });
        text(value, x + labelWidth, y, valueWidth, { size: 8, bold: true, color: green });
        y += Math.max(15, doc.heightOfString(value, { width: valueWidth, lineGap: 2 }) + 5);
      }
      return y;
    }
    function tableHeader(y: number) {
      doc.rect(left, y, width, 26).fill(green);
      headers.forEach((value, i) => text(value, left + columns[i]! + 6, y + 9,
        columns[i + 1]! - columns[i]! - 12, { size: 8, color: "#fff", align: i ? "center" : "left" }));
      return y + 26;
    }
    function nextPage() {
      doc.addPage();
      header();
      text("Reference: " + transaction.id + " (continued)", left, 132, width, { size: 8, color: green });
      return tableHeader(156);
    }

    header();
    const farmer = transaction.receiptParties.farmer;
    const dealer = transaction.receiptParties.dealer;
    const detailsEnd = details([
      ["Date:", new Intl.DateTimeFormat("en-GB", {
        weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Nairobi",
      }).format(new Date(transaction.createdAt))],
      ["Reference Number:", transaction.id],
      ["Wallet:", transaction.receiptParties.walletName],
      ["Farmer Name/ID:", farmer.name + " / " + farmer.reference],
      ["Farmer Phone No:", farmer.phone],
    ], left, 142, 116, 210);
    const dealerEnd = details([
      ["Agro-dealer Name:", dealer.name],
      ["Merchant ID:", dealer.id],
    ], right - 176, 142, 97, 79);

    let y = tableHeader(Math.max(248, detailsEnd + 28, dealerEnd + 28));
    transaction.items.forEach((item, index) => {
      const values = [item.productName, String(item.quantity), amount(item.unitPriceMinor),
        amount(item.lineTotalMinor), amount(item.deductionMinor)];
      doc.font("Helvetica").fontSize(8);
      const rowHeight = Math.max(22, ...values.map((value, i) =>
        doc.heightOfString(value, { width: columns[i + 1]! - columns[i]! - 12, lineGap: 2 }) + 14));
      if (y + rowHeight > bodyBottom) y = nextPage();
      if (index % 2 === 1) doc.rect(left, y, width, rowHeight).fill("#fcf7e7");
      values.forEach((value, i) => text(value, left + columns[i]! + 6, y + 7,
        columns[i + 1]! - columns[i]! - 12, { size: 8, align: i === 0 ? "left" : i === 1 ? "center" : "right" }));
      columns.slice(1, -1).forEach(x => {
        doc.moveTo(left + x, y).lineTo(left + x, y + rowHeight).lineWidth(0.3).strokeColor("#eadcab").stroke();
      });
      y += rowHeight;
    });
    if (y + 80 > bodyBottom) y = nextPage();
    doc.rect(left, y, width, 29).fill(green);
    text("TOTAL", left + columns[3]!, y + 10, columns[4]! - columns[3]! - 12,
      { bold: true, size: 8, color: "#fff", align: "right" });
    const totalX = left + columns[4]!;
    doc.rect(totalX + 2, y + 4, right - totalX - 4, 21).fill("#fff");
    text(amount(transaction.deductionTotalMinor), totalX + 6, y + 10, right - totalX - 12,
      { bold: true, size: 9, align: "right" });
    text("All amounts in KES. Purchase total: " + amount(transaction.purchaseTotalMinor) + ".",
      left, y + 38, width, { size: 8, color: green });
    text("Customer balance payable separately: KES " + amount(transaction.customerDueMinor) + ".",
      left, y + 52, width, { size: 8, color: green });

    const pages = doc.bufferedPageRange();
    for (let page = 0; page < pages.count; page++) {
      doc.switchToPage(page);
      text("PAGE " + (page + 1) + " OF " + pages.count, right - 90, 110, 90,
        { size: 6, color: "#777", align: "right" });
      text("Thank you for banking with us.", left, 711, width,
        { size: 8, bold: true, color: green, align: "center" });
      const footerTop = 738;
      doc.rect(0, footerTop, doc.page.width, doc.page.height - footerTop).fill("#f5f5f5");
      doc.moveTo(0, footerTop);
      for (let x = 0; x < doc.page.width; x += 23) doc.lineTo(x + 11.5, footerTop - 12).lineTo(x + 23, footerTop);
      doc.lineTo(0, footerTop).fill("#f5f5f5");
      doc.rect(0, 779, 23, 43).fill(green);
      doc.rect(23, 779, 2, 43).fill(gold);
      text("Note:", 34, 784, 250, { size: 8, bold: true, color: green });
      text("This document is computer generated and therefore\nnot signed.", 34, 798, 270, { size: 8, color: green });
    }
    doc.end();
  });
}
