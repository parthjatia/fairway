//! LiteSVM integration tests for the Fairway program (run `anchor build` first so target/deploy/fairway.so exists).
use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token,
    fairway::{state::*, ConfigUpdate, ScoreEntry},
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
    let rq = token_balance(&env.svm, &env.quote_vault);
    let rb = token_balance(&env.svm, &env.base_vault);
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
    let rb = token_balance(&env.svm, &env.base_vault);
    let rq = token_balance(&env.svm, &env.quote_vault);
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
            fairway::accounts::CloseScore { closer, config: config_pda(), score: score_pda(&trader), rent_receiver: receiver }.to_account_metas(None),
        )
    };
    let stranger = new_user(&mut env.svm);
    let tox = traders[1].kp.pubkey();
    assert!(send(&mut env.svm, &[close_ix(stranger.pubkey(), tox, a.pubkey())], &stranger, &[]).unwrap_err().contains("Custom(6014)"));
    // rent must go back to the authority, not the closer
    assert!(send(&mut env.svm, &[close_ix(bot.pubkey(), tox, bot.pubkey())], &bot, &[]).is_err());
    send(&mut env.svm, &[close_ix(bot.pubkey(), tox, a.pubkey())], &bot, &[]).unwrap();
    assert!(env.svm.get_account(&pdas[1]).map_or(true, |acc| acc.data.is_empty()));
    assert_eq!(buy_and_measure(&mut env, &traders[1], 100 * USDC).2, STANDARD as usize);
}
