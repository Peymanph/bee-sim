# HIVE — pixel bee colony sim

A side-view pixel-art bee colony living in a **hollow tree**, where the strategic
layer is played by **Queen Hermes**: doctrine and directives live in
`queen-orders.json`, and the command bar issues orders live.

Live: https://peymanph.github.io/bee-sim/

## The nest

The colony occupies a cavity chewed into a standing tree — no underground
tunnels. A founding swarm starts in a chamber low in the trunk with a fissure
through the bark as the flight entrance. The trunk tapers toward the crown, so
**comb slots that do not fit inside the wood are never built**: the hollow grows
with the colony, bark stays intact around it, and there is a hard ceiling on how
much comb a given tree can hold (~270 cells).

Foragers leave through the fissure and return by the same waypoints, so traffic
visibly streams in and out of the hole rather than clipping through the trunk.

## Biology model

Built on real honey-bee biology rather than arbitrary game rules.

| System | Modelled |
|---|---|
| **Caste by age** | < 1 d = cleaners, 1–12 d = nurses, 13–16 d = wax/stores, ≥ 17 d = foragers. Only mature bees can fly. |
| **Winter bees** | Autumn-emerging bees get a 95–140 day lifespan and stay in the nursing crew, which is what lets brood restart in early spring. |
| **Two food stores** | **Honey** = carbohydrate for adults and flight fuel. **Pollen** = protein, the only thing larvae can grow on. |
| **Larval rearing** | Only the larval stage eats: `0.70 pollen + 0.45 honey` per larva per day. Sealed pupae and eggs eat nothing and survive a starved colony. |
| **Nurse capacity** | One nurse keeps 6 larvae fed. Beyond that, extras stall and die after 2.6 days unfed (red cell). |
| **Behavioural plasticity** | If the young cohort runs short, mature workers **revert to nursing** (real honey-bee reflex). Without it a colony that loses one nurse generation could never lay again and would simply age out. |
| **Development** | egg 2.0 d → larva 4.5 d → pupa 7.0 d (real proportions 3 : 6 : 12, scaled for pace). |
| **Queen laying** | Gated on honey > 18 (or 30 % of the winter reserve), **pollen > 6**, empty cells, ≥ 2 effective nurses. Lays all year. |
| **Comb cells are finite** | Honey and pollen compete for free cells, so pollen hoarding directly costs honey capacity. |
| **Foraging triage** | If **both** stores are short the trips alternate nectar / pollen; otherwise cargo follows the deficit. A single-priority rule deadlocks one store against the other. |
| **Requeening** | If the queen dies, workers select a larva < 1.6 d old and raise an emergency queen cell. Colony recovers in 10 days. |
| **Seasons** | 30 days each, **and they are equal**: every season blooms (8 / 14 / 8 / 8 flowers), winter yields like spring, and the queen keeps laying through winter. Winter is harder only because of frost storms, not because it is empty. |
| **Threats** | Varroa each autumn (−18 % workers), optional prime swarm, honey exhaustion → **NEST FAILED**. |

## Job and personality

Every bee is drawn from two independent axes, and both change her behaviour.

**Job** (body colour — see the legend in the colony panel):

| Job | Colour | Behaviour |
|---|---|---|
| Cleaner | near-white | day 0–1, inside only |
| Nurse | pale cream | days 1–12, feeds larvae |
| Wax builder | sand | days 13–16, carries a white wax brick |
| Forager | yellow with heavy dark bands | flies the fissure route, carries a load pellet |
| Guard | amber | posted at the entrance; absorbs hornet-raid casualties |

**Personality** (head colour):

| Trait | Effect |
|---|---|
| `bold` | +18 % flight speed, ~60 % chance to survive a storm, volunteers for gate duty |
| `timid` | −12 % speed, more likely lost outside, refuses guard duty, stays home in storms |
| `diligent` | survives hazards at an above-average rate |
| `frugal` | smaller body, **consumes 22 % less honey** — a frugal cohort outlasts a famine |
| `social` | social nurses each feed 2 extra mouths |

Guards scale with the colony: a founding swarm cannot afford two bees on the
porch, so it fields one — or none — until it is mature.

## Weather hazards

Rolled every ~16–32 days, weighted by season. Duration, banner, colour tint,
particles and log line each:

| Hazard | Season | Effect |
|---|---|---|
| `THUNDERSTORM` | spring / summer | −10 % workers (bold bees mostly survive) |
| `DROUGHT` | summer | nectar regrowth cut to 30 % for 9 days |
| `HEATWAVE` | summer | adults burn 1.6× honey, larvae eat 1.6× and develop 30 % slower |
| `HORNET RAID` | autumn | losses fall from 17 % to 3 % as guards are added |
| `FROST STORM` | winter | falling snow, 1.8× burn, foraging halted, pollen regrowth stops |
| `BEAR ATTACK` | any | −22 % workers and 45 % of the comb torn out |

## Queen orders

Edit `queen-orders.json`, or type into the command bar:

```
forage .8        share of mature bees sent flying
brood .4         brood target relative to population
reserve 600      winter honey target the queen defends
swarm on|off     permit a prime swarm above 170 workers
build off        stop waxing new comb
speed 5          1x / 2x / 5x
haz bear         summon a hazard (demo / screenshots)
doctrine <text>  set the stated doctrine shown in the panel
```

URL parameters: `?start=180` fast-forwards 180 sim days, `?haz=frost` triggers a
hazard after the fast-forward. Both are used for demos and screenshots.

## Files

- `index.html` / `styles.css` — shell, HUD, role and trait legend
- `app.js` — simulation, renderer, queen-order parser
- `queen-orders.json` — the standing doctrine
- `test-headless.js` — runs ~525 sim days in Node with canvas stubs, asserts no crash

```sh
node test-headless.js
```

The suite has been run across many seeds; all reach day 525 (five sim years)
without a collapse.
