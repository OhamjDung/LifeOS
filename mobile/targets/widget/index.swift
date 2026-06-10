import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Shared data

let kAppGroup = "group.com.lifeos.app"
let kWidgetKey = "lifeos_widget_data"

struct WidgetData: Codable {
    var tasks: [WTask]
    var token: String?
    var tokenExpiry: Double?
    var supabaseUrl: String
    var anonKey: String
    var writtenAt: Double
}

struct WTask: Codable, Identifiable {
    var id: String
    var title: String
    var taskType: String
    var dueDate: String
    var rolloverCount: Int
}

struct LoadResult {
    var data: WidgetData?
    var defaultsNil: Bool
    var rawNil: Bool
    var rawLen: Int
    var decodeFailed: Bool
}

func loadDataDetailed() -> LoadResult {
    guard let defaults = UserDefaults(suiteName: kAppGroup) else {
        return LoadResult(data: nil, defaultsNil: true, rawNil: true, rawLen: 0, decodeFailed: false)
    }
    guard let raw = defaults.string(forKey: kWidgetKey) else {
        return LoadResult(data: nil, defaultsNil: false, rawNil: true, rawLen: 0, decodeFailed: false)
    }
    guard let bytes = raw.data(using: .utf8) else {
        return LoadResult(data: nil, defaultsNil: false, rawNil: false, rawLen: raw.count, decodeFailed: true)
    }
    if let decoded = try? JSONDecoder().decode(WidgetData.self, from: bytes) {
        return LoadResult(data: decoded, defaultsNil: false, rawNil: false, rawLen: raw.count, decodeFailed: false)
    }
    return LoadResult(data: nil, defaultsNil: false, rawNil: false, rawLen: raw.count, decodeFailed: true)
}

func loadData() -> WidgetData? { loadDataDetailed().data }

func tokenValid(_ data: WidgetData?) -> Bool {
    guard let expiry = data?.tokenExpiry else { return false }
    return expiry > Date().timeIntervalSince1970 + 60
}

// MARK: - Supabase

func supabasePatch(data: WidgetData, path: String, query: String, body: [String: Any]) async -> Bool {
    guard let token = data.token,
          let url = URL(string: "\(data.supabaseUrl)/rest/v1/\(path)?\(query)")
    else { return false }
    var req = URLRequest(url: url)
    req.httpMethod = "PATCH"
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue(data.anonKey, forHTTPHeaderField: "apikey")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    req.timeoutInterval = 10
    guard let (_, resp) = try? await URLSession.shared.data(for: req),
          let http = resp as? HTTPURLResponse else { return false }
    return http.statusCode < 300
}

// MARK: - App Intents

struct CompleteTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Complete Task"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Task ID") var taskId: String

    init() {}
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let data = loadData(), tokenValid(data) else {
            return .result(dialog: "Open LifeOS to sync")
        }
        let now = ISO8601DateFormatter().string(from: Date())
        let ok = await supabasePatch(data: data, path: "tasks", query: "id=eq.\(taskId)",
                                     body: ["status": "done", "updated_at": now])
        if ok { WidgetCenter.shared.reloadAllTimelines() }
        return .result(dialog: ok ? "Done!" : "Open LifeOS to sync")
    }
}

struct RolloverTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Move to Tomorrow"
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Task ID") var taskId: String

    init() {}
    init(taskId: String) { self.taskId = taskId }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let data = loadData(), tokenValid(data) else {
            return .result(dialog: "Open LifeOS to sync")
        }
        let cal = Calendar.current
        let tomorrow = cal.date(byAdding: .day, value: 1, to: Date())!
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        let tomorrowStr = fmt.string(from: tomorrow)
        let now = ISO8601DateFormatter().string(from: Date())
        let ok = await supabasePatch(data: data, path: "tasks", query: "id=eq.\(taskId)",
                                     body: ["due_date": tomorrowStr, "status": "rolled_over", "updated_at": now])
        if ok { WidgetCenter.shared.reloadAllTimelines() }
        return .result(dialog: ok ? "→ Tomorrow" : "Open LifeOS to sync")
    }
}

// MARK: - Timeline

struct Entry: TimelineEntry {
    let date: Date
    let data: WidgetData?
    let loadResult: LoadResult
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry {
        let r = LoadResult(data: nil, defaultsNil: false, rawNil: true, rawLen: 0, decodeFailed: false)
        return Entry(date: .now, data: nil, loadResult: r)
    }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) {
        let r = loadDataDetailed()
        completion(Entry(date: .now, data: r.data, loadResult: r))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let r = loadDataDetailed()
        let entry = Entry(date: .now, data: r.data, loadResult: r)
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: .now)!
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Views

struct TaskRowView: View {
    let task: WTask

    var body: some View {
        HStack(spacing: 6) {
            Button(intent: CompleteTaskIntent(taskId: task.id)) {
                Image(systemName: task.taskType == "event" ? "square" : "circle")
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)

            VStack(alignment: .leading, spacing: 0) {
                Text(task.title)
                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                    .lineLimit(1)
                if task.rolloverCount > 0 {
                    Text("↺\(task.rolloverCount)")
                        .font(.system(size: 8, design: .monospaced))
                        .foregroundStyle(.orange)
                }
            }

            Spacer(minLength: 0)

            Button(intent: RolloverTaskIntent(taskId: task.id)) {
                Image(systemName: "arrow.right")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
    }
}

struct WidgetView: View {
    let entry: Entry
    @Environment(\.widgetFamily) var family

    var agOk: Bool { entry.data != nil }
    var jwtOk: Bool { tokenValid(entry.data) }
    var debugLine: String {
        let r = entry.loadResult
        if r.defaultsNil { return "DEFAULTS-NIL" }
        if r.rawNil { return "RAW-NIL" }
        if r.decodeFailed { return "DECODE-FAIL raw=\(r.rawLen)" }
        return "raw=\(r.rawLen) tasks=\(entry.data?.tasks.count ?? 0)"
    }

    var todayTasks: [WTask] {
        guard let all = entry.data?.tasks else { return [] }
        let fmt = DateFormatter(); fmt.dateFormat = "yyyy-MM-dd"
        let todayStr = fmt.string(from: .now)
        return all.filter { $0.dueDate.hasPrefix(todayStr) }
    }

    var limit: Int { family == .systemMedium ? 4 : 7 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack(spacing: 5) {
                Text("LIFEOS")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .foregroundStyle(.secondary)
                // Risk-test indicators — remove once confirmed working
                Text(debugLine)
                    .font(.system(size: 7.5, design: .monospaced))
                    .foregroundStyle(agOk ? Color.green : Color.red)
                Text(jwtOk ? "JWT✓" : "JWT✗")
                    .font(.system(size: 8, design: .monospaced))
                    .foregroundStyle(jwtOk ? Color.green : Color.red)
                Spacer()
                // Brain dump — deep link opens app to braindump screen
                Link(destination: URL(string: "lifeos://braindump")!) {
                    Image(systemName: "brain")
                        .font(.system(size: 12))
                        .foregroundStyle(.tint)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .padding(.bottom, 5)

            Divider().padding(.horizontal, 12)

            if todayTasks.isEmpty {
                Spacer()
                Text(agOk ? "Clear today" : "Open LifeOS to load")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(todayTasks.prefix(limit).enumerated()), id: \.element.id) { idx, task in
                        TaskRowView(task: task)
                        if idx < min(limit, todayTasks.count) - 1 {
                            Divider().padding(.horizontal, 12)
                        }
                    }
                    if todayTasks.count > limit {
                        Text("+\(todayTasks.count - limit) more")
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

// MARK: - Widget entry point

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
