//! LiteSVM integration tests for the Fairway program (run `anchor build` first so target/deploy/fairway.so exists).
use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    fairway::{state::*, ConfigUpdate, ScoreEntry, PYTH_RECEIVER_PROGRAM, PRICE_UPDATE_V2_DISCRIMINATOR},
    fairway_math::{fee_on_input, swap_quote, withdraw, MIN_LIQUIDITY},
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program_pack::Pack,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

const RETAIL: u8 = 0;
const STANDARD: u8 = 1;
const TOXIC: u8 = 2;
const FEES: [u16; 3] = [5, 30, 80];
const TTL: u64 = 1_000;
const SOL: u64 = 1_000_000_000;
const USDC: u64 = 1_000_000;

struct Env {
    svm: LiteSVM,
    admin: Keypair,
    authority: Keypair,
    base_mint: Pubkey,
    quote_mint: Pubkey,
    pool: Pubkey,
    base_vault: Pubkey,
    quote_vault: Pubkey,
    lp_mint: Pubkey,
}

fn pda(seeds: &[&[u8]]) -> Pubkey {
    Pubkey::find_program_address(seeds, &fairway::id()).0
}
fn config_pda() -> Pubkey {
    pda(&[b"config"])
}
fn treasury_pda() -> Pubkey {
    pda(&[b"treasury"])
}
fn score_pda(trader: &Pubkey) -> Pubkey {
    pda(&[b"score", trader.as_ref()])
}

fn set_mint(svm: &mut LiteSVM, decimals: u8) -> Pubkey {
    let key = Pubkey::new_unique();
    let mint = spl_token::state::Mint { decimals, is_initialized: true, supply: u64::MAX / 2, ..Default::default() };
    let mut data = vec![0u8; spl_token::state::Mint::LEN];
    mint.pack_into_slice(&mut data);
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner: spl_token::ID, executable: false, rent_epoch: 0 }).unwrap();
    key
}

fn set_token_account(svm: &mut LiteSVM, mint: &Pubkey, owner: &Pubkey, amount: u64) -> Pubkey {
    let key = Pubkey::new_unique();
    let acc = spl_token::state::Account { mint: *mint, owner: *owner, amount, state: spl_token::state::AccountState::Initialized, ..Default::default() };
    let mut data = vec![0u8; spl_token::state::Account::LEN];
    acc.pack_into_slice(&mut data);
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner: spl_token::ID, executable: false, rent_epoch: 0 }).unwrap();
    key
}

fn token_balance(svm: &LiteSVM, key: &Pubkey) -> u64 {
    spl_token::state::Account::unpack(&svm.get_account(key).unwrap().data).unwrap().amount
}

fn send(svm: &mut LiteSVM, ixs: &[Instruction], payer: &Keypair, extra: &[&Keypair]) -> Result<(), String> {
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(ixs, Some(&payer.pubkey()), &bh);
    let mut signers: Vec<&Keypair> = vec![payer];
    signers.extend_from_slice(extra);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &signers).unwrap();
    let res = svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{:?}", e.err));
    svm.expire_blockhash();
    res
}

fn new_user(svm: &mut LiteSVM) -> Keypair {
    let k = Keypair::new();
    svm.airdrop(&k.pubkey(), 10 * SOL).unwrap();
    k
}

fn pool_state(env: &Env) -> Pool {
    Pool::try_deserialize(&mut &env.svm.get_account(&env.pool).unwrap().data[..]).unwrap()
}

fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/fairway.so"));
    svm.add_program(fairway::id(), bytes).unwrap();
    let admin = new_user(&mut svm);
    let authority = new_user(&mut svm);
    let base_mint = set_mint(&mut svm, 9);
    let quote_mint = set_mint(&mut svm, 6);
    let pool = pda(&[b"pool", base_mint.as_ref(), quote_mint.as_ref()]);
    let base_vault = pda(&[b"vault", pool.as_ref(), base_mint.as_ref()]);
    let quote_vault = pda(&[b"vault", pool.as_ref(), quote_mint.as_ref()]);
    let lp_mint = pda(&[b"lp_mint", pool.as_ref()]);
    let mut env = Env { svm, admin, authority, base_mint, quote_mint, pool, base_vault, quote_vault, lp_mint };

    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::InitializeConfig { score_authority: env.authority.pubkey(), fee_bps: FEES, score_ttl_slots: TTL }.data(),
        fairway::accounts::InitializeConfig { admin: env.admin.pubkey(), config: config_pda(), system_program: system_program::ID }.to_account_metas(None),
    );
    let admin = env.admin.insecure_clone();
    send(&mut env.svm, &[ix], &admin, &[]).unwrap();

    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::CreatePool {}.data(),
        fairway::accounts::CreatePool {
            payer: env.admin.pubkey(),
            base_mint,
            quote_mint,
            pool,
            base_vault,
            quote_vault,
            lp_mint,
            token_program: spl_token::ID,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &admin, &[]).unwrap();
    env
}

struct Lp {
    owner: Keypair,
    base: Pubkey,
    quote: Pubkey,
    lp: Pubkey,
}

fn new_lp(env: &mut Env, base: u64, quote: u64) -> Lp {
    let owner = new_user(&mut env.svm);
    let (bm, qm, lm) = (env.base_mint, env.quote_mint, env.lp_mint);
    Lp {
        base: set_token_account(&mut env.svm, &bm, &owner.pubkey(), base),
        quote: set_token_account(&mut env.svm, &qm, &owner.pubkey(), quote),
        lp: set_token_account(&mut env.svm, &lm, &owner.pubkey(), 0),
        owner,
    }
}

fn liquidity_accounts(env: &Env, lp: &Lp) -> Vec<anchor_lang::solana_program::instruction::AccountMeta> {
    fairway::accounts::Liquidity {
        owner: lp.owner.pubkey(),
        pool: env.pool,
        base_mint: env.base_mint,
        quote_mint: env.quote_mint,
        base_vault: env.base_vault,
        quote_vault: env.quote_vault,
        lp_mint: env.lp_mint,
        owner_base: lp.base,
        owner_quote: lp.quote,
        owner_lp: lp.lp,
        token_program: spl_token::ID,
    }
    .to_account_metas(None)
}

fn add_liquidity(env: &mut Env, lp: &Lp, max_base: u64, max_quote: u64, min_lp: u64) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(fairway::id(), &fairway::instruction::AddLiquidity { max_base, max_quote, min_lp }.data(), liquidity_accounts(env, lp));
    let o = lp.owner.insecure_clone();
    send(&mut env.svm, &[ix], &o, &[])
}

fn remove_liquidity(env: &mut Env, lp: &Lp, lp_amount: u64, min_base: u64, min_quote: u64) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(fairway::id(), &fairway::instruction::RemoveLiquidity { lp_amount, min_base, min_quote }.data(), liquidity_accounts(env, lp));
    let o = lp.owner.insecure_clone();
    send(&mut env.svm, &[ix], &o, &[])
}

/// a funded pool: 10,000 SOL / 1,500,000 USDC
fn seeded() -> (Env, Lp) {
    let mut env = setup();
    let lp = new_lp(&mut env, 20_000 * SOL, 3_000_000 * USDC);
    add_liquidity(&mut env, &lp, 10_000 * SOL, 1_500_000 * USDC, 1).unwrap();
    (env, lp)
}

struct Trader {
    kp: Keypair,
    base: Pubkey,
    quote: Pubkey,
}

fn new_trader(env: &mut Env) -> Trader {
    let kp = new_user(&mut env.svm);
    let (bm, qm) = (env.base_mint, env.quote_mint);
    Trader { base: set_token_account(&mut env.svm, &bm, &kp.pubkey(), 1_000 * SOL), quote: set_token_account(&mut env.svm, &qm, &kp.pubkey(), 1_000_000 * USDC), kp }
}

fn swap_ix(env: &Env, t: &Trader, score_account: Pubkey, amount_in: u64, min_out: u64, a_to_b: bool) -> Instruction {
    Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::Swap { amount_in, min_amount_out: min_out, a_to_b }.data(),
        fairway::accounts::Swap {
            trader: t.kp.pubkey(),
            config: config_pda(),
            pool: env.pool,
            trader_score: score_account,
            base_mint: env.base_mint,
            quote_mint: env.quote_mint,
            base_vault: env.base_vault,
            quote_vault: env.quote_vault,
            trader_base: t.base,
            trader_quote: t.quote,
            token_program: spl_token::ID,
            system_program: system_program::ID,
            treasury: treasury_pda(),
        }
        .to_account_metas(None),
    )
}

fn swap(env: &mut Env, t: &Trader, amount_in: u64, min_out: u64, a_to_b: bool) -> Result<(), String> {
    let ix = swap_ix(env, t, score_pda(&t.kp.pubkey()), amount_in, min_out, a_to_b);
    let k = t.kp.insecure_clone();
    send(&mut env.svm, &[ix], &k, &[])
}

fn set_score_ix(_env: &Env, signer: &Pubkey, trader: Pubkey, tier: u8) -> Instruction {
    Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::SetScore { trader, tier, score_bps: if tier == TOXIC { 35 } else { 0 }, trades: 12 }.data(),
        fairway::accounts::SetScore { authority: *signer, config: config_pda(), score: score_pda(&trader), system_program: system_program::ID }.to_account_metas(None),
    )
}

fn set_score(env: &mut Env, trader: Pubkey, tier: u8) {
    let a = env.authority.insecure_clone();
    let ix = set_score_ix(env, &a.pubkey(), trader, tier);
    send(&mut env.svm, &[ix], &a, &[]).unwrap();
}

