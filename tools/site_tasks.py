"""Task list for the fellmise.com art pack (v1 battle preset).

Scope is bounded by LORA_PLAN's "граница применимости v1": static objects and
buildings only. Characters, creatures, faction portraits, battle scenes and
gridded UI icons are deliberately absent — those slots wait for a v2 dataset.

Two tasks are flagged EXOTIC: they sit outside the six task types v1 was
accepted on, so a collapse toward "building" is a known risk. They are
generated like anything else; if all four seeds fail they are dropped from the
pack and reported as v2 dataset candidates rather than re-prompted here.
"""

SEEDS = [1001, 2002, 3003, 4004]

# (id, object phrase, exotic?)
TASKS = [
    # --- hero composition: sprites the site assembles into a panorama --------
    ("hero_house_a", "medieval cottage with red tiled roof and cream walls", False),
    ("hero_house_b", "large farmhouse with red tiled roof, wooden door", False),
    ("hero_tree_a", "large oak tree with dense green foliage", False),
    ("hero_tree_b", "small bush with pink flowers", False),
    ("hero_fence", "wooden fence section with posts", False),
    ("hero_well", "stone water well with wooden roof", False),
    ("hero_cart", "wooden merchant cart with goods", False),

    # --- features: one object per site section -------------------------------
    ("feat_skills", "wooden weapon rack with sword, bow and staff", False),
    ("feat_mining", "rocky ore vein with glowing blue diamond crystals", False),
    ("feat_craft", "blacksmith anvil with hammer and glowing forge", False),
    ("feat_pvp", "war banner on wooden pole with torn red flag", False),
    ("feat_death", "old stone gravestone with candles and moss", False),
    ("feat_death_alt", "ghostly wooden ship with tattered sails", True),
    ("feat_vendetta", "dark monster totem with bones and horns", True),
    ("feat_world", "market stall with awning, crates and barrels", False),
    ("feat_tavern", "tavern building with hanging sign and warm windows", False),

    # --- resources / gathering: pictograms for the mining & crafting sections -
    ("res_iron", "iron ore chunk", False),
    ("res_gold", "gold ore chunk with yellow veins", False),
    ("res_diamond", "cluster of blue diamond crystals", False),
    ("res_wood", "stack of chopped logs", False),
    ("res_herbs", "bundle of green herbs tied with string", False),
    ("res_fish", "wooden barrel full of fish", False),
    ("res_pickaxe", "iron pickaxe", False),
    ("res_sword", "steel sword", False),
    ("res_bow", "wooden bow with quiver of arrows", False),
    ("res_potion", "glass potion bottle with red liquid", False),
]

EXOTIC = {tid for tid, _, ex in TASKS if ex}
