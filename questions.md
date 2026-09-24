# Rework questions: Tasks + Chat harness, Planner, Notion Calendar

Answer inline under each question. Short answers are fine. Every question has a **Default** (what I'll build if you skip it or write "default").

---

## A. Layout: the `/tasks` page

**A1.** The A screen (left) stays as the TaskList and the B screen (right) becomes the chat. Today the B screen also holds the **calendar grid** and the **TaskDetailPane** (description and subtasks for the selected task). Where should those go?

- (a) The calendar moves to the new Planner tab. Clicking a task opens its details as a **drawer/overlay** on top of the chat, and closing it brings the chat back.
- (b) The B screen gets tabs: `CHAT | DETAILS | CALENDAR`.
- (c) The details expand inline under the task in the A screen.
- **Default: (a).**

**A2.** What happens to the `/braindump` page and the DUMP nav tab once the chat replaces it?

- (a) Remove it, since the chat does everything.
- (b) Keep it as a hidden route with its history, but take it out of the nav.
- **Default: (b)** for now, then delete it once the chat is proven.

> re use logic for the chat, all the logic youve implemented are basically tools for this LLM 

**A3.** Should the chat also show up on other pages (for example a pop-out like QuickNotesWidget on Notes/People), or only on `/tasks`?

- **Default: only on `/tasks`.**

> only on tasks, but could change in future

**A4.** New nav order? Proposal: `TASKS / PLAN / SESSION / NOTES / PEOPLE`.

> when youre on[lifeostrich.vercel.app/session](https://lifeostrich.vercel.app/session) and you see all your sessions, each session should have an x on top right to delete them

---

## B. Chat harness: what it can do

**B1.** Which tools should the chat have? Delete any you don't want and add any that are missing:

- Tasks: create, edit (title, description, due date), complete, delete, reschedule, set/unset ★ priority, add subtasks, group tasks
- Contacts: create, update fields, log an interaction ("met Mark yesterday")
- Notes: create a note, **search notes** (semantic)
- Planner: add or edit month/week goals ("plan my October")
- Calendar: read your Notion Calendar events ("what's on Thursday?")
- Sessions: start a focus session with selected tasks

> Contacts should also have information on them, and why theyre useful to me, catagorize them too to be family or work
>
> No need for sessions,
>

**B2.** When the chat wants to change data, should it:

- (a) **Just do it** and show a receipt card ("✓ created 3 tasks") with an **Undo** button.
- (b) Show a **preview and wait for you to click Confirm**.
- (c) Mixed: creates happen automatically, but deletes and big edits need a Confirm.
- **Default: (c).**

> b

**B3.** When the chat creates a contact whose name matches an existing one (the current duplicate-name gate), should it ask you in the chat ("Update Mark Sampelo or create new?") instead of opening the `ResolveContactsModal`?

- **Default: yes, ask in the chat.**

**B4.** "Advice on what to prioritize": should it be

- (a) **on demand only**: you ask and it answers,
- (b) **a short proactive suggestion when you open the page** (costs one AI call per visit, capped at once a day), or
- (c) both?
- **Default: (a) now, (b) later as the "Layer 2 nudges" phase.**

> a, it should be very robus tho, i could just go /prioritize and it starts grilling me and asking me questions 

**B5.** What should it weigh when advising on priorities? For example: ★ priority, rollover count (how long you've been avoiding it), due dates, calendar load that day, the month/week goals from the Planner, overdue contacts. Is anything missing, or is anything here something you don't want it to consider?

> yea ill list it from most important to least, due date, overdue contacts, calendar load that day,  roll over count, goals, and also group similar tasks together

**B6.** Should it have a personality or tone? For example blunt coach, neutral assistant, or something else. Should it push back ("you've rolled this over 6 times, drop it or do it")?

> efficient but warm

**B7.** Keep **voice input** (mic → Groq Whisper) in the chat box?

- **Default: yes.**

> yep

---

## C. Chat harness: memory and token cost

Context on cost: DeepSeek `v4-flash` is very cheap. A chat turn that carries your whole pending task list (about 100 tasks, titles only) plus the last ~20 messages is around 5–10k tokens, which works out to a fraction of a cent per message. Heavy daily use is probably **under $1–3/month**. My plan to keep it lean: send only compact task summaries (id, title, due date, priority, rollover count), have the model call tools to fetch details (subtasks, notes, contacts) when it needs them, and keep history short with a running summary.

**C1.** Is roughly $1–5/month OK? Do you want a hard monthly cap, where the chat stops and tells you when it's hit?

- **Default: $5 cap, with a usage number shown somewhere.**

**C2.** How should chat history work?

- (a) **One endless thread**: it remembers everything, and older parts get summarized.
- (b) **A new thread each day**, with the old ones viewable.
- (c) Threads like ChatGPT, where you start a new one whenever you want.
- **Default: (b).** It fits a daily-planning flow and keeps context small.

> b and a little of a, like before context gets thrown out add it to global memory like claude.md, like follow claude code's architecture

**C3.** Should it keep **long-term memory about you** across threads? For example "Thomas works best in mornings" or "school is priority this semester", editable by you.

- **Default: yes, a small "about me" memory list that it can add to and you can edit.**

**C4.** Should it stay on DeepSeek `v4-flash` or use `v4-pro` for the chat? Pro is smarter at planning and advice but costs more (roughly 5–10×).

- **Default: flash, and switch to pro if the advice feels dumb.**

> user can press /model to switch, flash by default

**C5.** Should replies **stream** word by word (feels like ChatGPT, a bit more work), or appear all at once when done?

- **Default: stream.**

> appear all at once

---

## D. Notion Calendar sync (ICS)

**D1.** An ICS link is **read-only, one way**: LifeOS can *show* your calendar events, but anything created in LifeOS will **not** show up in Notion Calendar. Is that OK?

- Two-way sync would need a Google Calendar API connection (OAuth), since Notion Calendar runs on top of Google Calendar. That's more work.
- **Default: read-only ICS now, and consider Google two-way later.**

> yea ics for now

**D2.** Which calendar is the ICS link from? Google Calendar's "secret address in iCal format", Notion Calendar itself, or something else? Is it one link or several (for example work + personal + school)?

> google calendar ical

**D3.** The ICS URL is effectively a password to your calendar. I'll store it in the database (your row only, protected by RLS) and enter it on a small settings screen, not in the code. OK?

> ye

**D4.** "Low-key copy Notion Calendar": which parts matter?

- (a) Month overview only
- (b) Week view with a time grid (hours down the side, events as blocks)
- (c) Day view
- (d) Drag on the grid to create a time block
- (e) LifeOS tasks shown alongside the calendar events
- **Default: (b) week time-grid plus (a) month view, with LifeOS tasks and events overlaid.** No dragging to create blocks at first.

> a, b, d, e, you can create blocks, then drag in your tasks ONTO that block to assign that block to that task

**D5.** How fresh do the events need to be? Refreshing on page open plus every ~15 min is easy. Instant updates aren't possible with ICS.

> ye

**D6.** What happens to the existing LifeOS `event` task type (events you create inside LifeOS)? Keep it as is, or phase it out now that real events come from Notion?

> keep as is

---

## E. Planner tab (month and week Kanban)

**E1.** On the month board, how many month columns should show?

- (a) A rolling 12 months starting with the current month
- (b) The current calendar year (Jan–Dec)
- (c) The current month plus the next 3, scrolling sideways for more
- **Default: (c).**

**E2.** What is a **card** on the month board? Just a title, or also:

- description / notes
- color or category (for example School, Career, Health, Social)
- status (not started / in progress / done)
- progress % (auto-calculated from its weekly items?)

> Title, with description, category, status

**E3.** Can a card be **dragged between months** (to push a goal later)? Can it span several months, like a 3-month project?

> Yes for both

**E4.** Week drill-down: clicking a month opens a board where **columns = weeks** of that month. A week that straddles two months (for example Sep 29 – Oct 5) belongs to:

- (a) the month its Monday is in
- (b) the month that has more of its days
- **Default: (a), with weeks running Mon–Sun.** Tell me if you want Sun–Sat.

> a

**E5.** On the week board, should each weekly card be **linked to a month goal** (it shows "↳ Land internship"), with the month's goals pinned in a sidebar or header? Or should the goals just be visible there for reference with no links?

- **Default: linked (optional). The pinned month goals show how many weekly items feed each one.**

> yea weekly card can be linked to a month goal, and you can see how many cards link to each month's goal so you know when youre not distributing evenly

**E6.** Should weekly cards be connectable to **real tasks** in the TaskList? For example, one button on a weekly card that says "turn this into a task due this week", or the weekly card showing its linked tasks' progress.

- **Default: yes, a one-click "make task" button, and the card shows ✓ when its tasks are done.**

> no need, keep it as very important context on the user for that LLM

**E7.** Should there be another level down, a **day board** (week → 7 day columns)? Or is the TaskList already "the day"?

- **Default: no day board, since the TaskList covers it.**

> Task lisk is day

**E8.** "A big overview in the calendar view": does this mean

- (a) the month/week goals show on the calendar (for example as a banner across that week or month), or
- (b) a separate zoomed-out view of the whole year's goals, or
- (c) something else?

> Never mind this, 

**E9.** Should there be a **year level** above months (for example "2027 themes") that month goals link to? Or is month the top level?

- **Default: month is the top level for now.**

> year too , lets do it,  

**E10.** Should the chat be able to plan for you ("break my October goal into weekly steps") and write straight into the week board?

> it shouldnt be able to write directly, it can definetly read it tho, and suggest stuff

---

## F. Scope and order

**F1.** Is this web only for now, with mobile later?

- **Default: web only.**

> we b only for now

**F2.** Build order. These are three independent chunks; which comes first?

- (a) **Planner** (just UI + DB, no AI, lowest risk)
- (b) **Notion Calendar ICS** (small)
- (c) **Chat harness** (biggest, and it replaces the braindump flow)
- **Default: Planner → ICS → Chat**, so the chat can use planner goals and calendar events from day one.

**F3.** Should I deploy to Vercel after each chunk as usual, or hold everything until the whole rework is done?

- **Default: deploy after each chunk.** The old version is safe at `baseline-pre-harness`.

**F4.** Anything else from your vision I didn't cover?

> Sounds good, if anything comes up just choose the best solution that you think is right, and also make it snappy and responsive with animations
>
> honestly, all the buttons and stuff feels very slow, add animations when you click on buttons, all buttons so theres feedback that you clicked it
