import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano, beginCell, Address } from '@ton/core';
import { SplitogramSettlement } from '../build/SplitogramSettlement/tact_SplitogramSettlement';
import '@ton/test-utils';

describe('SplitogramSettlement', () => {
    let blockchain: Blockchain;
    let contract: SandboxContract<SplitogramSettlement>;
    let owner: SandboxContract<TreasuryContract>;
    let userA: SandboxContract<TreasuryContract>;
    let userB: SandboxContract<TreasuryContract>;
    let jettonWallet: SandboxContract<TreasuryContract>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        owner = await blockchain.treasury('owner');
        userA = await blockchain.treasury('userA');
        userB = await blockchain.treasury('userB');
        jettonWallet = await blockchain.treasury('jettonWallet');

        contract = blockchain.openContract(
            await SplitogramSettlement.fromInit(owner.address, 100n)
        );

        const deployResult = await contract.send(
            owner.getSender(),
            { value: toNano('0.5') },
            { $$type: 'Deploy', queryId: 0n }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: owner.address,
            to: contract.address,
            deploy: true,
            success: true,
        });

        // Set the trusted Jetton Wallet (required before any settlement)
        await contract.send(
            owner.getSender(),
            { value: toNano('0.05') },
            { $$type: 'SetJettonWallet', wallet: jettonWallet.address }
        );
    });

    async function sendSettlement(
        from: SandboxContract<TreasuryContract>,
        sender: SandboxContract<TreasuryContract>,
        amount: bigint,
        recipient: Address
    ) {
        const forwardPayload = beginCell()
            .storeUint(0, 32)
            .storeAddress(recipient)
            .endCell()
            .asSlice();

        return await contract.send(
            sender.getSender(),
            { value: toNano('0.5') },
            {
                $$type: 'TokenNotification',
                queryId: 0n,
                amount: amount,
                from: from.address,
                forward_payload: forwardPayload,
            }
        );
    }

    it('should deploy correctly with initial state', async () => {
        const commission = await contract.getCommission();
        expect(commission).toBe(100n);

        const stats = await contract.getStats();
        expect(stats.total_processed).toBe(0n);
        expect(stats.total_commission).toBe(0n);
        expect(stats.settlement_count).toBe(0n);

        const wallet = await contract.getJettonWallet();
        expect(wallet!.equals(jettonWallet.address)).toBe(true);

        const contractOwner = await contract.getOwner();
        expect(contractOwner.equals(owner.address)).toBe(true);
    });

    it('should process settlement: 100 USDT → 99 to recipient, 1 to owner', async () => {
        const amount = 100_000_000n;

        const result = await sendSettlement(userA, jettonWallet, amount, userB.address);

        expect(result.transactions).toHaveTransaction({
            from: contract.address,
            to: jettonWallet.address,
            success: true,
        });

        const stats = await contract.getStats();
        expect(stats.total_processed).toBe(amount);
        expect(stats.total_commission).toBe(1_000_000n);
        expect(stats.settlement_count).toBe(1n);
    });

    it('should enforce minimum commission of 0.1 USDT', async () => {
        const amount = 5_000_000n;

        const result = await sendSettlement(userA, jettonWallet, amount, userB.address);

        expect(result.transactions).toHaveTransaction({
            from: contract.address,
            to: jettonWallet.address,
            success: true,
        });

        const stats = await contract.getStats();
        expect(stats.total_commission).toBe(100_000n);
        expect(stats.total_processed).toBe(amount);
    });

    it('should cap commission at 1 USDT max', async () => {
        const amount = 500_000_000n;

        const result = await sendSettlement(userA, jettonWallet, amount, userB.address);

        expect(result.transactions).toHaveTransaction({
            from: contract.address,
            to: jettonWallet.address,
            success: true,
        });

        const stats = await contract.getStats();
        expect(stats.total_commission).toBe(1_000_000n);
        expect(stats.total_processed).toBe(amount);
    });

    it('should reject amount too small after commission', async () => {
        const amount = 50_000n;

        const result = await sendSettlement(userA, jettonWallet, amount, userB.address);

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: contract.address,
            success: false,
        });
    });

    it('should reject settlement if jetton wallet not configured', async () => {
        // Deploy a fresh contract without SetJettonWallet
        const fresh = blockchain.openContract(
            await SplitogramSettlement.fromInit(owner.address, 100n)
        );
        // Different init params to get a different address
        const fresh2 = blockchain.openContract(
            await SplitogramSettlement.fromInit(owner.address, 99n)
        );
        await fresh2.send(
            owner.getSender(),
            { value: toNano('0.5') },
            { $$type: 'Deploy', queryId: 0n }
        );

        const result = await sendSettlementTo(fresh2, userA, jettonWallet, 100_000_000n, userB.address);

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: fresh2.address,
            success: false,
        });
    });

    it('should reject unknown Jetton Wallet', async () => {
        const fakeWallet = await blockchain.treasury('fakeWallet');
        const result = await sendSettlement(userA, fakeWallet, 100_000_000n, userB.address);

        expect(result.transactions).toHaveTransaction({
            from: fakeWallet.address,
            to: contract.address,
            success: false,
        });
    });

    it('should allow owner to update commission', async () => {
        const result = await contract.send(
            owner.getSender(),
            { value: toNano('0.05') },
            { $$type: 'UpdateCommission', new_commission: 200n }
        );

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: contract.address,
            success: true,
        });

        const commission = await contract.getCommission();
        expect(commission).toBe(200n);
    });

    it('should reject commission update from non-owner', async () => {
        const result = await contract.send(
            userA.getSender(),
            { value: toNano('0.05') },
            { $$type: 'UpdateCommission', new_commission: 200n }
        );

        expect(result.transactions).toHaveTransaction({
            from: userA.address,
            to: contract.address,
            success: false,
        });

        const commission = await contract.getCommission();
        expect(commission).toBe(100n);
    });

    it('should reject commission > 10% (1000 bps)', async () => {
        const result = await contract.send(
            owner.getSender(),
            { value: toNano('0.05') },
            { $$type: 'UpdateCommission', new_commission: 1001n }
        );

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: contract.address,
            success: false,
        });
    });

    it('should allow owner to withdraw TON', async () => {
        await owner.send({ to: contract.address, value: toNano('2'), bounce: false });

        const result = await contract.send(
            owner.getSender(),
            { value: toNano('0.1') },
            { $$type: 'WithdrawTon', amount: toNano('0.5') }
        );

        expect(result.transactions).toHaveTransaction({
            from: contract.address,
            to: owner.address,
            success: true,
        });
    });

    it('should reject TON withdrawal from non-owner', async () => {
        const result = await contract.send(
            userA.getSender(),
            { value: toNano('0.5') },
            { $$type: 'WithdrawTon', amount: toNano('0.1') }
        );

        expect(result.transactions).toHaveTransaction({
            from: userA.address,
            to: contract.address,
            success: false,
        });
    });

    it('should allow owner to set Jetton Wallet', async () => {
        const newWallet = await blockchain.treasury('newWallet');
        const result = await contract.send(
            owner.getSender(),
            { value: toNano('0.05') },
            { $$type: 'SetJettonWallet', wallet: newWallet.address }
        );

        expect(result.transactions).toHaveTransaction({
            from: owner.address,
            to: contract.address,
            success: true,
        });

        const wallet = await contract.getJettonWallet();
        expect(wallet!.equals(newWallet.address)).toBe(true);
    });

    it('should reject SetJettonWallet from non-owner', async () => {
        const result = await contract.send(
            userA.getSender(),
            { value: toNano('0.05') },
            { $$type: 'SetJettonWallet', wallet: jettonWallet.address }
        );

        expect(result.transactions).toHaveTransaction({
            from: userA.address,
            to: contract.address,
            success: false,
        });
    });

    it('should use updated commission for subsequent settlements', async () => {
        await contract.send(
            owner.getSender(),
            { value: toNano('0.05') },
            { $$type: 'UpdateCommission', new_commission: 200n }
        );

        const amount = 30_000_000n;
        await sendSettlement(userA, jettonWallet, amount, userB.address);

        const stats = await contract.getStats();
        expect(stats.total_commission).toBe(600_000n); // 2% of 30 = 0.6 USDT
    });

    it('should accumulate stats across multiple settlements', async () => {
        await sendSettlement(userA, jettonWallet, 100_000_000n, userB.address);
        await sendSettlement(userA, jettonWallet, 50_000_000n, userB.address);
        await sendSettlement(userA, jettonWallet, 200_000_000n, userB.address);

        const stats = await contract.getStats();
        expect(stats.total_processed).toBe(350_000_000n);
        // 1% of 100 = 1 (=max) + 1% of 50 = 0.5 + 1% of 200 = 2 (capped to 1) = 2.5 USDT
        expect(stats.total_commission).toBe(2_500_000n);
        expect(stats.settlement_count).toBe(3n);
    });

    it('should reject invalid forward_payload (wrong op)', async () => {
        const badPayload = beginCell()
            .storeUint(1, 32)
            .storeAddress(userB.address)
            .endCell()
            .asSlice();

        const result = await contract.send(
            jettonWallet.getSender(),
            { value: toNano('0.5') },
            {
                $$type: 'TokenNotification',
                queryId: 0n,
                amount: 100_000_000n,
                from: userA.address,
                forward_payload: badPayload,
            }
        );

        expect(result.transactions).toHaveTransaction({
            from: jettonWallet.address,
            to: contract.address,
            success: false,
        });
    });
});

// Helper for sending to a different contract instance
async function sendSettlementTo(
    target: SandboxContract<SplitogramSettlement>,
    from: SandboxContract<TreasuryContract>,
    sender: SandboxContract<TreasuryContract>,
    amount: bigint,
    recipient: Address
) {
    const forwardPayload = beginCell()
        .storeUint(0, 32)
        .storeAddress(recipient)
        .endCell()
        .asSlice();

    return await target.send(
        sender.getSender(),
        { value: toNano('0.5') },
        {
            $$type: 'TokenNotification',
            queryId: 0n,
            amount: amount,
            from: from.address,
            forward_payload: forwardPayload,
        }
    );
}
