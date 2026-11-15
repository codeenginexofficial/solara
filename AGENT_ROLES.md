# SOLARA Agent Roles & Operating Instructions

**Project:** SOLARA — NASA Space Apps Challenge 2026  
**Repository:** `codeenginexofficial/solara`  
**Expected local checkout:** `C:\Users\aas03\Desktop\Solara`  
**Submission deadline:** Sunday, November 15, 2026, 11:59 PM East Africa Time (EAT)

> This file defines who owns each task, which model should do it, and the rules every agent must follow. Read this file and `AGENT_COORDINATION.md` before making changes.

---

## 1. Mission and definition of done

SOLARA is a Martian exploration and mission-planning platform. It should help a user orient themselves on Mars, inspect real scientific datasets, understand local terrain and environmental observations, inspect rover imagery, and plan a preliminary traverse.

The submission should demonstrate a coherent, working scientific workflow—not merely a visually impressive dashboard.

A feature is **not complete** because a component renders. It is complete only when:

1. It uses the correct data source and coordinate reference system.
2. Its behavior works in the running application.
3. It represents unavailable or stale data honestly.
4. It does not break existing working map functionality.
5. Its changes have been checked with the relevant tests/build or a documented manual test.
6. Its source, limitations, and attribution are documented where relevant.

## 2. Agent roster and ownership

### Agent A — Codex / GPT-6 (Luna selection in Codex)

**Role:** Technical lead, globe implementation, backend architecture, and final integration.  
**Primary responsibility:** Own the shared architecture and make the separate contributions work together.

**Tasks**

- Inspect the repository, current Git state, existing application architecture, scripts, data flow, and current map implementation before editing.
- Establish a baseline: identify the correct package manager and run the existing build/type-check commands where practical. Record existing failures separately from new failures.
- Design and implement the interactive 3D Mars globe as the planetary-orientation entry experience, then connect it to the existing detailed surface map for Jezero Crater.
- Preserve the working OpenLayers surface map, Mars projection definitions, CTX/Viking/other valid data services, layer controls, and map lifecycle. Do not replace a working surface map just to add a globe.
- Choose the lowest-risk globe implementation that fits the current stack. Evaluate the existing dependencies and Mars-specific projection/imagery requirements before introducing a large library. Do not assume an Earth globe can be relabelled as Mars.
- Own backend API contracts, server-side orchestration, authentication/secrets handling, and integration of DeepSeek's isolated scientific services.
- Own the actual integration/loading of the scientific assistant's `INSTRUCTIONS.md` into the server-side system prompt. A file that is not loaded by the running application is not an implementation.
- Coordinate the DeepSeek backend contributor through `AGENT_COORDINATION.md`; review its interfaces and integrate the contribution without duplicating its work.
- Review the UI agent's changes for compatibility; do not unnecessarily rewrite its components.
- Own final integration, final build/type-check, and the final Git checkpoint/commit if the working tree is coherent.

**Owns conceptually**

- Globe component and globe-to-surface-map transition.
- Shared map/globe integration and projection decisions.
- Backend API entry points and orchestration.
- OpenRouter server-side request path and tool-call dispatch.
- Loading and applying `INSTRUCTIONS.md` to the assistant.
- Shared package/dependency changes and shared types/contracts.

**Must coordinate before editing**

- Shared app shell, route state, map controller, global styles, package manifests/lockfiles, shared API routes, shared types, and any file already claimed by another agent.

**Must not**

- Build fake NASA telemetry or fabricated observations.
- expose OpenRouter/NASA credentials in browser code, source files, logs, screenshots, or documentation.
- claim that a preliminary route is astronaut-certified or safe.
- delete or rewrite the existing surface-map implementation without proving it is broken and recording the reason.
- push, deploy, publish, alter production services, or run destructive Git commands unattended.

### Agent B — OpenCode / GLM-5.3-Flash

**Role:** UI cleanup and visual refinement.  
**Primary responsibility:** Fix the visible interface problems in the supplied screenshots without changing scientific/backend logic.

**Tasks**

1. Trace the grayscale/white square overlay visible in the map screenshot to the exact layer/source that renders it. The CTX layer is a suspect because it is enabled in the screenshot, but do not assume it is definitely the cause. Verify which layer actually creates the patch before removing anything.
2. Remove CTX Imagery from the user-facing layer list and stop enabling/rendering that layer if it is confirmed to be the unwanted overlay. Preserve any reusable CTX service code that other parts of the application still require. If a different layer creates the square, report that finding and remove/fix the actual broken overlay instead.
3. Remove the `PDS Unavailable` diagnostic chip/card and other developer-facing diagnostic/status cells from the main user interface. Keep detailed errors in logs or developer diagnostics, not as ugly permanent UI objects.
4. Remove or replace technical placeholder labels such as raw provider failure messages. For genuine user-relevant missing data, use a compact, contextual empty state only where the user needs it.
5. Reduce the `Compute Route` typography weight. Target approximately `font-weight: 500` (or the nearest existing design token), not heavy/bold styling.
6. Correct inconsistent typography and controls visible in the screenshots, including zoom controls, without redesigning the whole product.
7. If Codex supplies a globe mount point/component contract, style the surrounding shell and controls only. Do not implement or alter globe projection, imagery, or map-engine lifecycle.

