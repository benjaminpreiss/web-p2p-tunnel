//! Bounded LAN connectivity and opt-in read-only HTTP inspector; not a production tunnel.
mod bridge;
mod browser;
mod http_inspector;

use anyhow::{Context, Result, bail, ensure};
use clap::{Parser, Subcommand};
use saorsa_pqc::api::sig::ml_dsa_65;
use saorsa_transport::{
    NatTraversalConfig, NatTraversalEndpoint,
    transport::{WebRtcCertificateHash, WebRtcDirectAddr},
    upnp::UpnpConfig,
    webrtc::{
        PqClientHandshake, accept_pq_session,
        direct::{WebRtcCertificate, WebRtcDirectClient, WebRtcDirectListener},
    },
};
use std::{
    net::{Ipv4Addr, SocketAddr},
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::{task::JoinSet, time::timeout};

const LABEL: &str = "web-p2p-tunnel.relay-spike.v1";
const MAX_MESSAGE_BYTES: usize = 8 * 1024;
const DEADLINE: Duration = Duration::from_secs(60);

#[derive(Parser)]
#[command(about = "Bounded WebRTC-over-Saorsa-relay diagnostic. NOT a production tunnel.")]
struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Start a controlled relay, helper, and native WebRTC visitor on this machine.
    Local {
        #[arg(long, default_value = "hello through the relay")]
        message: String,
    },
    /// Serve the browser diagnostic on this computer (one visitor per run).
    Browser {
        /// Loopback HTTP port; 0 selects an available port.
        #[arg(long, default_value_t = 0)]
        port: u16,
    },
    /// Phone browser over Wi-Fi; page delivery uses developer-only ADB reverse.
    BrowserPhone {
        /// This computer's private IPv4 address, advertised for the UDP allocation.
        #[arg(long)]
        relay_ip: Ipv4Addr,
        /// Only this phone's private IPv4 source is admitted by the bridge.
        #[arg(long)]
        phone_ip: Ipv4Addr,
        #[arg(long, default_value_t = 18880)]
        port: u16,
    },
    /// LAN relay/helper for a separately hosted page; no HTTP listener or ADB.
    BrowserHosted {
        #[arg(long)]
        relay_ip: Ipv4Addr,
        #[arg(long)]
        phone_ip: Ipv4Addr,
        /// Opt in to token-authorized GET inspection of one 127.0.0.1 port.
        /// Use a test app: even GET can have side effects. No cookies or redirects.
        #[arg(long, value_parser = clap::value_parser!(u16).range(1..))]
        http_port: Option<u16>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warn")),
        )
        .with_ansi(false)
        .with_writer(std::io::stderr)
        .init();
    match Args::parse().command {
        Command::Local { message } => {
            ensure!(
                message.len() <= MAX_MESSAGE_BYTES,
                "message exceeds {MAX_MESSAGE_BYTES} bytes"
            );
            local(message.into_bytes()).await
        }
        Command::Browser { port } => browser::run(port).await,
        Command::BrowserPhone {
            relay_ip,
            phone_ip,
            port,
        } => browser::run_phone(port, relay_ip, phone_ip).await,
        Command::BrowserHosted {
            relay_ip,
            phone_ip,
            http_port,
        } => browser::run_hosted(relay_ip, phone_ip, http_port).await,
    }
}

async fn endpoint(relay: bool) -> Result<NatTraversalEndpoint> {
    let config = NatTraversalConfig {
        bind_addr: Some("127.0.0.1:0".parse()?),
        allow_loopback: true,
        known_peers: Vec::new(),
        relay_nodes: Vec::new(),
        enable_relay_service: relay,
        advertise_external_addresses: false,
        upnp: UpnpConfig::disabled(),
        ..Default::default()
    };
    timeout(DEADLINE, NatTraversalEndpoint::new(config, None, None))
        .await
        .context("native endpoint startup timed out")?
        .context("native endpoint startup")
}

async fn stop(name: &str, endpoint: &NatTraversalEndpoint) {
    match timeout(Duration::from_secs(10), endpoint.shutdown()).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => eprintln!("{name} shutdown: {error}"),
        Err(_) => {
            eprintln!("{name} shutdown timed out; process exit will release remaining sockets")
        }
    }
}

async fn local(message: Vec<u8>) -> Result<()> {
    println!("EXPERIMENT: local relay-path diagnostic; no HTTP target or public peers");
    println!("NOTE: upstream relay allocation binds an ephemeral wildcard UDP socket.");
    println!("The bridge accepts only one loopback visitor. No UPnP is enabled.");
    println!("[1/4] starting native relay and outbound helper");
    let relay = endpoint(true).await?;
    let helper = match endpoint(false).await {
        Ok(helper) => helper,
        Err(error) => {
            stop("relay", &relay).await;
            return Err(error);
        }
    };
    // Dropping the diagnostic future drops its JoinSet, aborting bridge/server
    // tasks. Both native endpoints are then explicitly shut down on every exit.
    let diagnostic = async {
        let relay_addr = relay
            .get_endpoint()
            .context("relay has no transport endpoint")?
            .local_addr()?;
        println!("relay control endpoint: {relay_addr}");
        exchange_via_relay(&helper, relay_addr, &message).await
    };
    let result = tokio::select! {
        result = timeout(DEADLINE, diagnostic) => {
            result.unwrap_or_else(|_| Err(anyhow::anyhow!("relay-path diagnostic exceeded 60 seconds")))
        }
        signal = tokio::signal::ctrl_c() => {
            match signal {
                Ok(()) => Err(anyhow::anyhow!("diagnostic cancelled")),
                Err(error) => Err(error.into()),
            }
        }
    };
    stop("helper", &helper).await;
    stop("relay", &relay).await;
    result?;
    println!("PASS: native WebRTC + PQ echo traversed the real local MASQUE relay.");
    println!(
        "NOT YET PROVEN: browser compatibility, phone/NAT connectivity, public relay availability."
    );
    Ok(())
}

