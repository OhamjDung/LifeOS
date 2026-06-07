# LifeOS Features

Last updated: 2026-06-07 (nav refactor)

---

## Navigation

5 tabs: **Tasks · Braindump · Notes · Contacts · Modes**

- Calendar is embedded inside Tasks (toggle button top-right)
- Search is embedded inside Notes (search bar always visible at top)

---

## Tasks

### View toggle (top-right 📅 / ✅ button)
- **List view** (default) — today's tasks with swipe gestures
- **Calendar view** — monthly grid, tap day → task detail below
  - Dots = regular tasks, event titles shown inline
  - Navigate months with ‹ / › arrows
  - Today highlighted with indigo circle

### Adding tasks
- Type toggle: **Task** (round checkbox) or **Event** (square checkbox, purple left border)
- Date picker: Today / Tomorrow / Day after tomorrow / Next week / Custom (YYYY-MM-DD)
- **Tags**: tap to select existing tags, long-press to delete, tap `+ tag` to create new
- If no tag selected → AI auto-tags in background (GPT-4o-mini picks from your tag library)
- Hit `+` or press Return to add

### Task list
- Sorted: highest rollover count first (priority), then creation order
- **Swipe right** → mark complete (green ✓ Done)
- **Swipe left** → move to tomorrow (blue → Tmrw)
- Tap checkbox → toggle complete/pending
- Tap `→tmrw` button → rollover to tomorrow
- Tags shown as indigo chips below task title
- `↻N moves` badge when rolled over ≥1 time
- **Orange left border + orange badge** = rolled over ≥3 times (high priority)
- **Purple left border** = event type task
- Done tasks shown at bottom, strikethrough

### Auto-rollover
- On app load: all past pending tasks automatically moved to today
- Tasks that were rolled over manually do NOT auto-roll again (status = `rolled_over`)

### Catching up tasks (auto-generated)
- On app load: checks all contacts against their contact frequency tier
- If a contact is overdue → creates "Catching up with [Name]" task for today (if not already there)
- **[!] prefix** = contact is 50%+ past their countdown (e.g. weekly contact, 10+ days since contact)
- Tasks update to [!] urgency on each app load

### Follow-up suggestions (on event complete)
- When an **event task** is marked complete:
  - Checks all contacts where countdown ≤ 2 days remaining or overdue
  - If any of those contacts share tags with the event → suggests follow-up via Alert

---

## Notes

### Search bar (always visible at top)
- Type to search → auto-searches after 400ms debounce
- Results powered by semantic vector search (`fn-search-notes`)
- While query is non-empty → shows search results with count
- Clear query → returns to notes list

### List view
- Shows 50 most recent notes when search bar is empty
- Displays: title, content preview (2 lines), AI-assigned category, date
- Refreshes every time you navigate to the tab

### Compose (tap + New)
- Optional title
- Text content (multiline)
- **🎙 mic button** (dev client only, hidden in Expo Go) — tap to record speech, appends to content
- Save → AI categorizes and embeds in background (~2 min)

### Upload recording (🎙 Upload button, top right)
- Tap → file picker for audio files
- Uploads to Supabase Storage (`recordings/` bucket)
- Queued as braindump job → AI transcribes and extracts tasks (~2 min)
- Requires: `recordings` storage bucket created in Supabase Dashboard
- Requires: `expo-document-picker` (`npx expo install expo-document-picker`)

---

## Braindump

### Category chips (multi-select, tap to toggle)
| Chip | What happens |
|---|---|
| ✅ Tasks | Queues braindump job → AI extracts tasks in ~2 min |
| 📝 Notes | Also saves text directly as a note immediately |
| 👥 Contacts | Passes people context to AI extraction |

- At least one chip must stay selected (can't deselect all)
- After submit: redirects to Tasks if Tasks selected, Notes if only Notes
- **🎙 mic button** (dev client only) — tap to record speech, appends to text area

---

## Contacts

### List view
- Sorted by `last_contacted_at` ascending (most overdue first)
- Shows: name, contact tier, countdown
  - `Nd left` = days remaining before due
  - `Nd overdue` (red) = past due
  - **Orange left border** = 50%+ past countdown (urgent)

### Contact tiers (frequency)
| Tier | Countdown |
|---|---|
| Daily | 1 day |
| Weekly | 7 days |
| Biweekly | 14 days |
| Monthly | 30 days |

### Contact detail
- Shows tier badge, days remaining/overdue, how we met
- **Tags** (same library as tasks) — tap to toggle, long-press to delete, tap `+ tag` to create
- Log interaction: Met up / Message / Photo / Life update / Note
- Timeline of all logged interactions
- Delete contact (destructive, with confirmation)

### New contact
- Name, how we met, contact tier selector, tags
- Tags can be created inline

### Triggers
- Logging `met`, `message_sent`, or `photo_sent` → updates `last_contacted_at`
- Completing an **event task** with `contact_id` set → updates `last_contacted_at`

---

## Modes (Locations)

> Requires dev client build — shows notice in Expo Go

- Save named locations (label + mode + current GPS coordinates)
- Modes: Home, Work, Gym, Default
- **Activate auto mode switching** — background geofencing triggers mode change on arrival
- Each location has 150m radius

---

## Tags (shared across Tasks & Contacts)

- Shared tag library per user stored in `tags` table
- Create: tap `+ tag` in task add form, contact new, or contact detail
- Delete: long-press any tag chip → confirm delete (removes from all tasks/contacts)
- Auto-tag: if no tags selected when creating a task, AI picks one from your library

---

## Limitations in Expo Go

| Feature | Status |
|---|---|
| Voice recording (braindump, notes) | Hidden — requires dev client build |
| Background geofencing (modes) | Disabled — requires dev client build |
| All other features | ✅ Full functionality |

---

## Dev Client Build (enables voice + geofencing)

Free path (no Apple Developer account):
1. Push to GitHub → GitHub Actions builds unsigned IPA (`.github/workflows/build-ios.yml`)
2. Download artifact → AltStore signs with free Apple ID → install on iPhone
3. AltStore re-signs automatically every 7 days over WiFi
