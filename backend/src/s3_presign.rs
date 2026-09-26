//! A minimal, dependency-light AWS Signature Version 4 presigner for S3
//! PUT uploads.
//!
//! We deliberately don't pull in `aws-sdk-s3`/`aws-config`: those crates
//! bump their minimum supported Rust version aggressively and often, and
//! without a committed `Cargo.lock` a fresh `cargo build` always resolves
//! to their newest release -- which has repeatedly required a Rust
//! toolchain newer than what's available. Presigning a PUT URL is a small,
//! well-specified algorithm (see AWS's "Authenticating Requests: Using
//! Query Parameters" docs), so we implement it directly against `hmac` +
//! `sha2`, both mature, slow-moving crates already in the dependency tree.
//!
//! Reference: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html

use chrono::Utc;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone)]
pub struct S3Config {
    pub access_key_id: String,
    pub secret_access_key: String,
    pub region: String,
    pub bucket: String,
}

/// Percent-encodes per AWS's SigV4 rules: unreserved characters
/// (`A-Za-z0-9-_.~`) pass through untouched; everything else -- including
/// `/` when `encode_slash` is true -- becomes an uppercase-hex `%XX`
/// escape. This matches AWS's own reference implementation, not
/// general-purpose URL encoding (which would, e.g., encode spaces as `+`).
fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b'/' if !encode_slash => out.push('/'),
            _ => out.push_str(&format!("%{:02X}", byte)),
        }
    }
    out
}

fn hmac_sha256(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts a key of any length");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

/// Builds a presigned `PUT` URL for `key` in `config.bucket`, valid for
/// `expires_secs` seconds. Only the `host` header is part of the signature
/// (matching the common browser-upload pattern where the client sets its
/// own `Content-Type`), so the caller doesn't need to pre-negotiate headers
/// with whoever performs the upload.
pub fn presign_put(config: &S3Config, key: &str, expires_secs: u32) -> String {
    let now = Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();

    let host = format!("{}.s3.{}.amazonaws.com", config.bucket, config.region);
    let credential_scope = format!("{}/{}/s3/aws4_request", date_stamp, config.region);
    let credential = format!("{}/{}", config.access_key_id, credential_scope);

    let canonical_uri = format!("/{}", uri_encode(key, false));

    let mut query_params = vec![
        ("X-Amz-Algorithm".to_string(), "AWS4-HMAC-SHA256".to_string()),
        ("X-Amz-Credential".to_string(), credential),
        ("X-Amz-Date".to_string(), amz_date.clone()),
        ("X-Amz-Expires".to_string(), expires_secs.to_string()),
        ("X-Amz-SignedHeaders".to_string(), "host".to_string()),
    ];
    query_params.sort();

    let canonical_query_string = query_params
        .iter()
        .map(|(k, v)| format!("{}={}", uri_encode(k, true), uri_encode(v, true)))
        .collect::<Vec<_>>()
        .join("&");

    let canonical_headers = format!("host:{}\n", host);
    let signed_headers = "host";

    let canonical_request = format!(
        "PUT\n{canonical_uri}\n{canonical_query_string}\n{canonical_headers}\n{signed_headers}\nUNSIGNED-PAYLOAD"
    );

    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{amz_date}\n{credential_scope}\n{}",
        sha256_hex(&canonical_request)
    );

    let k_date = hmac_sha256(format!("AWS4{}", config.secret_access_key).as_bytes(), &date_stamp);
    let k_region = hmac_sha256(&k_date, &config.region);
    let k_service = hmac_sha256(&k_region, "s3");
    let k_signing = hmac_sha256(&k_service, "aws4_request");
    let signature = hex::encode(hmac_sha256(&k_signing, &string_to_sign));

    format!("https://{host}{canonical_uri}?{canonical_query_string}&X-Amz-Signature={signature}")
}

/// The plain (unsigned) public URL for an object -- what the frontend
/// stores on the expense record once the upload completes.
pub fn public_url(config: &S3Config, key: &str) -> String {
    format!(
        "https://{}.s3.{}.amazonaws.com/{}",
        config.bucket,
        config.region,
        uri_encode(key, false)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uri_encode_preserves_unreserved_and_escapes_rest() {
        assert_eq!(uri_encode("abc-123_ABC.~", true), "abc-123_ABC.~");
        assert_eq!(uri_encode("a/b", true), "a%2Fb");
        assert_eq!(uri_encode("a/b", false), "a/b");
        assert_eq!(uri_encode("a b", true), "a%20b");
    }

    #[test]
    fn presign_put_produces_a_well_formed_url() {
        let config = S3Config {
            access_key_id: "AKIDEXAMPLE".into(),
            secret_access_key: "secret".into(),
            region: "us-east-1".into(),
            bucket: "example-bucket".into(),
        };
        let url = presign_put(&config, "trips/abc/receipts/1.png", 300);
        assert!(url.starts_with("https://example-bucket.s3.us-east-1.amazonaws.com/trips/abc/receipts/1.png?"));
        assert!(url.contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(url.contains("X-Amz-Expires=300"));
        assert!(url.contains("X-Amz-Signature="));
        // Same inputs at the "same instant" should be deterministic; since
        // the timestamp changes second to second we just check structure
        // rather than an exact golden signature here.
    }
}
