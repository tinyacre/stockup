// Reads a Quantity typed as a product of pack counts, such as "3 × 6" or "3 提 × 6 包" for three bundles of six packs.
export function parseQuantity(text: string): number | null {
  let quantity = 1;
  for (const factor of text.trim().split(/\s*[×✕xX*＊]\s*/)) {
    const count = /^([1-9]\d*)\s*\p{Script=Han}*$/u.exec(factor)?.[1];
    if (count === undefined) return null;
    quantity *= Number(count);
  }
  return Number.isSafeInteger(quantity) ? quantity : null;
}
