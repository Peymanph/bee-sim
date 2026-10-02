# HIVE — pixel bee colony sim

A side-view pixel-art bee colony where the strategic layer is played by **Queen Hermes**:
doctrine and directives live in `queen-orders.json`, and the command bar issues orders live.

Live: https://peymanph.github.io/bee-sim/

## Biology model

The simulation is built on real honey-bee biology rather than arbitrary game rules.

| System | Modelled |
|---|---|
| **Caste by age** | Bees < 1 day = cleaners, 1–12 d = nurses, 13–16 d = wax/stores, ≥ 17 d = foragers. Only mature bees can fly out. |
| **Winter bees** | Autumn-emerging bees get a 95–140 day lifespan and stay in the nursing crew, which is what lets brood restart in early spring. |
| **Two food stores** | **Honey** = carbohydrate for adults and flight fuel. **Pollen** = protein, the only thing larvae can grow on. |
| **Larval rearing** | Only the larval stage eats: `0.70 pollen + 0.45 honey` per larva per day. Sealed pupae and eggs eat nothing and survive a starved colony. |
| **Nurse capacity** | One nurse keeps 6 larvae fed. Beyond that, extras stall and die after 2.6 days unfed (red cell). |
| **Development** | egg 2.0 d → larva 4.5 d → pupa 7.0 d (real proportions 3 : 6 : 12, scaled for pace). |
| **Queen laying** | Gated on honey reserve, **pollen > 8**, empty cells, ≥ 2 nurses, and no winter laying. Brood target scales with `broodPriority`. |
| **Comb cells are finite** | Honey and pollen compete for free cells, so pollen hoarding directly costs honey capacity. |
| **Foraging triage** | Foragers choose cargo by need: nectar while honey is below the reserve floor, pollen only once honey is safe. |
| **Requeening** | If the queen dies, workers select a larva < 1.6 d old and raise an emergency queen cell (needs nurses, honey > 25, pollen > 8). Colony recovers in 10 days. |
| **Seasons** | 30 days each. Winter: no flowers, no laying, cluster burns stores. Drones are raised in spring/summer and evicted in autumn. |
| **Threats** | Varroa outbreak each autumn (−18 % workers), optional prime swarm, starvation collapse → **NEST FAILED**. |

## Queen orders

Edit `queen-orders.json`, or type into the command bar:

```
forage .8      share of mature bees sent flying
brood .4       brood target relative to population
reserve 600    winter honey target the queen defends
swarm on|off   permit a prime swarm above 170 workers
build off      stop waxing new comb
speed 5        1x / 2x / 5x
doctrine <text>  set the stated doctrine shown in the panel
```

`?start=180` fast-forwards 180 sim days (used for demos).

## Files

- `index.html` / `styles.css` — shell and HUD
- `app.js` — simulation, renderer, queen-order parser
- `queen-orders.json` — the standing doctrine
- `test-headless.js` — runs ~525 sim days in Node with canvas stubs, asserts no crash

```sh
node test-headless.js
```
