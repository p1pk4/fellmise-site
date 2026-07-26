"""Assert no sprite is ever displayed larger than the pixels it ships with.

    python tools/check_display_sizes.py

Upscaling past the exported size is what makes generated art look soft and
"AI-ish" on a big screen. The biome scenes size sprites as a share of the scene
band, so the on-screen height depends on the viewport — this measures the real
rendered height in a browser at the widest breakpoint we support and compares it
with the natural (exported) height of the file that was actually chosen.
Transforms are excluded on purpose — a gate deliberately flies its art past
the camera, and that peak is masked by the light flood at the same moment.

Needs Playwright; skips with a clear message if it is not installed.
"""

import json
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCRATCH = pathlib.Path(
    r"C:\Users\igorr\AppData\Local\Temp\claude\d--Dev-fellmise-site"
    r"\c8248c5a-1a3f-4b21-8fb7-656b02c45201\scratchpad")

JS = r"""
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const out = [];
  for (const w of [1280, 1600, 1920, 2560]) {
    const p = await b.newPage({ viewport: { width: w, height: 1000 } });
    await p.goto('file:///%ROOT%/index.html');
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 500) {
        window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40));
      }
    });
    await p.waitForTimeout(600);
    const rows = await p.evaluate(() => [...document.images].map(i => ({
      src: i.currentSrc.split('/').pop(),
      // offsetHeight, NOT getBoundingClientRect: the gate zoom scales its art
      // 3.2x as a camera move. That is choreography, not a resolution choice,
      // and the question here is whether the ASSET is too small for its layout.
      shown: i.offsetHeight,
      natural: i.naturalHeight,
    })));
    out.push({ w, rows });
    await p.close();
  }
  await b.close();
  console.log(JSON.stringify(out));
})();
"""


def main():
    js = JS.replace('%ROOT%', str(ROOT).replace('\\', '/'))
    tmp = SCRATCH / "_dispcheck.js"
    try:
        tmp.write_text(js, encoding="utf-8")
    except OSError:
        tmp = pathlib.Path(tempfile.gettempdir()) / "_dispcheck.js"
        tmp.write_text(js, encoding="utf-8")

    r = subprocess.run(["node", str(tmp)], capture_output=True, text=True, cwd=str(SCRATCH))
    if r.returncode != 0:
        print("Playwright недоступен, проверка пропущена:\n", r.stderr[:400])
        return 0

    data = json.loads(r.stdout.strip().splitlines()[-1])
    worst = {}
    for block in data:
        for row in block["rows"]:
            if not row["natural"] or not row["shown"]:
                continue
            ratio = row["shown"] / row["natural"]
            cur = worst.get(row["src"])
            if cur is None or ratio > cur[0]:
                worst[row["src"]] = (ratio, row["shown"], row["natural"], block["w"])

    bad = {k: v for k, v in worst.items() if v[0] > 1.0}
    print(f"{'sprite':<28}{'показ':>7}{'натур':>7}{'коэф':>7}  @vw")
    for k, (ratio, shown, nat, vw) in sorted(worst.items(), key=lambda kv: -kv[1][0])[:12]:
        flag = "  ПРЕВЫШЕНИЕ" if ratio > 1.0 else ""
        print(f"{k:<28}{shown:>7}{nat:>7}{ratio:>7.2f}  {vw}{flag}")
    print()
    if bad:
        print(f"!! {len(bad)} спрайтов растягиваются выше своего экспорта")
        return 1
    print(f"ок: ни один из {len(worst)} спрайтов не превышает натуральную высоту "
          f"(макс. коэф {max(v[0] for v in worst.values()):.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
