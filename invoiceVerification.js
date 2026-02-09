verification_content = '''// invoiceVerification.js

/**
 * PHASE-1 LOCKED: STRICT INVOICE VERIFICATION SYSTEM
 * Implements a 7-phase logic order for deterministic verification.
 * 
 * GUARANTEES:
 * - No inference or guessing of missing data.
 * - Line items require explicit qty + rate.
 * - Summary rows (tax, totals) are excluded from calculatedTotal.
 * - Deterministic math: calculatedTotal = sum(qty * rate).
 */
export function verifyInvoiceTotals(invoice, cleanedText) {
  const result = {
    status: "UNVERIFIABLE",
    message: "",
    differenceAmount: 0,
    computedTotal: 0,
    declaredTotal: 0,
    confidence: "0%",
    itemCount: 0
  };

  if (!cleanedText) return result;

  // PHASE 1 — INPUT NORMALIZATION
  const lines = cleanedText.split('\\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      // Normalize numbers: remove commas, preserve decimals
      // This regex identifies numbers with commas as thousand separators
      return line.replace(/(\\d),(\\d{3})/g, '$1$2');
    });

  // PHASE 2 — GLOBAL LINE CLASSIFICATION
  const metadataKeywords = [
    "invoice", "inv", "bill", "date", "gst", "gstin", "cgst", "sgst", "igst",
    "address", "phone", "mobile", "total", "subtotal", "tax", "amount", "grand"
  ];

  const classifiedLines = lines.map(line => {
    const lowerLine = line.toLowerCase();
    
    // Check for Metadata Line
    const isMetadata = metadataKeywords.some(kw => lowerLine.includes(kw));
    if (isMetadata) return { type: 'METADATA', text: line };

    // Check for Potential Line Item
    // 1. Contains alphabetic product word
    const hasAlpha = /[a-zA-Z]{3,}/.test(line);
    // 2. Extract numbers to check qty and rate
    const numbers = line.match(/\\d+\\.\\d{2}|\\d+/g) || [];
    let qty = null;
    let rate = null;

    for (const num of numbers) {
      const val = parseFloat(num);
      if (isNaN(val)) continue;
      
      // Quantity is a small integer (1–100)
      if (qty === null && Number.isInteger(val) && val >= 1 && val <= 100) {
        qty = val;
      } 
      // Rate is a reasonable price (>1 and <100000)
      else if (rate === null && val > 1 && val < 100000) {
        rate = val;
      }
      if (qty !== null && rate !== null) break;
    }

    if (hasAlpha && qty !== null && rate !== null) {
      return { type: 'ITEM', text: line, qty, rate };
    }

    return { type: 'UNKNOWN', text: line };
  });

  // PHASE 3 — LINE ITEM EXTRACTION
  const itemLines = classifiedLines.filter(l => l.type === 'ITEM');
  const itemTotals = itemLines.map(l => {
    // Compute itemTotal = qty × rate
    return parseFloat((l.qty * l.rate).toFixed(2));
  });
  
  result.itemCount = itemLines.length;

  if (itemTotals.length === 0) {
    result.computedTotal = 0;
    result.status = "UNVERIFIABLE";
    result.message = "No valid line items found.";
    result.confidence = "0%";
    // Skip to Phase 6 (Comparison logic for UNVERIFIABLE is handled there)
  } else {
    // PHASE 4 — CALCULATED TOTAL
    const sum = itemTotals.reduce((a, b) => a + b, 0);
    result.computedTotal = parseFloat(sum.toFixed(2));

    // PHASE 5 — INVOICE TOTAL EXTRACTION
    const metadataLines = classifiedLines.filter(l => l.type === 'METADATA');
    const totalKeywords = ["total amount", "grand total", "total"];
    let invoiceTotal = null;

    // Search Metadata lines for totals
    for (const kw of totalKeywords) {
      const matchingLines = metadataLines.filter(l => l.text.toLowerCase().includes(kw));
      if (matchingLines.length > 0) {
        // Extract the LAST occurrence in the text for that keyword type
        const targetLine = matchingLines[matchingLines.length - 1];
        const numbers = targetLine.text.replace(/(\\d),(\\d{3})/g, '$1$2').match(/\\d+\\.\\d{2}|\\d+/g) || [];
        if (numbers.length > 0) {
          // Prefer the largest numeric value in the line
          const lineNums = numbers.map(n => parseFloat(n)).filter(n => !isNaN(n));
          const maxInLine = Math.max(...lineNums);
          if (invoiceTotal === null || maxInLine > invoiceTotal) {
            invoiceTotal = maxInLine;
          }
        }
      }
      if (invoiceTotal !== null) break; 
    }

    if (invoiceTotal === null) {
      result.status = "UNVERIFIABLE";
      result.message = "No invoice total found in metadata.";
    } else {
      result.declaredTotal = parseFloat(invoiceTotal.toFixed(2));
      
      // PHASE 6 — COMPARISON LOGIC
      const difference = result.declaredTotal - result.computedTotal;
      result.differenceAmount = parseFloat(Math.abs(difference).toFixed(2));

      if (Math.abs(difference) < 1.0) {
        result.status = "MATCHED";
        result.message = "Invoice total matches calculated amount.";
      } else if (difference >= 1.0) {
        result.status = "INVOICE HIGHER THAN ITEMS";
        result.message = `You may have been overcharged ₹${result.differenceAmount.toFixed(2)}`;
      } else {
        result.status = "INVOICE LOWER THAN ITEMS";
        result.message = `Invoice total is ₹${result.differenceAmount.toFixed(2)} less than item sum`;
      }
    }
  }

  // PHASE 7 — CONFIDENCE SCORE
  // Confidence rules:
  // - No line items → 0%
  // - Line items + invoice total → 75%
  // - Line items + clear qty×rate + total → 90%
  // - Poor OCR → cap at 75% (We check for poor OCR by noise ratio)
  
  const rawText = lines.join(' ');
  const noiseChars = (rawText.match(/[^a-zA-Z0-9\\s.,₹]/g) || []).length;
  const isPoorOCR = (noiseChars / rawText.length) > 0.15;

  /**
   * PHASE-2 EXTENSION POINTS (FUTURE):
   * - File awareness (multi-page PDF support)
   * - OCR Redundancy (secondary engine validation)
   * - Table-aware extraction (coordinate-based grouping)
   */

  if (itemTotals.length === 0) {
    result.confidence = "0%";
  } else if (result.status === "UNVERIFIABLE") {
    result.confidence = "25%"; // Found items but no total
  } else {
    // We have items and a total
    let score = 75;
    // Check if items are "clear" (simple lines with just qty and rate)
    const clearItems = classifiedLines.filter(l => l.type === 'ITEM').every(l => {
        const nums = l.text.match(/\\d+/g) || [];
        return nums.length <= 3; // description, qty, rate, (maybe amount)
    });
    if (clearItems) score = 90;
    
    if (isPoorOCR) score = Math.min(score, 75);
    result.confidence = `${score}%`;
  }

  return result;
}
'''

