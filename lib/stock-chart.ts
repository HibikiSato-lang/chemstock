/** A zero-based litre scale with readable, evenly spaced tick labels. */
export function quantityAxis(largestAmount: number) {
  const padded = Number.isFinite(largestAmount) && largestAmount > 0 ? largestAmount * 1.08 : 1;
  const roughStep = padded / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const factor = [1, 2, 2.5, 5, 10].find((candidate) => candidate >= roughStep / magnitude) ?? 10;
  const step = factor * magnitude;
  const intervals = Math.ceil(padded / step);
  const maximum = Number((intervals * step).toPrecision(12));
  const digits = Math.min(12, Math.max(0, -Math.floor(Math.log10(magnitude))) + (factor === 2.5 ? 1 : 0));
  const formatter = new Intl.NumberFormat("ja-JP", { maximumFractionDigits: digits });
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => {
    const value = Number((index * step).toPrecision(12));
    return { value, label: formatter.format(value) };
  });
  return { maximum, ticks };
}
