# Local Robot Sim

A browser-based robot simulator you can run without installing ROS, Gazebo, or MuJoCo. Edit Python controllers and URDF robots, hit save, and watch the sim update — all locally in your browser.

**Stack:** Rapier 3D (physics) · Three.js (rendering) · Pyodide (Python controllers)

---

## What is this?

Local Robot Sim is a lightweight sandbox for prototyping robot behavior. You drop in a simulation folder, write control logic in Python, and iterate in real time. No native installs, no cloud dependency — just a modern web app that runs entirely client-side.

Each **simulation** is a self-contained scenario: an environment, a robot, and a controller working together.

---

## End goal

The long-term vision is a **modular simulation platform** where creators can share and mix assets independently:

| Asset | What it is | Shareable as |
|-------|------------|--------------|
| **Environment** | Rooms, terrain, obstacles, physics settings | `env/world.yaml` |
| **Bot** | Robot geometry and drive model (URDF) | `bot/robot.urdf` |
| **Simulation** | A scenario that composes env + bot + controller | A folder under `simulations/` |

Today each simulation bundles its own env and bot in one folder. The engine already loads them as separate modules — the foundation for a future asset library where you pick a room, pick a robot, and run.

---

## Quick start

**Requirements:** Node.js 18+ and a Chromium-based browser (Chrome, Edge, Arc)

```bash
git clone https://github.com/alphatrait/local-robot-sim.git
cd local-robot-sim
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) and select **Modular env + bot demo** from the simulation dropdown in Settings.

Or jump straight to it:

```
http://localhost:5173/?root=simulations/modular-demo
```

---

## Running simulations

Three ways to load a simulation:

### 1. Bundled examples (fastest)

Built-in simulations ship with the app. Select one from the **Simulation** dropdown in the Settings tab, or pass a URL param:

```
http://localhost:5173/?root=simulations/modular-demo
```

### 2. Local folder sync (live editing)

Best for active development — changes on disk reload automatically.

1. Open the **Settings** tab
2. Set **Sync mode** to **Local folder**
3. Click **Pick project folder** and select the repo root
4. Set **Project root** to e.g. `simulations/modular-demo`
5. Edit files, save, and the sim reloads within ~500 ms

### 3. GitHub sync (share via URL)

Pull simulations from any public GitHub repo:

```
http://localhost:5173/?repo=alphatrait/local-robot-sim&root=simulations/modular-demo
```

Optional: `&branch=main`

---

## Simulation folder layout

Modular simulations (v2) follow this structure:

```
simulations/my-sim/
├── sim.yaml                 # Scenario config — spawn, controller, physics rate
├── env/
│   └── world.yaml           # Environment — gravity, ground, obstacles
├── bot/
│   ├── robot.urdf           # Robot definition
│   └── robot.yaml           # Optional — drive model, metadata
└── controllers/
    └── main.py              # Python controller
```

### Default paths (override in sim.yaml if needed)

| Key | Default |
|-----|---------|
| `environment` | `env/world.yaml` |
| `robot` | `bot/robot.urdf` |
| `controller.path` | `controllers/main.py` |

**Who owns what:**

- **Environment** — gravity, friction, ground size, static obstacles
- **Simulation (`sim.yaml`)** — spawn pose, controller, physics tick rate
- **Bot** — URDF geometry; optional `drive_model` (`auto`, `diff_drive`, `articulated`)

### Example: sim.yaml (v2)

```yaml
version: 2

spawn:
  position: [0, 0.05, 0]

controller:
  path: controllers/main.py

simulation:
  physics_hz: 60
```

### Example: env/world.yaml

```yaml
version: 1
name: my-room

physics:
  gravity: [0, -9.81, 0]
  friction: 0.8

ground:
  size: [20, 20]

static_bodies:
  wall_north:
    shape: box
    size: [8, 2, 0.2]
    position: [0, 1, -4]
```

### Example: Python controller

Controllers must define `init(sim)` and `step(sim, dt)`:

```python
def init(sim):
    sim.log("ready")

def step(sim, dt):
    sim.set_joint_velocity("left_wheel_joint", 4.0)
    sim.set_joint_velocity("right_wheel_joint", 4.0)
```

Available on `sim`: `log()`, `time()`, `get_body_pose(id)`, `get_joint_states()`, `set_joint_velocity(name, vel)`.

---

## Included examples

| Simulation | Path | Description |
|------------|------|-------------|
| Modular env + bot demo | `simulations/modular-demo` | v2 layout — separate env and bot, includes a wall obstacle |
| Differential drive box | `simulations/diff-drive` | Legacy v1 layout — single bundled robot on flat ground |

---

## Development

```bash
npm run dev       # Start dev server with hot reload
npm run build     # Type-check + production build
npm run preview   # Serve production build locally
```

### Project structure

```
local-robot-sim/
├── src/
│   ├── main.ts           # Three.js UI + scene
│   ├── sim.worker.ts     # Rapier physics + Pyodide loop
│   ├── sim-loader.ts     # Loads simulation bundles
│   ├── world-rapier.ts   # Environment → physics
│   ├── world-visuals.ts  # Environment → visuals
│   └── urdf-*.ts         # URDF → Rapier + visuals
├── simulations/          # Example simulation folders
├── examples.yaml         # Simulation registry
└── index.html
```

---

## Roadmap

- [ ] Shared asset library UI (pick env + bot from catalog)
- [ ] Cross-simulation asset references
- [ ] Multi-robot scenarios
- [ ] Additional environment formats (GLTF, SDF)
- [ ] Mesh collision and visuals

---

## License

Private — see repository owner for usage terms.
