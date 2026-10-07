//! Thin browser bindings over the same Saorsa PQ session used by the helper.
//! No cryptographic algorithms or SDP profiles are reimplemented here.

use saorsa_transport::webrtc::{
    PqClientHandshake, PqSession, WebRtcDirectEndpoint, ice_password_from_sdp,
    parse_webrtc_direct_multiaddr, server_answer_sdp, v2_server_ice_credential,
};
use wasm_bindgen::prelude::*;

const MAX_MESSAGE_BYTES: usize = 8 * 1024;
const MAX_WIRE_BYTES: usize = 16 * 1024;

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}

#[wasm_bindgen]
pub struct PqEchoClient {
    endpoint: WebRtcDirectEndpoint,
    handshake: Option<PqClientHandshake>,
    hello: Vec<u8>,
    session: Option<PqSession>,
}

#[wasm_bindgen]
impl PqEchoClient {
    #[wasm_bindgen(constructor)]
    pub fn new(multiaddr: &str) -> Result<PqEchoClient, JsValue> {
        let endpoint = parse_webrtc_direct_multiaddr(multiaddr).map_err(js_error)?;
        let (handshake, hello) = PqClientHandshake::start().map_err(js_error)?;
        Ok(Self {
            endpoint,
            handshake: Some(handshake),
            hello,
            session: None,
        })
    }

    /// Use upstream's answer synthesis with the browser's unchanged local SDP.
    pub fn answer_sdp(&self, local_sdp: &str) -> Result<String, JsValue> {
        let password = ice_password_from_sdp(local_sdp).map_err(js_error)?;
        let credential = v2_server_ice_credential(&password).map_err(js_error)?;
        server_answer_sdp(&self.endpoint, &credential).map_err(js_error)
    }

    pub fn client_hello(&self) -> Vec<u8> {
        self.hello.clone()
    }

    /// A failed handshake cannot be retried on this instance.
    pub fn authenticate(&mut self, server_accept: &[u8]) -> Result<(), JsValue> {
        let handshake = self
            .handshake
            .take()
            .ok_or_else(|| js_error("handshake already consumed"))?;
        if server_accept.len() > MAX_WIRE_BYTES {
            return Err(js_error("oversized server handshake"));
        }
        let expected_peer = self.endpoint.peer_id_bytes().map_err(js_error)?;
        self.session = Some(
            handshake
                .finish(server_accept, &expected_peer)
                .map_err(js_error)?,
        );
        Ok(())
    }

    pub fn encrypt(&mut self, message: &[u8]) -> Result<Vec<u8>, JsValue> {
        if message.len() > MAX_MESSAGE_BYTES {
            return Err(js_error("echo message exceeds 8 KiB"));
        }
        self.session
            .as_mut()
            .ok_or_else(|| js_error("publisher not authenticated"))?
            .seal(message)
            .map_err(js_error)
    }

    pub fn decrypt(&mut self, record: &[u8]) -> Result<Vec<u8>, JsValue> {
        if record.len() > MAX_WIRE_BYTES {
            return Err(js_error("oversized encrypted record"));
        }
        self.session
            .as_mut()
            .ok_or_else(|| js_error("publisher not authenticated"))?
            .open(record)
            .map_err(js_error)
    }
}
