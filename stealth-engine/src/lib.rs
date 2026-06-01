use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct StealthEngine {
    is_active: bool,
    payload_index: usize,
    payload: Vec<u8>,
    sequence_number: u16,
    timestamp: u32,
}

#[wasm_bindgen]
impl StealthEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> StealthEngine {
        StealthEngine {
            is_active: false,
            payload_index: 0,
            payload: Vec::new(),
            sequence_number: 0,
            timestamp: 0,
        }
    }

    pub fn set_payload(&mut self, payload: &[u8]) {
        self.payload = payload.to_vec();
        self.payload_index = 0;
        self.is_active = true;
    }

    pub fn stop(&mut self) {
        self.is_active = false;
    }

    /// Embeds the payload into the LSB of the audio buffer (Float32Array)
    /// Converts Float32 -> i16 -> Modifies LSB -> Float32
    pub fn process_audio_chunk(&mut self, audio_chunk: &mut [f32]) {
        if !self.is_active || self.payload.is_empty() {
            return;
        }

        for sample in audio_chunk.iter_mut() {
            if self.payload_index >= self.payload.len() * 8 {
                self.is_active = false;
                break;
            }

            // Convert Web Audio f32 [-1.0, 1.0] to standard i16 [-32768, 32767]
            let mut int_sample = (*sample * 32767.0) as i16;

            // Extract the bit we want to hide
            let byte_idx = self.payload_index / 8;
            let bit_idx = 7 - (self.payload_index % 8);
            let bit = (self.payload[byte_idx] >> bit_idx) & 1;

            // Embed bit into LSB
            int_sample = (int_sample & !1) | (bit as i16);

            // Convert back to f32
            *sample = (int_sample as f32) / 32767.0;

            self.payload_index += 1;
        }
    }

    /// Generates a Fake RTP (WebRTC) Packet Header wrapped around the steganographic data
    /// This provides the Structural Camouflage layer
    pub fn generate_fake_rtp_packet(&mut self, audio_data: &[u8]) -> Vec<u8> {
        let mut packet = Vec::with_capacity(12 + audio_data.len());
        
        // RTP Header (12 bytes standard)
        packet.push(0x80); // Version 2
        packet.push(0x78); // Payload type (e.g., dynamic audio codec)
        
        // Sequence number (Big Endian)
        packet.push((self.sequence_number >> 8) as u8);
        packet.push(self.sequence_number as u8);
        self.sequence_number = self.sequence_number.wrapping_add(1);
        
        // Timestamp (Big Endian)
        packet.push((self.timestamp >> 24) as u8);
        packet.push((self.timestamp >> 16) as u8);
        packet.push((self.timestamp >> 8) as u8);
        packet.push(self.timestamp as u8);
        self.timestamp = self.timestamp.wrapping_add(960); // Standard 20ms audio frame jump
        
        // SSRC (Synchronization Source Identifier) - Hardcoded fake ID for camouflage
        packet.extend_from_slice(&[0x12, 0x34, 0x56, 0x78]);
        
        // Append the actual steganographic payload
        packet.extend_from_slice(audio_data);
        
        packet
    }

    /// Calculates artificial jitter to defeat dynamic flow analysis
    /// Returns a millisecond delay value mimicking a struggling human Wi-Fi connection
    pub fn calculate_human_jitter(&self) -> u32 {
        let mut buf = [0u8; 1];
        if getrandom::getrandom(&mut buf).is_ok() {
            // Generates a random delay between 0ms and 15ms (typical Wi-Fi jitter)
            (buf[0] % 16) as u32
        } else {
            0
        }
    }
}