async fn exchange_via_relay(
    helper: &NatTraversalEndpoint,
    relay_addr: SocketAddr,
    message: &[u8],
) -> Result<()> {
    println!("[2/4] obtaining a real CONNECT-UDP allocation");
    let (allocation, streams) = helper
        .establish_relay_session(relay_addr)
        .await
        .context("allocate MASQUE relay")?;
    let allocation = allocation.context("relay returned no public UDP address")?;
    ensure!(
        allocation.ip().is_loopback(),
        "local diagnostic refuses non-loopback relay allocation"
    );
    let streams = streams.context("relay returned no fresh forwarding streams")?;
    println!("relay UDP allocation: {allocation}");

    let certificate = WebRtcCertificate::generate().context("create ephemeral DTLS certificate")?;
    let certificate_hash = WebRtcCertificateHash::new(certificate.sha256_digest()?);
    let mut listener = WebRtcDirectListener::bind("127.0.0.1:0".parse()?, certificate).await?;
    let local_listener = listener.local_addr();
    ensure!(
        allocation != local_listener,
        "relay allocation must differ from helper listener"
    );
    println!("helper WebRTC listener: {local_listener}");

    let dsa = ml_dsa_65();
    let (public_key, secret_key) = dsa.generate_keypair()?;
    let public_key = public_key.to_bytes();
    let publisher_id = *blake3::hash(&public_key).as_bytes();
    println!(
        "ephemeral publisher identity: {}",
        hex::encode(publisher_id)
    );

    let mut tasks = JoinSet::new();
    let counters = Arc::new(bridge::Counters::default());
    bridge::start(
        streams,
        local_listener,
        bridge::SourcePolicy::Loopback,
        Arc::clone(&counters),
        &mut tasks,
    )
    .await?;
    tasks.spawn(async move {
        let mut connection = listener
            .accept()
            .await
            .context("accept helper WebRTC association")?;
        let channel = connection.accept_data_channel().await?;
        ensure!(channel.label() == LABEL, "unexpected data channel label");
        let hello = channel.receive().await.context("receive PQ hello")?;
        let (accept, mut session) =
            accept_pq_session(&hello, &publisher_id, &public_key, |transcript| {
                dsa.sign(&secret_key, transcript)
                    .map(|signature| signature.to_bytes())
            })
            .context("authenticate helper PQ session")?;
        channel.send(&accept).await?;
        let request = session
            .open(&channel.receive().await?)
            .context("decrypt echo request")?;
        ensure!(request.len() <= MAX_MESSAGE_BYTES, "echo request too large");
        channel
            .send(&session.seal(&request)?)
            .await
            .context("send encrypted echo")?;
        // Retain the association until the visitor receives its reply. The
        // supervising JoinSet cancels this task after the exchange or on error.
        std::future::pending::<()>().await;
        Ok(())
    });

    println!("[3/4] native visitor dialing ONLY the relay allocation");
    let destination = WebRtcDirectAddr::new(allocation, certificate_hash)?;
    let result = tokio::select! {
        outcome = visit(&destination, &publisher_id, message) => outcome,
        task = tasks.join_next() => {
            match task {
                Some(Ok(Err(error))) => Err(error.context("background relay/helper task")),
                Some(Err(error)) => Err(anyhow::anyhow!("background task failed: {error}")),
                _ => Err(anyhow::anyhow!("background relay/helper task stopped unexpectedly")),
            }
        }
    };
    tasks.abort_all();
    while tasks.join_next().await.is_some() {}
    // Print path counters even when WebRTC/PQ fails: this localizes the failure.
    let inbound = counters.relay_to_listener_packets.load(Ordering::Relaxed);
    let outbound = counters.listener_to_relay_packets.load(Ordering::Relaxed);
    println!(
        "relay -> listener: {inbound} packets, {} bytes",
        counters.relay_to_listener_bytes.load(Ordering::Relaxed)
    );
    println!(
        "listener -> relay: {outbound} packets, {} bytes",
        counters.listener_to_relay_bytes.load(Ordering::Relaxed)
    );
    result?;
    ensure!(
        inbound > 0 && outbound > 0,
        "no measured bidirectional relay traffic"
    );
    Ok(())
}

async fn visit(
    destination: &WebRtcDirectAddr,
    publisher_id: &[u8; 32],
    message: &[u8],
) -> Result<()> {
    let visitor = WebRtcDirectClient::dial(destination, LABEL)
        .await
        .context("WebRTC dial through allocation")?;
    println!("[4/4] authenticating publisher and exchanging PQ-encrypted echo");
    let channel = visitor.data_channel();
    let (handshake, hello) = PqClientHandshake::start()?;
    channel.send(&hello).await?;
    let mut session = handshake
        .finish(&channel.receive().await?, publisher_id)
        .context("verify pinned publisher identity")?;
    channel.send(&session.seal(message)?).await?;
    let response = session
        .open(&channel.receive().await?)
        .context("decrypt echo response")?;
    if response != message {
        bail!(
            "echo mismatch: sent {} bytes, received {} bytes",
            message.len(),
            response.len()
        );
    }
    println!("authenticated echo: {} bytes matched", response.len());
    // Drop closes the visitor's RTC stack. The parent then cancels the helper
    // and bridge tasks and shuts down both native endpoints.
    Ok(())
}
