# Create invoiceVerification.js
verification_content = '''export function verifyInvoiceTotals(parsed, rawText, items = []) {
  const result = {
    status: "Unverifiable",
    computedTotal: 0,
    declaredTotal: parseFloat(parsed.total) || 0,
    differenceAmount: 0,
    itemCount: items.length
  };

  // If we have items, calculate from them
  if (items.length > 0) {
    result.computedTotal = items.reduce((sum, item) => sum + (item.amount || 0), 0);
  } else {
    // Try to extract from text patterns
    const amountMatches = rawText.match(/(\\d+\\.\\d{2})/g) || [];
    const amounts = amountMatches.map(a => parseFloat(a)).filter(a => a > 0);
    
    // Use largest amount as likely total, or sum of line items if we can identify them
    if (amounts.length > 0) {
      // Sort descending
      amounts.sort((a, b) => b - a);
      // If declared total matches one of the amounts, use second largest as computed
      const declaredIndex = amounts.indexOf(result.declaredTotal);
      if (declaredIndex > -1 && amounts.length > 1) {
        // Sum all except the declared total (assuming it's the final total)
        result.computedTotal = amounts.slice(1).reduce((a, b) => a + b, 0);
      } else {
        // Can't determine, use largest as computed
        result.computedTotal = amounts[0];
      }
    }
  }

  result.differenceAmount = result.computedTotal - result.declaredTotal;
  
  if (items.length > 0) {
    result.status = Math.abs(result.differenceAmount) <= 0.01 ? "Verified" : "Mismatch";
  } else if (result.computedTotal > 0) {
    result.status = Math.abs(result.differenceAmount) <= 0.01 ? "Verified" : "Partial";
  }

  return result;
}'''

