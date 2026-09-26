use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    authz,
    error::ApiResult,
    hashchain::verify_chain,
    models::ActivityLogEntry,
    state::AppState,
};

pub async fn list_activity(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<Vec<ActivityLogEntry>>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;
    let entries: Vec<ActivityLogEntry> = sqlx::query_as(
        r#"SELECT id, trip_id, actor_id, action, metadata, seq, prev_hash, hash, created_at
           FROM activity_log WHERE trip_id = $1 ORDER BY seq DESC LIMIT 200"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(entries))
}

#[derive(FromRow)]
struct ChainRow {
    seq: i64,
    trip_id: Uuid,
    actor_id: Option<Uuid>,
    action: String,
    metadata: serde_json::Value,
    prev_hash: String,
    hash: String,
}

/// Recomputes the HMAC chain for this trip's entire activity log from
/// genesis and reports whether it's intact. Exposed so the UI can show a
/// "log verified" badge, and so an operator can detect out-of-band tampering
/// (e.g. a direct DB edit) that bypassed the API.
pub async fn verify_activity(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let rows: Vec<ChainRow> = sqlx::query_as(
        r#"SELECT seq, trip_id, actor_id, action, metadata, prev_hash, hash
           FROM activity_log WHERE trip_id = $1 ORDER BY seq ASC"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;

    let entries: Vec<_> = rows
        .into_iter()
        .map(|r| (r.seq, r.trip_id, r.actor_id, r.action, r.metadata, r.prev_hash, r.hash))
        .collect();

    let result = verify_chain(state.activity_hmac_secret.as_slice(), &entries);

    Ok(Json(json!({
        "valid": result.valid,
        "entries_checked": result.entries_checked,
        "first_broken_seq": result.first_broken_seq,
    })))
}
