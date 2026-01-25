        // invoiceVerification.js
export function verifyInvoiceTotals(invoice) {
  const warnings = [];

  if (!invoice || !Array.isArray(invoice.items) || invoice.items.length === 0) {
    return {
      status: "Unverifiable",
      mismatch_amount: null,
      warnings: ["No line items found"]
    };
  }

  const safeNumber = v =>
    typeof v === "number"
      ? v
      : Number(String(v).replace(/[^0-9.-]/g, ""));

  const calculatedSubtotal = invoice.items.reduce((sum, item) => {
    const qty = safeNumber(item.qty || 1);
    const price = safeNumber(item.price);
    return sum + qty * price;
  }, 0);

  const tax = safeNumber(invoice.tax || 0);
  const calculatedTotal = +(calculatedSubtotal + tax).toFixed(2);
  const reportedTotal = safeNumber(invoice.total);

  if (Number.isNaN(reportedTotal)) {
    return {
      status: "Unverifiable",
      mismatch_amount: null,
      warnings: ["Invoice total missing or invalid"]
    };
  }

  const diff = +(reportedTotal - calculatedTotal).toFixed(2);

  if (Math.abs(diff) <= 0.01) {
    return {
      status: "Verified",
      mismatch_amount: 0,
      warnings
    };
  }

  return {
    status: "Needs Review",
    mismatch_amount: diff,
    warnings: [`Mismatch detected: ${diff}`]
  };
}
