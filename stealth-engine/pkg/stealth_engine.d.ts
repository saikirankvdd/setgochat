/* tslint:disable */
/* eslint-disable */

export class StealthEngine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Calculates artificial jitter to defeat dynamic flow analysis
     */
    calculate_human_jitter(): number;
    /**
     * Extracts the encrypted webcam frame bit string from received stego video pixels
     */
    extract_video_frame(pixels: Uint8Array, pin: string, _frame_index: number): string;
    /**
     * Generates a Fake RTP (WebRTC) Packet Header wrapped around the steganographic data
     */
    generate_fake_rtp_packet(audio_data: Uint8Array): Uint8Array;
    constructor();
    /**
     * Embeds the payload into the LSB of the audio buffer (Float32Array)
     * Converts Float32 -> i16 -> Modifies LSB -> Float32
     */
    process_audio_chunk(audio_chunk: Float32Array): void;
    /**
     * Embeds the encrypted webcam frame bit string and frame index into cover frame pixel channel LSBs
     */
    process_video_frame(pixels: Uint8Array, payload_bits: string, pin: string, frame_index: number): void;
    set_payload(payload: Uint8Array): void;
    stop(): void;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_stealthengine_free: (a: number, b: number) => void;
    readonly stealthengine_calculate_human_jitter: (a: number) => number;
    readonly stealthengine_extract_video_frame: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly stealthengine_generate_fake_rtp_packet: (a: number, b: number, c: number) => [number, number];
    readonly stealthengine_new: () => number;
    readonly stealthengine_process_audio_chunk: (a: number, b: number, c: number, d: any) => void;
    readonly stealthengine_process_video_frame: (a: number, b: number, c: number, d: any, e: number, f: number, g: number, h: number, i: number) => void;
    readonly stealthengine_set_payload: (a: number, b: number, c: number) => void;
    readonly stealthengine_stop: (a: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