/// executes a quote→base swap of `usdc` and returns (base received, fee charged, tier index used)
fn buy_and_measure(env: &mut Env, t: &Trader, usdc: u64) -> (u64, u64, usize) {
    let before = token_balance(&env.svm, &t.base);
    let pool_before = pool_state(env);
    let rq = token_balance(&env.svm, &env.quote_vault) - pool_before.protocol_owed_quote;
    let rb = token_balance(&env.svm, &env.base_vault) - pool_before.protocol_owed_base;
    swap(env, t, usdc, 1, false).unwrap();
    let got = token_balance(&env.svm, &t.base) - before;
    let p = pool_state(env);
    let tier = (0..3).find(|&i| p.swaps[i] != pool_before.swaps[i]).unwrap();
    let fee = p.fees_quote[tier] - pool_before.fees_quote[tier];
    // matches the pure math crate exactly
    let q = swap_quote(usdc, rq, rb, FEES[tier]).unwrap();
    assert_eq!(got, q.amount_out);
    assert_eq!(fee, q.fee);
    (got, fee, tier)
}

#[test]
fn happy_path_unknown_wallet_pays_standard() {
    let (mut env, _lp) = seeded();
    let p = pool_state(&env);
    assert_eq!(token_balance(&env.svm, &env.base_vault), 10_000 * SOL);
    assert_eq!(p.lp_supply, fairway_math::isqrt(10_000u128 * SOL as u128 * 1_500_000 * USDC as u128) as u64);
    let t = new_trader(&mut env);
    let (out, fee, tier) = buy_and_measure(&mut env, &t, 1_500 * USDC);
    assert_eq!(tier, STANDARD as usize);
    assert_eq!(fee, fee_on_input(1_500 * USDC, 30).unwrap());
    assert!(out > 9 * SOL && out < 10 * SOL);
    // sell back base → quote
    let before = token_balance(&env.svm, &t.quote);
    swap(&mut env, &t, SOL, 1, true).unwrap();
    assert!(token_balance(&env.svm, &t.quote) > before);
    assert_eq!(pool_state(&env).fees_base[STANDARD as usize], fee_on_input(SOL, 30).unwrap());
}

#[test]
fn fee_per_tier() {
    let (mut env, _lp) = seeded();
    let rita = new_trader(&mut env);
    let bot = new_trader(&mut env);
    let newbie = new_trader(&mut env);
    set_score(&mut env, rita.kp.pubkey(), RETAIL);
    set_score(&mut env, bot.kp.pubkey(), TOXIC);
    let (_, f_r, t_r) = buy_and_measure(&mut env, &rita, 1_000 * USDC);
    let (_, f_n, t_n) = buy_and_measure(&mut env, &newbie, 1_000 * USDC);
    let (_, f_b, t_b) = buy_and_measure(&mut env, &bot, 1_000 * USDC);
    assert_eq!((t_r, t_n, t_b), (0, 1, 2));
    assert_eq!(f_r, 500_000); // 5 bps of 1,000 USDC
    assert_eq!(f_n, 3_000_000); // 30 bps
    assert_eq!(f_b, 8_000_000); // 80 bps
}

#[test]
fn wrong_signer_cannot_use_someone_elses_retail_score() {
    let (mut env, _lp) = seeded();
    let rita = new_trader(&mut env);
    let bot = new_trader(&mut env);
    set_score(&mut env, rita.kp.pubkey(), RETAIL);
    set_score(&mut env, bot.kp.pubkey(), TOXIC);
    // the bot signs, but passes Rita's RETAIL score PDA
    let ix = swap_ix(&env, &bot, score_pda(&rita.kp.pubkey()), 1_000 * USDC, 1, false);
    let k = bot.kp.insecure_clone();
    let err = send(&mut env.svm, &[ix], &k, &[]).unwrap_err();
    assert!(err.contains("Custom(2006)"), "expected ConstraintSeeds, got {err}");
    // a random program-owned account (e.g. the config) is rejected too
    let ix = swap_ix(&env, &bot, config_pda(), 1_000 * USDC, 1, false);
    assert!(send(&mut env.svm, &[ix], &k, &[]).is_err());
    // nothing was traded; with its own PDA the bot pays TOXIC
    assert_eq!(pool_state(&env).swaps, [0, 0, 0]);
    let (_, _, tier) = buy_and_measure(&mut env, &bot, 1_000 * USDC);
    assert_eq!(tier, TOXIC as usize);
}

#[test]
fn stale_score_falls_back_to_standard() {
    let (mut env, _lp) = seeded();
    let rita = new_trader(&mut env);
    set_score(&mut env, rita.kp.pubkey(), RETAIL);
    let slot = env.svm.get_sysvar::<anchor_lang::prelude::Clock>().slot;
    env.svm.warp_to_slot(slot + TTL); // exactly at TTL: still fresh
    assert_eq!(buy_and_measure(&mut env, &rita, 100 * USDC).2, RETAIL as usize);
    env.svm.warp_to_slot(slot + TTL + 1);
    assert_eq!(buy_and_measure(&mut env, &rita, 100 * USDC).2, STANDARD as usize);
    // refreshed by the keeper → RETAIL again
    set_score(&mut env, rita.kp.pubkey(), RETAIL);
    assert_eq!(buy_and_measure(&mut env, &rita, 100 * USDC).2, RETAIL as usize);
}

#[test]
fn slippage_failure() {
    let (mut env, _lp) = seeded();
    let t = new_trader(&mut env);
    let rq = token_balance(&env.svm, &env.quote_vault);
    let rb = token_balance(&env.svm, &env.base_vault);
    let q = swap_quote(1_000 * USDC, rq, rb, 30).unwrap();
    let err = swap(&mut env, &t, 1_000 * USDC, q.amount_out + 1, false).unwrap_err();
    assert!(err.contains("Custom(6005)"), "{err}");
    swap(&mut env, &t, 1_000 * USDC, q.amount_out, false).unwrap();
    // zero amount
    assert!(swap(&mut env, &t, 0, 0, false).unwrap_err().contains("Custom(6006)"));
}

#[test]
fn unauthorized_set_score_and_config() {
    let (mut env, _lp) = seeded();
    let bot = new_trader(&mut env);
    // the bot tries to make itself RETAIL
    let ix = set_score_ix(&env, &bot.kp.pubkey(), bot.kp.pubkey(), RETAIL);
    let k = bot.kp.insecure_clone();
    let err = send(&mut env.svm, &[ix], &k, &[]).unwrap_err();
    assert!(err.contains("Custom(6001)"), "{err}");
    // invalid tier from the real authority
    let a = env.authority.insecure_clone();
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::SetScore { trader: bot.kp.pubkey(), tier: 3, score_bps: 0, trades: 1 }.data(),
        fairway::accounts::SetScore { authority: a.pubkey(), config: config_pda(), score: score_pda(&bot.kp.pubkey()), system_program: system_program::ID }.to_account_metas(None),
    );
    assert!(send(&mut env.svm, &[ix], &a, &[]).unwrap_err().contains("Custom(6004)"));
    // non-admin config update
    let upd = |admin: Pubkey, update: ConfigUpdate| {
        Instruction::new_with_bytes(fairway::id(), &fairway::instruction::UpdateConfig { update }.data(), fairway::accounts::UpdateConfig { admin, config: config_pda() }.to_account_metas(None))
    };
    let ix = upd(bot.kp.pubkey(), ConfigUpdate { fee_bps: Some([0, 0, 0]), ..Default::default() });
    assert!(send(&mut env.svm, &[ix], &k, &[]).unwrap_err().contains("Custom(6000)"));
    // admin cannot set a default tier below STANDARD or an unordered schedule
    let admin = env.admin.insecure_clone();
    let ix = upd(admin.pubkey(), ConfigUpdate { default_tier: Some(RETAIL), ..Default::default() });
    assert!(send(&mut env.svm, &[ix], &admin, &[]).unwrap_err().contains("Custom(6003)"));
    let ix = upd(admin.pubkey(), ConfigUpdate { fee_bps: Some([50, 30, 80]), ..Default::default() });
    assert!(send(&mut env.svm, &[ix], &admin, &[]).unwrap_err().contains("Custom(6002)"));
    // valid update applies
    let ix = upd(admin.pubkey(), ConfigUpdate { fee_bps: Some([10, 30, 100]), ..Default::default() });
    send(&mut env.svm, &[ix], &admin, &[]).unwrap();
    let c = Config::try_deserialize(&mut &env.svm.get_account(&config_pda()).unwrap().data[..]).unwrap();
    assert_eq!(c.fee_bps, [10, 30, 100]);
}

#[test]
fn first_deposit_edge_cases() {
    let mut env = setup();
    let lp = new_lp(&mut env, 10 * SOL, 10 * USDC);
    // sqrt(1000 * 1000) = 1000 = MIN_LIQUIDITY → nothing for the depositor → rejected
    assert!(add_liquidity(&mut env, &lp, 1_000, 1_000, 0).unwrap_err().contains("Custom(6008)"));
    assert!(add_liquidity(&mut env, &lp, 0, 1_000, 0).unwrap_err().contains("Custom(6006)"));
    // min_lp slippage on the first deposit
    assert!(add_liquidity(&mut env, &lp, 4_000, 4_000, 3_001).unwrap_err().contains("Custom(6005)"));
    add_liquidity(&mut env, &lp, 4_000, 4_000, 3_000).unwrap();
    assert_eq!(token_balance(&env.svm, &lp.lp), 3_000);
    assert_eq!(pool_state(&env).lp_supply, 4_000); // includes locked MIN_LIQUIDITY
    // the locked units can never be withdrawn
    assert!(remove_liquidity(&mut env, &lp, 3_001, 0, 0).is_err());
    // second deposit is proportional (uses the limiting side)
    let lp2 = new_lp(&mut env, 10 * SOL, 10 * USDC);
    add_liquidity(&mut env, &lp2, 2_000, 9_000, 1).unwrap();
    assert_eq!(token_balance(&env.svm, &lp2.lp), 2_000);
    assert_eq!(token_balance(&env.svm, &env.quote_vault), 6_000);
}

