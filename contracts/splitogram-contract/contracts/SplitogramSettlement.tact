import "@stdlib/deploy";
import "@stdlib/ownable";

// ── TEP-74 Jetton Messages ─────────────────────────────────────

message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;
    forward_payload: Slice as remaining;
}

message(0xf8a7ea5) TokenTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;
    response_destination: Address;
    custom_payload: Cell?;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

// ── Owner Messages ──────────────────────────────────────────────

message UpdateCommission {
    new_commission: Int as uint16;
}

message WithdrawTon {
    amount: Int as coins;
}

message SetJettonWallet {
    wallet: Address;
}

// ── Data Structures ─────────────────────────────────────────────

struct Stats {
    total_processed: Int as coins;
    total_commission: Int as coins;
    settlement_count: Int as uint32;
}

// ── Constants ───────────────────────────────────────────────────

const MIN_COMMISSION: Int = 100000;     // 0.1 USDT (6 decimals)
const MAX_COMMISSION: Int = 1000000;    // 1.0 USDT (6 decimals)
const MAX_BPS: Int = 1000;              // 10% hard cap
const GAS_PER_TRANSFER: Int = 150000000; // 0.15 TON

// ── Settlement Contract ─────────────────────────────────────────

contract SplitogramSettlement with Deployable, Ownable {

    owner: Address;
    commission_bps: Int as uint16;
    usdt_wallet: Address?;
    total_processed: Int as coins;
    total_commission: Int as coins;
    settlement_count: Int as uint32;

    init(owner: Address, commission_bps: Int) {
        self.owner = owner;
        require(commission_bps <= MAX_BPS, "Max 10%");
        self.commission_bps = commission_bps;
        self.usdt_wallet = null;
        self.total_processed = 0;
        self.total_commission = 0;
        self.settlement_count = 0;
    }

    // ── Receive Jetton notification (settlement trigger) ────────

    receive(msg: TokenNotification) {
        // Require usdt_wallet to be set via SetJettonWallet before first settlement.
        // This prevents trust-on-first-use attacks where an attacker sends a fake
        // TokenNotification from a malicious jetton wallet to claim the trusted slot.
        require(self.usdt_wallet != null, "Jetton wallet not configured");
        require(sender() == self.usdt_wallet!!, "Unknown Jetton wallet");

        let op: Int = msg.forward_payload.loadUint(32);
        require(op == 0, "Unknown operation");
        let recipient: Address = msg.forward_payload.loadAddress();

        // Commission: percentage with min/max clamp
        let commission: Int = (msg.amount * self.commission_bps) / 10000;
        if (commission < MIN_COMMISSION) {
            commission = MIN_COMMISSION;
        }
        if (commission > MAX_COMMISSION) {
            commission = MAX_COMMISSION;
        }

        let remainder: Int = msg.amount - commission;
        require(remainder > 0, "Amount too small");

        self.total_processed = self.total_processed + msg.amount;
        self.total_commission = self.total_commission + commission;
        self.settlement_count = self.settlement_count + 1;

        // Send remainder to recipient
        self._sendJetton(recipient, remainder, msg.from, msg.queryId);

        // Send commission to owner
        self._sendJetton(self.owner, commission, self.owner, msg.queryId);
    }

    // ── Internal: send Jettons via our Jetton Wallet ────────────

    fun _sendJetton(to: Address, amount: Int, responseAddr: Address, queryId: Int) {
        send(SendParameters{
            to: self.usdt_wallet!!,
            value: GAS_PER_TRANSFER,
            mode: 0,
            body: TokenTransfer{
                queryId: queryId,
                amount: amount,
                destination: to,
                response_destination: responseAddr,
                custom_payload: null,
                forward_ton_amount: 0,
                forward_payload: beginCell().storeUint(0, 1).asSlice()
            }.toCell()
        });
    }

    // ── Owner: set trusted Jetton Wallet address ─────────────────
    // Must be called before the contract can accept settlements.
    // Set this to the contract's USDT Jetton Wallet address
    // (query USDT Master's get_wallet_address with this contract's address).

    receive(msg: SetJettonWallet) {
        self.requireOwner();
        self.usdt_wallet = msg.wallet;
    }

    // ── Owner: update commission ─────────────────────────────────

    receive(msg: UpdateCommission) {
        self.requireOwner();
        require(msg.new_commission <= MAX_BPS, "Max 10%");
        self.commission_bps = msg.new_commission;
    }

    // ── Owner: withdraw excess TON ───────────────────────────────

    receive(msg: WithdrawTon) {
        self.requireOwner();
        require(msg.amount > 0, "Amount must be positive");
        send(SendParameters{
            to: self.owner,
            value: msg.amount,
            mode: 0,
            body: "withdraw".asComment()
        });
    }

    // ── Bounce handler ───────────────────────────────────────────
    // If an outgoing Jetton transfer bounces, the tokens return to the contract's
    // jetton wallet. Owner can recover them via a manual TokenTransfer.
    // Stats are already incremented — treat bounced settlements as exceptions
    // requiring manual resolution.

    bounced(src: bounced<TokenTransfer>) {
        // No automatic refund — owner monitors and resolves manually.
        // The bounced jetton amount stays in the contract's jetton wallet.
    }

    // ── Getters ──────────────────────────────────────────────────

    get fun commission(): Int {
        return self.commission_bps;
    }

    get fun stats(): Stats {
        return Stats{
            total_processed: self.total_processed,
            total_commission: self.total_commission,
            settlement_count: self.settlement_count
        };
    }

    get fun jetton_wallet(): Address? {
        return self.usdt_wallet;
    }
}
