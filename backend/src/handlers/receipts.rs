use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    authz,
    error::{ApiError, ApiResult},
    local_uploads,
    s3_presign::{presign_put, public_url as s3_public_url},
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct PresignRequest {
    pub filename: String,
    pub content_type: String,
}

/// Returns an `{ upload_url, public_url }` pair for a receipt photo. The
/// client always does the same thing with the result regardless of which
/// backend served it: `PUT` the raw file bytes to `upload_url` with a
/// matching `Content-Type` header, then store `public_url` on the expense.
///
/// - When S3 is configured: `upload_url` is a short-lived presigned S3 PUT
///   URL (see `s3_presign`); the client uploads directly to S3.
/// - Otherwise: `upload_url` points at this server's own
///   `/local-uploads/...` endpoint, which writes to disk (see
///   `local_uploads`) -- a dev/testing stub that needs no AWS account.
pub async fn presign_receipt_upload(
    auth: AuthUser,
    State(state): State<AppState>,
    Path(trip_id): Path<Uuid>,
    Json(req): Json<PresignRequest>,
) -> ApiResult<Json<serde_json::Value>> {
    authz::require_member(&state.db, trip_id, auth.id).await?;

    if req.content_type.is_empty() || !req.content_type.starts_with("image/") {
        return Err(ApiError::BadRequest("only image uploads are supported".into()));
    }

    if let Some(s3) = state.s3.as_ref() {
        let ext = req.filename.rsplit('.').next().unwrap_or("bin");
        let key = format!("trips/{trip_id}/receipts/{}.{}", Uuid::new_v4(), ext);
        return Ok(Json(json!({
            "upload_url": presign_put(s3, &key, 300),
            "public_url": s3_public_url(s3, &key),
        })));
    }

    let key = local_uploads::build_key(trip_id, &req.filename)?;
    Ok(Json(json!({
        "upload_url": local_uploads::upload_url(&state.public_base_url, &key),
        "public_url": local_uploads::public_url(&state.public_base_url, &key),
    })))
}
