"""Gapless-loop encodes for /proto/ ambients (WebM/Opus and M4A/AAC-LC), plus plain SFX encodes.

    python tools/audio_loop_encode.py --opus-loop IN.wav OUT.webm
    python tools/audio_loop_encode.py --aac-loop  IN.wav OUT.m4a
    python tools/audio_loop_encode.py --sfx       IN.wav OUT.webm|OUT.m4a

Why: perceptual codecs do not keep the waveform of noise-like beds (decoded error
about -9..-12 dB of the signal, by design). In a plain encode the decoded last
sample and the decoded first sample come from two independent decodes, so the wrap
is a hard splice of two different noise realisations (measured: spectral step
~3x the median at the seam, above the file's own p99.9).

Both loop encoders make the coded stream periodic:
  1. encode the loop three times in a row;
  2. keep the frames covering the middle loop plus K frames of the loop before it
     as decoder warm-up;
  3. tell the container to discard the warm-up and the run-on exactly:
       Opus: OpusHead pre-skip = K*960 + 312, final granule = pre-skip + N
             (then `ffmpeg -c copy` to WebM: CodecDelay / DiscardPadding)
       AAC:  MP4 edit list (elst) media_time = first loop sample in the kept
             frames, segment_duration = the period (ISO 14496-12; honoured by
             decodeAudioData in Chromium). A 1024-sample AAC frame does not
             divide 60 s, so the AAC period is two loops (120 s, see aac_loop).
The decoder reaches the loop start in the state it has at the loop end, so the
decoded loop continues across the wrap. Decoded length is exactly the period.

Encoder settings (ffmpeg 8.x):
  Opus  -c:a libopus -b:a 96k -vbr on -application audio -frame_duration 20      (ambient, stereo)
  AAC   -c:a aac -profile:a aac_low -q:a 0.8 -aac_pns 0 -aac_is 0               (ambient, stereo, ~150 kb/s)
        (quality mode: the bitrate mode carries rate-control state across periods,
        so two decoded periods differ (-15..-25 dB at quiet spots) and the wrap splices;
        in quality mode successive periods decode bit-identically)
        (no perceptual noise substitution / intensity stereo: PNS noise is drawn by the
        decoder's own random generator, so it can never repeat across a wrap)
  SFX   -ac 1 -c:a libopus -b:a 64k -vbr on -application audio -frame_duration 20
        -ac 1 -c:a aac -profile:a aac_low -b:a 64k -aac_pns 0 -aac_is 0   (PNS adds noise energy: +0.8 dB TP on village-forest)
"""
import pathlib
import struct
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

SR = 48000
K = 25                                                    # warm-up frames (Opus 500 ms, AAC ~533 ms)
OPUS = ["-c:a", "libopus", "-b:a", "96k", "-vbr", "on", "-application", "audio", "-frame_duration", "20"]
AAC = ["-c:a", "aac", "-profile:a", "aac_low", "-q:a", "0.8", "-aac_pns", "0", "-aac_is", "0"]
SFX_OPUS = ["-ac", "1", "-c:a", "libopus", "-b:a", "64k", "-vbr", "on", "-application", "audio", "-frame_duration", "20"]
SFX_AAC = ["-ac", "1", "-c:a", "aac", "-profile:a", "aac_low", "-b:a", "64k", "-aac_pns", "0", "-aac_is", "0"]


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *map(str, args)], check=True)


def read3(master):
    x, sr = sf.read(master, always_2d=True, dtype="float32")
    assert sr == SR, f"{master}: {sr} Hz"
    return x, np.concatenate([x, x, x])


# ------------------------------------------------------------------ Opus / Ogg
def _crc_table():
    t = []
    for i in range(256):
        r = i << 24
        for _ in range(8):
            r = ((r << 1) ^ 0x04C11DB7) if r & 0x80000000 else (r << 1)
        t.append(r & 0xFFFFFFFF)
    return t


CRC = _crc_table()


def ogg_crc(data):
    c = 0
    for b in data:
        c = ((c << 8) ^ CRC[((c >> 24) & 0xFF) ^ b]) & 0xFFFFFFFF
    return c


def ogg_packets(buf):
    i, packets, cur, serial = 0, [], b"", None
    while i < len(buf):
        assert buf[i:i + 4] == b"OggS"
        serial = struct.unpack_from("<I", buf, i + 14)[0]
        nseg = buf[i + 26]
        lace = buf[i + 27:i + 27 + nseg]
        p = i + 27 + nseg
        for n in lace:
            cur += buf[p:p + n]
            p += n
            if n < 255:
                packets.append(cur)
                cur = b""
        i = p
    return serial, packets


