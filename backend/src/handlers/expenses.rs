use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde_json::json;
use uuid::Uuid;
use validator::Validate;

use crate::{
    auth::AuthUser,
    authz,
    error::{ApiError, ApiResult},
    idempotency::{self, IdempotencyOutcome},
    models::{CreateExpenseRequest, Expense, ExpenseSplit},
    splits::compute_splits,
    state::AppState,
    ws,
};

fn extract_idempotency_key(headers: &HeaderMap) -> ApiResult<String> {
    headers
        .get("Idempotency-Key")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::BadRequest("Idempotency-Key header is required".into()))
}

pub async fn list_expenses(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<Vec<serde_json::Value>>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let expenses: Vec<Expense> = sqlx::query_as(
        r#"SELECT id, trip_id, description, amount, currency, category, paid_by,
                  split_type, receipt_url, notes, created_by, created_at, updated_at
           FROM expenses WHERE trip_id = $1 AND deleted_at IS NULL
           ORDER BY created_at DESC"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;

    let mut out = Vec::with_capacity(expenses.len());
    for e in expenses {
        let splits: Vec<ExpenseSplit> = sqlx::query_as(
            "SELECT id, expense_id, user_id, amount, percentage FROM expense_splits WHERE expense_id = $1",
        )
        .bind(e.id)
        .fetch_all(&state.db)
        .await?;
        out.push(json!({
            "id": e.id, "trip_id": e.trip_id, "description": e.description,
            "amount": e.amount, "currency": e.currency, "category": e.category,
            "paid_by": e.paid_by, "split_type": e.split_type, "receipt_url": e.receipt_url,
            "notes": e.notes, "created_by": e.created_by, "created_at": e.created_at,
            "updated_at": e.updated_at, "splits": splits,
        }));
    }
    Ok(Json(out))
}

pub async fn create_expense(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
    headers: HeaderMap,
    Json(req): Json<CreateExpenseRequest>,
) -> ApiResult<(axum::http::StatusCode, Json<serde_json::Value>)> {
    req.validate()?;
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let idem_key = extract_idempotency_key(&headers)?;
    let request_json = serde_json::to_value(&IdemBody {
        description: &req.description,
        amount: &req.amount,
        paid_by: req.paid_by,
        split_type: &req.split_type,
    })
    .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    // Validate the payer is actually a trip member.
    authz::require_member(&state.db, trip_id, req.paid_by).await.map_err(|_| {
        ApiError::BadRequest("paid_by must be a member of this trip".into())
    })?;

    let computed = compute_splits(req.split_type, &req.amount, &req.splits)
        .map_err(|e| ApiError::BadRequest(e.to_string()))?;

    let mut tx = state.db.begin().await?;

    let idem_endpoint = format!("POST /trips/{trip_id}/expenses");
    match idempotency::begin(&mut tx, &idem_key, &idem_endpoint, auth.id, &request_json).await? {
        IdempotencyOutcome::Replay { status, body } => {
            tx.commit().await?; // release the FOR UPDATE lock; nothing was mutated
            let code = axum::http::StatusCode::from_u16(status)
                .unwrap_or(axum::http::StatusCode::OK);
            return Ok((code, Json(body)));
        }
        IdempotencyOutcome::InFlight => {
            return Err(ApiError::Conflict(
                "a request with this idempotency key is already being processed".into(),
            ));
        }
        IdempotencyOutcome::Proceed => {}
    }

    let expense: Expense = sqlx::query_as(
        r#"INSERT INTO expenses (trip_id, description, amount, currency, category, paid_by, split_type, receipt_url, notes, created_by)
           VALUES ($1, $2, $3, COALESCE($4, 'USD'), COALESCE($5, 'other'), $6, $7, $8, $9, $10)
           RETURNING id, trip_id, description, amount, currency, category, paid_by,
                     split_type, receipt_url, notes, created_by, created_at, updated_at"#,
    )
    .bind(trip_id)
    .bind(&req.description)
    .bind(&req.amount)
    .bind(&req.currency)
    .bind(&req.category)
    .bind(req.paid_by)
    .bind(req.split_type)
    .bind(&req.receipt_url)
    .bind(&req.notes)
    .bind(auth.id)
    .fetch_one(&mut *tx)
    .await?;

    let mut split_rows = Vec::with_capacity(computed.len());
    for s in &computed {
        let row: ExpenseSplit = sqlx::query_as(
            r#"INSERT INTO expense_splits (expense_id, user_id, amount, percentage)
               VALUES ($1, $2, $3, $4)
               RETURNING id, expense_id, user_id, amount, percentage"#,
        )
        .bind(expense.id)
        .bind(s.user_id)
        .bind(&s.amount)
        .bind(&s.percentage)
        .fetch_one(&mut *tx)
        .await?;
        split_rows.push(row);
    }

    crate::activity::record(
        &mut tx,
        state.activity_hmac_secret.as_slice(),
        trip_id,
        Some(auth.id),
        "expense.created",
        json!({
            "expense_id": expense.id,
            "description": expense.description,
            "amount": expense.amount,
            "split_type": req.split_type,
        }),
    )
    .await?;

    let response_body = json!({
        "id": expense.id, "trip_id": expense.trip_id, "description": expense.description,
        "amount": expense.amount, "currency": expense.currency, "category": expense.category,
        "paid_by": expense.paid_by, "split_type": expense.split_type, "receipt_url": expense.receipt_url,
        "notes": expense.notes, "created_by": expense.created_by, "created_at": expense.created_at,
        "updated_at": expense.updated_at, "splits": split_rows,
    });

    idempotency::complete(&mut tx, &idem_key, 201, &response_body).await?;

    tx.commit().await?;

    ws::broadcast(&state, trip_id, "expense.created", json!({ "id": expense.id }));

    Ok((axum::http::StatusCode::CREATED, Json(response_body)))
}

pub async fn delete_expense(
    auth: AuthUser,
    State(state): State<AppState>,
    Path((trip_id, expense_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<serde_json::Value>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let mut tx = state.db.begin().await?;
    let updated = sqlx::query(
        "UPDATE expenses SET deleted_at = now() WHERE id = $1 AND trip_id = $2 AND deleted_at IS NULL",
    )
    .bind(expense_id)
    .bind(trip_id)
    .execute(&mut *tx)
    .await?;
    if updated.rows_affected() == 0 {
        return Err(ApiError::NotFound("expense not found".into()));
    }

    crate::activity::record(
        &mut tx,
        state.activity_hmac_secret.as_slice(),
        trip_id,
        Some(auth.id),
        "expense.deleted",
        json!({ "expense_id": expense_id }),
    )
    .await?;

    tx.commit().await?;
    ws::broadcast(&state, trip_id, "expense.deleted", json!({ "id": expense_id }));
    Ok(Json(json!({ "status": "deleted" })))
}

#[derive(serde::Serialize)]
struct IdemBody<'a> {
    description: &'a str,
    amount: &'a bigdecimal::BigDecimal,
    paid_by: Uuid,
    split_type: &'a crate::models::SplitType,
}
