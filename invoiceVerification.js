// invoiceVerification.js

/**
 * LINE-ITEM MATH VERIFICATION ENGINE
 * Extracts line items from cleanedText and verifies math accuracy.
 */
export function verifyInvoiceTotals(invoice, cleanedText) {
  const result = {
    status: "Unverifiable",
    differenceAmount: 0,
    computedTotal: 0,
    declaredTotal: 0,
    mismatchedLines: []
  };

  if (!invoice || !cleanedText) return result;

  const declaredTotal = parseFloat(String(invoice.total).replace(/[^0-9.-]/g, ""));
  if (isNaN(declaredTotal)) return result;
  result.declaredTotal = declaredTotal;

  const lines = cleanedText.split('\n');
  let computedTotal = 0;
  let itemsFound = 0;

  // Patterns for line item detection
  // 1. item name + qty + unit price (e.g., "Item A 2 10.00" or "Item A 2 x 10.00")
  const qtyPriceRegex = /^(.*?)\s+(\d+)\s*(?:x|\*|\s)\s*([\d,]+\.\d{2})$/i;
  // 2. item name + amount (e.g., "1 AMUL MILK 30.00" or "Bread 25.00")
  const itemAmountRegex = /^(.*?)\s+([\d,]+\.\d{2})$/;

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let qty = 1;
    let price = 0;
    let lineAmount = 0;
    let matched = false;

    // Try Qty + Price pattern
    const qpMatch = trimmed.match(qtyPriceRegex);
    if (qpMatch) {
      qty = parseFloat(qpMatch[2]);
      price = parseFloat(qpMatch[3].replace(/,/g, ''));
      lineAmount = qty * price;
      matched = true;
    } else {
      // Try Item + Amount pattern
      const iaMatch = trimmed.match(itemAmountRegex);
      if (iaMatch) {
        // Special case: check if the "item name" starts with a quantity
        const namePart = iaMatch[1].trim();
        const qtyMatch = namePart.match(/^(\d+)\s+(.*)$/);
        
        price = parseFloat(iaMatch[2].replace(/,/g, ''));
        if (qtyMatch) {
          qty = parseFloat(qtyMatch[1]);
          // If it looks like a quantity (small integer), we use it
          if (qty > 0 && qty < 1000) {
             lineAmount = qty * price;
          } else {
             qty = 1;
             lineAmount = price;
          }
        } else {
          qty = 1;
          lineAmount = price;
        }
        matched = true;
      }
    }

    if (matched && !isNaN(lineAmount)) {
      computedTotal += lineAmount;
      itemsFound++;
      
      // Basic sanity check: if line item is suspiciously large compared to total
      if (lineAmount > declaredTotal * 1.5 && declaredTotal > 0) {
        result.mismatchedLines.push({
          index: index,
          reason: `Line amount ${lineAmount.toFixed(2)} exceeds declared total significantly`
        });
      }
    }
  });

  result.computedTotal = parseFloat(computedTotal.toFixed(2));
  result.differenceAmount = parseFloat((result.declaredTotal - result.computedTotal).toFixed(2));

  // Determine status
  if (itemsFound === 0) {
    result.status = "Unverifiable";
  } else if (Math.abs(result.differenceAmount) <= 0.01) {
    result.status = "Verified";
  } else {
    result.status = "Needs Review";
  }

  return result;
  }
        
