// Builds a branded one-page PDF invoice for a fully-paid booking (see
// settle.ts, which only calls this once a booking reaches payment_status =
// 'paid'). No GSTIN/tax/discount — this business isn't GST-registered and
// has no discount/coupon system, so those rows are simply omitted rather
// than showing fabricated numbers.
//
// Deno Edge Functions have no headless browser, so this can't render literal
// HTML/CSS — the branded layout below is drawn directly with pdf-lib
// primitives (rects, lines, text, small vector marks) to the same visual
// design. pdf-lib is the only Deno/esm.sh-compatible pure-JS PDF library
// option (no native deps) — matches this project's esm.sh import convention
// already used for @supabase/supabase-js everywhere else.

import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import type { PDFFont, PDFPage, RGB } from 'https://esm.sh/pdf-lib@1.17.1';

const FROM_NAME = Deno.env.get('BOOKING_EMAIL_FROM_NAME') ?? 'DreamCapture';
// Optional — set INVOICE_BUSINESS_ADDRESS to show an address line under the
// wordmark. Left unset today, so that line is simply omitted (no placeholder
// text on real invoices).
const BUSINESS_ADDRESS = Deno.env.get('INVOICE_BUSINESS_ADDRESS') ?? '';
const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL') ?? 'support@dreamcapture.example';

const PAGE_W = 595.28; // A4 at 72dpi (== 794px at 96dpi, the same physical page)
const PAGE_H = 841.89;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;

const ORANGE = rgb(0.918, 0.357, 0.047); // #EA5B0C — accent only: top bar, icon, pill/box highlights
const DARK = rgb(0.09, 0.094, 0.129); // heading ink / logo badge fill
const GRAY = rgb(0.42, 0.447, 0.502); // secondary text
const LIGHT_BORDER = rgb(0.9, 0.9, 0.91);
const ZEBRA = rgb(0.965, 0.965, 0.973);
const WHITE = rgb(1, 1, 1);
const GREEN_BG = rgb(0.863, 0.988, 0.906);
const GREEN_TEXT = rgb(0.086, 0.639, 0.29);

// Mirrors src/lib/common.js formatPrice.
function formatPrice(amount: number): string {
  return `Rs. ${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// bookings.start_date/end_date come back as plain 'YYYY-MM-DD' strings —
// same reformat send-booking-status-email/index.ts's toDMY() already does.
function toDMY(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// Same billable-nights convention as src/lib/rentalDays.js — end_date is the
// return day, not a day of use, so it's excluded (Aug 10 -> Aug 12 = 2 days).
// Kept in sync so the per-day rate shown here actually multiplies back to
// what was charged.
function rentalDays(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00`).getTime() - new Date(`${start}T00:00:00`).getTime();
  return Math.max(1, Math.round(ms / 86400000));
}

export interface InvoiceLineItem {
  description: string;
  sublabel?: string; // e.g. a date range — rendered as a smaller line under description
  quantity: number;
  rate: number; // per day
  amount: number;
}

export interface InvoiceInput {
  bookingId: string;
  cameraName: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  startDate: string;
  endDate: string;
  quantity: number;
  amountTotal: number;
  amountPaid: number;
  paymentMethod?: string;
  /** Defaults to one row built from cameraName/quantity/dates/amountTotal —
   *  pass an explicit array once add-ons/extra line items are a real feature. */
  lineItems?: InvoiceLineItem[];
}

function drawApertureMark(page: PDFPage, cx: number, cy: number, outerR: number, innerR: number, color: RGB) {
  page.drawEllipse({ x: cx, y: cy, xScale: outerR, yScale: outerR, borderColor: color, borderWidth: 1.3 });
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const angle = (Math.PI * 2 * i) / blades;
    page.drawLine({
      start: { x: cx + Math.cos(angle) * innerR, y: cy + Math.sin(angle) * innerR },
      end: { x: cx + Math.cos(angle) * outerR, y: cy + Math.sin(angle) * outerR },
      thickness: 2,
      color,
    });
  }
}

// A tiny checkmark glyph drawn as two line segments — StandardFonts use
// WinAnsi encoding, which can't render a real ✓ character.
function drawCheckMark(page: PDFPage, cx: number, cy: number, size: number, color: RGB) {
  page.drawLine({ start: { x: cx - size, y: cy }, end: { x: cx - size * 0.3, y: cy - size * 0.7 }, thickness: 1.6, color });
  page.drawLine({ start: { x: cx - size * 0.3, y: cy - size * 0.7 }, end: { x: cx + size, y: cy + size * 0.6 }, thickness: 1.6, color });
}

