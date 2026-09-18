"""Top-down layout: generated + overrides -> runtime.

    python tools/topdown_layout.py            # merge and write layout.runtime.json
    python tools/topdown_layout.py --check    # fail if runtime is stale or overrides are bad

Three files in assets/topdown/, each with one owner:

  layout.generated.json   tools/generate_layout.py --target topdown. Only the
                          spec's result; nobody edits it.
  layout.overrides.json   manual changes, keyed by stable object id. Only the
                          fields the editor can change, only where they differ.
  layout.runtime.json     generated with overrides applied. What /proto/ reads.
                          Nobody edits it either — it is rebuilt from the two.

An override that names an id the generator no longer produces is an error,
not a no-op: a silently dropped override is a placement that quietly moved back
and nobody was told.
"""

import argparse
import copy
import json
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOPDOWN = ROOT / "assets" / "topdown"
GENERATED = TOPDOWN / "layout.generated.json"
OVERRIDES = TOPDOWN / "layout.overrides.json"
RUNTIME = TOPDOWN / "layout.runtime.json"

# What journey3/src/editor.js can change on an object: drag (pos), wheel (h),
# R (rotY), Del (visible). Nothing else is an override.
EDITABLE = ("pos", "h", "rotY", "visible")

OVERRIDES_NOTE = ("Ручные правки top-down расстановки: {stable id: {pos|h|rotY|visible}}. "
                  "Только отличия от layout.generated.json. Пишет POST /__topdown/layout "
                  "(tools/editor_serve.py) или человек; orphan id — ошибка сборки.")


class OverrideError(ValueError):
    pass


def dump(layout):
    return json.dumps(layout, ensure_ascii=False, indent=1) + "\n"


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def check_value(field, v):
    """None if `v` is a valid value for `field`, else what is wrong with it."""
    if field == "pos":
        if not (isinstance(v, list) and len(v) == 3 and _num(v[0]) and _num(v[2])
                and (v[1] is None or _num(v[1]))):
            return "pos — список [x, y|null, z] из чисел"
    elif field == "h":
        if not (_num(v) and v > 0):
            return "h — положительное число"
    elif field == "rotY":
        if not _num(v):
            return "rotY — число (радианы)"
    elif field == "visible":
        if not isinstance(v, bool):
            return "visible — true или false"
    else:
        return f"поле '{field}' не редактируется (можно: {', '.join(EDITABLE)})"
    return None


def objects(layout):
    """id -> object, over every sprite and board. Duplicate or missing ids fail."""
    seen = {}
    for bid, b in layout["biomes"].items():
        for kind in ("sprites", "boards"):
            for o in b.get(kind, []):
                oid = o.get("id")
                if not isinstance(oid, str) or not oid:
                    raise OverrideError(f"{bid}/{kind}: объект без id ({o.get('t')})")
                if oid in seen:
                    raise OverrideError(f"id '{oid}' встречается дважды")
                seen[oid] = o
    return seen


