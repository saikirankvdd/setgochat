use wasm_bindgen::prelude::*;

struct RustPRNG {
    seed: u32,
}

impl RustPRNG {
    fn new(seed_string: &str) -> Self {
        let mut hash: i32 = 5381;
        for c in seed_string.chars() {
            hash = ((hash << 5).wrapping_add(hash)) ^ (c as i32);
        }
        RustPRNG {
            seed: hash as u32,
        }
    }

    fn next(&mut self) -> f64 {
        self.seed ^= self.seed << 13;
        self.seed ^= self.seed >> 17;
        self.seed ^= self.seed << 5;
        (self.seed as f64) / 4294967296.0
    }
}

fn encrypt_frame_index(frame_index: u32, pin: &str) -> [u8; 4] {
    let seed_str = format!("VID_IDX_{}", pin);
    let mut prng = RustPRNG::new(&seed_str);
    let mut index_bytes = [0u8; 4];
    index_bytes[0] = ((frame_index >> 24) & 0xFF) as u8;
    index_bytes[1] = ((frame_index >> 16) & 0xFF) as u8;
    index_bytes[2] = ((frame_index >> 8) & 0xFF) as u8;
    index_bytes[3] = (frame_index & 0xFF) as u8;
    
    for i in 0..4 {
        index_bytes[i] ^= (prng.next() * 256.0).floor() as u8;
    }
    index_bytes
}

fn decrypt_frame_index(enc_bytes: &[u8], pin: &str) -> u32 {
    let seed_str = format!("VID_IDX_{}", pin);
    let mut prng = RustPRNG::new(&seed_str);
    let mut decrypted = [0u8; 4];
    for i in 0..4 {
        decrypted[i] = enc_bytes[i] ^ (prng.next() * 256.0).floor() as u8;
    }
    ((decrypted[0] as u32) << 24)
        | ((decrypted[1] as u32) << 16)
        | ((decrypted[2] as u32) << 8)
        | (decrypted[3] as u32)
}

fn encrypt_length_header(length: u32, pin: &str, frame_index: u32) -> [u8; 4] {
    let seed_str = format!("VID_HDR_{}_{}", pin, frame_index);
    let mut prng = RustPRNG::new(&seed_str);
    let mut length_bytes = [0u8; 4];
    length_bytes[0] = ((length >> 24) & 0xFF) as u8;
    length_bytes[1] = ((length >> 16) & 0xFF) as u8;
    length_bytes[2] = ((length >> 8) & 0xFF) as u8;
    length_bytes[3] = (length & 0xFF) as u8;
    
    for i in 0..4 {
        length_bytes[i] ^= (prng.next() * 256.0).floor() as u8;
    }
    length_bytes
}

