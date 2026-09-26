use serde_json::Value;
use sqlx::{FromRow, Postgres, Transaction};
use uuid::Uuid;

use crate::{error::ApiError, hashchain};

#[derive(FromRow)]
struct LastActivityRow {
    seq: i64,
    hash: String,
}

/// Appends one event to `activity_log` inside the caller's transaction,
/// extending the HMAC hash chain for this trip. Must be called with the
/// transaction that also performs the underlying write, so the event and
/// the write commit or roll back together.
pub async fn record(
    tx: &mut Transaction<'_, Postgres>,
    secret: &[u8],
    trip_id: Uuid,
    actor_id: Option<Uuid>,
    action: &str,
    metadata: Value,
) -> Result<Uuid, ApiError> {
    // Lock the trip's last activity row so concurrent writers to the same
    // trip serialize on `seq`/`prev_hash` instead of racing.
    let last: Option<LastActivityRow> = sqlx::query_as(
        r#"SELECT seq, hash FROM activity_log
           WHERE trip_id = $1 ORDER BY seq DESC LIMIT 1 FOR UPDATE"#,
    )
    .bind(trip_id)
    .fetch_optional(&mut **tx)
    .await?;

    let (next_seq, prev_hash) = match last {
        Some(row) => (row.seq + 1, row.hash),
        None => (1i64, hashchain::GENESIS.to_string()),
    };

    let canonical = hashchain::canonicalize(trip_id, actor_id, action, &metadata, next_seq);
    let hash = hashchain::compute_hash(secret, &prev_hash, &canonical);

    let id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO activity_log (trip_id, actor_id, action, metadata, seq, prev_hash, hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
    )
    .bind(trip_id)
    .bind(actor_id)
    .bind(action)
    .bind(&metadata)
    .bind(next_seq)
    .bind(&prev_hash)
    .bind(&hash)
    .fetch_one(&mut **tx)
    .await?;

    Ok(id)
}
