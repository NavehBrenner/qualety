export function processAlpha(record: { quantity: number; unitPrice: number }): number {
  const seed = record.quantity * record.unitPrice;
  function helperAlpha(value: number): number {
    const doubled = value * 2;
    const shifted = doubled + 11;
    const folded = shifted * shifted;
    const clipped = folded > 50 ? folded - 7 : folded + 3;
    const scaled = clipped * 1.5;
    const rounded = Math.round(scaled);
    const labeled = rounded + "alpha".length;
    return labeled > 0 ? labeled : 1;
  }
  return seed + helperAlpha(seed);
}

export function processBeta(record: { quantity: number; unitPrice: number }): number {
  const seed = record.quantity * record.unitPrice;
  function helperBeta(value: number): number {
    let acc = 1;
    for (let i = 0; i < 6; i += 1) {
      acc += i * value;
      acc = acc % 97;
    }
    const flipped = acc < 10 ? acc + 40 : acc;
    const mixed = flipped * 3 + record.quantity;
    return mixed > 0 ? mixed : 2;
  }
  return seed + helperBeta(seed);
}
