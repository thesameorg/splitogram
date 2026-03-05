import "@stdlib/deploy";
import "@stdlib/ownable";

// ── TEP-74 Jetton Messages ─────────────────────────────────────

// Incoming: our Jetton Wallet notifies us that tokens arrived
message(0x7362d09c) TokenNotification {
    queryId: Int as uint64;
    amount: Int as coins;
    from: Address;                    // original sender (User A)
    forward_payload: Slice as remaining;
}

// Outgoing: we tell our Jetton Wallet to send tokens
message(0xf8a7ea5) TokenTransfer {
    queryId: Int as uint64;
    amount: Int as coins;
    destination: Address;             // recipient owner address
    response_destination: Address;    // where to send excess TON
    custom_payload: Cell?;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

// ── Owner Messages ──────────────────────────────────────────────

message UpdateCommission {
    new_commission: Int as uint16;    // basis points, e.g. 100 = 1%
}

message WithdrawTon {
    amount: Int as coins;
}

message SetJettonWallet {
    wallet: Address;                  // manually set the trusted Jetton Wallet
}

// ── Data Structures ─────────────────────────────────────────────

struct Stats {
    total_processed: Int as coins;
    total_commission: Int as coins;
    settlement_count: Int as uint32;
}

// ── Settlement Contract ─────────────────────────────────────────

contract SplitogramSettlement with Deployable, Ownable {

    owner: Address;
    commission_bps: Int as uint16;      // basis points (100 = 1%)
    usdt_wallet: Address?;              // this contract's USDT Jetton Wallet address
    total_processed: Int as coins;
    total_commission: Int as coins;
    settlement_count: Int as uint32;

    init(owner: Address, commission_bps: Int) {
        self.owner = owner;
        require(commission_bps <= 1000, "Max 10%");
        self.commission_bps = commission_bps;
        self.usdt_wallet = null;
        self.total_processed = 0;
        self.total_commission = 0;
        self.settlement_count = 0;
    }

    // ── Receive Jetton notification (settlement trigger) ────────

    receive(msg: TokenNotification) {
        // Only accept from our known Jetton Wallet
        if (self.usdt_wallet == null) {
            // First time: trust the sender as our Jetton Wallet
            // NOTE: In production, verify against USDT Master's get_wallet_address
            self.usdt_wallet = sender();
        } else {
            require(sender() == self.usdt_wallet!!, "Unknown Jetton wallet");
        }

        // Decode forward_payload: op(32 bits) + recipient address
        let op: Int = msg.forward_payload.loadUint(32);
        require(op == 0, "Unknown operation");
        let recipient: Address = msg.forward_payload.loadAddress();

        // Calculate commission (basis points)
        let commission: Int = (msg.amount * self.commission_bps) / 10000;

        // Enforce minimum commission: 0.1 USDT = 100_000 units (6 decimals)
        let minCommission: Int = 100000;
        if (commission < minCommission) {
            commission = minCommission;
        }

        let remainder: Int = msg.amount - commission;
        require(remainder > 0, "Amount too small");

        // Update stats
        self.total_processed = self.total_processed + msg.amount;
        self.total_commission = self.total_commission + commission;
        self.settlement_count = self.settlement_count + 1;

        // Send remainder to recipient
        self._sendJetton(
            recipient,
            remainder,
            msg.from,       // excess gas returns to original sender
            msg.queryId
        );

        // Send commission to owner
        self._sendJetton(
            self.owner,
            commission,
            self.owner,
            msg.queryId
        );
    }

    // ── Internal: send Jettons via our Jetton Wallet ────────────

    fun _sendJetton(to: Address, amount: Int, responseAddr: Address, queryId: Int) {
        send(SendParameters{
            to: self.usdt_wallet!!,
            value: ton("0.06"),         // gas for one Jetton transfer
            mode: 0,
            body: TokenTransfer{
                queryId: queryId,
                amount: amount,
                destination: to,
                response_destination: responseAddr,
                custom_payload: null,
                forward_ton_amount: 0,
                forward_payload: emptySlice()
            }.toCell()
        });
    }

    // ── Owner: set Jetton Wallet manually ───────────────────────

    receive(msg: SetJettonWallet) {
        self.requireOwner();
        self.usdt_wallet = msg.wallet;
    }

    // ── Owner: update commission ─────────────────────────────────

    receive(msg: UpdateCommission) {
        self.requireOwner();
        require(msg.new_commission <= 1000, "Max 10%");
        self.commission_bps = msg.new_commission;
    }

    // ── Owner: withdraw excess TON ───────────────────────────────

    receive(msg: WithdrawTon) {
        self.requireOwner();
        require(msg.amount > 0, "Amount must be positive");
        send(SendParameters{
            to: self.owner,
            value: msg.amount,
            mode: SendRemainingValue,
            body: "withdraw".asComment()
        });
    }

    // ── Bounce handler ───────────────────────────────────────────
    // If an outgoing Jetton transfer fails, log it.
    // In production, implement refund logic here.

    bounced(src: bounced<TokenTransfer>) {
        // Bounced transfer — the Jetton transfer failed.
        // For testnet, we just absorb it.
        // Production TODO: track failed transfers and allow owner to retry/refund.
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