#[test]
fn remove_liquidity_proportionality() {
    let (mut env, lp) = seeded();
    let t = new_trader(&mut env);
    swap(&mut env, &t, 50_000 * USDC, 1, false).unwrap();
    let held = token_balance(&env.svm, &lp.lp);
    let supply = pool_state(&env).lp_supply;
    assert_eq!(held, supply - MIN_LIQUIDITY);
    let po = pool_state(&env);
    let rb = token_balance(&env.svm, &env.base_vault) - po.protocol_owed_base;
    let rq = token_balance(&env.svm, &env.quote_vault) - po.protocol_owed_quote;
    let quarter = held / 4;
    let (eb, eq) = withdraw(quarter, rb, rq, supply).unwrap();
    let (b0, q0) = (token_balance(&env.svm, &lp.base), token_balance(&env.svm, &lp.quote));
    assert!(remove_liquidity(&mut env, &lp, quarter, eb + 1, eq).unwrap_err().contains("Custom(6005)"));
    remove_liquidity(&mut env, &lp, quarter, eb, eq).unwrap();
    assert_eq!(token_balance(&env.svm, &lp.base) - b0, eb);
    assert_eq!(token_balance(&env.svm, &lp.quote) - q0, eq);
    assert_eq!(token_balance(&env.svm, &lp.lp), held - quarter);
    assert_eq!(pool_state(&env).lp_supply, supply - quarter);
    // share of reserves is exactly proportional (up to floor rounding)
    assert!((eb as u128) * (supply as u128) <= quarter as u128 * rb as u128);
    assert!((eb as u128 + 1) * (supply as u128) > quarter as u128 * rb as u128);
}

#[test]
fn batch_scores_and_close() {
    let (mut env, _lp) = seeded();
    let traders: Vec<Trader> = (0..3).map(|_| new_trader(&mut env)).collect();
    let entries: Vec<ScoreEntry> = traders
        .iter()
        .zip([RETAIL, TOXIC, STANDARD])
        .map(|(t, tier)| ScoreEntry { trader: t.kp.pubkey(), tier, score_bps: tier as i32 * 10, trades: 7 })
        .collect();
    let batch_ix = |entries: Vec<ScoreEntry>, accounts: Vec<Pubkey>, authority: Pubkey| {
        let mut metas = fairway::accounts::SetScoresBatch { authority, config: config_pda(), system_program: system_program::ID }.to_account_metas(None);
        metas.extend(accounts.into_iter().map(|k| anchor_lang::solana_program::instruction::AccountMeta::new(k, false)));
        Instruction::new_with_bytes(fairway::id(), &fairway::instruction::SetScoresBatch { entries }.data(), metas)
    };
    let a = env.authority.insecure_clone();
    let pdas: Vec<Pubkey> = traders.iter().map(|t| score_pda(&t.kp.pubkey())).collect();
    // mismatched account order is rejected
    let mut wrong = pdas.clone();
    wrong.swap(0, 1);
    assert!(send(&mut env.svm, &[batch_ix(entries.clone(), wrong, a.pubkey())], &a, &[]).unwrap_err().contains("Custom(6013)"));
    // creates all three, then updates in place
    send(&mut env.svm, &[batch_ix(entries.clone(), pdas.clone(), a.pubkey())], &a, &[]).unwrap();
    let mut upd = entries.clone();
    upd[0].tier = TOXIC;
    send(&mut env.svm, &[batch_ix(upd, pdas.clone(), a.pubkey())], &a, &[]).unwrap();
    let s0 = TraderScore::try_deserialize(&mut &env.svm.get_account(&pdas[0]).unwrap().data[..]).unwrap();
    assert_eq!((s0.trader, s0.tier, s0.trades), (traders[0].kp.pubkey(), TOXIC, 7));
    assert_eq!(buy_and_measure(&mut env, &traders[1], 100 * USDC).2, TOXIC as usize);
    // non-authority batch is rejected
    let bot = traders[1].kp.insecure_clone();
    assert!(send(&mut env.svm, &[batch_ix(entries.clone(), pdas.clone(), bot.pubkey())], &bot, &[]).unwrap_err().contains("Custom(6001)"));

    // close: a stranger cannot; the trader can, and then pays STANDARD (closing never lowers a fee below STANDARD)
    let close_ix = |closer: Pubkey, trader: Pubkey, receiver: Pubkey| {
        Instruction::new_with_bytes(
            fairway::id(),
            &fairway::instruction::CloseScore {}.data(),
            fairway::accounts::CloseScore { closer, config: config_pda(), treasury: treasury_pda(), score: score_pda(&trader), rent_receiver: receiver }.to_account_metas(None),
        )
    };
    let stranger = new_user(&mut env.svm);
    let tox = traders[1].kp.pubkey();
    assert!(send(&mut env.svm, &[close_ix(stranger.pubkey(), tox, a.pubkey())], &stranger, &[]).unwrap_err().contains("Custom(6014)"));
    // rent must go back to the trader, not anyone else
    assert!(send(&mut env.svm, &[close_ix(bot.pubkey(), tox, a.pubkey())], &bot, &[]).is_err());
    send(&mut env.svm, &[close_ix(bot.pubkey(), tox, bot.pubkey())], &bot, &[]).unwrap();
    assert!(env.svm.get_account(&pdas[1]).map_or(true, |acc| acc.data.is_empty()));
    assert_eq!(buy_and_measure(&mut env, &traders[1], 100 * USDC).2, STANDARD as usize);
}


// ======================================================================================
// M13: onchain markout scoring
// ======================================================================================

const FEED: [u8; 32] = [7u8; 32];
const MARKOUT_SLOTS: u64 = 75;
const MAX_SETTLE: u64 = 450;
const HISTORY: u64 = 100;
const PRIOR: u64 = 2_000 * USDC;
const ONCHAIN_MIN: u64 = 1_000 * USDC;
/// onchain price fixed point (fairway_math::markout::PRICE_SCALE)
const PX: u64 = 1_000_000_000_000;

fn clock(env: &Env) -> anchor_lang::prelude::Clock {
    env.svm.get_sysvar::<anchor_lang::prelude::Clock>()
}

/// advance slots and wall-clock time (400 ms per slot)
fn warp(env: &mut Env, slots: u64) {
    let mut c = clock(env);
    let slot = c.slot + slots;
    env.svm.warp_to_slot(slot);
    c.slot = slot;
    c.unix_timestamp += (slots * 2 / 5) as i64 + 1;
    env.svm.set_sysvar(&c);
}

struct Oracle {
    key: Pubkey,
}

/// a mock Pyth `PriceUpdateV2` (pyth-solana-receiver-sdk layout), price in USD with expo -8
fn write_price(env: &mut Env, key: Pubkey, owner: Pubkey, feed: [u8; 32], mid_e6: u64, conf: u64, publish_time: i64, posted_slot: u64) {
    let price = (mid_e6 * 100) as i64; // 1e6 → 1e8 (expo -8)
    let mut d = Vec::with_capacity(134);
    d.extend_from_slice(&PRICE_UPDATE_V2_DISCRIMINATOR);
    d.extend_from_slice(&[9u8; 32]); // write authority
    d.push(1); // VerificationLevel::Full
    d.extend_from_slice(&feed);
    d.extend_from_slice(&price.to_le_bytes());
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&(-8i32).to_le_bytes());
    d.extend_from_slice(&publish_time.to_le_bytes());
    d.extend_from_slice(&(publish_time - 1).to_le_bytes());
    d.extend_from_slice(&price.to_le_bytes());
    d.extend_from_slice(&conf.to_le_bytes());
    d.extend_from_slice(&posted_slot.to_le_bytes());
    env.svm.set_account(key, Account { lamports: 1_000_000_000, data: d, owner, executable: false, rent_epoch: 0 }).unwrap();
}

/// a fresh, valid oracle update at the current slot/time
fn post_mid(env: &mut Env, o: &Oracle, mid_e6: u64) {
    let c = clock(env);
    write_price(env, o.key, PYTH_RECEIVER_PROGRAM, FEED, mid_e6, mid_e6 / 10_000, c.unix_timestamp, c.slot);
}

fn set_pool_oracle(env: &mut Env, pool: Pubkey, price_account: Pubkey, feed_id: [u8; 32]) {
    let admin = env.admin.insecure_clone();
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::SetPoolOracle { price_account, feed_id }.data(),
        fairway::accounts::SetPoolOracle { admin: admin.pubkey(), config: config_pda(), pool }.to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &admin, &[]).unwrap();
}

fn markout_env() -> (Env, Lp, Oracle) {
    let (mut env, lp) = seeded();
    let mut c = clock(&env);
    c.unix_timestamp = 1_763_000_000;
    env.svm.set_sysvar(&c);
    let o = Oracle { key: Pubkey::new_unique() };
    let params = MarkoutParams {
        markout_slots: MARKOUT_SLOTS,
        max_settle_slots: MAX_SETTLE,
        prior_notional: PRIOR,
        onchain_min_notional: ONCHAIN_MIN,
        retail_min_history_slots: HISTORY,
        ..MarkoutParams::default()
    };
    let admin = env.admin.insecure_clone();
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::UpdateConfig { update: ConfigUpdate { markout: Some(params), ..Default::default() } }.data(),
        fairway::accounts::UpdateConfig { admin: admin.pubkey(), config: config_pda() }.to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &admin, &[]).unwrap();
    let pool = env.pool;
    set_pool_oracle(&mut env, pool, o.key, FEED);
    post_mid(&mut env, &o, 150 * USDC);
    (env, lp, o)
}

fn score_of(env: &Env, trader: &Pubkey) -> TraderScore {
    TraderScore::try_deserialize(&mut &env.svm.get_account(&score_pda(trader)).unwrap().data[..]).unwrap()
}

fn settle_ix(cranker: Pubkey, trader: Pubkey, score: Pubkey, pool: Pubkey, oracle: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::SettleMarkout { trader }.data(),
        fairway::accounts::SettleMarkout { cranker, config: config_pda(), score, pool, pyth_price: oracle }.to_account_metas(None),
    )
}

/// settle `trader` from a random permissionless cranker
fn settle(env: &mut Env, trader: &Pubkey, oracle: Pubkey) -> Result<(), String> {
    let cranker = new_user(&mut env.svm);
    let ix = settle_ix(cranker.pubkey(), *trader, score_pda(trader), env.pool, oracle);
    send(&mut env.svm, &[ix], &cranker, &[])
}

fn pending_count(s: &TraderScore) -> usize {
    s.pending.iter().filter(|p| p.notional != 0).count()
}