def load_overrides(path=OVERRIDES):
    if not path.exists():
        raise OverrideError(f"нет {path.relative_to(ROOT)}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise OverrideError(f"{path.name}: не JSON — {exc}") from exc
    return data


def validate_overrides(generated, data):
    """Every problem with the overrides at once, as a list of lines."""
    errs = []
    if not isinstance(data, dict) or data.get("version") != 1:
        return ["overrides: ожидается объект с \"version\": 1"]
    objs = data.get("objects")
    if not isinstance(objs, dict):
        return ["overrides: ожидается \"objects\": {id: {поле: значение}}"]
    ids = objects(generated)
    for oid, fields in objs.items():
        if oid not in ids:
            errs.append(f"override '{oid}': такого id нет в layout.generated.json "
                        f"(объект переименован или удалён из spec)")
            continue
        if not isinstance(fields, dict) or not fields:
            errs.append(f"override '{oid}': ожидается непустой объект полей")
            continue
        for field, v in fields.items():
            why = check_value(field, v)
            if why:
                errs.append(f"override '{oid}': {why}")
    return errs


def merge(generated, data):
    """Generated layout with the overrides applied. The input is not modified."""
    errs = validate_overrides(generated, data)
    if errs:
        raise OverrideError("\n  ".join([f"ошибок {len(errs)}:"] + errs))
    out = copy.deepcopy(generated)
    out["generated"] = ("tools/topdown_layout.py: layout.generated.json + "
                        "layout.overrides.json. Руками не править")
    ids = objects(out)
    for oid, fields in data["objects"].items():
        for field, v in fields.items():
            ids[oid][field] = copy.deepcopy(v)
    out["overrides_applied"] = len(data["objects"])
    return out


def diff(generated, edited):
    """The overrides that turn `generated` into `edited`.

    `edited` is a whole layout as an editor hands it back. It must hold exactly
    the generated ids — deleting is done with visible: false, adding is done in
    the spec — and may differ only in the editable fields. Only what differs is
    kept, so an object moved back to where it was generated loses its override.
    """
    gen, ed = objects(generated), objects(edited)
    errs = [f"'{oid}' есть в редакторе, но не в генерации" for oid in ed if oid not in gen]
    errs += [f"'{oid}' пропал из редактора — удаляется через visible: false"
             for oid in gen if oid not in ed]
    out = {}
    for oid, g in gen.items():
        e = ed.get(oid)
        if e is None:
            continue
        for k in set(g) | set(e):
            if k not in EDITABLE and g.get(k) != e.get(k):
                errs.append(f"'{oid}': поле '{k}' не редактируется, а изменено")
        fields = {}
        for k in EDITABLE:
            if k in e and e[k] != g.get(k):
                why = check_value(k, e[k])
                if why:
                    errs.append(f"'{oid}': {why}")
                fields[k] = e[k]
        if fields:
            out[oid] = fields
    if errs:
        raise OverrideError("\n  ".join([f"ошибок {len(errs)}:"] + errs))
    return {"version": 1, "note": OVERRIDES_NOTE, "objects": dict(sorted(out.items()))}


def export(edited, *, generated=GENERATED, overrides=OVERRIDES, runtime=RUNTIME,
           backups=None):
    """What an editor's Export does: edited runtime layout -> overrides file ->
    rebuilt runtime. The generated file is read, never written. The previous
    overrides are copied to `backups` first, if given. Returns the number of
    overridden objects; raises OverrideError and writes nothing on bad input."""
    gen = json.loads(generated.read_text(encoding="utf-8"))
    data = diff(gen, edited)
    text = dump(merge(gen, data))
    if backups is not None and overrides.exists():
        backups.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        (backups / f"topdown-overrides-{stamp}.json").write_bytes(overrides.read_bytes())
    overrides.write_text(dump(data), encoding="utf-8")
    runtime.write_text(text, encoding="utf-8")
    return len(data["objects"])


def rebuild(write=True):
    """Read generated + overrides, return (runtime_text, current_text_or_None)."""
    generated = json.loads(GENERATED.read_text(encoding="utf-8"))
    text = dump(merge(generated, load_overrides()))
    have = RUNTIME.read_text(encoding="utf-8") if RUNTIME.exists() else None
    if write and have != text:
        RUNTIME.write_text(text, encoding="utf-8")
    return text, have


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="ничего не записывать; упасть, если runtime устарел")
    args = ap.parse_args()
    try:
        text, have = rebuild(write=not args.check)
    except OverrideError as exc:
        print(f"OVERRIDES: {exc}")
        sys.exit(1)
    rel = RUNTIME.relative_to(ROOT)
    if args.check and have != text:
        print(f"УСТАРЕЛ: {rel} — запустите python tools/topdown_layout.py")
        sys.exit(1)
    print(f"{'актуален' if args.check else '->'} {rel}")


if __name__ == "__main__":
    main()
