//! Local browser fixture. Fixed HTTP routes; no arbitrary file or URL proxying.

use crate::{
    LABEL, MAX_MESSAGE_BYTES, bridge, endpoint,
    http_inspector::{self, HttpInspector},
    stop,
};
use anyhow::{Context, Result, ensure};
use saorsa_pqc::api::sig::ml_dsa_65;
use saorsa_transport::{
    NatTraversalEndpoint,
    transport::{WebRtcCertificateHash, WebRtcDirectAddr},
    webrtc::{
        accept_pq_session,
        direct::{WebRtcCertificate, WebRtcDirectListener},
    },
};
use std::{
    net::{Ipv4Addr, SocketAddr, UdpSocket},
    path::Path,
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    task::JoinSet,
    time::timeout,
};
use zeroize::{Zeroize, Zeroizing};

const BROWSER_LIFETIME: Duration = Duration::from_secs(600);
const MAX_ASSET_BYTES: u64 = 16 * 1024 * 1024;

struct Assets {
    html: Vec<u8>,
    application: Vec<u8>,
    stylesheet: Vec<u8>,
    javascript: Vec<u8>,
    wasm: Vec<u8>,
}

impl Assets {
    async fn load() -> Result<Self> {
        let directory =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/browser/dist/local-browser");
        async fn read(path: &Path) -> Result<Vec<u8>> {
            let metadata = tokio::fs::metadata(path).await.with_context(|| {
                format!(
                    "{} is missing; run npm --prefix apps/browser run build first",
                    path.display()
                )
            })?;
            ensure!(
                metadata.len() <= MAX_ASSET_BYTES,
                "browser asset exceeds 16 MiB"
            );
            Ok(tokio::fs::read(path).await?)
        }
        Ok(Self {
            html: read(&directory.join("index.html")).await?,
            application: read(&directory.join("app.js")).await?,
            stylesheet: read(&directory.join("style.css")).await?,
            javascript: read(&directory.join("pkg/relay_crypto.js")).await?,
            wasm: read(&directory.join("pkg/relay_crypto_bg.wasm")).await?,
        })
    }
}

#[derive(Clone, Copy)]
struct Phone {
    relay_ip: Ipv4Addr,
    phone_ip: Ipv4Addr,
    hosted: bool,
}

fn validate_phone_addresses(relay_ip: Ipv4Addr, phone_ip: Ipv4Addr) -> Result<()> {
    ensure!(
        relay_ip.is_private() && phone_ip.is_private(),
        "phone mode requires explicit private IPv4 addresses"
    );
    ensure!(relay_ip != phone_ip, "phone and Mac addresses must differ");
    Ok(())
}

pub async fn run(port: u16) -> Result<()> {
    run_mode(port, None, None).await
}

pub async fn run_phone(port: u16, relay_ip: Ipv4Addr, phone_ip: Ipv4Addr) -> Result<()> {
    validate_phone_addresses(relay_ip, phone_ip)?;
    ensure!(
        port != 0,
        "phone mode needs a fixed HTTP port matching ADB reverse"
    );
    // Validate local ownership before advertising the UDP allocation on this IP.
    drop(UdpSocket::bind((relay_ip, 0)).context("relay-ip must belong to this Mac")?);
    run_mode(
        port,
        Some(Phone {
            relay_ip,
            phone_ip,
            hosted: false,
        }),
        None,
    )
    .await
}

pub async fn run_hosted(
    relay_ip: Ipv4Addr,
    phone_ip: Ipv4Addr,
    http_port: Option<u16>,
) -> Result<()> {
    validate_phone_addresses(relay_ip, phone_ip)?;
    drop(UdpSocket::bind((relay_ip, 0)).context("relay-ip must belong to this Mac")?);
    run_mode(
        0,
        Some(Phone {
            relay_ip,
            phone_ip,
            hosted: true,
        }),
        http_port,
    )
    .await
}

