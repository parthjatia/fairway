//! Shared test vectors: the same `vectors/onchain.json` is checked by packages/scoring (TypeScript).
use fairway_math::markout::*;
use serde_json::Value;

fn load() -> Value {
    serde_json::from_str(include_str!("../vectors/onchain.json")).unwrap()
}
fn u(v: &Value) -> u64 { v.as_u64().unwrap() }

fn params(v: &Value) -> TierParams {
    TierParams {
        prior_notional: u(&v["prior_notional"]),
        toxic_bps: v["toxic_bps"].as_i64().unwrap() as i32,
        toxic_min_trades: u(&v["toxic_min_trades"]) as u32,
        retail_bps: v["retail_bps"].as_i64().unwrap() as i32,
        retail_min_trades: u(&v["retail_min_trades"]) as u32,
        retail_min_history_slots: u(&v["retail_min_history_slots"]),
    }
}

#[test]
fn markout_vectors() {
    for c in load()["markout"].as_array().unwrap() {
        let got = markout_bps(u(&c["side"]) as u8, u(&c["exec"]), u(&c["mid"])).unwrap();
        assert_eq!(got, c["expected"].as_i64().unwrap(), "{c}");
    }
}

#[test]
fn exec_price_and_pyth_vectors() {
    let v = load();
    for c in v["exec_price"].as_array().unwrap() {
        let got = exec_price_e6(u(&c["quote_raw"]), u(&c["quote_decimals"]) as u8, u(&c["base_raw"]), u(&c["base_decimals"]) as u8).unwrap();
        assert_eq!(got, u(&c["expected"]), "{c}");
    }
    for c in v["pyth"].as_array().unwrap() {
        assert_eq!(pyth_to_price_e6(c["price"].as_i64().unwrap(), c["expo"].as_i64().unwrap() as i32).unwrap(), u(&c["expected"]), "{c}");
    }
}

#[test]
fn scenario_vectors() {
    let v = load();
    let p = params(&v["params"]);
    for sc in v["scenarios"].as_array().unwrap() {
        let mut s = Sums::default();
        for t in sc["trades"].as_array().unwrap() {
            let m = markout_bps(u(&t["side"]) as u8, u(&t["exec"]), u(&t["mid"])).unwrap();
            s = accumulate(s, u(&t["notional"]), m).unwrap();
        }
        let e = &sc["expected"];
        let name = sc["name"].as_str().unwrap();
        assert_eq!(s.sum_notional, u(&e["sum_notional"]), "{name}");
        assert_eq!(s.sum_weighted_markout.to_string(), e["sum_weighted_markout"].as_str().unwrap(), "{name}");
        assert_eq!(s.trades as u64, u(&e["trades"]), "{name}");
        assert_eq!(score_bps(&s, p.prior_notional) as i64, e["score_bps"].as_i64().unwrap(), "{name}");
        assert_eq!(onchain_tier(&s, u(&sc["history_slots"]), &p) as u64, u(&e["tier"]), "{name}");
    }
}

#[test]
fn sign_conventions_and_guards() {
    // buy: price up = informed (+); sell: price up = adverse (−)
    assert!(markout_bps(SIDE_BUY, 100_000_000, 101_000_000).unwrap() > 0);
    assert!(markout_bps(SIDE_SELL, 100_000_000, 101_000_000).unwrap() < 0);
    assert_eq!(markout_bps(SIDE_BUY, 1_000_000, 900_000_000).unwrap(), MARKOUT_CLAMP_BPS);
    assert!(markout_bps(SIDE_BUY, 0, 1).is_err());
    assert!(pyth_to_price_e6(-5, -8).is_err());
    assert!(pyth_to_price_e6(1, -8).is_err()); // rounds to zero
    assert!(confidence_ok(15_000_000_000, 10_000_000, 10)); // 0.0667% ≤ 0.10%
    assert!(!confidence_ok(15_000_000_000, 30_000_000, 10)); // 0.2% > 0.10%
}

#[test]
fn blend_rule() {
    use fairway_math::*;
    let boot = Some(ScoreView { tier: TIER_RETAIL, updated_slot: 90 });
    let on = |tier, sum_notional, trades| Some(OnchainView { tier, sum_notional, trades });
    // below the notional threshold: keeper bootstrap is used
    assert_eq!(resolve_blended(on(TIER_TOXIC, 99, 9), 100, 5, boot, 100, 50, TIER_STANDARD), (TIER_RETAIL, TierSource::Score));
    // enough notional but too few trades for the tier rules: still bootstrap (a TOXIC wallet can't escape with 3 big trades)
    let toxic_boot = Some(ScoreView { tier: TIER_TOXIC, updated_slot: 90 });
    assert_eq!(resolve_blended(on(TIER_STANDARD, 10_000, 4), 100, 5, toxic_boot, 100, 50, TIER_STANDARD).0, TIER_TOXIC);
    // at/above both thresholds: the onchain score wins, even against a fresh RETAIL keeper score
    assert_eq!(resolve_blended(on(TIER_TOXIC, 100, 5), 100, 5, boot, 100, 50, TIER_STANDARD), (TIER_TOXIC, TierSource::Onchain));
    // ...and a stale/absent keeper score does not matter
    assert_eq!(resolve_blended(on(TIER_RETAIL, 100, 5), 100, 5, None, 100, 50, TIER_STANDARD), (TIER_RETAIL, TierSource::Onchain));
    assert_eq!(resolve_blended(None, 100, 5, None, 100, 50, TIER_STANDARD).0, TIER_STANDARD);
}
