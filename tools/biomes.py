"""Biome definitions for the scroll journey.

One entry per full-screen section, in scroll order.

BASELINE ROWS. Every biome has three ground lines expressed as a share of the
scene band. A sprite names the row it stands on; its FOOT is pinned to that
line and its scale comes from the row, not from a hand-tuned height:

    row 0 (far)   bottom 34%   scale 0.85
    row 1 (mid)   bottom 22%   scale 1.00
    row 2 (near)  bottom  8%   scale 1.15

Hand-set heights are what made the earlier scenes look like objects standing at
random depths — nothing shared a horizon. With rows, depth is decided once and
z-order follows the row, so a near object cannot end up behind a far one.
`?debug=rows` draws the lines.

Sprite tuple: (class suffix, sprite file, row, base height %, mobile-hidden, iso)
  base height % — height at scale 1.0, as a share of the scene band; the row
                  multiplier is applied on top.
  iso           — isometric projection, so the contact shadow is skewed.

`gate` is the doorway the next biome is entered through (None on the last).
`door` marks a gate whose art has a separate hinged door layer.
"""

ROWS = [
    dict(bottom=34, scale=0.85, z=1),
    dict(bottom=22, scale=1.00, z=3),
    dict(bottom=8,  scale=1.15, z=5),
]

BIOMES = [
    dict(
        id="village", ground="village", clock=True, road=True, atmos=True,
        en="The village", ru="Деревня",
        sprites=[
            ("house-b", "hero_house_b", 0, 62, False, False),
            ("tree-a", "hero_tree_a", 1, 52, False, False),
            ("well", "hero_well", 1, 38, False, False),
            ("house-a", "hero_house_a", 1, 64, False, True),
            ("tree-b", "hero_tree_b", 0, 24, True, False),
            ("crates", "prop_crates", 1, 24, True, True),
            ("lantern", "prop_lantern", 2, 30, True, False),
            ("signpost", "prop_signpost", 2, 26, False, False),
            ("stones-verge", "prop_stones", 1, 11, True, False),
        ],
        cards=["world"],
        gate=dict(art="hero_house_b", door=True, en="Into the house", ru="В дом"),
    ),
    dict(
        id="forest", ground="forest",
        en="The forest", ru="Лес",
        sprites=[
            ("pine-b", "biome_pine_b", 0, 66, False, False),
            ("deadtree", "biome_deadtree", 0, 54, True, False),
            ("pine-a", "biome_pine_a", 1, 68, False, False),
            ("stump", "biome_stump", 2, 22, False, False),
        ],
        cards=["skills", "craft"],
        gate=dict(art="biome_orevein", en="Into the mine", ru="В шахту"),
    ),
    dict(
        id="mine", ground="mine", dark=True,
        en="The mine", ru="Шахта",
        sprites=[
            ("orevein", "biome_orevein", 0, 64, False, False),
            ("crystals", "biome_crystals", 1, 50, False, False),
            ("mining", "feat_mining", 1, 42, True, True),
            ("brazier", "biome_brazier", 2, 28, False, False),
        ],
        cards=["pvp", "mining"],
        gate=dict(art="biome_portal", en="Through the portal", ru="В портал"),
    ),
    dict(
        id="spirit", ground="spirit", dark=True,
        en="The spirit world", ru="Мир духов",
        sprites=[
            ("ship", "feat_death_alt", 0, 56, True, True),
            ("deadtree2", "biome_deadtree", 0, 44, True, False),
            ("vendetta", "feat_vendetta", 1, 54, False, False),
            ("crypt", "feat_death", 1, 56, False, True),
            ("brazier2", "biome_brazier", 2, 26, False, False),
        ],
        cards=["death", "vendetta"],
        gate=dict(art="feat_death", door=True, en="Through the crypt door", ru="В дверь склепа"),
    ),
    dict(
        id="home", ground="home", dusk=True, resources=True, cta=True,
        en="Home", ru="Дом",
        sprites=[
            ("house-b2", "hero_house_b", 0, 60, False, False),
            ("tree-a2", "hero_tree_a", 0, 48, True, False),
            ("house-a2", "hero_house_a", 1, 62, False, True),
            ("lantern2", "prop_lantern", 2, 28, False, False),
        ],
        cards=["home", "factions"],
        gate=None,
    ),
]
