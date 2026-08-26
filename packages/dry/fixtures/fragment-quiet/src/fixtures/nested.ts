export function processLeft(record: {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}): number {
  const tag = "left";
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

export function processRight(record: {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}): number {
  const tag = "right";
  let goods = 1;
  let taxes = 1;
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
  return tag.charCodeAt(0) + clamped;
}