fn params() -> fairway_math::markout::TierParams {
    MarkoutParams { prior_notional: PRIOR, retail_min_history_slots: HISTORY, ..MarkoutParams::default() }.tier_params()
}

#[test]
fn swap_records_pending_trade_and_creates_score_pda() {
    let (mut env, _lp, _o) = markout_env();
    let t = new_trader(&mut env);
    assert!(env.svm.get_account(&score_pda(&t.kp.pubkey())).map_or(true, |a| a.data.is_empty()));
    buy_and_measure(&mut env, &t, 1_500 * USDC);
    let s = score_of(&env, &t.kp.pubkey());
    assert_eq!(s.trader, t.kp.pubkey());
    assert_eq!(s.tier, STANDARD); // neutral bootstrap default, never RETAIL
    assert_eq!(pending_count(&s), 1);
    let p = s.pending[0];
    let fee = fee_on_input(1_500 * USDC, 30).unwrap();
    assert_eq!((p.side, p.notional, p.slot), (fairway_math::markout::SIDE_BUY, 1_500 * USDC - fee, clock(&env).slot));
    // pre-fee price ≈ 150 USDC/SOL plus a little price impact
    // 1e12 fixed point
    assert!(p.exec_price > 150 * PX && p.exec_price < 151 * PX, "{}", p.exec_price);
    assert_eq!(p.pool, env.pool);
}

#[test]
fn markout_sign_buy_and_sell() {
    use fairway_math::markout::*;
    let (mut env, _lp, o) = markout_env();
    let buyer = new_trader(&mut env);
    let seller = new_trader(&mut env);
    swap(&mut env, &buyer, 1_000 * USDC, 1, false).unwrap();
    swap(&mut env, &seller, 5 * SOL, 1, true).unwrap();
    let (pb, ps) = (score_of(&env, &buyer.kp.pubkey()).pending[0], score_of(&env, &seller.kp.pubkey()).pending[0]);
    assert_eq!((pb.side, ps.side), (SIDE_BUY, SIDE_SELL));
    warp(&mut env, MARKOUT_SLOTS);
    post_mid(&mut env, &o, 160 * USDC); // price went UP after both trades
    settle(&mut env, &buyer.kp.pubkey(), o.key).unwrap();
    settle(&mut env, &seller.kp.pubkey(), o.key).unwrap();
    let (sb, ss) = (score_of(&env, &buyer.kp.pubkey()), score_of(&env, &seller.kp.pubkey()));
    let mb = markout_bps(SIDE_BUY, pb.exec_price, 160 * PX).unwrap();
    let ms = markout_bps(SIDE_SELL, ps.exec_price, 160 * PX).unwrap();
    assert!(mb > 600 && ms < -600, "buy {mb} sell {ms}");
    assert_eq!(sb.sum_weighted_markout, pb.notional as i128 * mb as i128);
    assert_eq!(ss.sum_weighted_markout, ps.notional as i128 * ms as i128);
    assert!(sb.onchain_score_bps > 0 && ss.onchain_score_bps < 0);
    assert_eq!((sb.trade_count, pending_count(&sb)), (1, 0));
}

#[test]
fn settle_before_markout_slots_does_nothing() {
    let (mut env, _lp, o) = markout_env();
    let t = new_trader(&mut env);
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    let before = score_of(&env, &t.kp.pubkey());
    warp(&mut env, MARKOUT_SLOTS - 1);
    post_mid(&mut env, &o, 200 * USDC);
    settle(&mut env, &t.kp.pubkey(), o.key).unwrap();
    let after = score_of(&env, &t.kp.pubkey());
    assert_eq!(after.pending, before.pending);
    assert_eq!((after.sum_notional, after.sum_weighted_markout, after.trade_count), (0, 0, 0));
    // even a bogus oracle account is not touched when nothing is due
    settle(&mut env, &t.kp.pubkey(), Pubkey::new_unique()).unwrap();
    // one slot later it settles
    warp(&mut env, 1);
    post_mid(&mut env, &o, 150 * USDC);
    settle(&mut env, &t.kp.pubkey(), o.key).unwrap();
    assert_eq!(score_of(&env, &t.kp.pubkey()).trade_count, 1);
}

#[test]
fn stale_and_invalid_oracle_rejected() {
    let (mut env, _lp, o) = markout_env();
    let t = new_trader(&mut env);
    let tk = t.kp.pubkey();
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    warp(&mut env, MARKOUT_SLOTS);
    let c = clock(&env);
    let code = |r: Result<(), String>| r.unwrap_err();
    // stale: published 61 s ago (limit 60)
    write_price(&mut env, o.key, PYTH_RECEIVER_PROGRAM, FEED, 150 * USDC, 0, c.unix_timestamp - 61, c.slot);
    assert!(code(settle(&mut env, &tk, o.key)).contains("Custom(6018)"));
    // from the future
    write_price(&mut env, o.key, PYTH_RECEIVER_PROGRAM, FEED, 150 * USDC, 0, c.unix_timestamp + 60, c.slot);
    assert!(code(settle(&mut env, &tk, o.key)).contains("Custom(6018)"));
    // wrong feed id
    write_price(&mut env, o.key, PYTH_RECEIVER_PROGRAM, [8u8; 32], 150 * USDC, 0, c.unix_timestamp, c.slot);
    assert!(code(settle(&mut env, &tk, o.key)).contains("Custom(6017)"));
    // not owned by the Pyth receiver (anyone can create an account with the right bytes)
    write_price(&mut env, o.key, Pubkey::new_unique(), FEED, 150 * USDC, 0, c.unix_timestamp, c.slot);
    assert!(code(settle(&mut env, &tk, o.key)).contains("Custom(6017)"));
    // confidence too wide: 1% > 0.5%
    write_price(&mut env, o.key, PYTH_RECEIVER_PROGRAM, FEED, 150 * USDC, 150 * USDC, c.unix_timestamp, c.slot);
    assert!(code(settle(&mut env, &tk, o.key)).contains("Custom(6019)"));
    // a valid-looking price account at a different address
    let other = Pubkey::new_unique();
    write_price(&mut env, other, PYTH_RECEIVER_PROGRAM, FEED, 150 * USDC, 0, c.unix_timestamp, c.slot);
    assert!(code(settle(&mut env, &tk, other)).contains("Custom(6016)"));
    // partially verified update / garbage
    let mut acc = env.svm.get_account(&other).unwrap();
    acc.data[40] = 0;
    env.svm.set_account(o.key, acc).unwrap();
    assert!(code(settle(&mut env, &tk, o.key)).contains("Custom(6017)"));
    // price posted BEFORE the trade's horizon: accepted oracle, but the trade stays pending
    write_price(&mut env, o.key, PYTH_RECEIVER_PROGRAM, FEED, 150 * USDC, 0, c.unix_timestamp, c.slot - MARKOUT_SLOTS);
    settle(&mut env, &tk, o.key).unwrap();
    assert_eq!(pending_count(&score_of(&env, &tk)), 1);
    // nothing was ever scored by the rejected attempts
    assert_eq!(score_of(&env, &tk).trade_count, 0);
    post_mid(&mut env, &o, 150 * USDC);
    settle(&mut env, &tk, o.key).unwrap();
    assert_eq!(score_of(&env, &tk).trade_count, 1);
}

#[test]
fn pool_without_oracle_is_not_scored_onchain() {
    let (mut env, _lp) = seeded();
    let t = new_trader(&mut env);
    let tk = t.kp.pubkey();
    // no oracle on the pool: the swap works, creates no score account, charges no rent, queues nothing
    let bal0 = env.svm.get_balance(&tk).unwrap();
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    assert_eq!(bal0 - env.svm.get_balance(&tk).unwrap(), 5_000);
    assert!(env.svm.get_account(&score_pda(&tk)).map_or(true, |a| a.data.is_empty()));
    // a keeper RETAIL score still works, and never hits the full-buffer cap (nothing is queued)
    set_score(&mut env, tk, RETAIL);
    for _ in 0..6 {
        assert_eq!(buy_and_measure(&mut env, &t, 100 * USDC).2, RETAIL as usize);
    }
    let s = score_of(&env, &tk);
    assert_eq!((pending_count(&s), s.dropped_trades, s.trade_count), (0, 0, 0));
}

#[test]
fn settle_fails_if_the_pool_oracle_is_removed() {
    let (mut env, _lp, o) = markout_env();
    let t = new_trader(&mut env);
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    warp(&mut env, MARKOUT_SLOTS);
    post_mid(&mut env, &o, 150 * USDC);
    let pool = env.pool;
    set_pool_oracle(&mut env, pool, Pubkey::default(), [0u8; 32]);
    assert!(settle(&mut env, &t.kp.pubkey(), o.key).unwrap_err().contains("Custom(6015)")); // OracleNotConfigured
    // pointing the pool at a different feed id makes the (valid-looking) account invalid for it
    set_pool_oracle(&mut env, pool, o.key, [9u8; 32]);
    assert!(settle(&mut env, &t.kp.pubkey(), o.key).unwrap_err().contains("Custom(6017)"));
}