async fn run_mode(port: u16, phone: Option<Phone>, http_port: Option<u16>) -> Result<()> {
    let inspector = http_port.map(HttpInspector::new).transpose()?;
    // Hosted mode serves no HTTP routes and needs no local copy of the assets.
    // Local modes fail before opening relay sockets if the WASM build is missing.
    let assets = if phone.is_some_and(|phone| phone.hosted) {
        None
    } else {
        Some(Arc::new(Assets::load().await?))
    };
    println!("EXPERIMENT: one browser visitor through a controlled local MASQUE relay");
    if let Some(port) = http_port {
        println!(
            "OPT-IN HTTP INSPECTOR: only GET http://127.0.0.1:{port}; visitor token required."
        );
        println!("Use a test app, not a sensitive local service. GET can have side effects.");
        println!(
            "Maximum 16 requests, 4 KiB bodies, 5 seconds per fetch; no redirects or credentials forwarded."
        );
    } else {
        println!("No HTTP application is exposed; only encrypted echo is available.");
    }
    if let Some(phone) = phone {
        if phone.hosted {
            println!(
                "HOSTED-PAGE LAN MODE: no HTTP server or ADB. Paste the public descriptor into the trusted hosted page."
            );
        } else {
            println!(
                "PHONE LAN MODE: WebRTC UDP uses Wi-Fi; page/pin delivery uses developer-only USB ADB reverse."
            );
        }
        println!(
            "Bridge admits only {} then pins one source port. This is NOT visitor authorization.",
            phone.phone_ip
        );
    } else {
        println!("Only this computer's sources are accepted by the bridge.");
    }
    println!(
        "Upstream relay allocation binds a wildcard ephemeral UDP socket. No router/firewall changes."
    );
    let relay = endpoint(true).await?;
    let helper = match endpoint(false).await {
        Ok(helper) => helper,
        Err(error) => {
            stop("relay", &relay).await;
            return Err(error);
        }
    };
    let counters = Arc::new(bridge::Counters::default());
    let result = tokio::select! {
        result = timeout(BROWSER_LIFETIME, serve(&relay, &helper, port, phone, assets, Arc::clone(&counters), inspector)) => {
            result.unwrap_or_else(|_| Err(anyhow::anyhow!("browser fixture expired after 10 minutes; restart it")))
        }
        signal = tokio::signal::ctrl_c() => signal.context("wait for Ctrl-C"),
    };
    stop("helper", &helper).await;
    stop("relay", &relay).await;
    println!("Final bridge counters: {}", snapshot(&counters));
    println!(
        "Browser fixture stopped. The browser page reports echo or HTTP results; these counters measure relay traffic."
    );
    result
}

