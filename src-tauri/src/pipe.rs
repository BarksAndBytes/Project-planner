//! Encrypted device-to-device pipe for sync (spec 6.2).
//!
//! TCP on the local network, secured with the Noise protocol
//! (Noise_XX_25519_ChaChaPoly_BLAKE2s, via the `snow` crate). XX exchanges
//! both devices' long-term identity keys inside the encrypted handshake, so
//! afterwards each side knows exactly which device it is talking to. The
//! screens then check that key against the sync group's member list (or the
//! QR code) before any data moves. The handshake hash feeds the 4-word
//! check phrase used when adding a device.
//!
//! Messages are length-prefixed Noise frames (max 65,535 bytes each); one
//! application message may span several frames, up to MAX_MESSAGE bytes.
//! Only private (local) addresses are accepted or connected to.

use std::io::{self, Read, Write};
use std::net::{IpAddr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use snow::{Builder, TransportState};

use crate::net::is_private;

const PARAMS: &str = "Noise_XX_25519_ChaChaPoly_BLAKE2s";
const MAX_FRAME: usize = 65535;
const TAG: usize = 16;
const MAX_PLAIN: usize = MAX_FRAME - TAG;
pub const MAX_MESSAGE: usize = 64 * 1024 * 1024;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);

fn err(e: impl std::fmt::Display) -> io::Error {
    io::Error::other(e.to_string())
}

/// A new identity key pair: (private, public), 32 bytes each.
pub fn generate_keypair() -> io::Result<(Vec<u8>, Vec<u8>)> {
    let kp = Builder::new(PARAMS.parse().map_err(err)?).generate_keypair().map_err(err)?;
    Ok((kp.private, kp.public))
}

pub struct Pipe {
    stream: TcpStream,
    transport: TransportState,
    pub peer_key: Vec<u8>,
    pub handshake_hash: Vec<u8>,
}

fn write_frame(stream: &mut TcpStream, bytes: &[u8]) -> io::Result<()> {
    let len = u16::try_from(bytes.len()).map_err(|_| err("frame too large"))?;
    stream.write_all(&len.to_be_bytes())?;
    stream.write_all(bytes)
}

fn read_frame(stream: &mut TcpStream) -> io::Result<Vec<u8>> {
    let mut len = [0u8; 2];
    stream.read_exact(&mut len)?;
    let mut buf = vec![0u8; u16::from_be_bytes(len) as usize];
    stream.read_exact(&mut buf)?;
    Ok(buf)
}

impl Pipe {
    fn handshake(mut stream: TcpStream, initiator: bool, private_key: &[u8]) -> io::Result<Pipe> {
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT))?;
        stream.set_write_timeout(Some(HANDSHAKE_TIMEOUT))?;
        stream.set_nodelay(true)?;
        let builder = Builder::new(PARAMS.parse().map_err(err)?).local_private_key(private_key);
        let mut hs = if initiator { builder.build_initiator() } else { builder.build_responder() }.map_err(err)?;
        let mut buf = vec![0u8; MAX_FRAME];
        let mut scratch = vec![0u8; MAX_FRAME];
        // XX: -> e | <- e, ee, s, es | -> s, se
        let steps: [bool; 3] = if initiator { [true, false, true] } else { [false, true, false] };
        for write in steps {
            if write {
                let n = hs.write_message(&[], &mut buf).map_err(err)?;
                write_frame(&mut stream, &buf[..n])?;
            } else {
                let frame = read_frame(&mut stream)?;
                hs.read_message(&frame, &mut scratch).map_err(err)?;
            }
        }
        let peer_key = hs.get_remote_static().map(|k| k.to_vec()).ok_or_else(|| err("peer sent no identity key"))?;
        if peer_key.len() != 32 {
            return Err(err("bad peer key"));
        }
        let handshake_hash = hs.get_handshake_hash().to_vec();
        let transport = hs.into_transport_mode().map_err(err)?;
        Ok(Pipe { stream, transport, peer_key, handshake_hash })
    }

    /// Connects to the first of `ips` that answers on `port` (phone side).
    pub fn connect(ips: &[String], port: u16, private_key: &[u8]) -> io::Result<Pipe> {
        let mut last = err("no address to try");
        for ip in ips.iter().take(4) {
            let ip: IpAddr = match ip.parse() {
                Ok(ip) if is_private(ip) => ip,
                _ => continue,
            };
            match TcpStream::connect_timeout(&SocketAddr::new(ip, port), CONNECT_TIMEOUT) {
                Ok(stream) => return Pipe::handshake(stream, true, private_key),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    pub fn send(&mut self, message: &[u8]) -> io::Result<()> {
        if message.len() > MAX_MESSAGE {
            return Err(err("message too large"));
        }
        self.stream.set_write_timeout(Some(Duration::from_secs(30)))?;
        let mut framed = Vec::with_capacity(message.len() + 4);
        framed.extend_from_slice(&(message.len() as u32).to_be_bytes());
        framed.extend_from_slice(message);
        let mut out = vec![0u8; MAX_FRAME];
        for chunk in framed.chunks(MAX_PLAIN) {
            let n = self.transport.write_message(chunk, &mut out).map_err(err)?;
            write_frame(&mut self.stream, &out[..n])?;
        }
        self.stream.flush()
    }

    pub fn recv(&mut self, timeout: Duration) -> io::Result<Vec<u8>> {
        self.stream.set_read_timeout(Some(timeout))?;
        let mut plain = vec![0u8; MAX_FRAME];
        let mut message: Vec<u8> = Vec::new();
        let mut expected: Option<usize> = None;
        loop {
            let frame = read_frame(&mut self.stream)?;
            let n = self.transport.read_message(&frame, &mut plain).map_err(err)?;
            message.extend_from_slice(&plain[..n]);
            if expected.is_none() && message.len() >= 4 {
                let len = u32::from_be_bytes([message[0], message[1], message[2], message[3]]) as usize;
                if len > MAX_MESSAGE {
                    return Err(err("message too large"));
                }
                expected = Some(len);
                message.drain(..4);
            }
            if let Some(len) = expected {
                if message.len() >= len {
                    message.truncate(len);
                    return Ok(message);
                }
            }
        }
    }
}

/// Code-showing side: waits for one device to connect and finish the
/// handshake, until `deadline` or until `cancel` is set. Connections from
/// non-local addresses, or that fail the handshake, are ignored.
pub fn accept_one(listener: TcpListener, private_key: &[u8], timeout: Duration, cancel: &AtomicBool) -> io::Result<Pipe> {
    listener.set_nonblocking(true)?;
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if cancel.load(Ordering::Relaxed) {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        match listener.accept() {
            Ok((stream, peer)) if is_private(peer.ip()) => {
                if let Ok(pipe) = Pipe::handshake(stream, false, private_key) {
                    return Ok(pipe);
                }
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(100)),
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::new(io::ErrorKind::TimedOut, "timed out"))
}
