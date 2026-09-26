//! A dev/testing-only stand-in for S3 receipt storage: when no
//! `AWS_S3_BUCKET` is configured, receipt photos are written to a local
//! directory instead and served back over plain HTTP.
//!
//! **This is not a secure substitute for the S3 path.** A presigned S3 URL
//! is protected by an AWS signature the client can't forge; the local PUT
//! endpoint here has no such check -- anyone who guesses (or is handed) an
//! upload URL within its short life could write to that path. That's an
//! acceptable trade-off for "let me click around and see photos attached to
//! expenses on my laptop", never for anything reachable outside localhost.
//! `presign_receipt_upload` only falls back to this path automatically when
//! S3 isn't configured; set real AWS credentials to get the real thing.

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use uuid::Uuid;

use crate::{error::ApiError, state::AppState};

pub const MAX_UPLOAD_BYTES: usize = 15 * 1024 * 1024; // 15 MB

const ALLOWED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// Builds the local storage key for a receipt: `{trip_id}/{uuid}.{ext}`.
/// Only ever called server-side with an extension we've already validated,
/// so the `filename` segment written to disk is always `<uuid>.<ext>`,
/// never user-controlled text -- that's what keeps the PUT handler below
/// safe from path traversal even without an auth check on it.
pub fn build_key(trip_id: Uuid, original_filename: &str) -> Result<String, ApiError> {
    let ext = original_filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "unsupported file extension '{ext}'; allowed: {}",
            ALLOWED_EXTENSIONS.join(", ")
        )));
    }
    Ok(format!("{trip_id}/{}.{ext}", Uuid::new_v4()))
}

pub fn upload_url(base_url: &str, key: &str) -> String {
    format!("{base_url}/local-uploads/{key}")
}

pub fn public_url(base_url: &str, key: &str) -> String {
    format!("{base_url}/uploads/{key}")
}

/// `PUT /local-uploads/:trip_id/:filename` -- writes the request body to
/// `local_uploads_dir/{trip_id}/{filename}`. `filename` must already look
/// like `<uuid>.<allowed-extension>` (i.e. something `build_key` produced);
/// anything else is rejected before touching the filesystem.
pub async fn receive_upload(
    State(state): State<AppState>,
    Path((trip_id, filename)): Path<(Uuid, String)>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    if body.len() > MAX_UPLOAD_BYTES {
        return Err(ApiError::BadRequest(format!(
            "file too large ({} bytes, max {MAX_UPLOAD_BYTES})",
            body.len()
        )));
    }

    let content_type = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !content_type.starts_with("image/") {
        return Err(ApiError::BadRequest("only image uploads are supported".into()));
    }

    validate_filename(&filename)?;

    let dir = state.local_uploads_dir.join(trip_id.to_string());
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| ApiError::Other(anyhow::anyhow!("couldn't create upload dir: {e}")))?;

    let path = dir.join(&filename);
    tokio::fs::write(&path, &body)
        .await
        .map_err(|e| ApiError::Other(anyhow::anyhow!("couldn't write uploaded file: {e}")))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Rejects anything that isn't exactly `<uuid>.<allowed-extension>`, so the
/// path segment we join onto `local_uploads_dir` can never contain `..`,
/// `/`, or other surprises -- even though `filename` here ultimately comes
/// from the URL path of an unauthenticated PUT.
fn validate_filename(filename: &str) -> Result<(), ApiError> {
    let (stem, ext) = filename
        .rsplit_once('.')
        .ok_or_else(|| ApiError::BadRequest("invalid upload path".into()))?;
    if Uuid::parse_str(stem).is_err() {
        return Err(ApiError::BadRequest("invalid upload path".into()));
    }
    if !ALLOWED_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
        return Err(ApiError::BadRequest("invalid upload path".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_key_rejects_disallowed_extensions() {
        let trip_id = Uuid::new_v4();
        assert!(build_key(trip_id, "receipt.pdf").is_err());
        assert!(build_key(trip_id, "receipt.exe").is_err());
        assert!(build_key(trip_id, "no_extension").is_err());
    }

    #[test]
    fn build_key_accepts_image_extensions() {
        let trip_id = Uuid::new_v4();
        let key = build_key(trip_id, "photo.JPG").unwrap();
        assert!(key.ends_with(".jpg")); // normalized to lowercase
        assert!(key.starts_with(&trip_id.to_string()));
    }

    #[test]
    fn validate_filename_rejects_path_traversal() {
        assert!(validate_filename("../../etc/passwd.png").is_err());
        assert!(validate_filename("not-a-uuid.png").is_err());
        assert!(validate_filename("../secrets.png").is_err());
    }

    #[test]
    fn validate_filename_accepts_wellformed_key() {
        let filename = format!("{}.png", Uuid::new_v4());
        assert!(validate_filename(&filename).is_ok());
    }
}
