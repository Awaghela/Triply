//! Net balance calculation and a greedy min-transaction settlement
//! suggestion algorithm ("who should pay whom to zero everyone out").

use bigdecimal::{BigDecimal, Zero};
use std::cmp::Ordering;
use std::collections::HashMap;
use uuid::Uuid;

use crate::models::SuggestedTransfer;

/// Given each member's net balance (positive = owed money, negative = owes
/// money), produce the minimum-ish set of transfers that settles everyone
/// to zero. This is the classic greedy "largest creditor <-> largest
/// debtor" heuristic: not provably minimal in every case, but always
/// correct (sums to zero net effect) and close to optimal in practice.
pub fn suggest_transfers(
    balances: &HashMap<Uuid, (String, BigDecimal)>,
) -> Vec<SuggestedTransfer> {
    let mut creditors: Vec<(Uuid, String, BigDecimal)> = balances
        .iter()
        .filter(|(_, (_, net))| *net > BigDecimal::zero())
        .map(|(id, (name, net))| (*id, name.clone(), net.clone()))
        .collect();
    let mut debtors: Vec<(Uuid, String, BigDecimal)> = balances
        .iter()
        .filter(|(_, (_, net))| *net < BigDecimal::zero())
        .map(|(id, (name, net))| (*id, name.clone(), -net.clone()))
        .collect();

    creditors.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(Ordering::Equal));
    debtors.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(Ordering::Equal));

    let mut transfers = Vec::new();
    let mut ci = 0usize;
    let mut di = 0usize;

    while ci < creditors.len() && di < debtors.len() {
        let (c_id, c_name, c_amt) = &mut (
            creditors[ci].0,
            creditors[ci].1.clone(),
            creditors[ci].2.clone(),
        );
        let (d_id, d_name, d_amt) = &mut (
            debtors[di].0,
            debtors[di].1.clone(),
            debtors[di].2.clone(),
        );

        let transfer_amount = if c_amt < d_amt { c_amt.clone() } else { d_amt.clone() };

        if transfer_amount > BigDecimal::zero() {
            transfers.push(SuggestedTransfer {
                from_user: *d_id,
                from_name: d_name.clone(),
                to_user: *c_id,
                to_name: c_name.clone(),
                amount: transfer_amount.clone(),
            });
        }

        creditors[ci].2 -= &transfer_amount;
        debtors[di].2 -= &transfer_amount;

        if creditors[ci].2 <= BigDecimal::zero() {
            ci += 1;
        }
        if debtors[di].2 <= BigDecimal::zero() {
            di += 1;
        }
    }

    transfers
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn settles_three_way_split_in_minimum_transfers() {
        let mut balances = HashMap::new();
        let a = Uuid::from_bytes([1; 16]);
        let b = Uuid::from_bytes([2; 16]);
        let c = Uuid::from_bytes([3; 16]);
        // A paid for everyone: A is owed 20, B owes 10, C owes 10.
        balances.insert(a, ("A".into(), BigDecimal::from_str("20.00").unwrap()));
        balances.insert(b, ("B".into(), BigDecimal::from_str("-10.00").unwrap()));
        balances.insert(c, ("C".into(), BigDecimal::from_str("-10.00").unwrap()));

        let transfers = suggest_transfers(&balances);
        assert_eq!(transfers.len(), 2);
        let total: BigDecimal = transfers.iter().map(|t| t.amount.clone()).sum();
        assert_eq!(total, BigDecimal::from_str("20.00").unwrap());
    }

    #[test]
    fn zero_balances_produce_no_transfers() {
        let balances = HashMap::new();
        assert!(suggest_transfers(&balances).is_empty());
    }
}