def ogg_page(serial, seq, granule, packets, flags=0):
    lace = b"".join(b"\xff" * (len(pk) // 255) + bytes([len(pk) % 255]) for pk in packets)
    assert len(lace) <= 255
    hdr = b"OggS" + bytes([0, flags]) + struct.pack("<qII", granule, serial, seq) + b"\0\0\0\0" + bytes([len(lace)]) + lace
    data = bytearray(hdr + b"".join(packets))
    struct.pack_into("<I", data, 22, ogg_crc(bytes(data)))
    return bytes(data)


def opus_loop(master, out):
    x, x3 = read3(master)
    frame = 960
    assert len(x) % frame == 0, "loop length must be whole 20 ms frames"
    n = len(x) // frame
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        sf.write(d / "x3.wav", x3, SR, subtype="FLOAT")
        ffmpeg("-i", d / "x3.wav", *OPUS, d / "a.ogg")
        serial, pk = ogg_packets((d / "a.ogg").read_bytes())
        head, tags, audio = bytearray(pk[0]), pk[1], pk[2:]
        enc_pre = struct.unpack_from("<H", head, 10)[0]
        sel = audio[n - K:2 * n + 1]                     # middle loop (+1 for the encoder look-ahead) + warm-up
        pre = K * frame + enc_pre
        struct.pack_into("<H", head, 10, pre)
        pages = [ogg_page(serial, 0, 0, [bytes(head)], 2), ogg_page(serial, 1, 0, [tags])]
        g, seq = 0, 2
        for i in range(0, len(sel), 50):
            chunk = sel[i:i + 50]
            g += frame * len(chunk)
            last = i + 50 >= len(sel)
            pages.append(ogg_page(serial, seq, min(g, pre + len(x)) if last else g, chunk, 4 if last else 0))
            seq += 1
        (d / "b.ogg").write_bytes(b"".join(pages))
        ffmpeg("-i", d / "b.ogg", "-c", "copy", out)


# ------------------------------------------------------------------ AAC / MP4
def adts_frames(buf):
    frames, i = [], 0
    while i < len(buf):
        assert buf[i] == 0xFF and (buf[i + 1] & 0xF0) == 0xF0, i
        n = ((buf[i + 3] & 0x03) << 11) | (buf[i + 4] << 3) | (buf[i + 5] >> 5)
        frames.append(buf[i:i + n])
        i += n
    return frames


def mp4_boxes(b, off, end):
    while off < end:
        size, typ = struct.unpack(">I4s", b[off:off + 8])
        yield typ.decode("latin1"), off, size
        off += size


def find(b, path, off=0, end=None):
    end = len(b) if end is None else end
    for typ, o, s in mp4_boxes(b, off, end):
        if typ == path[0]:
            return (o, s) if len(path) == 1 else find(b, path[1:], o + 8, o + s)
    return None


def set_edit(m4a: bytes, media_time: int, n: int) -> bytes:
    """Replace/insert the track's edit list: play `n` samples from `media_time` (media timescale)."""
    b = bytearray(m4a)
    moov = find(b, ["moov"])
    mdat = find(b, ["mdat"])
    assert moov and mdat and moov[0] > mdat[0], "moov must follow mdat (chunk offsets stay valid)"
    mvhd = find(b, ["moov", "mvhd"])
    v = b[mvhd[0] + 8]
    movie_ts = struct.unpack_from(">I", b, mvhd[0] + (20 if v == 0 else 28))[0]
    mdhd = find(b, ["moov", "trak", "mdia", "mdhd"])
    v2 = b[mdhd[0] + 8]
    media_ts = struct.unpack_from(">I", b, mdhd[0] + (20 if v2 == 0 else 28))[0]
    assert media_ts == SR, media_ts
    seg = round(n * movie_ts / media_ts)
    elst = struct.pack(">I4sB3sIQqhh", 36, b"elst", 1, b"\0\0\0", 1, seg, media_time, 1, 0)
    edts = struct.pack(">I4s", 8 + len(elst), b"edts") + elst
    trak = find(b, ["moov", "trak"])
    old = find(b, ["moov", "trak", "edts"])
    if old:
        b[old[0]:old[0] + old[1]] = edts
        delta = len(edts) - old[1]
    else:
        tkhd = find(b, ["moov", "trak", "tkhd"])
        at = tkhd[0] + tkhd[1]
        b[at:at] = edts
        delta = len(edts)
    for o, _ in (moov, trak):
        struct.pack_into(">I", b, o, struct.unpack_from(">I", b, o)[0] + delta)
    # movie / track durations = the edit
    struct.pack_into(">I" if v == 0 else ">Q", b, mvhd[0] + (24 if v == 0 else 32), seg)
    tkhd = find(b, ["moov", "trak", "tkhd"])
    vt = b[tkhd[0] + 8]
    struct.pack_into(">I" if vt == 0 else ">Q", b, tkhd[0] + (28 if vt == 0 else 36), seg)
    return bytes(b)


def aac_loop(master, out):
    """AAC frames are 1024 samples; a 60 s loop is 2,880,000 = 2812.5 frames, so loop n+1
    starts half a frame later than loop n and a one-loop stream cannot be periodic.
    The period is made frame-aligned by repeating the loop: lcm(N, 1024) (two loops for
    60 s). The file then holds the loop twice (identical audio, twice the bytes)."""
    x, _ = read3(master)
    frame, prime = 1024, 1024                            # ffmpeg aac: 1024 priming samples
    reps = frame // np.gcd(len(x), frame)
    x = np.concatenate([x] * reps)
    x3 = np.concatenate([x, x, x])
    with tempfile.TemporaryDirectory() as d:
        d = pathlib.Path(d)
        sf.write(d / "x3.wav", x3, SR, subtype="FLOAT")
        ffmpeg("-i", d / "x3.wav", *AAC, "-f", "adts", d / "a.aac")
        fr = adts_frames((d / "a.aac").read_bytes())
        start = len(x) + prime                           # decoded index of the middle loop's first sample
        p0 = start // frame - K
        p1 = (start + len(x)) // frame + 2               # through the loop end, +1 frame of overlap
        (d / "b.aac").write_bytes(b"".join(fr[p0:p1]))
        ffmpeg("-i", d / "b.aac", "-c", "copy", "-movflags", "-faststart", d / "b.m4a")
        m4a = set_edit((d / "b.m4a").read_bytes(), start - p0 * frame, len(x))
        pathlib.Path(out).write_bytes(m4a)


def sfx(master, out):
    ffmpeg("-i", master, *(SFX_OPUS if str(out).endswith(".webm") else SFX_AAC), out)


if __name__ == "__main__":
    mode, src, dst = sys.argv[1:4]
    {"--opus-loop": opus_loop, "--aac-loop": aac_loop, "--sfx": sfx}[mode](pathlib.Path(src), pathlib.Path(dst))
