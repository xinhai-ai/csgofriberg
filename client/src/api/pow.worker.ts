interface SolveMessage {
  challenge: string;
  difficulty: number;
}

interface PowExports {
  set_challenge_word(index: number, value: number): void;
  solve_chunk(start: bigint, count: number, difficulty: number): bigint;
}

// WebAssembly exposes i64 values to JavaScript as signed BigInt.
const NOT_FOUND = -1n;
const CHUNK_SIZE = 25_000;

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function solve(message: SolveMessage): Promise<string> {
  const challenge = decodeBase64Url(message.challenge);
  if (challenge.length !== 32) throw new Error('POW_CHALLENGE_INVALID');
  const response = await fetch('/pow/csgofriberg_pow.wasm', { cache: 'force-cache' });
  if (!response.ok) throw new Error('POW_WASM_UNAVAILABLE');
  let module: WebAssembly.WebAssemblyInstantiatedSource;
  try {
    module = await WebAssembly.instantiateStreaming(response.clone(), {});
  } catch {
    module = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  }
  const exports = module.instance.exports as unknown as PowExports;
  const view = new DataView(challenge.buffer, challenge.byteOffset, challenge.byteLength);
  for (let index = 0; index < 8; index++) {
    exports.set_challenge_word(index, view.getUint32(index * 4, true));
  }

  let start = 0n;
  while (start <= 0x7fffffffffffffffn) {
    const found = exports.solve_chunk(start, CHUNK_SIZE, message.difficulty);
    if (found !== NOT_FOUND) return found.toString();
    start += BigInt(CHUNK_SIZE);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('POW_NOT_FOUND');
}

self.onmessage = (event: MessageEvent<SolveMessage>) => {
  void solve(event.data).then(
    (nonce) => self.postMessage({ nonce }),
    (error) => self.postMessage({ error: error instanceof Error ? error.message : 'POW_FAILED' })
  );
};

export {};