/// a second pool with its own mints and oracle, on the same program/config
struct Pool2 {
    pool: Pubkey,
    base_mint: Pubkey,
    quote_mint: Pubkey,
    base_vault: Pubkey,
    quote_vault: Pubkey,
}
fn create_pool2(env: &mut Env) -> Pool2 {
    let base_mint = set_mint(&mut env.svm, 5); // a 5-decimal memecoin-like mint
    let quote_mint = env.quote_mint; // shares USDC with pool 1
    let pool = pda(&[b"pool", base_mint.as_ref(), quote_mint.as_ref()]);
    let base_vault = pda(&[b"vault", pool.as_ref(), base_mint.as_ref()]);
    let quote_vault = pda(&[b"vault", pool.as_ref(), quote_mint.as_ref()]);
    let lp_mint = pda(&[b"lp_mint", pool.as_ref()]);
    let admin = env.admin.insecure_clone();
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::CreatePool {}.data(),
        fairway::accounts::CreatePool { payer: admin.pubkey(), base_mint, quote_mint, pool, base_vault, quote_vault, lp_mint, token_program: spl_token::ID, system_program: system_program::ID }
            .to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &admin, &[]).unwrap();
    // seed it with liquidity: 10B tokens (5 dec) vs 200,000 USDC → $0.00002
    let owner = new_user(&mut env.svm);
    let ob = set_token_account(&mut env.svm, &base_mint, &owner.pubkey(), 20_000_000_000 * 100_000);
    let oq = set_token_account(&mut env.svm, &quote_mint, &owner.pubkey(), 1_000_000 * USDC);
    let ol = set_token_account(&mut env.svm, &lp_mint, &owner.pubkey(), 0);
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::AddLiquidity { max_base: 10_000_000_000 * 100_000, max_quote: 200_000 * USDC, min_lp: 1 }.data(),
        fairway::accounts::Liquidity {
            owner: owner.pubkey(), pool, base_mint, quote_mint, base_vault, quote_vault, lp_mint, owner_base: ob, owner_quote: oq, owner_lp: ol, token_program: spl_token::ID,
        }
        .to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &owner, &[]).unwrap();
    Pool2 { pool, base_mint, quote_mint, base_vault, quote_vault }
}

#[test]
fn each_pool_settles_only_against_its_own_oracle() {
    use fairway_math::markout::*;
    let (mut env, _lp, o_sol) = markout_env();
    let p2 = create_pool2(&mut env);
    let o_meme = Oracle { key: Pubkey::new_unique() };
    let meme_feed = [3u8; 32];
    set_pool_oracle(&mut env, p2.pool, o_meme.key, meme_feed);
    let t = new_trader(&mut env);
    let tk = t.kp.pubkey();
    let tb2 = set_token_account(&mut env.svm, &p2.base_mint, &tk, 0);
    let tq2 = t.quote;
    // one buy on each pool
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::Swap { amount_in: 1_000 * USDC, min_amount_out: 1, a_to_b: false }.data(),
        fairway::accounts::Swap {
            trader: tk, config: config_pda(), pool: p2.pool, trader_score: score_pda(&tk), base_mint: p2.base_mint, quote_mint: p2.quote_mint, base_vault: p2.base_vault, quote_vault: p2.quote_vault,
            trader_base: tb2, trader_quote: tq2, token_program: spl_token::ID, system_program: system_program::ID, treasury: treasury_pda(),
        }
        .to_account_metas(None),
    );
    let k = t.kp.insecure_clone();
    send(&mut env.svm, &[ix], &k, &[]).unwrap();
    let s = score_of(&env, &tk);
    assert_eq!(pending_count(&s), 2);
    let meme = s.pending.iter().find(|p| p.pool == p2.pool).unwrap();
    // $0.00002 with a 5-decimal token: the 1e12 fixed point keeps 5+ significant digits (1e6 would give "20")
    assert!(meme.exec_price > 19_000_000 && meme.exec_price < 21_000_000, "{}", meme.exec_price);

    warp(&mut env, MARKOUT_SLOTS);
    // SOL oracle says 150 → 160, meme oracle says 0.00002 → 0.000021 (+5%)
    post_mid(&mut env, &o_sol, 150 * USDC);
    let c = clock(&env);
    // meme price 0.000021 USD = 21 in USD×1e6; Pyth expo -8 → price = 2100
    write_price(&mut env, o_meme.key, PYTH_RECEIVER_PROGRAM, meme_feed, 21, 0, c.unix_timestamp, c.slot);
    // settling pool 1 with pool 2's oracle account is refused (address is checked against the pool)
    let cr = new_user(&mut env.svm);
    let ix = settle_ix(cr.pubkey(), tk, score_pda(&tk), env.pool, o_meme.key);
    assert!(send(&mut env.svm, &[ix], &cr, &[]).unwrap_err().contains("Custom(6016)"));
    // settle pool 1 only: the meme trade stays pending
    let ix = settle_ix(cr.pubkey(), tk, score_pda(&tk), env.pool, o_sol.key);
    send(&mut env.svm, &[ix], &cr, &[]).unwrap();
    let s = score_of(&env, &tk);
    assert_eq!((s.trade_count, pending_count(&s)), (1, 1));
    assert_eq!(s.pending.iter().find(|p| p.notional != 0).unwrap().pool, p2.pool);
    // now the meme pool, against ITS oracle: +5% on a buy
    let ix = settle_ix(cr.pubkey(), tk, score_pda(&tk), p2.pool, o_meme.key);
    send(&mut env.svm, &[ix], &cr, &[]).unwrap();
    let s = score_of(&env, &tk);
    assert_eq!((s.trade_count, pending_count(&s)), (2, 0));
    let mk = markout_bps(SIDE_BUY, meme.exec_price, 21_000_000).unwrap(); // 0.000021 at 1e12 scale
    assert!(mk > 400 && mk < 600, "{mk}");
}

#[test]
fn wrong_trader_account_rejected() {
    let (mut env, _lp, o) = markout_env();
    let victim = new_trader(&mut env);
    let attacker = new_trader(&mut env);
    swap(&mut env, &victim, 1_000 * USDC, 1, false).unwrap();
    swap(&mut env, &attacker, 1_000 * USDC, 1, false).unwrap();
    warp(&mut env, MARKOUT_SLOTS);
    post_mid(&mut env, &o, 170 * USDC);
    let k = attacker.kp.insecure_clone();
    // claim to settle the attacker, but pass the victim's score PDA (and vice versa)
    for (trader, score) in [(attacker.kp.pubkey(), score_pda(&victim.kp.pubkey())), (victim.kp.pubkey(), score_pda(&attacker.kp.pubkey()))] {
        let err = send(&mut env.svm, &[settle_ix(k.pubkey(), trader, score, env.pool, o.key)], &k, &[]).unwrap_err();
        assert!(err.contains("Custom(2006)"), "expected ConstraintSeeds, got {err}");
    }
    assert_eq!(score_of(&env, &victim.kp.pubkey()).trade_count, 0);
}

#[test]
fn ring_buffer_full_drops_trade_and_removes_discount() {
    let (mut env, _lp, o) = markout_env();
    let t = new_trader(&mut env);
    let tk = t.kp.pubkey();
    set_score(&mut env, tk, RETAIL); // keeper bootstrap says RETAIL
    for _ in 0..4 {
        assert_eq!(buy_and_measure(&mut env, &t, 100 * USDC).2, RETAIL as usize);
    }
    let s = score_of(&env, &tk);
    assert_eq!((pending_count(&s), s.dropped_trades), (4, 0));
    // 5th trade inside the window: cannot be queued → recorded as dropped and charged STANDARD, not RETAIL
    assert_eq!(buy_and_measure(&mut env, &t, 100 * USDC).2, STANDARD as usize);
    let s = score_of(&env, &tk);
    assert_eq!((pending_count(&s), s.dropped_trades), (4, 1));
    // settling frees the buffer → discount is back
    warp(&mut env, MARKOUT_SLOTS);
    post_mid(&mut env, &o, 150 * USDC);
    settle(&mut env, &tk, o.key).unwrap();
    let s = score_of(&env, &tk);
    assert_eq!((pending_count(&s), s.trade_count), (0, 4));
    assert_eq!(s.tier, RETAIL); // keeper field untouched by settlement
}

#[test]
fn unsettled_trades_expire() {
    let (mut env, _lp, o) = markout_env();
    let t = new_trader(&mut env);
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    warp(&mut env, MAX_SETTLE + 1);
    settle(&mut env, &t.kp.pubkey(), o.key).unwrap(); // no oracle read needed
    let s = score_of(&env, &t.kp.pubkey());
    assert_eq!((pending_count(&s), s.dropped_trades, s.trade_count), (0, 1, 0));
}

/// one trade, wait for the horizon, post a mid `bps_move` away from its exec price, settle
fn round(env: &mut Env, o: &Oracle, t: &Trader, usdc: u64, bps_move: i64) -> usize {
    let tier = buy_and_measure(env, t, usdc).2;
    let p = score_of(env, &t.kp.pubkey()).pending.into_iter().find(|p| p.notional != 0).unwrap();
    warp(env, MARKOUT_SLOTS);
    // exec_price is 1e12 fixed point, the mock Pyth helper takes USD × 1e6
    post_mid(env, o, (p.exec_price as i128 * (10_000 + bps_move as i128) / 10_000 / 1_000_000) as u64);
    settle(env, &t.kp.pubkey(), o.key).unwrap();
    tier
}

#[test]
fn shrinkage_tier_transitions_and_blend_with_keeper() {
    use fairway_math::markout::*;
    let (mut env, _lp, o) = markout_env();
    let bot = new_trader(&mut env);
    let bk = bot.kp.pubkey();
    // the keeper (wrongly) bootstraps the bot as RETAIL
    set_score(&mut env, bk, RETAIL);
    let mut fees = vec![];
    for i in 0..6 {
        fees.push(round(&mut env, &o, &bot, 1_100 * USDC, 50)); // price moves +0.5% after every buy
        let s = score_of(&env, &bk);
        // shrinkage: Σ(n·m) / (Σn + K), exactly as packages/scoring
        assert_eq!(s.onchain_score_bps as i128, s.sum_weighted_markout / (s.sum_notional as i128 + PRIOR as i128));
        let sums = Sums { sum_notional: s.sum_notional, sum_weighted_markout: s.sum_weighted_markout, trades: s.trade_count };
        assert_eq!(s.onchain_tier, onchain_tier(&sums, clock(&env).slot - s.first_slot, &params()));
        assert_eq!(s.trade_count, i + 1);
        // 5 trades of ~1100 USDC at +50 bps: score ≈ 50·5500/7500 ≈ 36 bps ≥ 10 → TOXIC from the 5th settle on
        assert_eq!(s.onchain_tier, if i >= 4 { TOXIC } else { STANDARD }, "after trade {}", i + 1);
    }
    // trades 1-5: fewer than 5 settled trades → the keeper's (wrong) RETAIL still applies.
    // trade 6: 5 settled trades and ≥ 1000 USDC → the onchain TOXIC tier takes over.
    assert_eq!(fees, vec![0, 0, 0, 0, 0, 2]);
    // the keeper cannot override onchain evidence, and set_score does not wipe it
    set_score(&mut env, bk, RETAIL);
    let s = score_of(&env, &bk);
    assert_eq!((s.trade_count, s.onchain_tier), (6, TOXIC));
    assert_eq!(buy_and_measure(&mut env, &bot, 100 * USDC).2, TOXIC as usize);
}