async fn serve(
    relay: &NatTraversalEndpoint,
    helper: &NatTraversalEndpoint,
    port: u16,
    phone: Option<Phone>,
    assets: Option<Arc<Assets>>,
    counters: Arc<bridge::Counters>,
    inspector: Option<(HttpInspector, String)>,
) -> Result<()> {
    let relay_addr = relay
        .get_endpoint()
        .context("relay endpoint missing")?
        .local_addr()?;
    let (allocation, streams) = helper.establish_relay_session(relay_addr).await?;
    let allocation = allocation.context("relay returned no UDP allocation")?;
    ensure!(
        allocation.ip().is_loopback(),
        "browser fixture refuses non-loopback relay allocation"
    );
    let streams = streams.context("relay returned no fresh streams")?;
    let certificate = WebRtcCertificate::generate()?;
    let pin = WebRtcCertificateHash::new(certificate.sha256_digest()?);
    let mut listener = WebRtcDirectListener::bind("127.0.0.1:0".parse()?, certificate).await?;
    let local_listener = listener.local_addr();
    ensure!(
        allocation != local_listener,
        "relay and listener addresses must differ"
    );
    let dsa = ml_dsa_65();
    let (public_key, secret_key) = dsa.generate_keypair()?;
    let public_key = public_key.to_bytes();
    let publisher_id = *blake3::hash(&public_key).as_bytes();
    // Upstream allocates a wildcard UDP socket but advertises loopback in this
    // local relay setup. Only phone mode advertises the verified Mac LAN IP;
    // control QUIC and the helper listener remain on loopback.
    let advertised = phone.map_or(allocation, |phone| {
        SocketAddr::new(phone.relay_ip.into(), allocation.port())
    });
    let destination = WebRtcDirectAddr::new(advertised, pin)?;
    let multiaddr = format!("{destination}/p2p/{}", hex::encode(publisher_id));
    println!("relay control endpoint: {relay_addr}");
    println!("relay UDP allocation: {allocation}; advertised to browser: {advertised}");
    println!("helper WebRTC listener (NOT supplied to browser): {local_listener}");
    println!("publisher identity: {}", hex::encode(publisher_id));

    let mut tasks = JoinSet::new();
    bridge::start(
        streams,
        local_listener,
        phone.map_or(bridge::SourcePolicy::LocalInterfaces, |phone| {
            bridge::SourcePolicy::ExactPhone(phone.phone_ip)
        }),
        Arc::clone(&counters),
        &mut tasks,
    )
    .await?;
    let inspector = inspector.map(|(inspector, mut token)| {
        println!("\nPRIVATE VISITOR TOKEN — transfer privately; omit from screenshots and diagnostic logs:");
        println!("{token}");
        token.zeroize();
        println!("Only this helper run accepts it; Ctrl-C revokes access. Never paste it into the descriptor field.");
        inspector
    });
    let http_mode = inspector.is_some();
    tasks.spawn(async move {
        let mut connection = listener.accept().await.context("accept browser association")?;
        let channel = connection.accept_data_channel().await?;
        let expected_label = if http_mode { http_inspector::LABEL } else { LABEL };
        ensure!(channel.label() == expected_label, "wrong mode: use the matching echo or HTTP button");
        let hello = timeout(Duration::from_secs(30), channel.receive()).await??;
        ensure!(hello.len() <= 16384, "oversized browser handshake");
        let (accept, mut session) = accept_pq_session(&hello, &publisher_id, &public_key, |transcript| {
            dsa.sign(&secret_key, transcript).map(|signature| signature.to_bytes())
        })?;
        channel.send(&accept).await?;
        if let Some(mut inspector) = inspector {
            // One authorization record, then at most 16 sequential requests.
            for _ in 0..17 {
                let record = match timeout(Duration::from_secs(30), channel.receive()).await? {
                    Ok(record) => record,
                    Err(_) => break, // A completed batch may close its DataChannel.
                };
                ensure!(record.len() <= 16384, "oversized encrypted inspector record");
                let request = Zeroizing::new(session.open(&record).context("decrypt inspector request")?);
                let response = match inspector.handle(&request).await {
                    Ok(response) => response,
                    Err(_) => {
                        // Do not reflect tokens, target URLs or response data into logs.
                        channel.send(&session.seal(br#"{"v":1,"type":"error"}"#)?).await?;
                        println!("Inspector access closed: authorization, request, or target response rejected.");
                        break;
                    }
                };
                channel.send(&session.seal(&response)?).await?;
            }
            println!("Inspector finished. No further target access is possible; Ctrl-C for counters.");
            std::future::pending::<()>().await;
            return Ok(());
        }
        let message = session.open(&channel.receive().await?).context("decrypt browser echo request")?;
        ensure!(message.len() <= MAX_MESSAGE_BYTES, "browser message exceeds 8 KiB");
        channel.send(&session.seal(&message)?).await?;
        println!("Browser PQ session established; {}-byte encrypted echo queued. Check the page for verification.", message.len());
        // Keep the association and relay alive until Ctrl-C or the fixture deadline.
        std::future::pending::<()>().await;
        Ok(())
    });

    if let Some(assets) = assets {
        let http = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
        let origin = format!("http://{}", http.local_addr()?);
        let configuration = serde_json::to_vec(&serde_json::json!({
            "multiaddr": multiaddr,
            "label": LABEL,
            "messageLimit": MAX_MESSAGE_BYTES,
            "mode": if phone.is_some() { "phone-lan" } else { "desktop-local" },
        }))?;
        tasks.spawn(http_server(
            http,
            origin.clone(),
            assets,
            Arc::new(configuration),
            counters,
        ));
        if phone.is_some() {
            println!("\nOpen on the PHONE via the configured ADB reverse: {origin}/");
            println!(
                "Keep USB connected. This does not test Irys deployment or cellular/NAT traversal."
            );
        } else {
            println!("\nOpen on THIS computer: {origin}/");
        }
    } else {
        println!(
            "\nPUBLIC CONNECTION DESCRIPTOR (not an access grant; do not embed in a permanent upload):"
        );
        println!("{multiaddr}");
        println!(
            "Paste it into the hosted page on the phone. No USB required; stay on the same Wi-Fi."
        );
        println!(
            "Use the matching echo or HTTP inspector button. After verification, Ctrl-C here for final relay counters."
        );
    }
    println!("One attempt per run. Restart the command before retrying or switching browsers.");
    println!("Use an ordinary browser profile—no special WebRTC flags. Ctrl-C stops everything.\n");

    match tasks.join_next().await {
        Some(Ok(Err(error))) => Err(error.context("browser fixture background task")),
        Some(Err(error)) => Err(error.into()),
        _ => Err(anyhow::anyhow!(
            "browser fixture background task stopped unexpectedly"
        )),
    }
}

fn snapshot(counters: &bridge::Counters) -> serde_json::Value {
    serde_json::json!({
        "relayToListenerPackets": counters.relay_to_listener_packets.load(Ordering::Relaxed),
        "relayToListenerBytes": counters.relay_to_listener_bytes.load(Ordering::Relaxed),
        "listenerToRelayPackets": counters.listener_to_relay_packets.load(Ordering::Relaxed),
        "listenerToRelayBytes": counters.listener_to_relay_bytes.load(Ordering::Relaxed),
        "rejectedSourcePackets": counters.rejected_source_packets.load(Ordering::Relaxed),
    })
}

async fn http_server(
    listener: TcpListener,
    origin: String,
    assets: Arc<Assets>,
    configuration: Arc<Vec<u8>>,
    counters: Arc<bridge::Counters>,
) -> Result<()> {
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (socket, remote) = accepted?;
                if !remote.ip().is_loopback() || connections.len() >= 16 {
                    drop(socket);
                    continue;
                }
                let origin = origin.clone();
                let assets = Arc::clone(&assets);
                let configuration = Arc::clone(&configuration);
                let counters = Arc::clone(&counters);
                connections.spawn(async move {
                    timeout(Duration::from_secs(10), http_request(socket, &origin, &assets, &configuration, &counters)).await
                });
            }
            _ = connections.join_next(), if !connections.is_empty() => {}
        }
    }
}