**Owns conceptually**

- Layer-panel presentation and labels.
- Removal of user-visible diagnostic clutter.
- Compute Route typography and small visual refinements.
- Globe container/shell presentation only after Codex defines the component interface.

**Must not**

- Change NASA data providers, scientific calculations, backend APIs, map projections, coordinate conversions, rover logic, or route algorithms.
- Make broad changes to the global design system or unrelated screens.
- Remove a layer merely because its label appears suspicious; trace the actual rendered layer first.
- change package manifests/lockfiles without asking Codex and recording the request in the coordination file.

### Agent C — OpenCode / DeepSeek-V4.1-Flash

**Role:** Scientific backend/data-services contributor working in coordination with Codex.  
**Primary responsibility:** Implement isolated, deterministic scientific data adapters and calculations that Codex can wire into the backend.

**Tasks**

- Inspect existing data integrations and identify what is already implemented. Reuse working source adapters; do not create duplicate APIs.
- Propose a small, typed tool/service contract for the scientific assistant before implementation. Record the contract in `AGENT_COORDINATION.md` and wait for Codex's acknowledgement if it touches a shared API/router/type.
- Implement isolated service modules for the highest-value capabilities supported by the actual repository/data:
  - MEDA observation retrieval, with source timestamp, instrument/measurement metadata, units, and geographic/temporal coverage.
  - DEM elevation sampling where an actual DEM is available.
  - Deterministic slope calculation from neighbouring DEM samples, using correct horizontal distance units and handling missing/no-data cells.
  - Dataset availability/coverage lookup for a coordinate.
  - Rover-location and rover-image metadata adapters only if the actual source integration already exists or can be added safely.
- Return structured results with value, units, coordinates, source, observation timestamp or sol where available, spatial resolution where known, and quality/availability metadata.
- Add focused tests for coordinate handling, no-data cells, unit conversions, slope calculations, missing coverage, and stale/missing observations.
- Hand Codex exact exported function names, input/output types, data-source URLs, assumptions, limitations, and test results.

**Suggested tool names (contracts, not permission to fake features)**

- `get_meda_observations`
- `get_terrain_elevation`
- `calculate_slope`
- `get_dataset_coverage`
- `get_nearby_rovers`
- `get_rover_imagery`

Only expose a tool when its underlying data source or calculation really works. A proposed tool is not evidence that the capability exists.

**Scientific constraints**

- MEDA observations are measurements made by an instrument at its actual location and time. Do not present them as live weather at every Mars coordinate.
- Do not interpolate, extrapolate, or generalize observations unless the method is explicit, justified, and labelled.
- A slope result must be computed from real elevation samples. Never let the language model guess a slope.
- Use Mars-specific coordinate conventions and record the convention used by each dataset. Do not blindly assume latitude/longitude axis order or east/west longitude sign.
- Return `unavailable`, `outside_coverage`, or `no_data` explicitly rather than inventing values.
- A terrain-aware route is preliminary decision support, not a certified safe route.

**Owns conceptually**

- New, isolated scientific service/adapter modules.
- Deterministic DEM/slope algorithms and focused tests.
- Service-level types confined to those modules until Codex integrates them.

**Must not**

- Edit shared backend routers, app shell, globe/map engine, package manifests/lockfiles, global types, or system prompt without agreement from Codex.
- make UI changes.
- commit, push, deploy, change production data, or alter live database state.

### Agent D — GitHub Copilot CLI

**Role:** Documentation and small, explicitly delegated helper tasks.  
**Primary responsibility:** Improve submission documentation and provide small support changes assigned by Codex or another owner.

**Initial tasks**

1. Scan the repository and create/update `SOURCES.md` using only sources actually used by the code or explicitly configured in the project. Include source name, exact URL, what it provides, where/how it is used, attribution/licensing notes, and whether it is implemented or merely proposed.
2. Review/update `README.md` so it accurately explains SOLARA, setup, the actual implemented features, data sources, limitations, and the demonstration workflow.
3. Review existing project documentation for inconsistencies with the actual implementation. Do not claim that unfinished capabilities work.
4. Prepare a concise list of any missing attribution, setup, or submission documentation.

**Helper-task policy**