#[test]
fn uninformed_flow_earns_retail_onchain() {
    let (mut env, _lp, o) = markout_env();
    let rita = new_trader(&mut env);
    let mut tiers = vec![];
    for _ in 0..6 {
        tiers.push(round(&mut env, &o, &rita, 1_000 * USDC, -5)); // price drifts slightly against her
        warp(&mut env, 30);
    }
    let s = score_of(&env, &rita.kp.pubkey());
    assert!(s.onchain_score_bps <= 0);
    assert!(clock(&env).slot - s.first_slot >= HISTORY);
    assert_eq!(s.onchain_tier, RETAIL);
    // no keeper score at all: STANDARD until onchain evidence proves RETAIL
    assert_eq!(tiers[0], STANDARD as usize);
    assert_eq!(*tiers.last().unwrap(), RETAIL as usize);
    assert_eq!(buy_and_measure(&mut env, &rita, 100 * USDC).2, RETAIL as usize);
}

#[test]
fn invalid_markout_params_rejected() {
    let (mut env, _lp) = seeded();
    let admin = env.admin.insecure_clone();
    let bad = MarkoutParams { markout_slots: 100, max_settle_slots: 50, ..MarkoutParams::default() };
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::UpdateConfig { update: ConfigUpdate { markout: Some(bad), ..Default::default() } }.data(),
        fairway::accounts::UpdateConfig { admin: admin.pubkey(), config: config_pda() }.to_account_metas(None),
    );
    assert!(send(&mut env.svm, &[ix], &admin, &[]).unwrap_err().contains("Custom(6020)"));
}

#[test]
fn authority_cannot_close_a_score_with_onchain_evidence() {
    let (mut env, _lp, o) = markout_env();
    let t = new_trader(&mut env);
    let tk = t.kp.pubkey();
    let a = env.authority.insecure_clone();
    let close = |closer: Pubkey| {
        Instruction::new_with_bytes(
            fairway::id(),
            &fairway::instruction::CloseScore {}.data(),
            fairway::accounts::CloseScore { closer, config: config_pda(), treasury: treasury_pda(), score: score_pda(&tk), rent_receiver: tk }.to_account_metas(None),
        )
    };
    // pending trade → the keeper cannot wipe it
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    assert!(send(&mut env.svm, &[close(a.pubkey())], &a, &[]).unwrap_err().contains("Custom(6014)"));
    // settled evidence → still cannot
    warp(&mut env, MARKOUT_SLOTS);
    post_mid(&mut env, &o, 150 * USDC);
    settle(&mut env, &tk, o.key).unwrap();
    assert!(send(&mut env.svm, &[close(a.pubkey())], &a, &[]).unwrap_err().contains("Custom(6014)"));
    // the trader can close their own account and gets the rent back
    let before = env.svm.get_balance(&tk).unwrap();
    let k = t.kp.insecure_clone();
    send(&mut env.svm, &[close(tk)], &k, &[]).unwrap();
    assert!(env.svm.get_balance(&tk).unwrap() > before);
}

#[test]
fn few_large_trades_do_not_override_a_toxic_keeper_score() {
    let (mut env, _lp, o) = markout_env();
    let bot = new_trader(&mut env);
    set_score(&mut env, bot.kp.pubkey(), TOXIC); // keeper knows it is a bot from other venues
    for _ in 0..3 {
        // big, flat trades: plenty of notional, but only 3 settled trades → onchain says STANDARD
        assert_eq!(round(&mut env, &o, &bot, 20_000 * USDC, 0), TOXIC as usize);
    }
    let s = score_of(&env, &bot.kp.pubkey());
    assert!(s.sum_notional >= ONCHAIN_MIN && s.trade_count == 3 && s.onchain_tier == STANDARD);
    assert_eq!(buy_and_measure(&mut env, &bot, 100 * USDC).2, TOXIC as usize);
}


// ======================================================================================
// M14: protocol fee share, treasury, sponsored score rent
// ======================================================================================

/// treasury balance (the PDA is a system account; it does not exist until someone funds it)
fn treasury_balance(env: &Env) -> u64 {
    env.svm.get_balance(&treasury_pda()).unwrap_or(0)
}
/// the minimum a data-less account must keep to stay rent-exempt: the treasury never goes below this when sponsoring
fn treasury_floor(env: &Env) -> u64 {
    env.svm.minimum_balance_for_rent_exemption(0)
}
fn config_state(env: &Env) -> Config {
    Config::try_deserialize(&mut &env.svm.get_account(&config_pda()).unwrap().data[..]).unwrap()
}
fn update_config(env: &mut Env, update: ConfigUpdate) -> Result<(), String> {
    let admin = env.admin.insecure_clone();
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::UpdateConfig { update }.data(),
        fairway::accounts::UpdateConfig { admin: admin.pubkey(), config: config_pda() }.to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &admin, &[])
}
fn fund_treasury(env: &mut Env, lamports: u64) {
    let cur = treasury_balance(env);
    env.svm.set_account(treasury_pda(), Account { lamports: cur + lamports, data: vec![], owner: system_program::ID, executable: false, rent_epoch: 0 }).unwrap();
}
fn score_rent(env: &Env, t: &Pubkey) -> u64 {
    let len = env.svm.get_account(&score_pda(t)).unwrap().data.len();
    env.svm.minimum_balance_for_rent_exemption(len)
}

#[test]
fn protocol_fee_defaults_and_bounds() {
    let (mut env, _lp) = seeded();
    assert_eq!(config_state(&env).protocol_fee_bps, 1_500); // 15% of the toxic premium
    assert!(update_config(&mut env, ConfigUpdate { protocol_fee_bps: Some(5_001), ..Default::default() }).unwrap_err().contains("Custom(6021)"));
    update_config(&mut env, ConfigUpdate { protocol_fee_bps: Some(5_000), ..Default::default() }).unwrap();
    assert_eq!(config_state(&env).protocol_fee_bps, 5_000);
}

#[test]
fn protocol_share_accrues_excluded_from_reserves_and_is_claimable() {
    let (mut env, lp) = seeded();
    let t = new_trader(&mut env);
    set_score(&mut env, t.kp.pubkey(), TOXIC);
    // a buy (quote in) and a sell (base in), TOXIC tier: the protocol keeps 15% of the PREMIUM (fee above the STANDARD fee)
    let (_, fee_q, _) = buy_and_measure(&mut env, &t, 10_000 * USDC);
    swap(&mut env, &t, 5 * SOL, 1, true).unwrap();
    let fee_b = fee_on_input(5 * SOL, 80).unwrap();
    let prem_q = fee_q - fee_on_input(10_000 * USDC, 30).unwrap();
    let prem_b = fee_b - fee_on_input(5 * SOL, 30).unwrap();
    let p = pool_state(&env);
    let cut_q = fairway_math::protocol_share(prem_q, 1_500).unwrap();
    let cut_b = fairway_math::protocol_share(prem_b, 1_500).unwrap();
    assert_eq!((p.protocol_owed_quote, p.protocol_owed_base), (cut_q, cut_b));
    assert_eq!((p.protocol_earned_quote, p.protocol_earned_base), (cut_q, cut_b));
    assert_eq!(cut_q, prem_q * 15 / 100);

    // LPs keep the other 85% of the premium and every non-premium fee: reserves used for pricing exclude the unclaimed protocol fees
    let (rb, rq) = (token_balance(&env.svm, &env.base_vault) - p.protocol_owed_base, token_balance(&env.svm, &env.quote_vault) - p.protocol_owed_quote);
    let q = swap_quote(1_000 * USDC, rq, rb, 80).unwrap();
    let before = token_balance(&env.svm, &t.base);
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    assert_eq!(token_balance(&env.svm, &t.base) - before, q.amount_out, "swap must price off LP reserves, not the raw vault balance");

    // LP withdrawal is proportional to LP reserves (protocol fees stay put)
    let p = pool_state(&env);
    let supply = p.lp_supply;
    let held = token_balance(&env.svm, &lp.lp);
    let (rb, rq) = (token_balance(&env.svm, &env.base_vault) - p.protocol_owed_base, token_balance(&env.svm, &env.quote_vault) - p.protocol_owed_quote);
    let (eb, eq) = withdraw(held, rb, rq, supply).unwrap();
    let (b0, q0) = (token_balance(&env.svm, &lp.base), token_balance(&env.svm, &lp.quote));
    remove_liquidity(&mut env, &lp, held, eb, eq).unwrap();
    assert_eq!((token_balance(&env.svm, &lp.base) - b0, token_balance(&env.svm, &lp.quote) - q0), (eb, eq));
    let p = pool_state(&env);
    assert!(token_balance(&env.svm, &env.base_vault) >= p.protocol_owed_base && token_balance(&env.svm, &env.quote_vault) >= p.protocol_owed_quote);

    // claim into treasury-owned token accounts (permissionless), then admin moves them out
    let (bm, qm) = (env.base_mint, env.quote_mint);
    let tb = set_token_account(&mut env.svm, &bm, &treasury_pda(), 0);
    let tq = set_token_account(&mut env.svm, &qm, &treasury_pda(), 0);
    let claim = |env: &Env, cranker: Pubkey, tb: Pubkey, tq: Pubkey| {
        Instruction::new_with_bytes(
            fairway::id(),
            &fairway::instruction::ClaimProtocolFees {}.data(),
            fairway::accounts::ClaimProtocolFees {
                cranker,
                pool: env.pool,
                treasury: treasury_pda(),
                base_mint: env.base_mint,
                quote_mint: env.quote_mint,
                base_vault: env.base_vault,
                quote_vault: env.quote_vault,
                treasury_base: tb,
                treasury_quote: tq,
                token_program: spl_token::ID,
            }
            .to_account_metas(None),
        )
    };
    // destinations must be owned by the treasury: a stranger's account is rejected
    let stranger = new_user(&mut env.svm);
    let (sb, sq) = (set_token_account(&mut env.svm, &bm, &stranger.pubkey(), 0), set_token_account(&mut env.svm, &qm, &stranger.pubkey(), 0));
    let ix = claim(&env, stranger.pubkey(), sb, sq);
    assert!(send(&mut env.svm, &[ix], &stranger, &[]).is_err());
    let (owed_b, owed_q) = (p.protocol_owed_base, p.protocol_owed_quote);
    let ix = claim(&env, stranger.pubkey(), tb, tq);
    send(&mut env.svm, &[ix], &stranger, &[]).unwrap();
    assert_eq!((token_balance(&env.svm, &tb), token_balance(&env.svm, &tq)), (owed_b, owed_q));
    let p = pool_state(&env);
    assert_eq!((p.protocol_owed_base, p.protocol_owed_quote), (0, 0));
    assert_eq!((p.protocol_earned_base, p.protocol_earned_quote), (owed_b, owed_q)); // lifetime counters keep their value

    let dest = set_token_account(&mut env.svm, &qm, &env.admin.pubkey(), 0);
    let xfer = |signer: Pubkey, amount: u64| {
        Instruction::new_with_bytes(
            fairway::id(),
            &fairway::instruction::TreasuryTransferTokens { amount }.data(),
            fairway::accounts::TreasuryTransferTokens { admin: signer, config: config_pda(), treasury: treasury_pda(), mint: qm, from: tq, to: dest, token_program: spl_token::ID }.to_account_metas(None),
        )
    };
    assert!(send(&mut env.svm, &[xfer(stranger.pubkey(), 1)], &stranger, &[]).unwrap_err().contains("Custom(6000)"));
    let admin = env.admin.insecure_clone();
    send(&mut env.svm, &[xfer(admin.pubkey(), owed_q)], &admin, &[]).unwrap();
    assert_eq!(token_balance(&env.svm, &dest), owed_q);
}

