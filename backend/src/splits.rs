//! Pure calculation logic for the four expense-split modes. Kept free of
//! any DB/HTTP concerns so it's trivial to unit test exhaustively.

use bigdecimal::{BigDecimal, Zero};
use std::str::FromStr;
use uuid::Uuid;

use crate::models::{SplitInput, SplitType};

#[derive(Debug, Clone, PartialEq)]
pub struct ComputedSplit {
    pub user_id: Uuid,
    pub amount: BigDecimal,
    pub percentage: Option<BigDecimal>,
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum SplitError {
    #[error("at least one participant is required")]
    NoParticipants,
    #[error("percentage split values must sum to 100 (got {0})")]
    PercentagesDontSumTo100(String),
    #[error("custom split amounts must sum to the expense total (expected {expected}, got {actual})")]
    CustomAmountsMismatch { expected: String, actual: String },
    #[error("percentage split requires a value for every participant")]
    MissingPercentage,
    #[error("custom split requires a value for every participant")]
    MissingCustomAmount,
    #[error("duplicate participant {0}")]
    DuplicateParticipant(Uuid),
}

// bigdecimal 0.3 (the version sqlx's Postgres decimal support is pinned to;
// see the note on the `bigdecimal` dependency in Cargo.toml) doesn't have
// `with_scale_round`/`RoundingMode` -- `.round(n)` is its equivalent,
// rounding half-away-from-zero to `n` digits after the decimal point,
// which is exactly the "round half up" behavior we want for money.
fn cents(n: &BigDecimal) -> BigDecimal {
    n.round(2)
}

fn check_duplicates(inputs: &[SplitInput]) -> Result<(), SplitError> {
    let mut seen = std::collections::HashSet::new();
    for s in inputs {
        if !seen.insert(s.user_id) {
            return Err(SplitError::DuplicateParticipant(s.user_id));
        }
    }
    Ok(())
}

/// Distribute `amount` evenly across `inputs`, giving the leftover cent(s)
/// from integer-cent division to the first participants (deterministic,
/// order-stable) so the split always sums exactly to `amount`.
fn distribute_remainder(
    amount: &BigDecimal,
    n: usize,
    order: &[Uuid],
) -> Vec<(Uuid, BigDecimal)> {
    let total_cents = (amount * BigDecimal::from(100)).round(0);
    let total_cents_i: i64 = total_cents.to_string().parse().unwrap_or(0);
    let base = total_cents_i / n as i64;
    let mut remainder = total_cents_i % n as i64;

    order
        .iter()
        .map(|&uid| {
            let mut share = base;
            if remainder > 0 {
                share += 1;
                remainder -= 1;
            }
            let dec = BigDecimal::from(share) / BigDecimal::from(100);
            (uid, cents(&dec))
        })
        .collect()
}

pub fn compute_splits(
    split_type: SplitType,
    amount: &BigDecimal,
    inputs: &[SplitInput],
) -> Result<Vec<ComputedSplit>, SplitError> {
    if inputs.is_empty() {
        return Err(SplitError::NoParticipants);
    }
    check_duplicates(inputs)?;

    match split_type {
        SplitType::Equal | SplitType::Selected => {
            let order: Vec<Uuid> = inputs.iter().map(|s| s.user_id).collect();
            let shares = distribute_remainder(amount, inputs.len(), &order);
            Ok(shares
                .into_iter()
                .map(|(user_id, amt)| ComputedSplit {
                    user_id,
                    amount: amt,
                    percentage: None,
                })
                .collect())
        }
        SplitType::Percentage => {
            let mut total_pct = BigDecimal::zero();
            for s in inputs {
                let v = s.value.clone().ok_or(SplitError::MissingPercentage)?;
                total_pct += v;
            }
            // Allow tiny floating-style rounding slack (<= 0.01) from client input.
            let diff = (&total_pct - BigDecimal::from(100)).abs();
            if diff > BigDecimal::from_str("0.01").unwrap() {
                return Err(SplitError::PercentagesDontSumTo100(total_pct.to_string()));
            }

            // Compute raw shares, then fix up rounding drift on the last
            // participant so amounts sum exactly to `amount`.
            let mut running = BigDecimal::zero();
            let mut result = Vec::with_capacity(inputs.len());
            for (i, s) in inputs.iter().enumerate() {
                let pct = s.value.clone().unwrap();
                let raw = amount * &pct / BigDecimal::from(100);
                let amt = if i == inputs.len() - 1 {
                    cents(&(amount - &running))
                } else {
                    cents(&raw)
                };
                running += &amt;
                result.push(ComputedSplit {
                    user_id: s.user_id,
                    amount: amt,
                    percentage: Some(pct),
                });
            }
            Ok(result)
        }
        SplitType::Custom => {
            let mut total = BigDecimal::zero();
            let mut result = Vec::with_capacity(inputs.len());
            for s in inputs {
                let v = s.value.clone().ok_or(SplitError::MissingCustomAmount)?;
                let amt = cents(&v);
                total += &amt;
                result.push(ComputedSplit {
                    user_id: s.user_id,
                    amount: amt,
                    percentage: None,
                });
            }
            let expected = cents(amount);
            if total != expected {
                return Err(SplitError::CustomAmountsMismatch {
                    expected: expected.to_string(),
                    actual: total.to_string(),
                });
            }
            Ok(result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn uid(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    #[test]
    fn equal_split_distributes_remainder_deterministically() {
        let amount = BigDecimal::from_str("10.00").unwrap();
        let inputs = vec![
            SplitInput { user_id: uid(1), value: None },
            SplitInput { user_id: uid(2), value: None },
            SplitInput { user_id: uid(3), value: None },
        ];
        let result = compute_splits(SplitType::Equal, &amount, &inputs).unwrap();
        let sum: BigDecimal = result.iter().map(|s| s.amount.clone()).sum();
        assert_eq!(sum, amount);
        // 10.00 / 3 = 3.33, 3.33, 3.34 (first participant absorbs no extra
        // here since 1000 % 3 == 1, remainder goes to first participant)
        assert_eq!(result[0].amount, BigDecimal::from_str("3.34").unwrap());
        assert_eq!(result[1].amount, BigDecimal::from_str("3.33").unwrap());
        assert_eq!(result[2].amount, BigDecimal::from_str("3.33").unwrap());
    }

    #[test]
    fn percentage_split_must_sum_to_100() {
        let amount = BigDecimal::from_str("100.00").unwrap();
        let inputs = vec![
            SplitInput { user_id: uid(1), value: Some(BigDecimal::from_str("50").unwrap()) },
            SplitInput { user_id: uid(2), value: Some(BigDecimal::from_str("40").unwrap()) },
        ];
        let err = compute_splits(SplitType::Percentage, &amount, &inputs).unwrap_err();
        assert!(matches!(err, SplitError::PercentagesDontSumTo100(_)));
    }

    #[test]
    fn percentage_split_computes_exact_amounts_with_rounding_fixup() {
        let amount = BigDecimal::from_str("100.00").unwrap();
        let inputs = vec![
            SplitInput { user_id: uid(1), value: Some(BigDecimal::from_str("33.33").unwrap()) },
            SplitInput { user_id: uid(2), value: Some(BigDecimal::from_str("33.33").unwrap()) },
            SplitInput { user_id: uid(3), value: Some(BigDecimal::from_str("33.34").unwrap()) },
        ];
        let result = compute_splits(SplitType::Percentage, &amount, &inputs).unwrap();
        let sum: BigDecimal = result.iter().map(|s| s.amount.clone()).sum();
        assert_eq!(sum, amount);
    }

    #[test]
    fn custom_split_must_sum_to_total() {
        let amount = BigDecimal::from_str("50.00").unwrap();
        let inputs = vec![
            SplitInput { user_id: uid(1), value: Some(BigDecimal::from_str("20.00").unwrap()) },
            SplitInput { user_id: uid(2), value: Some(BigDecimal::from_str("20.00").unwrap()) },
        ];
        let err = compute_splits(SplitType::Custom, &amount, &inputs).unwrap_err();
        assert!(matches!(err, SplitError::CustomAmountsMismatch { .. }));
    }

    #[test]
    fn selected_split_only_charges_chosen_members() {
        let amount = BigDecimal::from_str("30.00").unwrap();
        let inputs = vec![
            SplitInput { user_id: uid(1), value: None },
            SplitInput { user_id: uid(2), value: None },
        ];
        let result = compute_splits(SplitType::Selected, &amount, &inputs).unwrap();
        assert_eq!(result.len(), 2);
        let sum: BigDecimal = result.iter().map(|s| s.amount.clone()).sum();
        assert_eq!(sum, amount);
    }

    #[test]
    fn rejects_duplicate_participants() {
        let amount = BigDecimal::from_str("10.00").unwrap();
        let inputs = vec![
            SplitInput { user_id: uid(1), value: None },
            SplitInput { user_id: uid(1), value: None },
        ];
        let err = compute_splits(SplitType::Equal, &amount, &inputs).unwrap_err();
        assert!(matches!(err, SplitError::DuplicateParticipant(_)));
    }

    #[test]
    fn rejects_empty_participants() {
        let amount = BigDecimal::from_str("10.00").unwrap();
        let err = compute_splits(SplitType::Equal, &amount, &[]).unwrap_err();
        assert_eq!(err, SplitError::NoParticipants);
    }
}
