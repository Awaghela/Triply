//! Idempotency-key handling for unsafe (POST) writes.
//!
//! Clients that may retry a request (flaky network, double-tap on the
//! "Add expense" button, etc.) send an `Idempotency-Key` header. We store a
//! fingerprint of the request body alongside the eventual response:
//!
//! - First request with a fresh key: we insert a row with
//!   `response_status = NULL` inside the SAME transaction as the write, so a
//!   crash between insert and completion leaves a `locked_at` row that a
//!   later retry can detect as "in flight" and reject with 409, rather than
//!   racing the original write.
//! - Retry with the same key + same request fingerprint: we short-circuit
//!   and replay the stored response verbatim (no double write).
//! - Retry with the same key + a DIFFERENT request body: that's a client
//!   bug (reusing a key for a different logical request), so we return 409.
//!
//! Because the key row is written in the same DB transaction as the
//! business write (e.g. `expenses` + `expense_splits` + `activity_log`),
//! either both commit or neither does -- there is no window where an
//! expense exists but its idempotency record doesn't (or vice versa).

use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::error::ApiError;

pub fn fingerprint(body: &Value) -> String {
    let canonical = serde_json::to_string(body).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    hex::encode(hasher.finalize())
}

pub enum IdempotencyOutcome {
    /// No prior record: caller should proceed and call `complete`.
    Proceed,
    /// A completed prior response exists: replay it verbatim.
    Replay { status: u16, body: Value },
    /// A request is currently in flight for this key.
    InFlight,
}

#[derive(FromRow)]
struct ExistingKeyRow {
    request_hash: String,
    response_status: Option<i32>,
    response_body: Option<Value>,
    completed_at: Option<DateTime<Utc>>,
}

pub async fn begin(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    endpoint: &str,
    user_id: Uuid,
    request_body: &Value,
) -> Result<IdempotencyOutcome, ApiError> {
    let fp = fingerprint(request_body);

    let existing: Option<ExistingKeyRow> = sqlx::query_as(
        r#"SELECT request_hash, response_status, response_body, completed_at
           FROM idempotency_keys WHERE key = $1 FOR UPDATE"#,
    )
    .bind(key)
    .fetch_optional(&mut **tx)
    .await?;

    if let Some(row) = existing {
        if row.request_hash != fp {
            return Err(ApiError::Conflict(
                "idempotency key reused with a different request body".into(),
            ));
        }
        return match (row.response_status, row.completed_at) {
            (Some(status), Some(_)) => Ok(IdempotencyOutcome::Replay {
                status: status as u16,
                body: row.response_body.unwrap_or(Value::Null),
            }),
            _ => Ok(IdempotencyOutcome::InFlight),
        };
    }

    sqlx::query(
        r#"INSERT INTO idempotency_keys (key, endpoint, user_id, request_hash)
           VALUES ($1, $2, $3, $4)"#,
    )
    .bind(key)
    .bind(endpoint)
    .bind(user_id)
    .bind(&fp)
    .execute(&mut **tx)
    .await?;

    Ok(IdempotencyOutcome::Proceed)
}

pub async fn complete(
    tx: &mut Transaction<'_, Postgres>,
    key: &str,
    status: u16,
    body: &Value,
) -> Result<(), ApiError> {
    sqlx::query(
        r#"UPDATE idempotency_keys
           SET response_status = $2, response_body = $3, completed_at = now()
           WHERE key = $1"#,
    )
    .bind(key)
    .bind(status as i32)
    .bind(body)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
