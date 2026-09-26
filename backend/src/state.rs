use std::path::PathBuf;
use std::sync::Arc;

use sqlx::PgPool;
use tokio::sync::broadcast;

use crate::s3_presign::S3Config;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub jwt_secret: String,
    pub activity_hmac_secret: Arc<Vec<u8>>,
    /// Broadcast channel used to fan out WebSocket events to all connected
    /// clients; each event carries the trip_id so the frontend can filter.
    pub ws_tx: broadcast::Sender<crate::ws::WsEvent>,
    /// Some when AWS_S3_BUCKET + credentials are configured; receipts go to
    /// S3 via presigned PUT. None falls back to `local_uploads_dir` below,
    /// a dev/testing-only stub that needs no cloud account.
    pub s3: Option<S3Config>,
    /// Where local-mode receipt uploads are written on disk, and the base
    /// URL those files are served back from (see `local_uploads` module).
    /// Only used when `s3` is None.
    pub local_uploads_dir: PathBuf,
    pub public_base_url: String,
}
