# Asteroids Codex 5.5

An arcade-first Asteroids variant built for GitHub Pages as a static browser game.

## What changed

- Codex 5.5 presentation and HUD shell
- Adaptive encounter director with escalating threat states
- Focus meter and Overdrive mode for short burst dominance
- Mobile-friendly touch controls layered over the canvas
- Zero-build deployment: push the repo and serve from GitHub Pages

## Play locally

Any static server works. For example:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/`.

## Controls

- `Left / Right` or `A / D`: rotate
- `Up` or `W`: thrust
- `Space`: fire
- `Enter`: trigger Overdrive when Focus is full
- `Shift` or `H`: hyperspace
- `P` or `Esc`: pause

## Deploy on GitHub Pages

1. Push the repository to GitHub.
2. In repository settings, enable GitHub Pages from the `main` branch and `/ (root)`.
3. Visit `https://marcoakes.github.io/asteroids-codex-5-5/`.