async fn http_request(
    mut socket: TcpStream,
    origin: &str,
    assets: &Assets,
    configuration: &[u8],
    counters: &bridge::Counters,
) -> Result<()> {
    let mut request = Vec::new();
    let mut buffer = [0; 1024];
    while !request.windows(4).any(|window| window == b"\r\n\r\n") {
        let count = socket.read(&mut buffer).await?;
        if count == 0 {
            return Ok(());
        }
        request.extend_from_slice(&buffer[..count]);
        ensure!(request.len() <= 8192, "HTTP request headers too large");
    }
    let request = std::str::from_utf8(&request)?;
    let mut lines = request.split("\r\n");
    let mut first = lines
        .next()
        .context("HTTP request line missing")?
        .split_whitespace();
    let method = first.next().unwrap_or("");
    let path = first.next().unwrap_or("");
    let headers: Vec<_> = lines
        .take_while(|line| !line.is_empty())
        .filter_map(|line| line.split_once(':'))
        .collect();
    let header = |name: &str| {
        headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case(name))
            .map(|(_, value)| value.trim())
    };
    let expected_host = origin
        .strip_prefix("http://")
        .context("invalid local origin")?;
    let allowed = header("host") == Some(expected_host)
        && header("origin").is_none_or(|value| value == origin)
        && header("sec-fetch-site") != Some("cross-site");

    let (status, mime, body): (&str, &str, Vec<u8>) = if !allowed {
        (
            "403 Forbidden",
            "text/plain",
            b"Use the exact loopback URL printed by the CLI.".to_vec(),
        )
    } else if method != "GET" {
        ("405 Method Not Allowed", "text/plain", b"GET only".to_vec())
    } else {
        match path {
            "/" | "/index.html" => ("200 OK", "text/html; charset=utf-8", assets.html.clone()),
            "/app.js" => (
                "200 OK",
                "text/javascript; charset=utf-8",
                assets.application.clone(),
            ),
            "/style.css" => (
                "200 OK",
                "text/css; charset=utf-8",
                assets.stylesheet.clone(),
            ),
            "/session.json" => ("200 OK", "application/json", configuration.to_vec()),
            "/stats.json" => (
                "200 OK",
                "application/json",
                serde_json::to_vec(&snapshot(counters))?,
            ),
            "/pkg/relay_crypto.js" => (
                "200 OK",
                "text/javascript; charset=utf-8",
                assets.javascript.clone(),
            ),
            "/pkg/relay_crypto_bg.wasm" => ("200 OK", "application/wasm", assets.wasm.clone()),
            _ => ("404 Not Found", "text/plain", b"Not found".to_vec()),
        }
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
        body.len()
    );
    socket.write_all(response.as_bytes()).await?;
    socket.write_all(&body).await?;
    socket.shutdown().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phone_configuration_rejects_public_loopback_and_identical_addresses() {
        // Synthetic private addresses, not recorded device endpoints.
        let mac = Ipv4Addr::new(10, 0, 0, 1);
        let phone = Ipv4Addr::new(10, 0, 0, 2);
        assert!(validate_phone_addresses(mac, phone).is_ok());
        assert!(validate_phone_addresses(mac, mac).is_err());
        for invalid in [
            Ipv4Addr::LOCALHOST,
            Ipv4Addr::UNSPECIFIED,
            Ipv4Addr::new(8, 8, 8, 8),
        ] {
            assert!(validate_phone_addresses(mac, invalid).is_err());
            assert!(validate_phone_addresses(invalid, phone).is_err());
        }
    }
}
