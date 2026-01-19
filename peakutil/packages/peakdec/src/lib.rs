use wasm_bindgen::prelude::*;
use js_sys::Uint8Array;
use zstd::stream::decode_all;

use alphanumeric_sort::compare_str;

fn u32_from_bytes(bytes: &[u8]) -> u32 {
    u32::from_le_bytes(bytes[0..4].try_into().unwrap())
}

unsafe fn get_key_bytes(binary: &[u8], data_start: usize, off: u32) -> &[u8] {
    let start = data_start + off as usize;
    let slice = &binary[start..];
    let tab_pos = slice.iter().position(|&b| b == b'\t').unwrap_or(slice.len());
    &slice[..tab_pos]
}

unsafe fn get_entry_bytes(binary: &[u8], data_start: usize, start_off: u32, end_off: u32) -> &[u8] {
    &binary[data_start + start_off as usize..data_start + end_off as usize]
}

fn key_lower_matches(key_bytes: &[u8], query_lower: &[u8], prefix_only: bool) -> bool {
    if query_lower.is_empty() {
        return true;
    }
    if prefix_only {
        key_bytes.len() >= query_lower.len()
            && key_bytes.iter().zip(query_lower.iter()).all(|(&k, &q)| k.to_ascii_lowercase() == q)
    } else {
        key_bytes.windows(query_lower.len()).any(|w| {
            w.iter().zip(query_lower.iter()).all(|(&k, &q)| k.to_ascii_lowercase() == q)
        })
    }
}

fn text_after_tab_contains(entry_bytes: &[u8], query_lower: &[u8]) -> bool {
    if query_lower.is_empty() {
        return true;
    }
    let tab_pos = entry_bytes.iter().position(|&b| b == b'\t').unwrap_or(entry_bytes.len());
    let text = &entry_bytes[tab_pos + 1..];
    text.windows(query_lower.len())
        .any(|w| w.iter().zip(query_lower.iter()).all(|(&k, &q)| k.to_ascii_lowercase() == q))
}

unsafe fn get_key_str_unchecked(binary: &[u8], data_start: usize, off: u32) -> &str {
    let bytes = get_key_bytes(binary, data_start, off);
    std::str::from_utf8_unchecked(bytes)
}

#[wasm_bindgen]
pub struct PeakDecoder {
    binary: Vec<u8>,
    data_start: usize,
    offsets_starts: Vec<usize>,
    lens: Vec<usize>,

    query_lower: &'a str,
    results: Vec<u32>,
    ri: usize,
    pi: usize,
		level: usize,
    reverse: bool,
}

#[wasm_bindgen]
impl PeakDecoder {
    #[wasm_bindgen(constructor)]
    pub fn new(input: &[u8], is_compressed: bool) -> Result<PeakDecoder, JsValue> {
        let binary = if is_compressed {
            decode_all(input).map_err(|e| JsValue::from_str(&format!("zstd error: {}", e)))?
        } else {
            input.to_vec()
        };

        let mut cursor = 0usize;
        let ni = u32_from_bytes(&binary[cursor..cursor + 4]) as usize;
        cursor += 4;

        let mut offsets_starts = Vec::with_capacity(ni + 2);
        let mut lens = Vec::with_capacity(ni + 2);

        for _ in 0..ni {
            let len = u32_from_bytes(&binary[cursor..cursor + 4]) as usize;
            cursor += 4;
            let offsets_start = cursor;
            cursor += len * 4;
            offsets_starts.push(offsets_start);
            lens.push(len);
        }

        // Virtual levels use primary
        offsets_starts.push(offsets_starts[0]);
        lens.push(lens[0]);
        offsets_starts.push(offsets_starts[0]);
        lens.push(lens[0]);

        let data_start = cursor;

        Ok(PeakDecoder {
            binary,
            data_start,
            offsets_starts,
            lens,
            query_lower: "",
            results: Vec::new(),
            ri: 0,
            pi: 0,
						level: 0,
            reverse: false,
        })
    }

    pub fn get_num_levels(&self) -> usize {
        self.offsets_starts.len()
    }

    pub fn search(&mut self, query: &str, reverse: bool) -> Result<(), JsValue> {
        self.query_lower = query.to_ascii_lowercase();
        self.reverse = reverse;

				self.results.clear();
				self.ri = 0;
				self.pi = 0;
				self.level = 0;

        Ok(())
    }

