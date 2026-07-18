#![no_std]

use core::sync::atomic::{AtomicU32, Ordering};
use sha2::{Digest, Sha256};

#[cfg(target_arch = "wasm32")]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

const DOMAIN: &[u8] = b"csgofriberg-pow-v1\0";
const NOT_FOUND: u64 = u64::MAX;
static CHALLENGE: [AtomicU32; 8] = [const { AtomicU32::new(0) }; 8];

#[inline]
fn challenge_bytes() -> [u8; 32] {
    let mut bytes = [0u8; 32];
    for (index, word) in CHALLENGE.iter().enumerate() {
        bytes[index * 4..index * 4 + 4]
            .copy_from_slice(&word.load(Ordering::Relaxed).to_le_bytes());
    }
    bytes
}

#[inline]
fn modified_sha256(challenge: &[u8; 32], nonce: u64) -> [u8; 32] {
    let mut first_hasher = Sha256::new();
    first_hasher.update(DOMAIN);
    first_hasher.update(challenge);
    first_hasher.update(nonce.to_le_bytes());
    let first = first_hasher.finalize();

    let mut mixed = [0u8; 32];
    for index in 0..32 {
        mixed[index] = first[(index + 11) & 31]
            ^ first[index]
            ^ ((index * 29 + 0x5d) & 0xff) as u8;
    }

    let mut second_hasher = Sha256::new();
    second_hasher.update(DOMAIN);
    second_hasher.update(mixed);
    second_hasher.finalize().into()
}

#[inline]
fn has_leading_zero_bits(digest: &[u8; 32], difficulty: u32) -> bool {
    let whole_bytes = (difficulty / 8) as usize;
    if digest[..whole_bytes].iter().any(|byte| *byte != 0) {
        return false;
    }
    let remaining = difficulty & 7;
    remaining == 0 || digest[whole_bytes] & (0xff << (8 - remaining)) == 0
}

#[no_mangle]
pub extern "C" fn set_challenge_word(index: u32, value: u32) {
    if let Some(word) = CHALLENGE.get(index as usize) {
        word.store(value, Ordering::Relaxed);
    }
}

#[no_mangle]
pub extern "C" fn solve_chunk(start: u64, count: u32, difficulty: u32) -> u64 {
    if !(16..=24).contains(&difficulty) {
        return NOT_FOUND;
    }
    let challenge = challenge_bytes();
    let end = start.saturating_add(count as u64);
    let mut nonce = start;
    while nonce < end {
        if has_leading_zero_bits(&modified_sha256(&challenge, nonce), difficulty) {
            return nonce;
        }
        nonce += 1;
    }
    NOT_FOUND
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stable_vector() {
        let digest = modified_sha256(&[0u8; 32], 42);
        assert_eq!(
            digest,
            [
                0x84, 0xa4, 0x9c, 0xaf, 0x64, 0xdb, 0xaa, 0x0c,
                0xb9, 0x6a, 0x2d, 0x99, 0x64, 0x70, 0xd8, 0x8e,
                0x59, 0x6e, 0x04, 0x5e, 0x72, 0x06, 0x7c, 0xbd,
                0x5e, 0x99, 0x59, 0x61, 0x35, 0xca, 0xa2, 0x82,
            ]
        );
    }
}
