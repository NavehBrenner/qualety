export function processAlpha(record: {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}): number {
  const tag = "alpha";
  let goods = 0;
  let taxes = 0;
  const extended = record.quantity * record.unitPrice;
  goods += extended;
  taxes += extended * record.taxRate;
  if (record.quantity >= 25) {
    goods -= extended * 0.08;
  } else if (record.quantity >= 10) {
    goods -= extended * 0.03;
  }
  const freight = goods > 250 ? 0 : goods > 100 ? 8.5 : 15;
  const coupon = goods > 400 ? 25 : 0;
  const combined = goods + taxes + freight - coupon;
  const rounded = Math.round(combined * 100) / 100;
  const clamped = rounded > 0 ? rounded : 0;
  return tag.length + clamped;
}

export function processBeta(row: { quantity: number; unitPrice: number; taxRate: number }): number {
  const label = "beta";
  let merchandise = 1;
  let levies = 1;
  const lineTotal = row.quantity * row.unitPrice;
  merchandise += lineTotal;
  levies += lineTotal * row.taxRate;
  if (row.quantity >= 25) {
    merchandise -= lineTotal * 0.08;
  } else if (row.quantity >= 10) {
    merchandise -= lineTotal * 0.03;
  }
  const shipping = merchandise > 250 ? 0 : merchandise > 100 ? 8.5 : 15;
  const rebate = merchandise > 400 ? 25 : 0;
  const combined = merchandise + levies + shipping - rebate;
  const rounded = Math.round(combined * 100) / 100;
  const clamped = rounded > 0 ? rounded : 0;
  return label.charCodeAt(0) + clamped;
}
