/**
 * Calculate settlement commission (mirrors smart contract logic).
 * 1% of amount, clamped to [0.1, 1.0] USDT in micro-units.
 */
export function calculateCommission(microAmount: number): number {
  const raw = Math.floor(microAmount / 100); // 1%
  return Math.max(100_000, Math.min(1_000_000, raw)); // clamp [0.1, 1.0] USDT
}