- Other agents may assign Copilot a small task by adding a specific entry to `AGENT_COORDINATION.md` with an owner, files allowed, acceptance criteria, and deadline.
- Copilot must not begin an unscoped code task. It must acknowledge the assignment in the coordination log first.
- Prefer documentation, tests, small isolated fixes, and source attribution. Do not take over globe, map, or backend architecture.

**Owns conceptually**

- `SOURCES.md`.
- `README.md` and documentation sections explicitly assigned to it.
- Small isolated helper changes explicitly assigned and recorded.

**Must not**

- change core globe/map/backend logic on its own initiative.
- edit `AGENT_ROLES.md` or overwrite `AGENT_COORDINATION.md`.
- add dependencies, change package manifests/lockfiles, or change environment configuration unless Codex explicitly assigns it.
- expose secrets or claim that an unused source is integrated.

---

## 3. Shared operating rules — all agents

### Before touching code

1. Read `AGENTS.md` if it exists, then read this file and `AGENT_COORDINATION.md`.
2. Run `git status --short` and inspect existing uncommitted changes. Never assume they belong to you. Never revert them to make the tree clean.
3. Inspect the actual source before deciding what to change. Do not invent file paths, APIs, datasets, functions, model IDs, or scripts.
4. Record your intended task, expected files, and acceptance criteria in the coordination file before editing.
5. Check file ownership. If another agent owns a file, request a handoff instead of editing it.

### Working together in the shared checkout

All agents are expected to work in the same SOLARA checkout so they can read one another's code and the shared coordination log. This is intentional, but it requires strict file ownership.

- Do not edit a file owned by another agent without an explicit handoff.
- Do not run formatting across the entire repository.
- Do not change `package.json` or the lockfile unless Codex has approved and is coordinating the dependency change.
- Do not run migrations or scripts that modify production data.
- Do not commit while another agent is actively editing. Codex owns the final checkpoint/commit after the other agents report their work complete.
- If tasks collide, stop editing the contested file and record the conflict. Do not race to overwrite the other agent.

### Permissions and unattended execution

Agents may work autonomously **inside the SOLARA project folder**: read/search files, edit their assigned files, create tests/docs, run local development/build/type-check/test commands, and access public documentation when the environment allows it.

This does **not** authorize unrestricted access to the whole computer or account. The following actions are prohibited unless Abdullah explicitly approves them in a later, attended session:

- `git push`, force-push, publishing a release, deploying, or changing production services.
- `git reset --hard`, `git clean -fdx`, deleting branches, mass deletion, or destructive filesystem commands.
- reading, copying, printing, or committing `.env`, `.dev.vars`, credentials, tokens, private keys, browser profiles, or unrelated files outside the repository.
- putting API keys in client-side code, screenshots, logs, source control, or documentation.
- changing live Supabase/Cloudflare/NASA service data or running production migrations.
- making paid API calls or installing large new dependencies without recording the reason and expected cost.

Never use a blanket `--yolo`, `--allow-all`, `--dangerously-bypass-approvals-and-sandbox`, or equivalent unrestricted mode just to avoid a prompt while the owner is away. Use project-scoped write access. If a command is blocked by a sandbox, record the blocker; do not disable the sandbox globally.

### Scientific integrity

- Never fabricate a NASA observation, rover location, image, dataset coverage, elevation, slope, temperature, humidity, wind reading, route result, or citation.
- Preserve the coordinate reference system and axis/sign convention of every data source.
- Distinguish measured, derived, estimated, cached, stale, and unavailable values.
- Attach provenance to scientific values: source, timestamp/sol if available, units, location, and resolution/coverage where known.
- Never imply that model-generated prose is itself a scientific measurement.
- State uncertainty and limitations in the UI and documentation.

### Validation and reporting

- Use the package manager already indicated by the repository lockfile.
- Inspect available scripts before running commands. Do not invent script names.
- Run the narrowest useful tests first, then the project build/type-check if available.
- Report the exact commands run and whether they passed. Separate pre-existing failures from failures caused by your changes.
- Do not claim a feature works based only on static code inspection.
- Update `AGENT_COORDINATION.md` with files changed, tests, outcome, remaining issues, and handoff information.

## 4. Priority order for the deadline

1. Preserve a buildable application and the working Mars surface map.
2. Implement the interactive Mars globe and a reliable transition to detailed surface exploration.
3. Remove the broken imagery overlay and requested diagnostic clutter; fix `Compute Route` typography.
4. Connect only real, verifiable scientific tools to the assistant; prioritize MEDA/DEM/slope capabilities supported by available data.
5. Load `INSTRUCTIONS.md` into the actual assistant backend and render mathematical Markdown with KaTeX if safely achievable.
6. Coordinate lookup is a useful small enhancement, but it is lower priority than the globe, real data, and stable submission. Implement it only if the core work is already stable.
7. Finish `SOURCES.md`, `README.md`, smoke testing, and submission materials.

If time is short, reduce scope honestly instead of shipping fake or broken functionality.
