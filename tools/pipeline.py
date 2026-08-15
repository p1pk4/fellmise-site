"""Find the art pipeline, wherever it has been moved to this week.

The pipeline repository is reorganised from time to time — it has been
`D:\\Dev\\pixelart-pipeline`, then `D:\\Dev\\ART_Fellmise\\scripts`, and now
`D:\\Dev\\ART_Fellmise\\_system\\scripts`. Every generator here had the path
written into it, so each move broke all of them at once, silently, until a run
failed halfway.

So the path is resolved once, here, by looking for the files that actually
matter rather than by trusting a constant. Nothing in the pipeline is written
to: only its ComfyUI client, its workflows and its acceptance metrics are read.
"""

import pathlib
import sys

# Ordered by how recent the layout is; the first one that has the goods wins.
CANDIDATES = [
    pathlib.Path(r"D:\Dev\ART_Fellmise\_system"),
    pathlib.Path(r"D:\Dev\ART_Fellmise"),
    pathlib.Path(r"D:\Dev\pixelart-pipeline"),
]


def _root():
    for c in CANDIDATES:
        if (c / "scripts" / "comfy_client.py").exists():
            return c
    # last resort: search, so a fourth move is a slow start rather than a break
    for base in (pathlib.Path(r"D:\Dev\ART_Fellmise"), pathlib.Path(r"D:\Dev")):
        if not base.is_dir():
            continue
        for p in base.rglob("scripts/comfy_client.py"):
            return p.parent.parent
    raise SystemExit(
        "не нашёл пайплайн: нужен каталог со scripts/comfy_client.py.\n"
        "Искал в: " + ", ".join(str(c) for c in CANDIDATES))


ROOT = _root()
SCRIPTS = ROOT / "scripts"
WORKFLOWS = ROOT / "workflows"

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def workflow(name):
    p = WORKFLOWS / name
    if not p.exists():
        raise SystemExit(f"нет воркфлоу {p}")
    return p
