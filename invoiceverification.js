/**
 * verifyInvoiceTotals
 * -------------------
 * Pure function to verify invoice total against calculated totals.
 */
export function verifyInvoiceTotals(invoice) {
  
  const TOLERANCE = 2;

  const warnings = [];

  if (!invoice || typeof invoice !== "object") {
    return {
      status: "Unverifiable",
      mismatch_amount: null,
      warnings: ["Invalid invoice data"]
    };
  }

  const { invoice_total, line_items, taxes } = invoice;

  // --- Invoice total must exist ---
  if (typeof invoice_total !== "number") {
    return {
      status: "Unverifiable",
      mismatch_amount: null,
      warnings: ["Invoice total missing or invalid"]
    };
  }

  // --- Calculate line items ---
  let itemsSum = 0;
  let validItemCount = 0;
  let skippedItemCount = 0;

  if (Array.isArray(line_items)) {
    for (const item of line_items) {
      if (!item || typeof item !== "object") {
        skippedItemCount++;
        continue;
      }

      if (typeof item.line_total === "number") {
        itemsSum += item.line_total;
        validItemCount++;
      } else if (
        typeof item.quantity === "number" &&
        typeof item.unit_price === "number"
      ) {
        itemsSum += item.quantity * item.unit_price;
        validItemCount++;
      } else {
        skippedItemCount++;
      }
    }
  }

  if (validItemCount === 0) {
    warnings.push("No calculable line items found");
  }

  if (skippedItemCount > 0) {
    warnings.push("Some line items could not be calculated");
  }

  // --- Calculate taxes ---
  let taxSum = 0;
  let taxCount = 0;
  let invalidTaxCount = 0;

  if (Array.isArray(taxes)) {
    for (const tax of taxes) {
      if (tax && typeof tax.tax_amount === "number") {
        taxSum += tax.tax_amount;
        taxCount++;
      } else {
        invalidTaxCount++;
      }
    }
  }

  if (taxCount === 0 && Array.isArray(taxes) && taxes.length > 0) {
    warnings.push("Tax entries present but not calculable");
  }

  // --- Can we calculate anything at all? ---
  if (validItemCount === 0 && taxCount === 0) {
    return {
      status: "Unverifiable",
      mismatch_amount: null,
      warnings: warnings.length
        ? warnings
        : ["Insufficient numeric data to verify invoice"]
    };
  }

  const calculatedTotal = itemsSum + taxSum;
  const diff = Math.abs(invoice_total - calculatedTotal);

  // --- VERIFIED ---
  if (diff <= TOLERANCE) {
    if (taxCount === 0) {
      warnings.push("Invoice verified without tax calculation");
    }

    return {
      status: "Verified",
      mismatch_amount: null,
      warnings
    };
  }

  // --- NEEDS REVIEW ---
  warnings.push("Total mismatch detected");
  warnings.push(
    `Calculated total differs by ₹${diff.toFixed(2)}`
  );

  return {
    status: "Needs Review",
    mismatch_amount: Number(diff.toFixed(2)),
    warnings
  };
