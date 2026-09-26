use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use bigdecimal::{BigDecimal, Zero};
use serde_json::json;
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    authz,
    balances::suggest_transfers,
    error::{ApiError, ApiResult},
    idempotency::{self, IdempotencyOutcome},
    models::{BalanceEntry, CreateSettlementRequest, Settlement},
    state::AppState,
    ws,
};

#[derive(FromRow)]
struct MemberRow {
    id: Uuid,
    name: String,
    avatar_color: String,
}

#[derive(FromRow)]
struct PaidRow {
    paid_by: Uuid,
    user_id: Uuid,
    amount: BigDecimal,
}

#[derive(FromRow)]
struct SettlementRow {
    from_user: Uuid,
    to_user: Uuid,
    amount: BigDecimal,
}

/// Computes each member's net balance for a trip:
///   net = (sum of expense-splits where they're the payer, i.e. what others
///          owe them for expenses they fronted)
///       - (sum of their own splits across all expenses, i.e. what they owe)
///       + (settlements received) - (settlements paid)
pub async fn get_balances(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let members: Vec<MemberRow> = sqlx::query_as(
        r#"SELECT u.id, u.name, u.avatar_color FROM trip_members m
           JOIN users u ON u.id = m.user_id WHERE m.trip_id = $1"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;

    let mut net: HashMap<Uuid, BigDecimal> = members
        .iter()
        .map(|m| (m.id, BigDecimal::zero()))
        .collect();

    // Paid-out amounts: whoever paid an expense is owed the sum of every
    // split *other than their own* on that expense.
    let paid_rows: Vec<PaidRow> = sqlx::query_as(
        r#"SELECT e.paid_by, es.user_id, es.amount
           FROM expenses e JOIN expense_splits es ON es.expense_id = e.id
           WHERE e.trip_id = $1 AND e.deleted_at IS NULL"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;

    for row in &paid_rows {
        if row.paid_by != row.user_id {
            *net.entry(row.paid_by).or_insert_with(BigDecimal::zero) += &row.amount;
            *net.entry(row.user_id).or_insert_with(BigDecimal::zero) -= &row.amount;
        }
    }

    let settlement_rows: Vec<SettlementRow> = sqlx::query_as(
        "SELECT from_user, to_user, amount FROM settlements WHERE trip_id = $1",
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;

    for row in &settlement_rows {
        // Paying a settlement reduces what the payer owes (raises their net);
        // receiving one reduces what the receiver is owed (lowers their net).
        *net.entry(row.from_user).or_insert_with(BigDecimal::zero) += &row.amount;
        *net.entry(row.to_user).or_insert_with(BigDecimal::zero) -= &row.amount;
    }

    let mut entries: Vec<BalanceEntry> = members
        .iter()
        .map(|m| BalanceEntry {
            user_id: m.id,
            name: m.name.clone(),
            avatar_color: m.avatar_color.clone(),
            net: net.get(&m.id).cloned().unwrap_or_else(BigDecimal::zero),
        })
        .collect();
    entries.sort_by(|a, b| b.net.partial_cmp(&a.net).unwrap());

    let lookup: HashMap<Uuid, (String, BigDecimal)> = members
        .iter()
        .map(|m| {
            (
                m.id,
                (m.name.clone(), net.get(&m.id).cloned().unwrap_or_else(BigDecimal::zero)),
            )
        })
        .collect();
    let suggested = suggest_transfers(&lookup);

    Ok(Json(json!({ "balances": entries, "suggested_transfers": suggested })))
}

pub async fn list_settlements(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<Vec<Settlement>>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;
    let settlements: Vec<Settlement> = sqlx::query_as(
        r#"SELECT id, trip_id, from_user, to_user, amount, note, settled_at, created_by
           FROM settlements WHERE trip_id = $1 ORDER BY settled_at DESC"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(settlements))
}

pub async fn create_settlement(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<CreateSettlementRequest>,
) -> ApiResult<(axum::http::StatusCode, Json<serde_json::Value>)> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    if req.amount <= BigDecimal::zero() {
        return Err(ApiError::BadRequest("settlement amount must be positive".into()));
    }
    if req.from_user == req.to_user {
        return Err(ApiError::BadRequest("cannot settle with yourself".into()));
    }

    let idem_key = headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(String::from)
        .ok_or_else(|| ApiError::BadRequest("Idempotency-Key header is required".into()))?;

    let request_json = serde_json::to_value(&req).map_err(|e| ApiError::BadRequest(e.to_string()))?;
    let mut tx = state.db.begin().await?;

    let idem_endpoint = format!("POST /trips/{trip_id}/settlements");
    match idempotency::begin(&mut tx, &idem_key, &idem_endpoint, auth.id, &request_json).await? {
        IdempotencyOutcome::Replay { status, body } => {
            tx.commit().await?;
            let code = axum::http::StatusCode::from_u16(status).unwrap_or(axum::http::StatusCode::OK);
            return Ok((code, Json(body)));
        }
        IdempotencyOutcome::InFlight => {
            return Err(ApiError::Conflict("settlement already being processed".into()));
        }
        IdempotencyOutcome::Proceed => {}
    }

    let settlement: Settlement = sqlx::query_as(
        r#"INSERT INTO settlements (trip_id, from_user, to_user, amount, note, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, trip_id, from_user, to_user, amount, note, settled_at, created_by"#,
    )
    .bind(trip_id)
    .bind(req.from_user)
    .bind(req.to_user)
    .bind(&req.amount)
    .bind(&req.note)
    .bind(auth.id)
    .fetch_one(&mut *tx)
    .await?;

    crate::activity::record(
        &mut tx,
        state.activity_hmac_secret.as_slice(),
        trip_id,
        Some(auth.id),
        "settlement.recorded",
        json!({ "from": settlement.from_user, "to": settlement.to_user, "amount": settlement.amount }),
    )
    .await?;

    let body = serde_json::to_value(&settlement).map_err(|e| ApiError::BadRequest(e.to_string()))?;
    idempotency::complete(&mut tx, &idem_key, 201, &body).await?;
    tx.commit().await?;

    ws::broadcast(&state, trip_id, "settlement.recorded", json!({ "id": settlement.id }));
    Ok((axum::http::StatusCode::CREATED, Json(body)))
}
