export class BillingTotals {
  compute(lines: ReadonlyArray<{ quantity: number; unitPrice: number; taxRate: number }>): number {
    let goods = 0;
    let taxes = 0;
    for (const line of lines) {
      const extended = line.quantity * line.unitPrice;
      goods += extended;
      taxes += extended * line.taxRate;
    }
    const freight = goods > 250 ? 0 : 15;
    const coupon = goods > 400 ? 25 : 0;
    return goods + taxes + freight - coupon;
  }
}
