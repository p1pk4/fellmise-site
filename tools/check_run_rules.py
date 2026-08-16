"""Break each rule about runs on purpose and check the generator says no.

    python tools/check_run_rules.py

A run of fence is the one thing in the scene laid by a loop rather than placed
piece by piece, so a bad number does not misplace an object — it walks a whole
line across the road. The rules that stop that are only worth what they catch,
and a rule that has never fired guarantees nothing. So each one is broken here
and the generator has to refuse the result.

Two shapes of failure are both accepted: a violation from the validator, and a
SystemExit from the builder. Which one a rule uses is a judgement about when it
can be known — an unknown axis is a broken spec and dies at once, a segment on
the road is only visible once the line has been laid.
"""

import copy
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

import generate_layout as G          # noqa: E402


def crossing(spec):
    """The one rule the spec cannot express.

    `from_dx`/`to_dx` are distances from the road and the sign comes from
    `side`, so no authored run can straddle the axis. The check is a guard on
    the output rather than a live constraint — which is exactly how it has to be
    tested: on a built layout, with a segment moved across.
    """
    layout = G.Builder(copy.deepcopy(spec)).build()
    for o in layout["biomes"]["village"]["sprites"]:
        if o.get("_run") and o["pos"][0] > 0:
            o["pos"][0] = -o["pos"][0]
            break
    return G.validate(layout, spec)


CASES = [
    ("забор лезет на дорогу",
     lambda d: (d["biomes"]["village"]["runs"][0].update({"lane": "sign"}),
                d["global"]["lanes"].update({"sign": 1.5}))),
    # clear of the road but inside the near lane, so it is the yard rule that
    # answers and not the road rule
    ("поперечная секция у дороги",
     lambda d: d["biomes"]["village"]["runs"][2].update({"from_dx": 6.0,
                                                         "to_dx": 7.0})),
    ("поперечная секция длиннее трёх сегментов",
     lambda d: d["biomes"]["village"]["runs"][2].update({"to_dx": 24.0})),
    ("ось не вдоль и не поперёк",
     lambda d: d["biomes"]["village"]["runs"][0].update({"axis": "y"})),
    ("такта-владельца нет в ритме",
     lambda d: d["biomes"]["village"]["runs"][0].update({"owner_tact": 99})),
    ("отрезок на оси дороги",
     lambda d: d["biomes"]["village"]["runs"][0].update({"side": "C"})),
]


def main():
    spec = json.loads((ROOT / "assets" / "scene_spec.json").read_text(encoding="utf-8"))

    clean = G.validate(G.Builder(copy.deepcopy(spec)).build(), spec)
    if clean:
        print("боевой spec уже нарушает правила:")
        for m in clean:
            print("   ", m)
        raise SystemExit(1)
    print("боевой spec: чисто")

    ok = 0
    cases = CASES + [("отрезок по обе стороны дороги", None)]
    for name, breaker in cases:
        d = copy.deepcopy(spec)
        try:
            if breaker is None:
                bad = crossing(d)
            else:
                breaker(d)
                bad = G.validate(G.Builder(d).build(), d)
        except SystemExit as e:
            print(f"  падает   {name}\n             {str(e).splitlines()[0]}")
            ok += 1
            continue
        hits = [m for m in bad if "отрезок" in m]
        if hits:
            print(f"  ловит    {name}\n             {hits[0]}")
            ok += 1
        else:
            print(f"  ПРОПУЩЕНО {name} — правило не сработало")

    print(f"\n{ok}/{len(cases)} нарушений поймано")
    raise SystemExit(0 if ok == len(cases) else 1)


if __name__ == "__main__":
    main()