fn decrypt_length_header(enc_bytes: &[u8], pin: &str, frame_index: u32) -> u32 {
    let seed_str = format!("VID_HDR_{}_{}", pin, frame_index);
    let mut prng = RustPRNG::new(&seed_str);
    let mut decrypted = [0u8; 4];
    for i in 0..4 {
        decrypted[i] = enc_bytes[i] ^ (prng.next() * 256.0).floor() as u8;
    }
    ((decrypted[0] as u32) << 24)
        | ((decrypted[1] as u32) << 16)
        | ((decrypted[2] as u32) << 8)
        | (decrypted[3] as u32)
}

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
    pub fn generate_fake_rtp_packet(&mut self, audio_data: &[u8]) -> Vec<u8> {
        let mut packet = Vec::with_capacity(12 + audio_data.len());
        
        // RTP Header (12 bytes standard)
        packet.push(0x80); // Version 2
        packet.push(0x78); // Payload type (dynamic audio codec)
        
        // Sequence number (Big Endian)
        packet.push((self.sequence_number >> 8) as u8);
        packet.push(self.sequence_number as u8);
        self.sequence_number = self.sequence_number.wrapping_add(1);
        
        // Timestamp (Big Endian)
        packet.push((self.timestamp >> 24) as u8);
        packet.push((self.timestamp >> 16) as u8);
        packet.push((self.timestamp >> 8) as u8);
        packet.push(self.timestamp as u8);
        self.timestamp = self.timestamp.wrapping_add(960); // Standard Opus 20ms audio frame jump
        
        // SSRC
        packet.extend_from_slice(&[0x12, 0x34, 0x56, 0x78]);
        
        // Append payload
        packet.extend_from_slice(audio_data);
        
        packet
    }

    /// Calculates artificial jitter to defeat dynamic flow analysis
    pub fn calculate_human_jitter(&self) -> u32 {
        let mut buf = [0u8; 1];
        if getrandom::getrandom(&mut buf).is_ok() {
            (buf[0] % 16) as u32
        } else {
            0
        }
    }

    /// Embeds the encrypted webcam frame bit string and frame index into cover frame pixel channel LSBs
    pub fn process_video_frame(
        &self,
        pixels: &mut [u8],
        payload_bits: &str,
        pin: &str,
        frame_index: u32,
    ) {
        let total_channels = pixels.len();
        let total_pixels = total_channels / 4;
        let total_usable_channels = total_pixels * 3;

        let header_bits_count = 64; // 32 bits for index, 32 bits for length
        let total_bits_needed = header_bits_count + payload_bits.len();
        if total_bits_needed > total_usable_channels {
            return;
        }

        // 1. Embed frame index in the first 32 channels (logical index 0-31)
        let enc_frame_idx = encrypt_frame_index(frame_index, pin);
        let mut channel_idx = 0;
        for i in 0..32 {
            if (channel_idx % 4) == 3 {
                channel_idx += 1; // skip alpha
            }
            let byte_idx = i / 8;
            let bit_idx = 7 - (i % 8);
            let bit = (enc_frame_idx[byte_idx] >> bit_idx) & 1;

            let mut val = pixels[channel_idx];
            if (val & 1) != bit {
                if val == 255 {
                    val -= 1;
                } else if val == 0 {
                    val += 1;
                } else {
                    val = val.wrapping_add(1);
                }
            }
            pixels[channel_idx] = val;
            channel_idx += 1;
        }

        // 2. Embed length header in next 32 channels (logical index 32-63)
        let enc_length = encrypt_length_header(payload_bits.len() as u32, pin, frame_index);
        for i in 0..32 {
            if (channel_idx % 4) == 3 {
                channel_idx += 1; // skip alpha
            }
            let byte_idx = i / 8;
            let bit_idx = 7 - (i % 8);
            let bit = (enc_length[byte_idx] >> bit_idx) & 1;

            let mut val = pixels[channel_idx];
            if (val & 1) != bit {
                if val == 255 {
                    val -= 1;
                } else if val == 0 {
                    val += 1;
                } else {
                    val = val.wrapping_add(1);
                }
            }
            pixels[channel_idx] = val;
            channel_idx += 1;
        }

        // 3. Embed payload bits using matching scatter pattern starting at logical channel 64
        let usable_channels = total_usable_channels - 64;
        let data_length = payload_bits.len();
        if data_length > 0 {
            let stride = usable_channels / data_length;
            let seed_str = format!("{}_scatter_{}", pin, frame_index);
            let mut prng = RustPRNG::new(&seed_str);
            let bits_bytes = payload_bits.as_bytes();

            for i in 0..data_length {
                let relative_logical_idx = (i as u64 * stride as u64)
                    + (prng.next() * stride as f64).floor() as u64;
                let target_logical_idx = 64 + relative_logical_idx;
                let actual_idx = target_logical_idx + (target_logical_idx / 3);

                let bit_to_embed = if bits_bytes[i] == b'1' { 1 } else { 0 };
                let mut val = pixels[actual_idx as usize];

                if (val & 1) != bit_to_embed {
                    if val == 255 {
                        val -= 1;
                    } else if val == 0 {
                        val += 1;
                    } else {
                        val = val.wrapping_add(1);
                    }
                }
                pixels[actual_idx as usize] = val;
            }
        }
    }

    /// Extracts the encrypted webcam frame bit string from received stego video pixels
    pub fn extract_video_frame(
        &self,
        pixels: &[u8],
        pin: &str,
        _frame_index: u32,
    ) -> String {
        let total_channels = pixels.len();
        let total_pixels = total_channels / 4;
        let total_usable_channels = total_pixels * 3;
        let max_usable = total_usable_channels - 64;

        // 1. Read frame index from first 32 channels (logical index 0-31)
        let mut enc_frame_bytes = [0u8; 4];
        let mut channel_idx = 0;
        for i in 0..32 {
            if (channel_idx % 4) == 3 {
                channel_idx += 1; // skip alpha
            }
            let bit = pixels[channel_idx] & 1;
            let byte_idx = i / 8;
            let bit_idx = 7 - (i % 8);
            enc_frame_bytes[byte_idx] |= bit << bit_idx;
            channel_idx += 1;
        }
        let frame_index = decrypt_frame_index(&enc_frame_bytes, pin);

        // 2. Read length header from next 32 channels (logical index 32-63)
        let mut enc_len_bytes = [0u8; 4];
        for i in 0..32 {
            if (channel_idx % 4) == 3 {
                channel_idx += 1; // skip alpha
            }
            let bit = pixels[channel_idx] & 1;
            let byte_idx = i / 8;
            let bit_idx = 7 - (i % 8);
            enc_len_bytes[byte_idx] |= bit << bit_idx;
            channel_idx += 1;
        }

        let data_length = decrypt_length_header(&enc_len_bytes, pin, frame_index) as usize;
        if data_length == 0 || data_length > max_usable {
            return String::new();
        }

        // 3. Extract payload bits starting at logical channel 64
        let stride = max_usable / data_length;
        let seed_str = format!("{}_scatter_{}", pin, frame_index);
        let mut prng = RustPRNG::new(&seed_str);
        let mut bit_string = String::with_capacity(data_length);

        for i in 0..data_length {
            let relative_logical_idx = (i as u64 * stride as u64)
                + (prng.next() * stride as f64).floor() as u64;
            let target_logical_idx = 64 + relative_logical_idx;
            let actual_idx = target_logical_idx + (target_logical_idx / 3);

            let bit = pixels[actual_idx as usize] & 1;
            if bit == 1 {
                bit_string.push('1');
            } else {
                bit_string.push('0');
            }
        }

        bit_string
    }
}