#[test]
fn zero_protocol_fee_keeps_everything_with_lps() {
    let (mut env, _lp) = seeded();
    update_config(&mut env, ConfigUpdate { protocol_fee_bps: Some(0), ..Default::default() }).unwrap();
    let t = new_trader(&mut env);
    set_score(&mut env, t.kp.pubkey(), TOXIC);
    buy_and_measure(&mut env, &t, 1_000 * USDC);
    let p = pool_state(&env);
    assert_eq!((p.protocol_owed_quote, p.protocol_earned_quote), (0, 0));
}

#[test]
fn treasury_sponsors_first_score_account_rent() {
    let (mut env, _lp, _o) = markout_env(); // scored pool (has an oracle): swaps create score accounts
    fund_treasury(&mut env, 1_000_000_000);
    let t = new_trader(&mut env);
    let tk = t.kp.pubkey();
    let (bal0, tre0) = (env.svm.get_balance(&tk).unwrap(), treasury_balance(&env));
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    let rent = score_rent(&env, &tk);
    // the trader paid only the 5,000-lamport signature fee; the treasury paid the rent
    assert_eq!(bal0 - env.svm.get_balance(&tk).unwrap(), 5_000);
    assert_eq!(tre0 - treasury_balance(&env), rent);
    assert!(score_of(&env, &tk).sponsored);
    let p = pool_state(&env);
    assert_eq!((p.sponsored_accounts, p.sponsored_lamports), (1, rent));
    // a second swap does not charge the treasury again
    let tre1 = treasury_balance(&env);
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    assert_eq!(treasury_balance(&env), tre1);
    // closing refunds the treasury, not the trader, and the trader cannot redirect the rent
    let close = |receiver: Pubkey| {
        Instruction::new_with_bytes(
            fairway::id(),
            &fairway::instruction::CloseScore {}.data(),
            fairway::accounts::CloseScore { closer: tk, config: config_pda(), treasury: treasury_pda(), score: score_pda(&tk), rent_receiver: receiver }.to_account_metas(None),
        )
    };
    let k = t.kp.insecure_clone();
    assert!(send(&mut env.svm, &[close(tk)], &k, &[]).unwrap_err().contains("Custom(6014)"));
    send(&mut env.svm, &[close(treasury_pda())], &k, &[]).unwrap();
    assert_eq!(treasury_balance(&env), tre1 + rent);
}

#[test]
fn trader_pays_rent_when_treasury_is_empty() {
    let (mut env, _lp, _o) = markout_env();
    // fresh deployment: the treasury has no SOL
    assert_eq!(treasury_balance(&env), 0);
    let t = new_trader(&mut env);
    let tk = t.kp.pubkey();
    let bal0 = env.svm.get_balance(&tk).unwrap();
    swap(&mut env, &t, 1_000 * USDC, 1, false).unwrap();
    let rent = score_rent(&env, &tk);
    assert_eq!(bal0 - env.svm.get_balance(&tk).unwrap(), rent + 5_000);
    assert_eq!(treasury_balance(&env), 0);
    assert!(!score_of(&env, &tk).sponsored);
    assert_eq!(pool_state(&env).sponsored_accounts, 0);
    // the treasury must stay rent-exempt: one lamport short of floor + rent → the trader pays
    let floor = treasury_floor(&env);
    fund_treasury(&mut env, floor + rent - 1);
    let t2 = new_trader(&mut env);
    swap(&mut env, &t2, 1_000 * USDC, 1, false).unwrap();
    assert!(!score_of(&env, &t2.kp.pubkey()).sponsored);
    assert_eq!(treasury_balance(&env), floor + rent - 1);
    // exactly floor + rent → sponsored, and the treasury is left at exactly its floor
    fund_treasury(&mut env, 1);
    let t3 = new_trader(&mut env);
    swap(&mut env, &t3, 1_000 * USDC, 1, false).unwrap();
    assert!(score_of(&env, &t3.kp.pubkey()).sponsored);
    assert_eq!(treasury_balance(&env), floor);
}

#[test]
fn treasury_sol_withdraw_is_admin_only_and_keeps_rent_floor() {
    let (mut env, _lp) = seeded();
    fund_treasury(&mut env, 500_000_000);
    let dest = Pubkey::new_unique();
    let wd = |signer: Pubkey, lamports: u64| {
        Instruction::new_with_bytes(
            fairway::id(),
            &fairway::instruction::TreasuryWithdrawSol { lamports }.data(),
            fairway::accounts::TreasuryWithdrawSol { admin: signer, config: config_pda(), treasury: treasury_pda(), destination: dest, system_program: system_program::ID }.to_account_metas(None),
        )
    };
    let stranger = new_user(&mut env.svm);
    assert!(send(&mut env.svm, &[wd(stranger.pubkey(), 1)], &stranger, &[]).unwrap_err().contains("Custom(6000)"));
    let admin = env.admin.insecure_clone();
    let floor = treasury_floor(&env);
    // leaving less than the rent-exempt minimum (but not zero) is rejected; so is overdrawing
    assert!(send(&mut env.svm, &[wd(admin.pubkey(), 500_000_000 - floor + 1)], &admin, &[]).unwrap_err().contains("Custom(6022)"));
    assert!(send(&mut env.svm, &[wd(admin.pubkey(), 500_000_001)], &admin, &[]).unwrap_err().contains("Custom(6022)"));
    send(&mut env.svm, &[wd(admin.pubkey(), 500_000_000 - floor)], &admin, &[]).unwrap();
    assert_eq!(env.svm.get_balance(&dest).unwrap(), 500_000_000 - floor);
    assert_eq!(treasury_balance(&env), floor);
}

// ---------------------------------------------------------------------------------------------------------------------
// M15: bot-tax rebate (update_retail_fee)
// ---------------------------------------------------------------------------------------------------------------------

const ERR_INVALID_REBATE_PARAMS: &str = "Custom(6023)";
const ERR_EPOCH_NOT_ELAPSED: &str = "Custom(6024)";
const EPOCH: u64 = 100;

fn update_retail_fee(env: &mut Env, cranker: &Keypair) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        fairway::id(),
        &fairway::instruction::UpdateRetailFee {}.data(),
        fairway::accounts::UpdateRetailFee { cranker: cranker.pubkey(), config: config_pda(), pool: env.pool }.to_account_metas(None),
    );
    send(&mut env.svm, &[ix], cranker, &[])
}

fn set_rebate_cfg(env: &mut Env, share_bps: u16, floor_bps: u16) {
    update_config(
        env,
        ConfigUpdate { fee_bps: Some([30, 30, 80]), rebate: Some(RebateParams { epoch_slots: EPOCH, share_bps, floor_bps }), ..Default::default() },
    )
    .unwrap();
}

/// retail = standard = 30 bps, toxic 80, rebate epoch of 100 slots
fn rebate_env(share_bps: u16, floor_bps: u16) -> (Env, Trader, Trader, Trader) {
    let (mut env, _lp) = seeded();
    set_rebate_cfg(&mut env, share_bps, floor_bps);
    let retail = new_trader(&mut env);
    let toxic = new_trader(&mut env);
    let fresh = new_trader(&mut env);
    set_score(&mut env, retail.kp.pubkey(), RETAIL);
    set_score(&mut env, toxic.kp.pubkey(), TOXIC);
    (env, retail, toxic, fresh)
}

/// fee (quote units) charged by a quote-in swap of `usdc`, read from the per-tier counter
fn buy_fee(env: &mut Env, t: &Trader, tier: usize, usdc: u64) -> u64 {
    let before = pool_state(env).fees_quote[tier];
    swap(env, t, usdc, 1, false).unwrap();
    pool_state(env).fees_quote[tier] - before
}

