/**
 * Exactly rounded floating-point sum, a port of CPython's `math.fsum`.
 * `statistics.fmean` is `fsum(data) / len(data)`, so using this keeps period means
 * identical to the Python reference rather than merely close.
 */
export function fsum(values: readonly number[]): number {
  const partials: number[] = [];
  for (const value of values) {
    let x = value;
    let i = 0;
    for (let j = 0; j < partials.length; j++) {
      let y = partials[j] as number;
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }

  let n = partials.length;
  let hi = 0;
  if (n > 0) {
    hi = partials[--n] as number;
    let lo = 0;
    while (n > 0) {
      const x = hi;
      const y = partials[--n] as number;
      hi = x + y;
      lo = y - (hi - x);
      if (lo !== 0) break;
    }
    const next = partials[n - 1];
    if (n > 0 && next !== undefined && ((lo < 0 && next < 0) || (lo > 0 && next > 0))) {
      const y = lo * 2;
      const x = hi + y;
      if (y === x - hi) hi = x;
    }
  }
  return hi;
}

/** `statistics.fmean` for a non-empty list. */
export function fmean(values: readonly number[]): number {
  return fsum(values) / values.length;
}
