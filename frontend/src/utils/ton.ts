import { beginCell, Address } from '@ton/core';
import type { SettlementTxParams } from '../services/api';

/**
 * Convert any TON address (raw 0:hex or user-friendly) to bounceable user-friendly format.
 * TonConnect SDK requires user-friendly format in sendTransaction messages.
 */
export function toFriendly(addr: string): string {
  return Address.parse(addr).toString({ bounceable: true });
}

/**
 * Build a Jetton transfer message body for settlement via the Splitogram contract.
 *
 * The message is sent TO the sender's USDT Jetton Wallet, which transfers tokens
 * to the settlement contract. The contract splits: commission to owner, remainder to recipient.
 *
 * The total amount sent = debt + commission, so the recipient receives the full debt amount.
 *
 * forward_payload is stored inline (not as ref) — validated on testnet.
 */
export function buildSettlementBody(params: SettlementTxParams): string {
  const body = beginCell()
    .storeUint(0xf8a7ea5, 32) // op: jetton_transfer
    .storeUint(0, 64) // query_id
    .storeCoins(BigInt(params.totalAmount)) // jetton amount = debt + commission
    .storeAddress(Address.parse(params.contractAddress)) // destination: settlement contract
    .storeAddress(Address.parse(params.contractAddress)) // response_destination: excess gas back
    .storeBit(false) // no custom_payload
    .storeCoins(BigInt(params.forwardTonAmount)) // forward_ton_amount (gas for contract)
    // inline forward_payload (no Either bit, no ref — validated on testnet)
    .storeUint(0, 32) // op = 0 (settlement)
    .storeAddress(Address.parse(params.recipientAddress)) // who receives remainder
    .endCell();

  return body.toBoc().toString('base64');
}

/**
 * Truncate a TON address for display: EQBx...f7Ru
 */
export function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}