#[test]
fn rebate_defaults_and_validation() {
    let (mut env, _lp) = seeded();
    let c = config_state(&env);
    assert_eq!((c.rebate.epoch_slots, c.rebate.share_bps, c.rebate.floor_bps), (9_000, 1_000, 5));
    for bad in [RebateParams { epoch_slots: 0, share_bps: 1_000, floor_bps: 5 }, RebateParams { epoch_slots: 10, share_bps: 10_001, floor_bps: 5 }, RebateParams { epoch_slots: 10, share_bps: 10, floor_bps: 1_001 }] {
        let e = update_config(&mut env, ConfigUpdate { rebate: Some(bad), ..Default::default() }).unwrap_err();
        assert!(e.contains(ERR_INVALID_REBATE_PARAMS), "{e}");
    }
}

#[test]
fn epoch_roll_sets_rebate_from_previous_epoch_and_is_permissionless() {
    let (mut env, retail, toxic, fresh) = rebate_env(5_000, 5);
    // epoch 1: no rebate yet, everyone pays their tier fee
    assert_eq!(buy_fee(&mut env, &retail, 0, 100_000 * USDC), fee_on_input(100_000 * USDC, 30).unwrap());
    assert_eq!(buy_fee(&mut env, &fresh, 1, 10_000 * USDC), fee_on_input(10_000 * USDC, 30).unwrap());
    let tox_fee = buy_fee(&mut env, &toxic, 2, 10_000 * USDC);
    assert_eq!(tox_fee, fee_on_input(10_000 * USDC, 80).unwrap());
    let p = pool_state(&env);
    let premium = tox_fee - fee_on_input(10_000 * USDC, 30).unwrap(); // 50 USDC
    assert_eq!((p.epoch_premium_q, p.epoch_retail_vol_q), (premium, 100_000 * USDC));
    assert_eq!(p.volume_q, [100_000 * USDC, 10_000 * USDC, 10_000 * USDC]);

    // too early (anyone, including a stranger): the epoch has not elapsed
    let stranger = new_user(&mut env.svm);
    assert!(update_retail_fee(&mut env, &stranger).unwrap_err().contains(ERR_EPOCH_NOT_ELAPSED));
    warp(&mut env, EPOCH - 1);
    assert!(update_retail_fee(&mut env, &stranger).unwrap_err().contains(ERR_EPOCH_NOT_ELAPSED));
    warp(&mut env, 1);
    update_retail_fee(&mut env, &stranger).unwrap(); // permissionless

    // rate = 50% × 50 USDC premium ÷ 100,000 USDC retail volume = 2.5 bps → floors to 2
    let p = pool_state(&env);
    let expect = fairway_math::rebate::epoch_rebate(premium, 100_000 * USDC, 5_000, 30, 5).unwrap();
    assert_eq!((p.rebate_bps, p.rebate_budget_q), (2, premium / 2));
    assert_eq!((p.rebate_bps, p.rebate_budget_q), (expect.rate_bps, expect.budget_q));
    // counters rolled
    assert_eq!((p.epoch_premium_q, p.epoch_retail_vol_q), (0, 0));
    assert_eq!(p.epoch_start_slot, clock(&env).slot);
    // and the next roll needs a full new epoch
    assert!(update_retail_fee(&mut env, &stranger).unwrap_err().contains(ERR_EPOCH_NOT_ELAPSED));

    // epoch 2: RETAIL pays 28 bps; STANDARD and TOXIC are untouched (a rotating bot gets no discount)
    assert_eq!(buy_fee(&mut env, &retail, 0, 10_000 * USDC), fee_on_input(10_000 * USDC, 28).unwrap());
    assert_eq!(buy_fee(&mut env, &fresh, 1, 10_000 * USDC), fee_on_input(10_000 * USDC, 30).unwrap());
    assert_eq!(buy_fee(&mut env, &toxic, 2, 10_000 * USDC), fee_on_input(10_000 * USDC, 80).unwrap());
    let p = pool_state(&env);
    let given = fee_on_input(10_000 * USDC, 30).unwrap() - fee_on_input(10_000 * USDC, 28).unwrap();
    assert_eq!(p.rebate_total_q, given);
    assert_eq!(p.rebate_budget_q, premium / 2 - given);
}

#[test]
fn rebate_never_exceeds_share_of_premium_and_budget_runs_out() {
    let (mut env, retail, toxic, _fresh) = rebate_env(5_000, 5);
    // epoch 1: tiny retail volume, a big toxic trade → the naive rate would be huge
    buy_fee(&mut env, &retail, 0, 1_000 * USDC);
    let tox_fee = buy_fee(&mut env, &toxic, 2, 100_000 * USDC);
    let premium = tox_fee - fee_on_input(100_000 * USDC, 30).unwrap(); // 500 USDC
    warp(&mut env, EPOCH);
    let stranger = new_user(&mut env.svm);
    update_retail_fee(&mut env, &stranger).unwrap();
    let p = pool_state(&env);
    let budget = premium / 2; // 250 USDC
    assert_eq!((p.rebate_bps, p.rebate_budget_q), (25, budget), "rate is clamped by the floor: 30 - 5");

    // epoch 2: retail trades 100k USDC three times. The first trade drains the budget, later ones pay the full 30 bps
    let f1 = buy_fee(&mut env, &retail, 0, 100_000 * USDC);
    let f2 = buy_fee(&mut env, &retail, 0, 100_000 * USDC);
    let f3 = buy_fee(&mut env, &retail, 0, 100_000 * USDC);
    let full = fee_on_input(100_000 * USDC, 30).unwrap();
    assert!(f1 < full, "first trade is rebated");
    assert!(f2 >= full - 1 && f3 == full, "budget is exhausted: {f1} {f2} {f3}");
    let p = pool_state(&env);
    // cap: rebate handed out <= share × premium collected (+ at most one token unit of rounding per swap)
    assert!(p.rebate_total_q <= budget + 3, "rebate {} exceeds budget {}", p.rebate_total_q, budget);
    assert!(p.rebate_total_q <= p.premium_total_q * 5_000 / 10_000 + 3);
    assert_eq!(p.rebate_total_q, (full - f1) + (full - f2) + (full - f3));
    assert!(p.rebate_budget_q <= 3);
}

#[test]
fn rebate_floor_holds() {
    // floor 25 on a 30 bps retail fee: at most 5 bps of rebate, even with a 100% share and a huge premium
    let (mut env, retail, toxic, _fresh) = rebate_env(10_000, 25);
    buy_fee(&mut env, &retail, 0, 1_000 * USDC);
    buy_fee(&mut env, &toxic, 2, 100_000 * USDC);
    warp(&mut env, EPOCH);
    let stranger = new_user(&mut env.svm);
    update_retail_fee(&mut env, &stranger).unwrap();
    assert_eq!(pool_state(&env).rebate_bps, 5);
    assert_eq!(buy_fee(&mut env, &retail, 0, 10_000 * USDC), fee_on_input(10_000 * USDC, 25).unwrap());

    // floor at (or above) the retail fee: no rebate at all
    let (mut env, retail, toxic, _fresh) = rebate_env(10_000, 30);
    buy_fee(&mut env, &retail, 0, 1_000 * USDC);
    buy_fee(&mut env, &toxic, 2, 100_000 * USDC);
    warp(&mut env, EPOCH);
    let stranger = new_user(&mut env.svm);
    update_retail_fee(&mut env, &stranger).unwrap();
    assert_eq!((pool_state(&env).rebate_bps, pool_state(&env).rebate_budget_q), (0, 0));
    assert_eq!(buy_fee(&mut env, &retail, 0, 10_000 * USDC), fee_on_input(10_000 * USDC, 30).unwrap());
}

#[test]
fn zero_toxic_volume_epoch_clears_the_rebate() {
    let (mut env, retail, toxic, _fresh) = rebate_env(5_000, 5);
    let stranger = new_user(&mut env.svm);
    // epoch 1 creates a rebate
    buy_fee(&mut env, &retail, 0, 10_000 * USDC);
    buy_fee(&mut env, &toxic, 2, 10_000 * USDC);
    warp(&mut env, EPOCH);
    update_retail_fee(&mut env, &stranger).unwrap();
    assert!(pool_state(&env).rebate_bps > 0);
    // epoch 2: only retail trades, no toxic flow at all → no premium → the next epoch has no rebate
    buy_fee(&mut env, &retail, 0, 10_000 * USDC);
    warp(&mut env, EPOCH);
    update_retail_fee(&mut env, &stranger).unwrap();
    let p = pool_state(&env);
    assert_eq!((p.rebate_bps, p.rebate_budget_q, p.epoch_premium_q), (0, 0, 0));
    assert_eq!(buy_fee(&mut env, &retail, 0, 10_000 * USDC), fee_on_input(10_000 * USDC, 30).unwrap());
    // a completely empty epoch (no swaps) rolls fine too
    warp(&mut env, EPOCH);
    update_retail_fee(&mut env, &stranger).unwrap();
    assert_eq!(pool_state(&env).rebate_bps, 0);
}

#[test]
fn skipped_epochs_roll_once_over_the_whole_window() {
    let (mut env, retail, toxic, _fresh) = rebate_env(5_000, 5);
    let stranger = new_user(&mut env.svm);
    buy_fee(&mut env, &retail, 0, 100_000 * USDC);
    buy_fee(&mut env, &toxic, 2, 10_000 * USDC);
    warp(&mut env, EPOCH * 5); // nobody cranked for five epochs
    update_retail_fee(&mut env, &stranger).unwrap();
    assert_eq!(pool_state(&env).epoch_start_slot, clock(&env).slot);
    assert!(pool_state(&env).rebate_bps > 0);
}

#[test]
fn protocol_takes_a_share_of_the_premium_only() {
    let (mut env, retail, toxic, fresh) = rebate_env(5_000, 5);
    // retail and standard fees: LPs keep 100%, the protocol earns nothing
    buy_fee(&mut env, &retail, 0, 10_000 * USDC);
    buy_fee(&mut env, &fresh, 1, 10_000 * USDC);
    assert_eq!(pool_state(&env).protocol_owed_quote, 0);
    let fee = buy_fee(&mut env, &toxic, 2, 10_000 * USDC);
    let premium = fee - fee_on_input(10_000 * USDC, 30).unwrap();
    assert_eq!(pool_state(&env).protocol_owed_quote, premium * 15 / 100);
}
