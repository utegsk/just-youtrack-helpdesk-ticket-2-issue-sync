import type { ProjectConfig } from './settings'
import { LINK_TYPE_INWARD, LINK_TYPE_OUTWARD, parseProjectMap } from './settings'

import entities from '@jetbrains/youtrack-scripting-api/entities'

const LOG_PREFIX = '[auto-create-linked-issue]'

function log(id: string, msg: string) {
  console.log(`${LOG_PREFIX} [${id}] ${msg}`)
}

function warn(id: string, msg: string) {
  console.warn(`${LOG_PREFIX} [${id}] WARN: ${msg}`)
}

function error(id: string, msg: string) {
  console.error(`${LOG_PREFIX} [${id}] ERROR: ${msg}`)
}

exports.rule = entities.Issue.onChange({
  title: 'Auto-create linked dev issues from helpdesk ticket',

  guard: (ctx: any): boolean => {
    const issue = ctx.issue
    const projectKey: string = issue.project.key
    const ticketId: string = issue.id

    log(ticketId, `Guard evaluating. Project: ${projectKey}`)

    const projectMap = parseProjectMap(ctx.settings?.projectMap, LOG_PREFIX)
    if (!projectMap) return false

    if (!projectMap.hasOwnProperty(projectKey)) {
      log(ticketId, 'Guard EXIT — project not in projectMap.')
      return false
    }

    const config: ProjectConfig = projectMap[projectKey]!

    // Check how many targets are already linked
    const existingLinkedProjects: string[] = []
    issue.links[LINK_TYPE_OUTWARD].forEach((linked: any) => {
      existingLinkedProjects.push(linked.project.key)
    })

    const pendingTargets = Object.values(config.targets).filter(
      (t) => !existingLinkedProjects.includes(t.targetProject)
    )

    if (pendingTargets.length === 0) {
      log(ticketId, 'Guard EXIT — all target projects already linked.')
      return false
    }

    log(ticketId, `Pending targets: ${pendingTargets.map((t) => t.targetProject).join(', ')}`)

    if (config.triggerState === null) {
      const result: boolean = issue.becomesReported
      log(ticketId, `Trigger mode: on creation. becomesReported=${result}`)
      return result
    }

    const stateChanged: boolean = issue.fields.isChanged(ctx.State)
    const currentState: string = issue.fields.State?.name ?? 'null'
    log(ticketId, `Trigger mode: state. stateChanged=${stateChanged}, currentState="${currentState}", triggerState="${config.triggerState}"`)

    const result = stateChanged && currentState === config.triggerState
    if (!result) log(ticketId, 'Guard EXIT — state condition not met.')
    return result
  },

  action: (ctx: any): void => {
    const ticket = ctx.issue
    const projectKey: string = ticket.project.key
    const ticketId: string = ticket.id

    const projectMap = parseProjectMap(ctx.settings?.projectMap, LOG_PREFIX)
    if (!projectMap) return

    const config: ProjectConfig = projectMap[projectKey]!

    const existingLinkedProjects: string[] = []
    ticket.links[LINK_TYPE_OUTWARD].forEach((linked: any) => {
      existingLinkedProjects.push(linked.project.key)
    })

    log(ticketId, `Action started. Targets: ${Object.keys(config.targets).join(', ')}`)
    log(ticketId, `Already linked: ${existingLinkedProjects.join(', ') || 'none'}`)

    const createdIssues: string[] = []

    for (const [label, targetConfig] of Object.entries(config.targets)) {
      log(ticketId, `Processing target "${label}" → ${targetConfig.targetProject}`)

      if (existingLinkedProjects.includes(targetConfig.targetProject)) {
        warn(ticketId, `Target "${label}" already linked, skipping.`)
        continue
      }

      const targetProject = entities.Project.findByKey(targetConfig.targetProject)
      if (!targetProject) {
        error(ticketId, `Project "${targetConfig.targetProject}" not found. Skipping target "${label}".`)
        continue
      }

      let description = ''
      if (targetConfig.copyDescription) {
        description += ticket.description || '_No description provided._'
      }
      description += `\n\n---\n\nAutomatically created from helpdesk ticket **${ticketId}**.`

      const newIssue = new entities.Issue(ctx.currentUser, targetProject, ticket.summary)
      newIssue.description = description
      log(ticketId, `Issue created: ${newIssue.id}`)

      if (targetConfig.copyAttachments) {
        let count = 0
        ticket.attachments.forEach((att: any) => {
          newIssue.attachments.add(att)
          count++
        })
        log(ticketId, `Attachments copied: ${count}`)
      }

      ticket.links[LINK_TYPE_OUTWARD].add(newIssue)
      log(ticketId, `Linked ${ticketId} --[${LINK_TYPE_OUTWARD}]--> ${newIssue.id}`)

      if (targetConfig.ticketTag) {
        ticket.addTag(targetConfig.ticketTag)
        log(ticketId, `Tag applied: "${targetConfig.ticketTag}"`)
      }

      createdIssues.push(`**${newIssue.id}** (${targetConfig.targetProject})`)
    }

    if (createdIssues.length > 0) {
      ticket.addComment(
        `Dev issues automatically created and linked:\n` +
        createdIssues.map((i) => `- ${i}`).join('\n')
      )
      log(ticketId, `Done. Created: ${createdIssues.join(', ')}`)
    } else {
      warn(ticketId, 'No issues created — all targets already linked or failed.')
    }
  },

  requirements: {
    State: {
      type: entities.State.fieldType,
      name: 'State'
    },
    Duplicate: {
      type: entities.IssueLinkPrototype,
      outward: LINK_TYPE_OUTWARD,
      inward: LINK_TYPE_INWARD
    }
  }
})
