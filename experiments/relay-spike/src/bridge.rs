//! Single-visitor adapter with explicit source restrictions for the connectivity experiment.
//!
//! This intentionally avoids patching upstream: a connected local UDP socket
//! forwards the relayed packets to the WebRTC listener. The listener observes
//! the proxy's loopback address, NOT the real visitor address. That makes this
//! unsuitable for production source-IP admission or NAT/rebinding policy.

use anyhow::{Context, Result, bail, ensure};
use bytes::Bytes;
use saorsa_transport::{
    VarInt,
    high_level::{RecvStream, SendStream},
    masque::{RawRelayStreams, UncompressedDatagram},
};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{net::UdpSocket, sync::mpsc, task::JoinSet};

// The upstream stream protocol uses u32::MAX for out-of-band control frames.
// This experiment fails explicitly on them instead of pretending to handle PMTU.
const CONTROL_FRAME_MARKER: u32 = u32::MAX;
const MAX_DATAGRAM_FRAME: usize = 65_535 + 32;
const QUEUE_DEPTH: usize = 64;

#[derive(Default)]
pub struct Counters {
    pub relay_to_listener_packets: AtomicU64,
    pub relay_to_listener_bytes: AtomicU64,
    pub listener_to_relay_packets: AtomicU64,
    pub listener_to_relay_bytes: AtomicU64,
    pub rejected_source_packets: AtomicU64,
}

#[derive(Clone, Copy, Debug)]
pub enum SourcePolicy {
    Loopback,
    LocalInterfaces,
    ExactPhone(Ipv4Addr),
}

pub async fn start(
    streams: RawRelayStreams,
    listener: SocketAddr,
    policy: SourcePolicy,
    counters: Arc<Counters>,
    tasks: &mut JoinSet<Result<()>>,
) -> Result<()> {
    ensure!(
        listener.ip().is_loopback(),
        "bridge listener must be loopback"
    );
    let socket = UdpSocket::bind("127.0.0.1:0").await?;
    socket.connect(listener).await?;
    println!(
        "bridge local socket: {} -> {listener}",
        socket.local_addr()?
    );

    let (incoming_tx, incoming_rx) = mpsc::channel(QUEUE_DEPTH);
    let (outgoing_tx, outgoing_rx) = mpsc::channel(QUEUE_DEPTH);
    tasks.spawn(read_relay(streams.recv_stream, incoming_tx));
    tasks.spawn(write_relay(
        streams.send_stream,
        outgoing_rx,
        Arc::clone(&counters),
    ));
    tasks.spawn(pump_udp(socket, incoming_rx, outgoing_tx, policy, counters));
    Ok(())
}

async fn read_relay(
    mut stream: RecvStream,
    incoming: mpsc::Sender<UncompressedDatagram>,
) -> Result<()> {
    loop {
        // This task owns reads: select! never cancels a partially consumed frame.
        let mut prefix = [0; 4];
        stream
            .read_exact(&mut prefix)
            .await
            .context("relay frame prefix")?;
        let length = u32::from_be_bytes(prefix);
        if length == 0 {
            continue; // Upstream keepalive, not a datagram.
        }
        if length == CONTROL_FRAME_MARKER {
            bail!("relay sent a control/PMTU frame; not supported by this local experiment");
        }
        ensure!(
            length as usize <= MAX_DATAGRAM_FRAME,
            "oversized relay frame: {length}"
        );
        let mut frame = vec![0; length as usize];
        stream
            .read_exact(&mut frame)
            .await
            .context("relay datagram body")?;
        let mut frame = Bytes::from(frame);
        let datagram = UncompressedDatagram::decode(&mut frame)
            .map_err(|error| anyhow::anyhow!("invalid relay datagram: {error:?}"))?;
        ensure!(
            datagram.context_id == VarInt::from_u32(0),
            "unexpected relay context"
        );
        ensure!(datagram.payload.len() <= 65_535, "oversized UDP payload");
        incoming
            .send(datagram)
            .await
            .context("bridge reader queue closed")?;
    }
}

async fn write_relay(
    mut stream: SendStream,
    mut outgoing: mpsc::Receiver<UncompressedDatagram>,
    counters: Arc<Counters>,
) -> Result<()> {
    let mut keepalive = tokio::time::interval(Duration::from_secs(5));
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        // Select before writing, never in the middle of a framed write.
        let datagram = tokio::select! {
            item = outgoing.recv() => Some(item.context("bridge writer queue closed")?),
            _ = keepalive.tick() => None,
        };
        match datagram {
            Some(datagram) => {
                let frame = datagram.encode();
                stream
                    .write_all(&(frame.len() as u32).to_be_bytes())
                    .await?;
                stream
                    .write_all(&frame)
                    .await
                    .context("write relay datagram")?;
                counters
                    .listener_to_relay_packets
                    .fetch_add(1, Ordering::Relaxed);
                counters
                    .listener_to_relay_bytes
                    .fetch_add(datagram.payload.len() as u64, Ordering::Relaxed);
            }
            None => stream
                .write_all(&0u32.to_be_bytes())
                .await
                .context("relay keepalive")?,
        }
    }
}