		pub fn get_exact(&mut self, query: &str) -> Vec<Uint8Array>{ // This doesn't change the state
			// Real secondary index — prefix binary search
			let query_lower = query.to_ascii_lowercase();
			let mut out = Vec::new();
			for level in 0..self.lens.len(){
				let len = self.lens[level];
				let mut left = 0usize;
				let mut high = len;

				while left < high {
						let mid = left + (high - left) / 2;
						let off = self.get_offset_at(level, mid); // Check if this works with secondary
						let key_str = unsafe { get_key_str_unchecked(&self.binary, self.data_start, off) };
						let key_lower = key_str.to_ascii_lowercase();

						if compare_str(&key_lower, &query_lower).is_lt() {
								left = mid + 1;
						} else {
								high = mid;
						}
				}

				let off = self.get_offset_at(level, left);
				let primary_locali = self.primary_locali_from_offset(off) as usize;
				let start_off = self.get_offset_at(0, primary_locali);
				let end_off = if primary_locali + 1 < self.lens[0] {
						self.get_offset_at(0, primary_locali + 1)
				} else {
						(self.binary.len() - self.data_start) as u32
				};
				let slice = &self.binary[self.data_start + start_off as usize..self.data_start + end_off as usize];

				let arr = Uint8Array::new_with_length(slice.len() as u32);
				arr.copy_from(slice);
				out.push(arr);

			}
			return out;
		}

    pub fn get_results_from_level(&mut self, level: usize, count: usize) -> Vec<Uint8Array> {
        if level >= self.offsets_starts.len(){
            return Vec::new();
        }
				if level != self.level{
					self.pi = 0;
					self.level = level;
				}

        if self.results.len() - self.ri < count && self.pi < self.lens[level] {
					let ni = self.offsets_starts.len() - 2;
					let mut temp_results = Vec::new();

					if level < ni {
							self.pi = self.lens[level];
							// Real secondary index — prefix binary search
							let len = self.lens[level];
							let mut left = 0usize;
							let mut high = len;

							while left < high {
									let mid = left + (high - left) / 2;
									let off = self.get_offset_at(level, mid); // Check if this works with secondary
									let key_str = unsafe { get_key_str_unchecked(&self.binary, self.data_start, off) };
									let key_lower = key_str.to_ascii_lowercase();

									if compare_str(&key_lower, &self.query_lower).is_lt() {
											left = mid + 1;
									} else {
											high = mid;
									}
							}

							let mut right = left;
							high = len;
							while right < high {
									let mid = right + (high - right) / 2;
									let off = self.get_offset_at(level, mid);
									let key_str = unsafe { get_key_str_unchecked(&self.binary, self.data_start, off) };
									let key_lower = key_str.to_ascii_lowercase();
									if compare_str(&key_lower, &self.query_lower).is_lt() {
											right = mid + 1;
									} else {
											high = mid;
									}
							}

							for locali in left..right {
									let off = self.get_offset_at(level, locali);
									let primary_locali = self.primary_locali_from_offset(off);
									temp_results.push(primary_locali);
							}
					} else if level == ni {
							// Key substring fallback
							while self.pi < self.lens[level] {
									let off = self.get_offset_at(0, self.pi);
									let key_bytes = unsafe { get_key_bytes(&self.binary, self.data_start, off) };
									let already_in = self.results.contains(&(self.pi as u32));
									if !already_in && key_lower_matches(key_bytes, self.query_lower.as_bytes(), false) {
											temp_results.push(self.pi as u32);
									}
									self.pi += 1;
									if temp_results.len() >= count{
										break;
									}
							}
					} else {
							// Full-text fallback
							while self.pi < self.lens[level] {
									let start_off = self.get_offset_at(0, self.pi);
									let end_off = if self.pi + 1 < self.lens[level] {
											self.get_offset_at(0, self.pi + 1)
									} else {
											(self.binary.len() - self.data_start) as u32
									};
									let entry_bytes = unsafe { get_entry_bytes(&self.binary, self.data_start, start_off, end_off) };
									let already_in = self.results.contains(&(self.pi as u32));
									if !already_in && text_after_tab_contains(entry_bytes, self.query_lower.as_bytes()) {
											temp_results.push(self.pi as u32);
									}
									self.pi += 1;
									if temp_results.len() >= count{
										break;
									}
							}
					}

					if self.reverse {
							temp_results.reverse();
					}

					self.results.extend(temp_results);
				}

        let mut out = Vec::with_capacity(count);
        let start = self.ri;
        let end = (start + count).min(self.results.len());

        for &locali in &self.results[start..end] {
            let locali = locali as usize;
            let start_off = self.get_offset_at(0, locali);
            let end_off = if locali + 1 < self.lens[0] {
                self.get_offset_at(0, locali + 1)
            } else {
                (self.binary.len() - self.data_start) as u32
            };
            let slice = &self.binary[self.data_start + start_off as usize..self.data_start + end_off as usize];

            let arr = Uint8Array::new_with_length(slice.len() as u32);
            arr.copy_from(slice);
            out.push(arr);
        }

        self.ri = end;
        out
    }

    fn get_offset_at(&self, level: usize, locali: usize) -> u32 {
        let byte_offset = self.offsets_starts[level] + locali * 4;
        u32_from_bytes(&self.binary[byte_offset..byte_offset + 4])
    }

    fn primary_locali_from_offset(&self, target_off: u32) -> u32 {
        let mut low = 0usize;
        let mut high = self.lens[0];
        let mut result = 0u32;

        while low < high {
            let mid = low + (high - low) / 2;
            let off = self.get_offset_at(0, mid);
            if off <= target_off {
                result = mid as u32;
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        result
    }
}

        
