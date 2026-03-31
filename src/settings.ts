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

/**
 * Check whether a user is a helpdesk agent (project team member).
 * In Helpdesk projects only agents can update comment visibility, so
 * we must skip syncing when triggered by a non-agent (reporter / customer).
 */
export function isHelpdeskAgent(user: any, project: any): boolean {
  try {
    const team = project?.team
    if (!team || !team.name) return false
    return !!user?.isInGroup(team.name)
  } catch (_) {
    return false
  }
}

/**
 * Make a comment publicly visible (clear all visibility restrictions).
 * In helpdesk projects, comments created by workflows inherit the default
 * project visibility (e.g. "support-urg Team"), which hides them from reporters.
 */
export function makeCommentPublic(comment: any): void {
  try {
    comment.permittedGroup = null
  } catch (_) { /* field may not exist */ }
  try {
    if (comment.permittedGroups && !comment.permittedGroups.isEmpty()) {
      comment.permittedGroups.clear()
    }
  } catch (_) { /* ignore */ }
  try {
    if (comment.permittedUsers && !comment.permittedUsers.isEmpty()) {
      comment.permittedUsers.clear()
    }
  } catch (_) { /* ignore */ }
}

/**
 * Extract attachment filenames referenced in markdown text.
 * Matches patterns like ![alt](filename.ext) and ![alt](filename.ext){...}
 */
export function extractReferencedAttachments(text: string): string[] {
  const names: string[] = []
  // Match ![...](name) — only bare filenames, not URLs
  const regex = /!\[[^\]]*]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    const ref = match[1]!
    // Skip external URLs
    if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('//')) continue
    names.push(ref)
  }
  return names
}

/**
 * Copy attachments referenced in a comment from sourceIssue to targetIssue.
 * Also copies any attachments directly attached to the comment object.
 * Returns the number of attachments copied.
 */
export function copyReferencedAttachments(
  comment: any,
  sourceIssue: any,
  targetIssue: any,
  logFn?: (msg: string) => void
): number {
  let copied = 0
  const copiedNames = new Set<string>()

  // 1. Copy comment-level attachments
  if (comment.attachments && !comment.attachments.isEmpty()) {
    comment.attachments.forEach((att: any) => {
      try {
        targetIssue.addAttachment(att.content, att.name, undefined, att.mimeType)
        copiedNames.add(att.name)
        copied++
        logFn?.(`Copied comment attachment: ${att.name}`)
      } catch (e) {
        logFn?.(`Failed to copy comment attachment ${att.name}: ${e}`)
      }
    })
  }

  // 2. Copy issue-level attachments referenced in the comment text
  const referencedNames = extractReferencedAttachments(comment.text || '')
  if (referencedNames.length > 0) {
    sourceIssue.attachments.forEach((att: any) => {
      if (referencedNames.includes(att.name) && !copiedNames.has(att.name)) {
        try {
          targetIssue.addAttachment(att.content, att.name, undefined, att.mimeType)
          copiedNames.add(att.name)
          copied++
          logFn?.(`Copied referenced attachment: ${att.name}`)
        } catch (e) {
          logFn?.(`Failed to copy referenced attachment ${att.name}: ${e}`)
        }
      }
    })
  }

  return copied
}

