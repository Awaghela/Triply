use axum::{
    extract::{Path, State},
    Json,
};
use bigdecimal::{BigDecimal, Zero};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    authz,
    error::ApiResult,
    models::{CategoryTotal, DayTotal, TripMetrics},
    state::AppState,
};

#[derive(FromRow)]
struct SummaryRow {
    count: i64,
    total: BigDecimal,
}

pub async fn trip_metrics(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
) -> ApiResult<Json<TripMetrics>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    let summary: SummaryRow = sqlx::query_as(
        r#"SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total
           FROM expenses WHERE trip_id = $1 AND deleted_at IS NULL"#,
    )
    .bind(trip_id)
    .fetch_one(&state.db)
    .await?;

    let member_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM trip_members WHERE trip_id = $1")
        .bind(trip_id)
        .fetch_one(&state.db)
        .await?;

    let by_category: Vec<CategoryTotal> = sqlx::query_as(
        r#"SELECT category, SUM(amount) as total, COUNT(*) as count
           FROM expenses WHERE trip_id = $1 AND deleted_at IS NULL
           GROUP BY category ORDER BY total DESC"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;

    let by_day: Vec<DayTotal> = sqlx::query_as(
        r#"SELECT to_char(created_at, 'YYYY-MM-DD') as date, SUM(amount) as total
           FROM expenses WHERE trip_id = $1 AND deleted_at IS NULL
           GROUP BY 1 ORDER BY 1 ASC"#,
    )
    .bind(trip_id)
    .fetch_all(&state.db)
    .await?;

    let avg = if summary.count > 0 {
        &summary.total / BigDecimal::from(summary.count)
    } else {
        BigDecimal::zero()
    };

    Ok(Json(TripMetrics {
        total_expenses: summary.count,
        total_amount: summary.total,
        member_count,
        avg_expense: avg,
        by_category,
        by_day,
    }))
}
