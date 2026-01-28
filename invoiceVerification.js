// invoiceVerification.js

export function verifyInvoiceTotals(invoice, cleanedText) {
  const result = {
    status: "Unverifiable",
    differenceAmount: 0,
    computedTotal: 0,
    declaredTotal: 0,
    mismatchedLines: [],
    line_items: [],
    summary: {}
  };

  if (!invoice || !cleanedText) return result;

  const parseNumber = (v) => {
    if (!v) return NaN;
    return parseFloat(String(v).replace(/,/g, ""));
  };

  // ---------- SUMMARY KEYWORDS (HARD BLOCK) ----------
  const SUMMARY_KEYWORDS = [
    "subtotal", "sub total",
    "tax", "gst", "cgst", "sgst", "igst",
    "total", "grand total", "round off", "balance"
  ];

  const isSummaryRow = (line) =>
    SUMMARY_KEYWORDS.some(k => line.toLowerCase().includes(k));

  // ---------- DECLARED TOTAL ----------
  const declaredTotal = parseNumber(invoice.total);
  if (isNaN(declaredTotal)) return result;
  result.declaredTotal = declaredTotal;

  const lines = cleanedText.split("\n");

  let calculatedTotal = 0;

  /**
   * STRICT LINE ITEM PATTERN
   * description | qty | rate | amount   (order tolerant, same row)
   * Example:
   *  Item A   2   160.00   320.00
   *  Item B 1 x 50.00 50.00
   */
  const lineItemRegex =
    /(.+?)\s+(\d+)\s*(?:x|\*)?\s*([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/i;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    // 🚫 HARD EXCLUDE SUMMARY ROWS
    if (isSummaryRow(line)) {
      // Extract summary values ONLY
      const numMatch = line.match(/([\d,]+\.\d{2})/);
      if (!numMatch) return;

      const value = parseNumber(numMatch[1]);
      if (isNaN(value)) return;

      const lower = line.toLowerCase();
      if (lower.includes("subtotal")) result.summary.subtotal = value;
      else if (lower.includes("cgst") || lower.includes("sgst") || lower.includes("igst") || lower.includes("gst"))
        result.summary.tax = value;
      else if (lower.includes("total")) result.summary.total = value;

      return;
    }

    // ---------- LINE ITEM DETECTION ----------
    const match = line.match(lineItemRegex);
    if (!match) return;

    const qty = parseNumber(match[2]);
    const rate = parseNumber(match[3]);
    const amount = parseNumber(match[4]);

    // STRICT VALIDATION
    if (
      !Number.isInteger(qty) ||
      qty <= 0 ||
      isNaN(rate) ||
      isNaN(amount)
    ) return;

    // Amount MUST equal qty × rate (tolerance 0.01)
    const expected = qty * rate;
    if (Math.abs(expected - amount) > 0.01) return;

    // ✅ VALID LINE ITEM
    result.line_items.push({
      description: match[1].trim(),
      quantity: qty,
      rate: rate,
      amount: amount,
      lineIndex: index
    });

    calculatedTotal += amount;
  });

  result.computedTotal = parseFloat(calculatedTotal.toFixed(2));
  result.differenceAmount = parseFloat(
    (result.computedTotal - result.declaredTotal).toFixed(2)
  );

  // ---------- STATUS ----------
  if (result.line_items.length === 0) {
    result.status = "Unverifiable";
  } else if (Math.abs(result.differenceAmount) <= 0.01) {
    result.status = "Verified";
  } else {
    result.status = "Needs Review";
  }

  return result;
}
