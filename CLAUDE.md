# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `graphify update .` to keep the graph current (AST-only, no API cost)

## Next.js Web App

The web app lives in `web/`. **Before writing any Next.js code**, read the notice in `web/AGENTS.md` — this is Next.js 16 with breaking changes from standard Next.js.

Key Next.js 16 rules already applied to this codebase:
- `params` and `searchParams` in page components are `Promise` — always `await` before use
- Auth proxy is `proxy.ts` / `export function proxy()` — NOT `middleware.ts` / `middleware`
- `cookies()` is async — already handled in `lib/supabase/server.ts`

```bash
# From web/
npm run dev      # dev server at localhost:3000
npm run build    # production build
npm run lint     # ESLint (runs eslint directly, not next lint)
```

Env vars required (`web/.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Mobile App (Expo)

The mobile app lives in `mobile/`. Uses Expo SDK 56 + Expo Router v6.

```bash
# From mobile/
npx expo start --clear    # start dev server (scan QR with Expo Go)
eas build --profile development --platform ios   # build dev client (needs Apple Developer account)
```

Env vars in `mobile/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`

**Known working versions**: `react@19.2.3`, `@types/react@~19.2.0` — `react@19.1.0` caused runtime crashes (fixed by bumping).

**Expo Go limitations** (features requiring EAS dev client build):
- Voice recording (`@react-native-voice/voice`) — mic button hidden in Expo Go, shown after dev client
- Background geofencing (`expo-location` background tasks)

**GitHub Actions build pipeline** (free, no Apple Developer account):
- `.github/workflows/build-ios.yml` — runs on push to main when `mobile/` changes
- `expo prebuild` → `xcodebuild` (unsigned) → `.ipa` artifact
- Download artifact → drag into AltStore → signs with free Apple ID → installs on iPhone
- AltStore re-signs every 7 days automatically over WiFi

## CI Build Breakage: expo-av vs SDK 56 (runs 39–83, June 2026) — RESOLVED run 83

**Root cause — why build 38 worked and 39+ didn't**: run 38 (commit `e9b28b0`) was the
last build WITHOUT expo-av. Run 39's commit `1df9bc5` added `expo-av ~15.0.0` to fix the
voice "Session activation failed" bug. expo-av 15 is an SDK 52-era, deprecated pod (last
supported SDK ~54, uses the removed Legacy module API) inside an SDK 56 app — every CI
failure since run 39 is that one dependency. Nothing else regressed.

**Terminal fix (recommended)**: migrate `braindump.tsx`/`notes.tsx` from expo-av
`Audio.Recording` to `expo-audio` (SDK 56-native), drop `expo-av` from package.json, and
delete `mobile/ci/expo-legacy-shim/` + the two EXAV CI steps. The shims below only make
expo-av COMPILE; runtime behavior on device is unverified.

**Shim inventory (what's working)** — each fixed a confirmed failure:

| Piece | Fixes | Run that proved it |
|---|---|---|
| `mobile/ci/expo-legacy-shim/ExpoModulesCore/*.h` (31 vendored Legacy headers from expo-modules-core 3.0.30) + "Create ExpoModulesCore legacy header shim" step (copy-if-absent vs xcframework Headers) | `'ExpoModulesCore/EXEventEmitter.h' file not found` — expo-modules-core 56.x deleted `ios/Legacy/` from npm AND omits those headers from the prebuilt xcframework | 58 |
| "Wire EXAV xcconfig" step → `HEADER_SEARCH_PATHS += shim dir + Pods/React-Core-prebuilt/React.xcframework/Headers`, `OTHER_CFLAGS/OTHER_CPLUSPLUSFLAGS/OTHER_SWIFT_FLAGS += -ivfsoverlay React-VFS.yaml` | `'React/RCTBridgeModule.h' file not found` — RN 0.85 ships React-Core prebuilt; flat `<React/X.h>` names exist ONLY through the clang VFS overlay, and RN wires it only into pods depending on `React-Core` (expo-av depends on `ReactCommon/turbomodule/core`) | 65 |
| "Patch expo-av Swift" step (rewrites `VideoViewModule.swift` resolver closure) | `Promise.ResolveClosure` retyped to `(JavaScriptValue) -> Void` in ExpoModulesCore 56 | 66 |
| `EXLegacyCompat.h` force-included via `-include` in EXAV OTHER_CFLAGS | `EXFatal`/`EXErrorWithMessage` undeclared — deleted from expo-modules-core 56 (symbol gone too, so static-inline reimplementation, not a declaration) | 67 |
| "Remove expo-av video Swift files" step deletes `VideoViewModule.swift` + `ExpoVideoView.swift`, patches `EXAV.m` (remove `EXAV-Swift.h` import, replace `ExpoVideoView`→`EXVideoView`), patches `EXAV.h` (`EXEventEmitter` import → `@protocol EXEventEmitter;` forward decl), patches `expo-module.config.json` (remove `VideoViewModule` from `apple.modules`) | EXAV Swift files trigger `-import-underlying-module` → ObjC module build → framework EXEventEmitter.h lookup fails; ExpoVideoView deleted Swift class referenced at runtime; EXAV-Swift.h never generated when no Swift files; expo-configure-project.sh (Xcode build phase) REGENERATES ExpoModulesProvider.swift at build time from expo-module.config.json, overwriting any post-install patch | 73–80 |
| "Remove VideoViewModule from generated Expo scripts" step patches `expo-configure-project.sh` (sed removes VideoViewModule lines) + `ExpoModulesProvider.swift` (Python re.sub belt-and-suspenders) | Belt-and-suspenders for case where module list baked into shell script vs re-read from JSON | 80 |
| `EXLegacyProtocolStubs.m` (base64-decoded into expo-av source tree, compiled into libEXAV.a) — defines `EXEventEmitter` + `EXLegacyExpoViewProtocol` protocols with `__attribute__((constructor))` function referencing them | `Undefined symbols for architecture arm64: __OBJC_PROTOCOL_$_EXEventEmitter` + `__OBJC_PROTOCOL_$_EXLegacyExpoViewProtocol` — deleted from expo-modules-core 56 xcframework binary; EXAV.o and EXVideoView.o reference them at link time | 83 ✅ |

**Post-mortem: what worked, what failed, and why**

The core problem was two orthogonal compilation paths with different header lookup rules:

| Path | Triggered by | Header lookup | Shim works? |
|---|---|---|---|
| **CompileC** | Direct `.m` compilation | `-I` (flat dirs) | ✅ yes |
| **Module build** | Swift files in pod → `-import-underlying-module` | `-F` (framework lookup into XCFrameworkIntermediates) | ❌ no — xcframework slice omits legacy headers |

Every single error in this saga was one of these paths hitting a missing symbol or header. The shim we built fixes CompileC but can never fix module builds — those use a completely separate framework copy that Xcode assembles from the xcframework slice at build time, and injecting files there has no effect.

**What worked and why:**

- **Vendored 31 legacy headers + `-I` shim** (run 58): Gave CompileC path access to headers expo-modules-core 56 deleted. Correct — this is the only safe place to inject them.

- **VFS overlay for `<React/X.h>`** (run 65): RN 0.85 ships React-Core as a prebuilt xcframework and wires the VFS flat-root only into pods that directly depend on `React-Core`. expo-av depends on `ReactCommon/turbomodule/core`, not `React-Core`, so it never got the overlay. Adding `-ivfsoverlay React-VFS.yaml` to EXAV's xcconfig fixed it. Correct — understand the dependency graph before assuming "all pods get the same flags."

- **`EXLegacyCompat.h` force-include via `-include`** (runs 67+): `EXFatal` and `EXErrorWithMessage` were deleted as both declaration AND symbol from expo-modules-core 56. A header forward-declaration would compile but fail at link. Static-inline reimplementation in a force-included header bypasses both problems — no symbol reference, no link dependency.

- **Deleting Swift files (`VideoViewModule.swift`, `ExpoVideoView.swift`)** (run 73+): Swift files in a CocoaPods static pod trigger `-import-underlying-module` at compile time. That forces a module build of the pod's umbrella header. Module builds use `-F XCFrameworkIntermediates` — the xcframework slice copy — which never has the legacy headers we injected. Removing the Swift files eliminates the module build path entirely. This was the right lever; all the header injection into the xcframework was wrong.

- **Forward declarations in `EXAV.h` and other expo-av headers** (runs 76–77): After deleting the Swift files, ExpoModulesProvider.swift still `import`s the EXAV Clang module (module map exists from pod install). That triggers a module compilation. Forward decls (`@protocol EXEventEmitter;`) let module compilation succeed — full definitions are only needed in the `.m` CompileC path, where the shim provides them.

- **Patching `expo-module.config.json` + `expo-configure-project.sh`** (run 80): The [Expo] Configure project Xcode build phase regenerates `ExpoModulesProvider.swift` from `expo-module.config.json` at BUILD TIME, after our post-install patch. Patching the JSON source prevents both the pod-install generation and the build-time regeneration from knowing about VideoViewModule. Patching the generated shell script is belt-and-suspenders for the "baked-in list" case.

- **`EXLegacyProtocolStubs.m` with `__attribute__((constructor))`** (run 83): Compilation succeeded but the linker couldn't find `__OBJC_PROTOCOL_$_EXEventEmitter` or `__OBJC_PROTOCOL_$_EXLegacyExpoViewProtocol` — deleted from expo-modules-core 56 binary. ObjC protocol metaclass objects only exist in the binary if a compiled `.m` file DEFINES the protocol AND references it with `@protocol(X)`. Injecting a stub `.m` into expo-av's source tree before pod install causes CocoaPods to compile it into `libEXAV.a`, providing the linker symbols. The `__attribute__((constructor))` function scope allows `@protocol()` runtime expressions (not valid as static initializers) and prevents dead-strip.

**What failed and why:**

- **Copying headers into `Pods/Headers/Public/ExpoModulesCore/`** (`a1d422c`): Created a second path to the same headers — once via `-I Pods/Headers/Public/ExpoModulesCore` AND once via `-F XCFrameworkIntermediates/ExpoModulesCore.framework/Headers`. ObjC ODR: two definitions of the same `typedef` → redefinition errors. Rule: only one path per header, ever.

- **`target.build_settings` in Podfile `post_install`** (run 64): Expo's and RN's own `post_install` hooks run AFTER ours and merge our scalar string value into a Ruby array. When Xcode serializes that, it becomes one giant `-I["path1", "path2"]` argument — syntactically invalid. Must edit xcconfig files directly after pod install.

- **Injecting headers into the xcframework** (runs 71–72): Xcode's "Copy XCFrameworks" build phase copies the xcframework slice into `XCFrameworkIntermediates/`. It ONLY copies files that were originally in the slice — injected files are silently ignored. The xcframework is read-only from Xcode's perspective.

- **`DEFINES_MODULE = NO` in xcconfig** (`d27cf16`): CocoaPods generates the EXAV module map during `pod install`, before our xcconfig patch runs. Xcode's module build uses the pre-existing module map; `DEFINES_MODULE=NO` in the xcconfig has no effect on an already-generated module map.

- **Patching `ExpoModulesProvider.swift` after pod install** (runs 78–79): The [Expo] Configure project build phase (wired in the LifeOS Xcode project) runs `expo-configure-project.sh` at build time, regenerating the file. Our patch was correct but got overwritten before compilation.

- **`ExpoUseSources = true`** (`4e00d63`): Attempted to build expo-modules-core from source instead of xcframework. Failed — the Swift compiler version mismatch (xcframework compiled with Swift 6.3.1, runner has Swift 6.2.3) manifests differently in source mode. Also significantly increases build time.

- **Static `void *` initializer for `@protocol()`** (run 82): `@protocol(EXEventEmitter)` is an ObjC runtime expression, not a compile-time constant. Valid inside a function body; invalid as a file-scope static initializer. Clang correctly rejects it with "initializer element is not a compile-time constant."

**The meta-lesson**: this entire saga was ~45 CI runs because each fix only addressed the topmost error layer. The real fix was always "understand WHICH compilation path is hitting WHICH missing piece, and fix the right path." The two-path model (CompileC vs module build) explains every single failure.

**Hard-won rules (violating these re-breaks the build)**:
- NEVER copy xcframework headers into `Pods/Headers/Public/ExpoModulesCore/` — same header
  reachable via both `-I` and `-F` → ODR redefinition errors (run 3-of-saga / `a1d422c`).
- NEVER set EXAV search paths/flags via `target.build_settings` in Podfile `post_install` —
  Expo/RN hooks that run later merge the value into a Ruby array that gets STRINGIFIED into
  the build command as one giant `-I["…", "…"]` arg (run 64). Edit
  `Pods/Target Support Files/EXAV/EXAV.{release,debug}.xcconfig` after `pod install` instead.
- Don't add the shim `-I` to other Expo pods — broke ExpoTaskManager's module build (run 58).
- Local `mobile/node_modules` is STALE (npm install on CI resolves fresh; expo-modules-core
  is SDK-versioned now: CI gets 56.x, local had 3.0.30). Verify versions against the npm
  registry, never against local files.

**Debugging method that works** (each failed run = ~10 min, so maximize data per run):
1. Workflow uploads raw `/tmp/xcodebuild.log` as artifact `xcodebuild-log` on failure —
   step logs alone are useless (xcpretty swallows errors; run 59 failed with zero visible
   error lines). The build step must use `if ! pipeline` — under `bash -e` + `pipefail`, a
   plain pipeline aborts the step before any error extraction runs.
2. In the raw log, find the failing task (`SwiftDriver EXAV`, `CompileC …`), read clang's
   `note:` lines (run 61's "did not find header … in framework 'React' (loaded from …)"
   identified the VFS problem), and diff the full command's `-I`/`-F`/`-Xcc` args against a
   pod that compiles the same import successfully.
3. Dump ground truth in the diagnose step when theory runs out: resolved `React-VFS.yaml`,
   pod xcconfigs, `Pods/Headers/Public/` contents (runs 60/63 each turned a guess into a fact).
4. Known future fork: ExpoModulesCore 56.0.16 xcframework swiftinterface = Swift 6.3.1;
   Xcode 26.2 on `macos-15` = Swift 6.2.3. If "module compiled with newer Swift" appears,
   select a newer Xcode on the runner — do NOT retry `$ExpoUseSources` (failed, `4e00d63`).

**Checking CI logs automatically** (no `gh` CLI — use curl + Git Credential Manager):

```bash
# Get OAuth token git already has stored
TOKEN=$(printf 'protocol=https\nhost=github.com\n' | git credential fill | grep password | cut -d= -f2)

# 1. Find latest run ID (public — no auth needed)
RUN=$(curl -s "https://api.github.com/repos/OhamjDung/LifeOS/actions/workflows/build-ios.yml/runs?per_page=1" \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['workflow_runs'][0]; print(r['id'], r['status'], r['conclusion'])")
echo "Run: $RUN"
RUN_ID=$(echo $RUN | cut -d' ' -f1)

# 2. Poll run status (repeat until conclusion != null)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/runs/$RUN_ID" \
  | python3 -c "import sys,json; r=json.load(sys.stdin); print(r['status'], r['conclusion'])"

# 3. Get per-step results + job ID
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/runs/$RUN_ID/jobs" \
  | python3 -c "
import sys,json
jobs=json.load(sys.stdin)['jobs']
for j in jobs:
    print(f'Job {j[\"id\"]}: {j[\"conclusion\"]}')
    for s in j['steps']: print(f'  [{s[\"conclusion\"]}] {s[\"name\"]}')
"

# 4. Download full step logs (auth required)
JOB_ID=<job_id_from_step_3>
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/jobs/$JOB_ID/logs" \
  -o /tmp/ci_job.log
grep -E "error:|warning:|FAILED|❌" /tmp/ci_job.log | head -40
```

**Caveat**: job logs = step stdout only. Raw `xcodebuild.log` (full compiler output) lives in `/tmp/xcodebuild.log` on the runner. The workflow uploads it as an artifact on failure — download via:
```bash
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://api.github.com/repos/OhamjDung/LifeOS/actions/runs/$RUN_ID/artifacts" \
  | python3 -c "import sys,json; [print(a['name'], a['archive_download_url']) for a in json.load(sys.stdin)['artifacts']]"
# Then curl -sL -H "Authorization: Bearer $TOKEN" <archive_download_url> -o /tmp/artifact.zip
```

## AI Models

All AI calls use GitHub Models (free) via OpenAI SDK with a custom base URL:

```typescript
const openai = new OpenAI({
  baseURL: 'https://models.inference.ai.azure.com',
  apiKey: Deno.env.get('GITHUB_TOKEN'),
})
```

Models in use: `gpt-4o` (task extraction), `gpt-4o-mini` (categorization, CRM drafts), `text-embedding-3-small` (note embeddings + search). `GITHUB_TOKEN` is a Supabase Edge Function secret — never in web client or mobile binary.

## Supabase

- Schema: `supabase/schema.sql` — run in SQL Editor to initialize DB
- Additional migrations: `supabase/migrations.sql` — run after schema (task_type, rollover_count, triggers)
- Helper functions + pg_cron schedules: `supabase/functions.sql` — run after schema
- Edge Functions: `supabase/functions/` — deploy with `supabase functions deploy <name> --project-ref atokyvaqjvqkveqnfurg`

All Supabase clients use `@supabase/ssr` (web) or `@supabase/supabase-js` (mobile):
- Web server components: `import { createClient } from '@/lib/supabase/server'`
- Web client components: `import { createClient } from '@/lib/supabase/client'`
- Mobile: `import { supabase } from '../../lib/supabase'`

Never call AI from web client or mobile. All AI calls go through Edge Functions only.

## Architecture

Three-layer progressive enhancement — lower layers work without higher ones:

- **Layer 0** — CRUD core. Always works. No AI dependency.
- **Layer 1** — Async AI via pg_cron polling `processing_status='pending'` rows. Never blocks writes.
- **Layer 2** — Proactive AI nudges (not yet built).

Braindump flow: web/mobile saves `raw_transcript` to `braindump_jobs` immediately → `fn-process-braindump` polls every 2 min via pg_cron → extracts tasks with GPT-4o + cosine dedup → tasks appear via Realtime.

Note embedding: save note → `fn-embed-note` polls every 2 min → chunks + embeds → category/tags update via Realtime on `notes.processing_status`.

## Task Domain Details

Tasks have two types (`task_type`):
- `task` — regular task, shown as dot on calendar
- `event` — calendar event, shown with title on calendar, can be linked to a contact

Key task behaviors:
- **Auto-rollover**: on page load, past pending tasks are moved to today automatically
- **Future scheduling**: `due_date` can be any date, date picker in UI
- **Rollover count**: `rollover_count` incremented by trigger on each `task_rollovers` insert. Tasks with higher rollover_count sorted first (higher priority). Badge shown at ≥1, orange highlight at ≥3.
- **Event → contact sync**: completing an event task with `contact_id` set triggers `trg_event_task_contact` → updates `contacts.last_contacted_at`

## Web App Structure

```
web/app/
  page.tsx                       # root redirect to /dashboard
  login/page.tsx
  auth/callback/route.ts
  proxy.ts                       # auth proxy (Next.js 16 — replaces middleware.ts)
  (app)/layout.tsx               # auth guard + sidebar (Dashboard, Tasks, Calendar, Braindump, Notes, Search, Contacts)
  (app)/dashboard/page.tsx
  (app)/tasks/page.tsx           # auto-rollover past tasks, fetch with rollover_count sort
  (app)/calendar/page.tsx        # monthly grid: dots for tasks, titles for events, searchParams for month/year
  (app)/braindump/page.tsx       # text braindump → braindump_jobs
  (app)/notes/                   # list, new, [id]
  (app)/search/page.tsx          # semantic search via fn-search-notes
  (app)/contacts/                # list, new, [id]
web/lib/
  supabase/{client,server,middleware}.ts
  types.ts                       # all shared TypeScript types
web/components/
  TaskList.tsx                   # add/complete/rollover/delete tasks — type selector, date picker, contact selector for events
  NoteEditor.tsx                 # edit/delete note (client)
  ContactDetail.tsx              # log events + AI draft message button (client)
  LogoutButton.tsx
```

## Mobile App Structure

```
mobile/app/
  _layout.tsx                    # root layout — auth guard, session listener
  index.tsx                      # redirect to /(tabs)/today
  (auth)/login.tsx
  (tabs)/_layout.tsx             # tab bar: Today, Tasks, Dump, Notes, People, Modes, Logs
  (tabs)/today.tsx               # today's tasks + overdue contacts dashboard
  (tabs)/tasks.tsx               # all tasks, auto-rollover, event type, date picker, rollover badges
  (tabs)/braindump.tsx           # text + voice braindump (voice: mic hidden in Expo Go, shown in dev client)
  (tabs)/notes.tsx               # notes list + compose (text + voice recording)
  (tabs)/contacts.tsx            # contacts list with overdue badges (contact_tier-based)
  (tabs)/search.tsx              # semantic search (hidden from tab bar, accessible via nav)
  (tabs)/calendar.tsx            # calendar view (hidden from tab bar, accessible via nav)
  (tabs)/modes.tsx               # location anchors + geofence activation
  (tabs)/logs.tsx                # in-app debug log viewer (subscribes to lib/logger)
  contact/[id].tsx               # contact detail — timeline, log interaction
  contact-new.tsx                # new contact form
  connect-widget.tsx             # widget registration screen — links widget_id to user account
mobile/lib/
  supabase.ts                    # Supabase client with SecureStore auth persistence
  types.ts                       # Task, Contact, ContactEvent, Tag, TaskType, TaskStatus, ContactTier, etc.
  geofence.ts                    # expo-location geofencing task + startGeofencing/stopGeofencing
  logger.ts                      # in-memory log ring buffer + subscribe() for LogsScreen
  theme.ts                       # T color tokens, MONO font, raisedShadow helpers
  dailyTasks.ts                  # daily task helpers
  widgetSync.ts                  # widget registration + sync helpers
```

## Edge Functions

All in `supabase/functions/`. Each uses Deno + `jsr:@supabase/supabase-js@2` + `npm:openai`.

| Function | Trigger | Does |
|---|---|---|
| `fn-process-braindump` | pg_cron every 2 min | GPT-4o extracts tasks, cosine dedup (0.85/0.65 thresholds) |
| `fn-embed-note` | pg_cron every 2 min | Paragraph chunks → embeddings → GPT-4o-mini category+tags |
| `fn-search-notes` | HTTP POST from client | Embeds query → calls `search_notes()` DB function |
| `fn-draft-catchup` | HTTP POST from client | GPT-4o-mini drafts catch-up message for a contact |
| `fn-auto-tag` | HTTP POST from client | GPT-4o-mini picks best tag from user's tag list for a task |
| `fn-widget-data` | HTTP GET from iOS widget | Returns today's tasks for a `widget_id` (no JWT — uses `widget_registrations` table) |
| `fn-widget-action` | HTTP POST from iOS widget | Complete or rollover a task; auth via `widget_id` credential |

`fn-search-notes`, `fn-draft-catchup`, and `fn-auto-tag` verify the user JWT from `Authorization` header before executing.
`fn-widget-data` and `fn-widget-action` use `widget_registrations.widget_id` as the auth credential (no JWT — widget can't store tokens).

## Database Key Patterns

- All tables use RLS (`auth.uid() = user_id`). Always pass `user_id: user?.id` explicitly on inserts (no server-side default).
- `braindump_jobs` and `notes`: Edge Functions set `processing_status='processing'` before AI call, `done/failed` after. `retry_count` max 3 enforced in query (`lt('retry_count', 3)`).
- `tasks.rollover_count`: incremented by `trg_increment_rollover_count` trigger on `task_rollovers` insert. Backfilled from existing rows via `migrations.sql`.
- `tasks.contact_id`: optional FK to contacts. `trg_event_task_contact` trigger updates `contacts.last_contacted_at` when event task marked done.
- `contact_events` with `event_type in ('photo_sent','message_sent','met')` also auto-update `contacts.last_contacted_at` via `trg_last_contacted` trigger.
- `note_chunks.embedding` uses HNSW index (`vector_cosine_ops`, m=16, ef_construction=64). `search_notes()` DB function handles cosine similarity search.
- `tags` + `task_tags`: user-defined tags; `fn-auto-tag` auto-assigns one tag per task via GPT-4o-mini.
- `widget_registrations`: maps `widget_id` (UUID generated on iOS) → `user_id`. No JWT needed — widget uses `widget_id` as credential for `fn-widget-data` / `fn-widget-action`.
- `contacts.contact_tier`: enum `daily|weekly|biweekly|monthly` — drives overdue badge logic via `CONTACT_TIER_DAYS` map (`1/7/14/30` days).

## Build Phase Status

| Phase | Status |
|---|---|
| 0 — CRUD foundation | ✅ Done |
| 1 — Voice braindump (mobile) | ⏳ Code ready, needs dev client build (Apple Dev account or GitHub Actions + AltStore) |
| 2 — AI task extraction + dedup | ✅ Done |
| 3 — Contextual modes / geofencing | ⏳ Code ready, needs dev client build |
| 4 — CRM (web + AI drafts) | ✅ Done (push notifications need APNs) |
| 5 — Notes + semantic search | ✅ Done |
| 6 — Task events + calendar view | ✅ Done |
| 7 — Mobile notes with voice | ⏳ Code ready, needs dev client build |
| 8 — iOS widget (tasks/events) | ✅ Done — HTTP polling via Supabase, no App Group required; `connect-widget.tsx` registers widget |
| 9 — Tags + AI auto-tag | ✅ Done — `tags`/`task_tags` tables, `fn-auto-tag` edge function |
| 10 — Today dashboard (mobile) | ✅ Done — `today.tsx` shows tasks + overdue contacts |
| 11 — In-app debug logs | ✅ Done — `logs.tsx` + `lib/logger.ts` ring buffer |