function textWidth(font: PDFFont, text: string, size: number): number {
  return font.widthOfTextAtSize(text, size);
}

function drawRight(page: PDFPage, text: string, rightX: number, y: number, size: number, font: PDFFont, color: RGB) {
  page.drawText(text, { x: rightX - textWidth(font, text, size), y, size, font, color });
}

function drawCentered(page: PDFPage, text: string, centerX: number, y: number, size: number, font: PDFFont, color: RGB) {
  page.drawText(text, { x: centerX - textWidth(font, text, size) / 2, y, size, font, color });
}

export async function buildInvoicePdf(input: InvoiceInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const reference = `INV-${input.bookingId.slice(0, 8)}`;
  const dateLabel = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const method = input.paymentMethod || 'Razorpay';
  const days = rentalDays(input.startDate, input.endDate);

  const lineItems: InvoiceLineItem[] = input.lineItems?.length
    ? input.lineItems
    : [{
        description: input.cameraName,
        // En dash, not an arrow — pdf-lib's standard fonts use WinAnsi
        // encoding, which has no arrow glyphs and throws on one.
        sublabel: `${toDMY(input.startDate)} – ${toDMY(input.endDate)} · ${days} day${days === 1 ? '' : 's'}`,
        quantity: input.quantity,
        rate: input.quantity > 0 ? input.amountTotal / (input.quantity * days) : input.amountTotal,
        amount: input.amountTotal,
      }];
  const subtotal = lineItems.reduce((sum, li) => sum + li.amount, 0);

  // --- Top accent bar ------------------------------------------------------
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: ORANGE });

  // --- Header: logo badge + wordmark + address (left), invoice meta (right)
  const badgeSize = 34;
  const badgeTop = PAGE_H - 40;
  const badgeY = badgeTop - badgeSize;
  page.drawRectangle({ x: MARGIN, y: badgeY, width: badgeSize, height: badgeSize, color: DARK });
  drawApertureMark(page, MARGIN + badgeSize / 2, badgeY + badgeSize / 2, 9, 3.5, ORANGE);

  const wordmarkX = MARGIN + badgeSize + 12;
  const wordmarkY = badgeY + badgeSize / 2 - 6;
  // Two-tone "Dream"/"Capture" split only makes sense for the actual named
  // brand — falls back to a single color if BOOKING_EMAIL_FROM_NAME is ever
  // set to something else.
  if (FROM_NAME.toLowerCase() === 'dreamcapture') {
    page.drawText('Dream', { x: wordmarkX, y: wordmarkY, size: 18, font: bold, color: DARK });
    const dreamW = textWidth(bold, 'Dream', 18);
    page.drawText('Capture', { x: wordmarkX + dreamW, y: wordmarkY, size: 18, font: bold, color: ORANGE });
  } else {
    page.drawText(FROM_NAME, { x: wordmarkX, y: wordmarkY, size: 18, font: bold, color: DARK });
  }
  if (BUSINESS_ADDRESS) {
    page.drawText(BUSINESS_ADDRESS, { x: MARGIN, y: badgeY - 16, size: 8.5, font, color: GRAY });
  }

  const rightX = PAGE_W - MARGIN;
  drawRight(page, 'INVOICE', rightX, badgeTop - 4, 18, bold, DARK);
  drawRight(page, `Reference: ${reference}`, rightX, badgeTop - 22, 9, font, GRAY);
  drawRight(page, `Date: ${dateLabel}`, rightX, badgeTop - 35, 9, font, GRAY);

  const pillW = 62;
  const pillH = 18;
  const pillY = badgeTop - 60;
  page.drawRectangle({ x: rightX - pillW, y: pillY, width: pillW, height: pillH, color: GREEN_BG });
  drawCheckMark(page, rightX - pillW + 13, pillY + 9, 3.2, GREEN_TEXT);
  page.drawText('PAID', { x: rightX - pillW + 20, y: pillY + 5.5, size: 9, font: bold, color: GREEN_TEXT });

  let y = badgeY - 46;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: LIGHT_BORDER });
  y -= 26;

  // --- Two-column info strip: Bill To / Rental Period ----------------------
  const rightColX = MARGIN + CONTENT_W / 2;
  page.drawText('BILL TO', { x: MARGIN, y, size: 8, font: bold, color: GRAY });
  page.drawText('RENTAL PERIOD', { x: rightColX, y, size: 8, font: bold, color: GRAY });

  page.drawText(input.customerName, { x: MARGIN, y: y - 17, size: 11, font: bold, color: DARK });
  page.drawText(`${toDMY(input.startDate)} – ${toDMY(input.endDate)}`, { x: rightColX, y: y - 17, size: 11, font: bold, color: DARK });

  page.drawText(input.customerEmail, { x: MARGIN, y: y - 31, size: 9, font, color: GRAY });
  page.drawText(`Booking ID: ${input.bookingId.slice(0, 8).toUpperCase()}`, { x: rightColX, y: y - 31, size: 9, font, color: GRAY });

  if (input.customerPhone) {
    page.drawText(input.customerPhone, { x: MARGIN, y: y - 44, size: 9, font, color: GRAY });
  }

  y -= 70;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: LIGHT_BORDER });
  y -= 22;

  // --- Booking Details table -------------------------------------------------
  page.drawText('Booking Details', { x: MARGIN, y, size: 12, font: bold, color: DARK });
  y -= 20;

  const headerRowH = 24;
  const colItemX = MARGIN + 12;
  const colQtyRight = MARGIN + CONTENT_W * 0.58;
  const colRateRight = MARGIN + CONTENT_W * 0.78;
  const colAmountRight = MARGIN + CONTENT_W - 12;

  page.drawRectangle({ x: MARGIN, y: y - headerRowH, width: CONTENT_W, height: headerRowH, color: DARK });
  const headerTextY = y - headerRowH + 8;
  page.drawText('ITEM', { x: colItemX, y: headerTextY, size: 9, font: bold, color: WHITE });
  drawRight(page, 'QTY', colQtyRight, headerTextY, 9, bold, WHITE);
  drawRight(page, 'RATE', colRateRight, headerTextY, 9, bold, WHITE);
  drawRight(page, 'AMOUNT', colAmountRight, headerTextY, 9, bold, WHITE);
  y -= headerRowH;

  lineItems.forEach((li, i) => {
    const rowH = li.sublabel ? 34 : 24;
    if (i % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - rowH, width: CONTENT_W, height: rowH, color: ZEBRA });
    }
    const mainTextY = li.sublabel ? y - 16 : y - rowH + 8;
    page.drawText(li.description, { x: colItemX, y: mainTextY, size: 9.5, font, color: DARK });
    if (li.sublabel) {
      page.drawText(li.sublabel, { x: colItemX, y: y - 28, size: 7.5, font, color: GRAY });
    }
    drawRight(page, String(li.quantity), colQtyRight, mainTextY, 9.5, font, DARK);
    drawRight(page, `${formatPrice(li.rate)}/day`, colRateRight, mainTextY, 9.5, font, DARK);
    drawRight(page, formatPrice(li.amount), colAmountRight, mainTextY, 9.5, bold, DARK);
    y -= rowH;
  });

  page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + CONTENT_W, y }, thickness: 0.75, color: LIGHT_BORDER });
  y -= 28;

  // --- Totals block, right-aligned --------------------------------------------
  const totalsRight = MARGIN + CONTENT_W;
  drawRight(page, `Subtotal: ${formatPrice(subtotal)}`, totalsRight, y, 10, font, DARK);
  y -= 34;

  const boxW = 230;
  const boxH = 34;
  page.drawRectangle({ x: totalsRight - boxW, y: y - boxH + 10, width: boxW, height: boxH, color: DARK });
  drawRight(page, `Amount Paid: ${formatPrice(input.amountPaid)}`, totalsRight - 14, y - boxH + 21, 13, bold, WHITE);
  y -= boxH;
  drawRight(page, `Paid via ${method}`, totalsRight, y, 9, font, GRAY);

  y -= 46;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.75, color: LIGHT_BORDER });
  y -= 20;

  // --- Footer: thank-you + support (left), disclaimer (right) ------------------
  const footerTopY = y;
  page.drawText(`Thank you for choosing ${FROM_NAME}.`, { x: MARGIN, y: footerTopY, size: 9.5, font: bold, color: DARK });
  page.drawText(`Questions about this invoice? Reply to ${SUPPORT_EMAIL}`, { x: MARGIN, y: footerTopY - 14, size: 8, font, color: GRAY });

  drawRight(page, 'This is a system-generated invoice for camera', rightX, footerTopY, 7.5, italic, GRAY);
  drawRight(page, 'rental services only. Refer to your rental', rightX, footerTopY - 10, 7.5, italic, GRAY);
  drawRight(page, 'agreement for damage, late-return, and deposit terms.', rightX, footerTopY - 20, 7.5, italic, GRAY);

  y = footerTopY - 46;
  drawCentered(page, `${FROM_NAME} · This invoice was generated electronically and is valid without signature.`, PAGE_W / 2, y, 7.5, font, GRAY);

  return await pdfDoc.save();
}

// Chunked to avoid a call-stack blowout from spreading a large byte array
// straight into String.fromCharCode.
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
