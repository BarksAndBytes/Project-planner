//! Network check (spec 11, phase 2, first task): can the phone reach this
//! computer directly over the local network?
//!
//! The computer opens a short-lived TCP listener and shows a QR code with
//! its address and a one-time code. The phone scans it and connects. Both
//! sides show the result. No app data is sent: only the one-time code.
//!
//! Standard library only, so it is unit-tested without Tauri
//! (`rustc --edition 2021 --test src/net.rs`).
//!
//! Network lockdown (security checklist item 5): the listener only answers
//! peers on private (local) addresses, and the probe only connects to
//! private addresses.

use std::io::{self, BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub const LISTEN_SECS: u64 = 120;
const IO_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(4);

/// True for addresses on a local network: 10/8, 172.16/12, 192.168/16,
/// link-local 169.254/16, carrier-grade NAT 100.64/10 (some phone hotspots),
/// and loopback.
pub fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_private() || v4.is_link_local() || v4.is_loopback() || (o[0] == 100 && (o[1] & 0xC0) == 64)
        }
        IpAddr::V6(v6) => v6.is_loopback() || (v6.segments()[0] & 0xffc0) == 0xfe80 || (v6.segments()[0] & 0xfe00) == 0xfc00,
    }
}

pub fn valid_token(t: &str) -> bool {
    t.len() == 32 && t.bytes().all(|b| b.is_ascii_hexdigit())
}

/// This device's address on its main local network. Uses a UDP "connect",
/// which picks the outgoing interface without sending anything.
pub fn local_ipv4() -> Option<Ipv4Addr> {
    for target in ["192.168.0.1:9", "10.0.0.1:9", "172.16.0.1:9", "8.8.8.8:9"] {
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(target).is_ok() {
                if let Ok(SocketAddr::V4(a)) = sock.local_addr() {
                    if !a.ip().is_unspecified() && is_private(IpAddr::V4(*a.ip())) {
                        return Some(*a.ip());
                    }
                }
            }
        }
    }
    None
}

/// All of this device's local addresses we can find, main network first:
/// also covers a Windows Mobile Hotspot (192.168.137.x), an Android hotspot
/// (192.168.43.x) and an iPhone hotspot (172.20.10.x). Used in sync QR codes
/// so the phone can try each.
pub fn local_ipv4s() -> Vec<Ipv4Addr> {
    let mut out: Vec<Ipv4Addr> = Vec::new();
    let targets = ["192.168.0.1:9", "10.0.0.1:9", "172.16.0.1:9", "8.8.8.8:9", "192.168.137.2:9", "192.168.43.2:9", "172.20.10.2:9"];
    for target in targets {
        if let Ok(sock) = UdpSocket::bind("0.0.0.0:0") {
            if sock.connect(target).is_ok() {
                if let Ok(SocketAddr::V4(a)) = sock.local_addr() {
                    let ip = *a.ip();
                    if !ip.is_unspecified() && !ip.is_loopback() && is_private(IpAddr::V4(ip)) && !out.contains(&ip) {
                        out.push(ip);
                    }
                }
            }
        }
    }
    out.truncate(4);
    out
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Status {
    pub listening: bool,
    pub port: u16,
    pub seconds_left: u64,
    pub successes: u32,
    pub last_peer: Option<String>,
    pub rejected: u32,
}

pub struct Check {
    status: Arc<Mutex<Status>>,
    stop: Arc<AtomicBool>,
}

impl Check {
    /// Starts listening on all interfaces, on a random port, for `secs`.
    pub fn start(token: &str, device_name: &str, secs: u64) -> io::Result<Check> {
        if !valid_token(token) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "bad one-time code"));
        }
        let listener = TcpListener::bind("0.0.0.0:0")?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let status = Arc::new(Mutex::new(Status { listening: true, port, seconds_left: secs, ..Status::default() }));
        let stop = Arc::new(AtomicBool::new(false));
        let (st, sp, token, name) = (status.clone(), stop.clone(), token.to_string(), sanitize(device_name));
        thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(secs);
            while !sp.load(Ordering::Relaxed) && Instant::now() < deadline {
                if let Ok(mut s) = st.lock() {
                    s.seconds_left = deadline.saturating_duration_since(Instant::now()).as_secs();
                }
                match listener.accept() {
                    Ok((stream, peer)) => {
                        let ok = is_private(peer.ip()) && answer(stream, &token, &name).unwrap_or(false);
                        if let Ok(mut s) = st.lock() {
                            if ok {
                                s.successes += 1;
                                s.last_peer = Some(peer.ip().to_string());
                            } else {
                                s.rejected += 1;
                            }
                        }
                    }
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => thread::sleep(Duration::from_millis(100)),
                    Err(_) => thread::sleep(Duration::from_millis(100)),
                }
            }
            if let Ok(mut s) = st.lock() {
                s.listening = false;
                s.seconds_left = 0;
            }
        });
        Ok(Check { status, stop })
    }

    pub fn status(&self) -> Status {
        self.status.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for Check {
    fn drop(&mut self) {
        self.stop();
    }
}

fn sanitize(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric() || " -_.'".contains(*c)).take(40).collect()
}

