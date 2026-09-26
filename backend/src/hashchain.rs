//! Tamper-evident activity log via HMAC-SHA256 hash chaining.
//!
//! Every event appended to `activity_log` commits to the hash of the event
//! before it, forming a chain rooted at a fixed genesis value:
//!
//!   hash[0]   = HMAC(secret, "GENESIS" || canonical(payload[0]))
//!   hash[n]   = HMAC(secret, hash[n-1]  || canonical(payload[n]))
//!
//! Because the HMAC key never leaves the server, an attacker with only
//! database access (e.g. via a SQL injection or a stolen backup) cannot
//! recompute a valid hash after editing a row, and cannot re-splice the
//! chain without invalidating every subsequent hash. `verify_chain`
//! recomputes the whole chain from genesis and reports the first row (if
//! any) whose stored hash disagrees with the recomputed one.

use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

pub const GENESIS: &str = "GENESIS";

/// Deterministic, field-order-independent representation of an activity
/// event, used as the HMAC message alongside the previous hash.
#[derive(Serialize)]
struct CanonicalEvent<'a> {
    trip_id: Uuid,
    actor_id: Option<Uuid>,
    action: &'a str,
    metadata: &'a serde_json::Value,
    seq: i64,
}

pub fn canonicalize(
    trip_id: Uuid,
    actor_id: Option<Uuid>,
    action: &str,
    metadata: &serde_json::Value,
    seq: i64,
) -> String {
    // serde_json's default map serialization preserves insertion order; we
    // guarantee determinism by only ever building `metadata` from
    // `serde_json::json!` macros with a fixed key order at call sites, and by
    // canonicalizing through `serde_json::to_string` on a struct with fixed
    // field order (not a HashMap), so this is stable across the process.
    serde_json::to_string(&CanonicalEvent {
        trip_id,
        actor_id,
        action,
        metadata,
        seq,
    })
    .expect("serialization of canonical event cannot fail")
}

pub fn compute_hash(secret: &[u8], prev_hash: &str, canonical_payload: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts key of any length");
    mac.update(prev_hash.as_bytes());
    mac.update(canonical_payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Result of replaying the chain for a single trip.
pub struct VerificationResult {
    pub valid: bool,
    pub entries_checked: usize,
    pub first_broken_seq: Option<i64>,
}

pub fn verify_chain(
    secret: &[u8],
    entries: &[(i64, Uuid, Option<Uuid>, String, serde_json::Value, String, String)],
    // tuple: (seq, trip_id, actor_id, action, metadata, prev_hash, stored_hash)
) -> VerificationResult {
    let mut expected_prev = GENESIS.to_string();
    for (seq, trip_id, actor_id, action, metadata, prev_hash, stored_hash) in entries {
        if *prev_hash != expected_prev {
            return VerificationResult {
                valid: false,
                entries_checked: entries.len(),
                first_broken_seq: Some(*seq),
            };
        }
        let canonical = canonicalize(*trip_id, *actor_id, action, metadata, *seq);
        let recomputed = compute_hash(secret, prev_hash, &canonical);
        if recomputed != *stored_hash {
            return VerificationResult {
                valid: false,
                entries_checked: entries.len(),
                first_broken_seq: Some(*seq),
            };
        }
        expected_prev = recomputed;
    }
    VerificationResult {
        valid: true,
        entries_checked: entries.len(),
        first_broken_seq: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn chain_detects_tampering() {
        let secret = b"test-secret";
        let trip_id = Uuid::new_v4();
        let meta1 = json!({"amount": "10.00"});
        let c1 = canonicalize(trip_id, None, "expense.created", &meta1, 1);
        let h1 = compute_hash(secret, GENESIS, &c1);

        let meta2 = json!({"amount": "20.00"});
        let c2 = canonicalize(trip_id, None, "expense.created", &meta2, 2);
        let h2 = compute_hash(secret, &h1, &c2);

        let entries = vec![
            (1i64, trip_id, None, "expense.created".to_string(), meta1.clone(), GENESIS.to_string(), h1.clone()),
            (2i64, trip_id, None, "expense.created".to_string(), meta2.clone(), h1.clone(), h2.clone()),
        ];
        let result = verify_chain(secret, &entries);
        assert!(result.valid);

        // Tamper with the second event's recorded metadata without updating hashes.
        let tampered_meta2 = json!({"amount": "999999.00"});
        let entries_tampered = vec![
            (1i64, trip_id, None, "expense.created".to_string(), meta1, GENESIS.to_string(), h1.clone()),
            (2i64, trip_id, None, "expense.created".to_string(), tampered_meta2, h1, h2),
        ];
        let result = verify_chain(secret, &entries_tampered);
        assert!(!result.valid);
        assert_eq!(result.first_broken_seq, Some(2));
    }
}
