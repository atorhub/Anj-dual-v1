// invoiceVerification.js

export function verifyInvoiceTotals(invoice, cleanedText) {
  const result = {
    status: "Unverifiable",
    differenceAmount: 0,
    computedTotal: 0,
    declaredTotal: 0,
    mismatchedLines: []
  };

  if (!cleanedText) return result;

  // --- STEP 1: TEXT NORMALIZATION ---
  const rows = cleanedText.split('\n').map(row => {
    return row
      .replace(/[₹]|Rs\.?/gi, '') // Remove currency symbols
      .replace(/(\d),(\d)/g, '$1$2') // Convert numbers with commas (12,932.00 -> 12932.00)
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim();
  }).filter(row => row.length > 0);

  // Helper for Step 2 & 5: Keywords for classification
  const SUMMARY_KEYWORDS = [
    "subtotal", "sub total", "tax", "gst", "cgst", "sgst", "igst",
    "total", "net", "payable", "amount due"
  ];

  let calculatedTotal = 0;
  let validItemsCount = 0;
  let extractedInvoiceTotal = null;

  rows.forEach((row, index) => {
    const lowerRow = row.toLowerCase();

    // --- STEP 2: ROW CLASSIFICATION ---
    const isSummaryRow = SUMMARY_KEYWORDS.some(kw => lowerRow.includes(kw));

    if (isSummaryRow) {
      // --- STEP 5: INVOICE TOTAL EXTRACTION (Part 1: Extract from summary rows) ---
      // We look for the last number in the row as it's usually the total/subtotal
      const numbers = row.match(/\d+\.\d{2}|\d+/g);
      if (numbers) {
        const val = parseFloat(numbers[numbers.length - 1]);
        if (!isNaN(val)) {
          // Prefer explicit "total" over others
          if (lowerRow.includes("total") || lowerRow.includes("payable") || lowerRow.includes("amount due") || extractedInvoiceTotal === null) {
            extractedInvoiceTotal = val;
          }
        }
      }
      return; // Summary rows contribute ZERO to calculatedTotal
    }

    // POTENTIAL ITEM ROW CHECK
    const numericTokens = row.match(/\d+\.\d{2}|\d+/g) || [];
    if (numericTokens.length < 2) return; // Must have at least two numeric tokens

    // --- STEP 3: ITEM ROW VALIDATION ---
    // Extract qty and rate
    // Heuristic: Qty is usually a small integer (1-1000), Rate is a number > 0
    let qty = null;
    let rate = null;

    for (let token of numericTokens) {
      const val = parseFloat(token);
      if (isNaN(val)) continue;

      if (qty === null && Number.isInteger(val) && val >= 1 && val <= 1000) {
        qty = val;
      } else if (rate === null && val > 0 && val < 100000) {
        rate = val;
      }
      
      if (qty !== null && rate !== null) break;
    }

    if (qty !== null && rate !== null) {
      const lineItemTotal = parseFloat((qty * rate).toFixed(2));
      
      // --- STEP 4: CALCULATED TOTAL ---
      calculatedTotal += lineItemTotal;
      validItemsCount++;
    }
  });

  // --- STEP 5: INVOICE TOTAL EXTRACTION (Part 2: Use provided total if extraction failed) ---
  if (extractedInvoiceTotal === null && invoice && invoice.total) {
    const fallbackTotal = parseFloat(String(invoice.total).replace(/,/g, ''));
    if (!isNaN(fallbackTotal)) {
      extractedInvoiceTotal = fallbackTotal;
    }
  }

  result.computedTotal = parseFloat(calculatedTotal.toFixed(2));
  result.declaredTotal = extractedInvoiceTotal !== null ? parseFloat(extractedInvoiceTotal.toFixed(2)) : 0;

  // --- STEP 6: COMPARISON ---
  result.differenceAmount = parseFloat((result.declaredTotal - result.computedTotal).toFixed(2));

  if (validItemsCount === 0 || extractedInvoiceTotal === null) {
    result.status = "Unverifiable";
  } else if (Math.abs(result.differenceAmount) <= 0.01) {
    result.status = "Verified";
  } else {
    result.status = "Needs Review";
  }

  return result;
}
