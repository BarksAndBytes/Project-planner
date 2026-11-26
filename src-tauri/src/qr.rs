//! QR codes as SVG data URLs, for showing in the screens without HTML injection.

use qrcode::render::svg;
use qrcode::{EcLevel, QrCode};

use crate::storage::b64_encode;

pub fn svg_data_url(text: &str) -> Result<String, String> {
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M).map_err(|e| e.to_string())?;
    let svg = code
        .render::<svg::Color>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(format!("data:image/svg+xml;base64,{}", b64_encode(svg.as_bytes())))
}
