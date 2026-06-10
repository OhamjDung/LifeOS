import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Config (injected via Info.plist by expo-target.config.js)

func supabaseUrl() -> String  { Bundle.main.infoDictionary?["SUPABASE_URL"]  as? String ?? "" }
func anonKey()     -> String  { Bundle.main.infoDictionary?["SUPABASE_ANON_KEY"] as? String ?? "" }

// MARK: - Widget identity (per-device, per-widget-extension sandbox)

let kWidgetIdKey = "lifeos_widget_id"

func getOrCreateWidgetId() -> String {
    let d = UserDefaults.standard
    if let id = d.string(forKey: kWidgetIdKey) { return id }
    let newId = UUID().uuidString.lowercased()
    d.set(newId, forKey: kWidgetIdKey)
    return newId
}

// MARK: - Models

struct WTask: Codable, Identifiable {
    var id: String
    var title: String
    var taskType: String
    var dueDate: String
    var rolloverCount: Int
    var status: String

    enum CodingKeys: String, CodingKey {
        case id, title, status
        case taskType     = "task_type"
        case dueDate      = "due_date"
        case rolloverCount = "rollover_count"
    }
}

struct FetchResult {
    var registered: Bool
    var tasks: [WTask]
    var debugMsg: String
}

// MARK: - Network

func fetchWidgetData(widgetId: String) async -> FetchResult {
    let base = supabaseUrl(), key = anonKey()
    guard !base.isEmpty, !key.isEmpty else {
        return FetchResult(registered: false, tasks: [], debugMsg: "no-config")
    }
    guard let url = URL(string: "\(base)/functions/v1/fn-widget-data?widget_id=\(widgetId)") else {
        return FetchResult(registered: false, tasks: [], debugMsg: "bad-url")
    }
    var req = URLRequest(url: url)
    req.setValue(key, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    req.timeoutInterval = 8
    guard let (data, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse else {
        return FetchResult(registered: false, tasks: [], debugMsg: "network-fail")
    }
    guard http.statusCode == 200 else {
        return FetchResult(registered: false, tasks: [], debugMsg: "http-\(http.statusCode)")
    }
    struct Resp: Codable { var registered: Bool; var tasks: [WTask] }
    guard let decoded = try? JSONDecoder().decode(Resp.self, from: data) else {
        return FetchResult(registered: false, tasks: [], debugMsg: "decode-fail")
    }
    return FetchResult(registered: decoded.registered, tasks: decoded.tasks, debugMsg: "ok tasks=\(decoded.tasks.count)")
}

func postWidgetAction(widgetId: String, taskId: String, action: String) async -> Bool {
    let base = supabaseUrl(), key = anonKey()
    guard let url = URL(string: "\(base)/functions/v1/fn-widget-action") else { return false }
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue(key, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: [
        "widget_id": widgetId, "task_id": taskId, "action": action
    ])
    req.timeoutInterval = 8
    guard let (_, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse else { return false }
    return http.statusCode == 200
}

// MARK: - App Intents

struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Task"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Task ID")   var taskId: String
    @Parameter(title: "Widget ID") var widgetId: String

    init() {}
    init(taskId: String, widgetId: String) { self.taskId = taskId; self.widgetId = widgetId }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ok = await postWidgetAction(widgetId: widgetId, taskId: taskId, action: "complete")
        if ok { WidgetCenter.shared.reloadAllTimelines() }
        return .result(dialog: ok ? "Done!" : "Sync failed")
    }
}

struct RolloverTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Move to Tomorrow"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Task ID")   var taskId: String
    @Parameter(title: "Widget ID") var widgetId: String

    init() {}
    init(taskId: String, widgetId: String) { self.taskId = taskId; self.widgetId = widgetId }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let ok = await postWidgetAction(widgetId: widgetId, taskId: taskId, action: "rollover")
        if ok { WidgetCenter.shared.reloadAllTimelines() }
        return .result(dialog: ok ? "→ Tomorrow" : "Sync failed")
    }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let widgetId: String
    let result: FetchResult
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        let id = getOrCreateWidgetId()
        return Entry(date: .now, widgetId: id, result: FetchResult(registered: false, tasks: [], debugMsg: "placeholder"))
    }

    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        let id = getOrCreateWidgetId()
        Task {
            let result = await fetchWidgetData(widgetId: id)
            completion(Entry(date: .now, widgetId: id, result: result))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let id = getOrCreateWidgetId()
        Task {
            let result = await fetchWidgetData(widgetId: id)
            let entry = Entry(date: .now, widgetId: id, result: result)
            let next = Calendar.current.date(byAdding: .minute, value: 15, to: .now)!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }
}

// MARK: - Task row

struct TaskRowView: View {
    let task: WTask
    let widgetId: String

    var body: some View {
        HStack(spacing: 6) {
            Button(intent: CompleteTaskIntent(taskId: task.id, widgetId: widgetId)) {
                Image(systemName: task.status == "done" ? "checkmark.circle.fill" : (task.taskType == "event" ? "square" : "circle"))
                    .font(.system(size: 13))
                    .foregroundStyle(task.status == "done" ? Color.green : Color.secondary)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 0) {
                Text(task.title)
                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                    .strikethrough(task.status == "done")
                if task.rolloverCount > 0 {
                    Text("↺\(task.rolloverCount)")
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.orange)
                }
            }

            Spacer(minLength: 0)

            if task.status != "done" {
                Button(intent: RolloverTaskIntent(taskId: task.id, widgetId: widgetId)) {
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.tertiary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
    }
}

// MARK: - Widget view

struct WidgetView: View {
    let entry: Entry
    @Environment(\.widgetFamily) var family

    var limit: Int { family == .systemMedium ? 4 : 7 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(spacing: 5) {
                Text("LIFEOS")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(.secondary)
                // Debug: remove once confirmed working
                Text(entry.result.debugMsg)
                    .font(.system(size: 7, design: .monospaced))
                    .foregroundStyle(entry.result.registered ? Color.green : Color.orange)
                    .lineLimit(1)
                Spacer()
                if entry.result.registered {
                    Link(destination: URL(string: "lifeos://braindump")!) {
                        Image(systemName: "brain")
                            .font(.system(size: 12))
                            .foregroundStyle(.tint)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 5)

            Divider().padding(.horizontal, 12)

            if !entry.result.registered {
                // Show connect button
                Spacer()
                VStack(spacing: 8) {
                    Text("Tap to connect LifeOS →")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.tint)
                    Text("Open app first, then tap here")
                        .font(.system(size: 9, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                // Wrap whole unregistered state in a Link so user can tap anywhere
                .overlay(
                    Link(destination: URL(string: "lifeos://connect-widget?widget_id=\(entry.widgetId)")!) {
                        Color.clear
                    }
                )
                Spacer()
            } else if entry.result.tasks.isEmpty {
                Spacer()
                Text("Clear today ✓")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(entry.result.tasks.prefix(limit).enumerated()), id: \.element.id) { idx, task in
                        TaskRowView(task: task, widgetId: entry.widgetId)
                        if idx < min(limit, entry.result.tasks.count) - 1 {
                            Divider().padding(.horizontal, 12)
                        }
                    }
                    if entry.result.tasks.count > limit {
                        Text("+\(entry.result.tasks.count - limit) more")
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 4)
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

// MARK: - Entry point

struct LifeOSWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "LifeOSWidget", provider: Provider()) { entry in
            WidgetView(entry: entry)
        }
        .configurationDisplayName("LifeOS")
        .description("Today's tasks and events")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

@main
struct LifeOSBundle: WidgetBundle {
    var body: some Widget {
        LifeOSWidget()
    }
}
