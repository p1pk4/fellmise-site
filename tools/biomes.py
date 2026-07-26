"""Biome definitions for the scroll journey.

One entry per full-screen section, in scroll order. Kept apart from
build_site.py so the composition can be read and edited without wading through
markup.

Sprite tuple: (class suffix, sprite file, parallax depth, mobile-hidden, iso).
  depth   — parallax factor; 0 pins the sprite to the ground plane.
  iso     — the sprite is drawn in isometric projection, so its contact shadow
            is a skewed ellipse under the base rather than a flat one. Mixing
            the two is what makes objects look like they float.

`gate` is the doorway the next biome is entered through (None on the last).
"""

BIOMES = [
    dict(
        id="village", ground="village", clock=True, road=True,
        en="The village", ru="Деревня",
        sprites=[
            ("house-b", "hero_house_b", 0.04, False, False),
            ("tree-a", "hero_tree_a", 0.09, False, False),
            ("well", "hero_well", 0.06, False, False),
            ("house-a", "hero_house_a", 0.05, False, True),
            ("tree-b", "hero_tree_b", 0.11, True, False),
            ("crates", "prop_crates", 0.13, True, True),
            ("lantern", "prop_lantern", 0.14, True, False),
            ("signpost", "prop_signpost", 0.16, False, False),
            ("stones-verge", "prop_stones", 0.18, True, False),
        ],
        cards=["world"],
        gate=dict(art="hero_house_b", en="Into the house", ru="В дом"),
    ),
    dict(
        id="forest", ground="forest",
        en="The forest", ru="Лес",
        sprites=[
            ("pine-b", "biome_pine_b", 0.05, False, False),
            ("deadtree", "biome_deadtree", 0.08, True, False),
            ("pine-a", "biome_pine_a", 0.10, False, False),
            ("stump", "biome_stump", 0.15, False, False),
        ],
        cards=["skills", "craft"],
        gate=dict(art="biome_orevein", en="Into the mine", ru="В шахту"),
    ),
    dict(
        id="mine", ground="mine", dark=True,
        en="The mine", ru="Шахта",
        sprites=[
            ("orevein", "biome_orevein", 0.05, False, False),
            ("crystals", "biome_crystals", 0.09, False, False),
            ("mining", "feat_mining", 0.07, True, True),
            ("brazier", "biome_brazier", 0.16, False, False),
        ],
        cards=["pvp", "mining"],
        gate=dict(art="biome_portal", en="Through the portal", ru="В портал"),
    ),
    dict(
        id="spirit", ground="spirit", dark=True,
        en="The spirit world", ru="Мир духов",
        sprites=[
            ("ship", "feat_death_alt", 0.05, True, True),
            ("vendetta", "feat_vendetta", 0.08, False, False),
            ("crypt", "feat_death", 0.06, False, True),
            ("deadtree2", "biome_deadtree", 0.12, True, False),
            ("brazier2", "biome_brazier", 0.17, False, False),
        ],
        cards=["death", "vendetta"],
        gate=dict(art="feat_death", en="Through the crypt door", ru="В дверь склепа"),
    ),
    dict(
        id="home", ground="home", dusk=True, resources=True, cta=True,
        en="Home", ru="Дом",
        sprites=[
            ("house-b2", "hero_house_b", 0.05, False, False),
            ("tree-a2", "hero_tree_a", 0.09, True, False),
            ("house-a2", "hero_house_a", 0.04, False, True),
            ("lantern2", "prop_lantern", 0.14, False, False),
        ],
        cards=["home", "factions"],
        gate=None,
    ),
]