async fn allowed_source(source: SocketAddr, policy: SourcePolicy) -> bool {
    let ip = source.ip();
    if source.port() == 0 || ip.is_unspecified() || ip.is_multicast() {
        return false;
    }
    // Phone mode does NOT also admit loopback or arbitrary private addresses.
    if let SourcePolicy::ExactPhone(expected) = policy {
        return expected.is_private() && ip == IpAddr::V4(expected);
    }
    if ip.is_loopback() {
        return true;
    }
    // A local diagnostic guard, not a production authentication mechanism.
    // No freebind/nonlocal-bind socket option is enabled here.
    matches!(policy, SourcePolicy::LocalInterfaces)
        && UdpSocket::bind(SocketAddr::new(ip, 0)).await.is_ok()
}

async fn pump_udp(
    socket: UdpSocket,
    mut incoming: mpsc::Receiver<UncompressedDatagram>,
    outgoing: mpsc::Sender<UncompressedDatagram>,
    policy: SourcePolicy,
    counters: Arc<Counters>,
) -> Result<()> {
    let mut visitor = None;
    let mut buffer = vec![0; 65_536];
    loop {
        tokio::select! {
            item = incoming.recv() => {
                let datagram = item.context("relay input closed")?;
                // Gate the first source by mode, then pin its exact IP AND port.
                // Source-IP restrictions are not cryptographic authorization.
                if visitor.is_none()
                    && !allowed_source(datagram.target, policy).await
                {
                    if counters.rejected_source_packets.fetch_add(1, Ordering::Relaxed) == 0 {
                        eprintln!("bridge rejected visitor outside {policy:?}: {}", datagram.target);
                    }
                    continue;
                }
                match visitor {
                    Some(expected) if expected != datagram.target => {
                        counters.rejected_source_packets.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    None => {
                        println!("bridge pinned visitor: {}", datagram.target);
                        visitor = Some(datagram.target);
                    }
                    _ => {}
                }
                let sent = socket.send(&datagram.payload).await.context("UDP to listener")?;
                ensure!(sent == datagram.payload.len(), "partial UDP write");
                counters.relay_to_listener_packets.fetch_add(1, Ordering::Relaxed);
                counters.relay_to_listener_bytes.fetch_add(sent as u64, Ordering::Relaxed);
            }
            received = socket.recv(&mut buffer) => {
                let received = received.context("UDP from listener")?;
                let target = visitor.context("listener replied before a visitor was pinned")?;
                let datagram = UncompressedDatagram::new(
                    VarInt::from_u32(0), target, Bytes::copy_from_slice(&buffer[..received]),
                );
                outgoing.send(datagram).await.context("relay output closed")?;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn phone_policy_admits_only_the_named_private_source() {
        // Synthetic private addresses, not recorded device endpoints.
        let policy = SourcePolicy::ExactPhone(Ipv4Addr::new(10, 0, 0, 2));
        assert!(allowed_source("10.0.0.2:40000".parse().unwrap(), policy).await);
        for address in [
            "10.0.0.3:40000",
            "127.0.0.1:40000",
            "10.0.0.2:0",
            "0.0.0.0:40000",
            "[::1]:40000",
        ] {
            assert!(
                !allowed_source(address.parse().unwrap(), policy).await,
                "{address}"
            );
        }
        let public = SourcePolicy::ExactPhone(Ipv4Addr::new(198, 51, 100, 1));
        assert!(!allowed_source("198.51.100.1:40000".parse().unwrap(), public).await);
    }

    #[tokio::test]
    async fn original_loopback_policy_does_not_admit_the_phone() {
        assert!(allowed_source("127.0.0.1:40000".parse().unwrap(), SourcePolicy::Loopback).await);
        assert!(
            !allowed_source(
                "10.0.0.2:40000".parse().unwrap(),
                SourcePolicy::Loopback
            )
            .await
        );
        assert!(
            allowed_source(
                "127.0.0.1:40000".parse().unwrap(),
                SourcePolicy::LocalInterfaces
            )
            .await
        );
    }
}