/// Handles one connection: expects `WD-CHECK <token>`, answers `WD-OK <name>`.
fn answer(stream: TcpStream, token: &str, name: &str) -> io::Result<bool> {
    stream.set_nonblocking(false)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    let mut line = String::new();
    BufReader::new(io::Read::take(stream.try_clone()?, 128)).read_line(&mut line)?;
    let ok = line.trim_end() == format!("WD-CHECK {token}");
    let mut w = stream;
    if ok {
        writeln!(w, "WD-OK {name}")?;
    } else {
        writeln!(w, "WD-NO")?;
    }
    Ok(ok)
}

#[derive(Debug, PartialEq)]
pub enum ProbeError {
    NotLocal,
    BadInput,
    TimedOut,
    Refused,
    WrongCode,
    Other(String),
}

impl std::fmt::Display for ProbeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            ProbeError::NotLocal => "not-local",
            ProbeError::BadInput => "bad-input",
            ProbeError::TimedOut => "timed-out",
            ProbeError::Refused => "refused",
            ProbeError::WrongCode => "wrong-code",
            ProbeError::Other(e) => e,
        })
    }
}

/// Phone side: connects and checks the one-time code. Returns the other
/// device's name and the round-trip time in milliseconds.
pub fn probe(host: &str, port: u16, token: &str) -> Result<(String, u64), ProbeError> {
    let ip: IpAddr = host.parse().map_err(|_| ProbeError::BadInput)?;
    if !valid_token(token) || port == 0 {
        return Err(ProbeError::BadInput);
    }
    if !is_private(ip) {
        return Err(ProbeError::NotLocal);
    }
    let started = Instant::now();
    let stream = TcpStream::connect_timeout(&SocketAddr::new(ip, port), CONNECT_TIMEOUT).map_err(|e| match e.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => ProbeError::TimedOut,
        io::ErrorKind::ConnectionRefused => ProbeError::Refused,
        _ => ProbeError::Other(e.to_string()),
    })?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).map_err(|e| ProbeError::Other(e.to_string()))?;
    let mut w = stream.try_clone().map_err(|e| ProbeError::Other(e.to_string()))?;
    writeln!(w, "WD-CHECK {token}").map_err(|e| ProbeError::Other(e.to_string()))?;
    let mut line = String::new();
    BufReader::new(io::Read::take(stream, 128)).read_line(&mut line).map_err(|e| match e.kind() {
        io::ErrorKind::TimedOut | io::ErrorKind::WouldBlock => ProbeError::TimedOut,
        _ => ProbeError::Other(e.to_string()),
    })?;
    let ms = started.elapsed().as_millis() as u64;
    match line.trim_end().strip_prefix("WD-OK ") {
        Some(name) => Ok((sanitize(name), ms)),
        None if line.trim_end() == "WD-OK" => Ok((String::new(), ms)),
        None => Err(ProbeError::WrongCode),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn private_ranges() {
        for ip in ["192.168.1.20", "10.4.5.6", "172.20.0.9", "169.254.3.3", "100.70.1.1", "127.0.0.1", "fe80::1"] {
            assert!(is_private(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["8.8.8.8", "172.32.0.1", "100.128.0.1", "1.1.1.1", "2001:db8::1"] {
            assert!(!is_private(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn probe_succeeds_with_the_right_code() {
        let check = Check::start(TOKEN, "Shop PC <script>", 10).unwrap();
        let port = check.status().port;
        let (name, _ms) = probe("127.0.0.1", port, TOKEN).unwrap();
        assert_eq!(name, "Shop PC script");
        std::thread::sleep(Duration::from_millis(150));
        let s = check.status();
        assert_eq!(s.successes, 1);
        assert_eq!(s.last_peer.as_deref(), Some("127.0.0.1"));
    }

    #[test]
    fn wrong_code_is_rejected() {
        let check = Check::start(TOKEN, "PC", 10).unwrap();
        let port = check.status().port;
        assert_eq!(probe("127.0.0.1", port, "ffffffffffffffffffffffffffffffff"), Err(ProbeError::WrongCode));
        std::thread::sleep(Duration::from_millis(150));
        assert_eq!(check.status().rejected, 1);
    }

    #[test]
    fn listener_closes_when_stopped_or_expired() {
        let check = Check::start(TOKEN, "PC", 1).unwrap();
        let port = check.status().port;
        std::thread::sleep(Duration::from_millis(1400));
        assert!(!check.status().listening);
        assert!(probe("127.0.0.1", port, TOKEN).is_err());
    }

    #[test]
    fn probe_refuses_public_addresses_and_bad_input() {
        assert_eq!(probe("8.8.8.8", 80, TOKEN), Err(ProbeError::NotLocal));
        assert_eq!(probe("not-an-ip", 80, TOKEN), Err(ProbeError::BadInput));
        assert_eq!(probe("192.168.1.2", 80, "short"), Err(ProbeError::BadInput));
        assert!(Check::start("nope", "PC", 1).is_err());
    }
}
