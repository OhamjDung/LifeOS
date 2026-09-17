export function normalizeGroups(raw: { groups?: unknown }, tasks: { id: string; title: string }[]) {
    const allowed = new Set(tasks.map(t => t.id))
    const assigned = new Set<string>()
    const colors = new Set(['indigo', 'orange', 'green', 'yellow', 'rose', 'cyan', 'purple'])
    const groups: { name: string; color: string; task_ids: string[] }[] = []
    for (const group of Array.isArray(raw?.groups) ? raw.groups : []) {
      if (groups.length === 6) break
      if (!group || typeof group.name !== 'string' || !group.name.trim() || !Array.isArray(group.task_ids)) continue
      const ids = [...new Set<string>(group.task_ids.filter((id: unknown): id is string =>
        typeof id === 'string' && allowed.has(id) && !assigned.has(id)))]
      if (ids.length < 2) continue
      ids.forEach(id => assigned.add(id))
      groups.push({ name: group.name.trim().slice(0, 60), color: colors.has(group.color) ? group.color : 'indigo', task_ids: ids })
    }
    return { groups, ungrouped_ids: tasks.filter(t => !assigned.has(t.id)).map(t => t.id) }

}
