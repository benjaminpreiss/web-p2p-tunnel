//! Bounded application protocol inside the authenticated PQ channel.
//! Never derives Debug: token material must not enter diagnostic logs.
use anyhow::{Result, bail, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use rand::RngCore;
use serde::Deserialize;
use serde_json::json;
use std::time::Duration;
use zeroize::Zeroize;

pub const LABEL: &str = "web-p2p-tunnel.http-inspector.v1";
const MAX_REQUESTS: u32 = 16;
const MAX_BODY: usize = 4096;

enum State {
    Awaiting(blake3::Hash),
    Ready(u32),
    Closed,
}

pub struct HttpInspector {
    port: u16,
    state: State,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    Authorize { v: u8, token: String },
    Get { v: u8, id: u32, path: String },
}

impl HttpInspector {
    /// Returns the one-time displayed grant separately; retains only its hash.
    pub fn new(port: u16) -> Result<(Self, String)> {
        ensure!(port != 0, "choose a nonzero localhost port");
        let mut bytes = [0; 32];
        rand::rngs::OsRng.try_fill_bytes(&mut bytes)?;
        let token = hex::encode(bytes);
        bytes.zeroize();
        Ok((
            Self {
                port,
                state: State::Awaiting(blake3::hash(token.as_bytes())),
            },
            token,
        ))
    }

    /// Caller supplies authenticated/decrypted records, never raw network input.
    /// Any invalid record, failed fetch, or cancellation permanently closes access.
    pub async fn handle(&mut self, record: &[u8]) -> Result<Vec<u8>> {
        let state = std::mem::replace(&mut self.state, State::Closed);
        ensure!(record.len() <= 8192, "inspector record too large");
        let request: Request = serde_json::from_slice(record)
            .map_err(|_| anyhow::anyhow!("invalid inspector request"))?;
        let response = match (state, request) {
            (State::Awaiting(hash), Request::Authorize { v: 1, mut token }) => {
                let authorized = token.len() == 64 && blake3::hash(token.as_bytes()) == hash;
                token.zeroize();
                ensure!(authorized, "visitor authorization failed");
                self.state = State::Ready(0);
                json!({"v":1,"type":"authorized","maxRequests":MAX_REQUESTS,"maxBodyBytes":MAX_BODY})
            }
            (State::Ready(count), Request::Get { v: 1, id, path }) => {
                ensure!(
                    count < MAX_REQUESTS && id == count + 1,
                    "inspector request limit or order violation"
                );
                let response = tokio::time::timeout(Duration::from_secs(5), self.fetch(id, &path))
                    .await
                    .map_err(|_| anyhow::anyhow!("localhost request timed out"))??;
                self.state = State::Ready(count + 1);
                response
            }
            _ => bail!("inspector request not permitted"),
        };
        let response = serde_json::to_vec(&response)?;
        ensure!(response.len() <= 8192, "inspector response too large");
        Ok(response)
    }

    async fn fetch(&self, id: u32, path: &str) -> Result<serde_json::Value> {
        ensure!(
            path.len() <= 1024
                && path.starts_with('/')
                && !path.starts_with("//")
                && path
                    .bytes()
                    .all(|b| (0x21..=0x7e).contains(&b) && b != b'\\' && b != b'#'),
            "invalid request path"
        );
        let base = reqwest::Url::parse(&format!("http://127.0.0.1:{}/", self.port))?;
        let url = base
            .join(path)
            .map_err(|_| anyhow::anyhow!("invalid request path"))?;
        ensure!(
            url.origin() == base.origin() && url.username().is_empty() && url.password().is_none(),
            "target changes are forbidden"
        );
        // No environmental proxies, redirects, cookie jar, TLS, or caller headers.
        // Disable decompression even if another dependency enables its features.
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .http1_only()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .timeout(Duration::from_secs(5))
            .build()?;
        let mut response = client
            .get(url)
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("localhost request failed"))?;
        ensure!(
            response.status().as_u16() >= 200,
            "protocol upgrades are forbidden"
        );
        ensure!(
            response
                .content_length()
                .is_none_or(|n| n <= MAX_BODY as u64),
            "HTTP body exceeds 4 KiB"
        );
        ensure!(
            response
                .headers()
                .get("content-encoding")
                .is_none_or(|v| v == "identity"),
            "encoded HTTP bodies are unsupported"
        );
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_owned();
        ensure!(content_type.len() <= 256, "content type too large");
        let status = response.status().as_u16();
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| anyhow::anyhow!("localhost response failed"))?
        {
            ensure!(
                body.len() + chunk.len() <= MAX_BODY,
                "HTTP body exceeds 4 KiB"
            );
            body.extend_from_slice(&chunk);
        }
        Ok(
            json!({"v":1,"type":"response","id":id,"status":status,"contentType":content_type,"body":STANDARD.encode(body)}),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::{
        net::TcpListener,
        time::{Duration, timeout},
    };

    #[tokio::test]
    async fn authorized_visitor_fetches_a_page_and_asset_without_credentials() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = target.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for (path, mime, body) in [
                ("/", "text/html", "<h1>Hello</h1>"),
                ("/style.css", "text/css", "body{}"),
            ] {
                let (mut socket, _) = target.accept().await.unwrap();
                let mut headers = Vec::new();
                while !headers.ends_with(b"\r\n\r\n") {
                    headers.push(socket.read_u8().await.unwrap());
                    assert!(headers.len() < 4096);
                }
                let headers = String::from_utf8(headers).unwrap().to_lowercase();
                assert!(headers.starts_with(&format!("get {path} http/1.1\r\n")));
                assert!(headers.contains(&format!("host: 127.0.0.1:{port}\r\n")));
                assert!(!headers.contains("cookie:") && !headers.contains("authorization:"));
                socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            }
        });
        let (mut inspector, token) = HttpInspector::new(port).unwrap();
        let response = inspector
            .handle(&serde_json::to_vec(&json!({"v":1,"type":"authorize","token":token})).unwrap())
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&response).unwrap()["type"],
            "authorized"
        );
        for (id, path, expected) in [
            (1, "/", "PGgxPkhlbGxvPC9oMT4="),
            (2, "/style.css", "Ym9keXt9"),
        ] {
            let response = inspector
                .handle(
                    &serde_json::to_vec(&json!({"v":1,"type":"get","id":id,"path":path})).unwrap(),
                )
                .await
                .unwrap();
            let response: serde_json::Value = serde_json::from_slice(&response).unwrap();
            assert_eq!(response["id"], id);
            assert_eq!(response["status"], 200);
            assert_eq!(response["body"], expected);
        }
        server.await.unwrap();
    }

    #[tokio::test]
    async fn destination_header_and_protocol_injection_never_contacts_target() {
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        for request in [
            json!({"v":1,"type":"get","id":1,"path":"http://example.invalid/"}),
            json!({"v":1,"type":"get","id":1,"path":"//example.invalid/"}),
            json!({"v":1,"type":"get","id":1,"path":"/\\example.invalid/"}),
            json!({"v":1,"type":"get","id":1,"path":"/\r\nHost: example.invalid"}),
            json!({"v":1,"type":"get","id":1,"path":"/","headers":{"Authorization":"test"}}),
            json!({"v":2,"type":"get","id":1,"path":"/"}),
            json!({"v":1,"type":"get","id":2,"path":"/"}),
            json!({"v":1,"type":"post","id":1,"path":"/"}),
        ] {
            let (mut inspector, token) =
                HttpInspector::new(target.local_addr().unwrap().port()).unwrap();
            inspector
                .handle(
                    &serde_json::to_vec(&json!({"v":1,"type":"authorize","token":token})).unwrap(),
                )
                .await
                .unwrap();
            assert!(
                inspector
                    .handle(&serde_json::to_vec(&request).unwrap())
                    .await
                    .is_err()
            );
            assert!(
                timeout(Duration::from_millis(20), target.accept())
                    .await
                    .is_err()
            );
        }
    }

    // A real HTTP peer exercises body framing, redirects, and deadlines rather
    // than mocking reqwest or the inspector's internal methods.
    async fn fixture_reply(reply: Vec<u8>, keep_open: bool) -> Result<serde_json::Value> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let target = TcpListener::bind("127.0.0.1:0").await?;
        let port = target.local_addr()?.port();
        let server = tokio::spawn(async move {
            let (mut socket, _) = target.accept().await.unwrap();
            let mut headers = Vec::new();
            while !headers.ends_with(b"\r\n\r\n") {
                headers.push(socket.read_u8().await.unwrap());
            }
            socket.write_all(&reply).await.unwrap();
            if keep_open {
                tokio::time::sleep(Duration::from_secs(10)).await;
            }
        });
        let (mut inspector, token) = HttpInspector::new(port)?;
        inspector
            .handle(&serde_json::to_vec(
                &json!({"v":1,"type":"authorize","token":token}),
            )?)
            .await?;
        let response = inspector
            .handle(br#"{"v":1,"type":"get","id":1,"path":"/"}"#)
            .await;
        server.abort();
        serde_json::from_slice(&response?).map_err(Into::into)
    }

    #[tokio::test]
    async fn redirects_are_returned_without_contacting_the_destination() {
        let other = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let reply = format!(
            "HTTP/1.1 302 Found\r\nLocation: http://{}/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            other.local_addr().unwrap()
        );
        let response = fixture_reply(reply.into_bytes(), false).await.unwrap();
        assert_eq!(response["status"], 302);
        assert!(response.get("headers").is_none());
        assert!(
            timeout(Duration::from_millis(30), other.accept())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn oversized_content_length_and_chunked_bodies_are_rejected() {
        assert!(
            fixture_reply(
                b"HTTP/1.1 200 OK\r\nContent-Length: 4097\r\n\r\n".to_vec(),
                false
            )
            .await
            .is_err()
        );
        let reply = format!(
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1001\r\n{}\r\n0\r\n\r\n",
            "x".repeat(4097)
        );
        assert!(fixture_reply(reply.into_bytes(), false).await.is_err());
    }

    #[tokio::test]
    async fn stalled_body_times_out() {
        let started = std::time::Instant::now();
        assert!(
            fixture_reply(
                b"HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\n".to_vec(),
                true
            )
            .await
            .is_err()
        );
        assert!(started.elapsed() < Duration::from_secs(7));
    }

    #[tokio::test]
    async fn request_budget_stops_target_access_after_sixteen_fetches() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = target.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            for _ in 0..16 {
                let (mut socket, _) = target.accept().await.unwrap();
                let mut headers = Vec::new();
                while !headers.ends_with(b"\r\n\r\n") {
                    headers.push(socket.read_u8().await.unwrap());
                }
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                    .await
                    .unwrap();
            }
            target
        });
        let (mut inspector, token) = HttpInspector::new(port).unwrap();
        inspector
            .handle(&serde_json::to_vec(&json!({"v":1,"type":"authorize","token":token})).unwrap())
            .await
            .unwrap();
        for id in 1..=16 {
            inspector
                .handle(
                    &serde_json::to_vec(&json!({"v":1,"type":"get","id":id,"path":"/"})).unwrap(),
                )
                .await
                .unwrap();
        }
        let target = server.await.unwrap();
        assert!(
            inspector
                .handle(br#"{"v":1,"type":"get","id":17,"path":"/"}"#)
                .await
                .is_err()
        );
        assert!(
            timeout(Duration::from_millis(30), target.accept())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn unauthorized_records_never_contact_the_target_and_consume_the_attempt() {
        let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
        for request in [
            json!({"v":1,"type":"get","id":1,"path":"/"}),
            json!({"v":1,"type":"authorize","token":"0".repeat(64)}),
        ] {
            let (mut inspector, token) =
                HttpInspector::new(target.local_addr().unwrap().port()).unwrap();
            assert!(
                inspector
                    .handle(&serde_json::to_vec(&request).unwrap())
                    .await
                    .is_err()
            );
            assert!(
                inspector
                    .handle(
                        &serde_json::to_vec(&json!({"v":1,"type":"authorize","token":token}))
                            .unwrap()
                    )
                    .await
                    .is_err()
            );
            assert!(
                timeout(Duration::from_millis(30), target.accept())
                    .await
                    .is_err()
            );
        }
    }
}
