export interface TargetProjectConfig {
  targetProject: string;
  ticketTag: string | null;
  copyDescription: boolean;
  copyAttachments: boolean;
}

export interface ProjectConfig {
  triggerState: string | null;
  targets: Record<string, TargetProjectConfig>;
}

export type ProjectMap = Record<string, ProjectConfig>;

export const LINK_TYPE_OUTWARD = 'is duplicated by'
export const LINK_TYPE_INWARD = 'duplicates'

export function parseProjectMap(
  raw: string | undefined,
  logPrefix: string
): ProjectMap | null {
  if (!raw || raw.trim() === '') {
    console.error(`${logPrefix} ERROR: "projectMap" setting is empty. Configure it in Administration → Apps → helpdesk-sync → Settings.`)
    return null
  }

  try {
    const result: ProjectMap = {}

    const pairs = raw.split(',').map(s => s.trim()).filter(Boolean)

    for (const pair of pairs) {
      const [from, to] = pair.split('-').map(s => s.trim())
      if (!from || !to) {
        console.error(`${logPrefix} ERROR: Invalid mapping "${pair}". Expected format: FROM-TO`)
        return null
      }

      if (!result[from]) {
        result[from] = {
          triggerState: null,
          targets: {}
        }
      }

      result[from].targets[to] = {
        targetProject: to,
        ticketTag: null,
        copyDescription: true,
        copyAttachments: true
      }
    }

    console.log(`${logPrefix} projectMap parsed successfully. Keys: ${Object.keys(result).join(', ')}`)
    return result
  } catch (e) {
    console.error(`${logPrefix} ERROR: Failed to parse "projectMap" setting: ${e}`)
    return null
  }
}

/** Returns a Set of ALL project keys involved in any mapping (both source and target). */
export function getAllMappedProjects(projectMap: ProjectMap): Set<string> {
  const keys = new Set<string>()
  for (const [from, config] of Object.entries(projectMap)) {
    keys.add(from)
    for (const t of Object.values(config.targets)) {
      keys.add(t.targetProject)
    }
  }
  return keys
}

/** Collect linked issues from BOTH directions, filtered to mapped projects only */
export function getLinkedIssues(issue: any, allProjects: Set<string>): any[] {
  const linked: any[] = []
  issue.links[LINK_TYPE_OUTWARD].forEach((li: any) => {
    if (allProjects.has(li.project.key)) linked.push(li)
  })
  issue.links[LINK_TYPE_INWARD].forEach((li: any) => {
    if (allProjects.has(li.project.key)) linked.push(li)
  })
  return linked
}

/** Build a collapsible alert comment */
export function alertComment(message: string): string {
  return `<details><summary><span style="color:dimgray;">⚠️ Helpdesk sync</span></summary>\n\n${message}\n\n</details>`
}

