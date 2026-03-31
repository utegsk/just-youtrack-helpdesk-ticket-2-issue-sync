import { LINK_TYPE_INWARD, LINK_TYPE_OUTWARD, parseProjectMap, getAllMappedProjects, getLinkedIssues, alertComment, copyReferencedAttachments } from './settings'

import entities from '@jetbrains/youtrack-scripting-api/entities'

const LOG_PREFIX = '[sync-comment]'

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
  title: 'Sync comments between linked issues (bidirectional)',

  guard: (ctx): boolean => {
    const issue = ctx.issue
    const projectKey: string = issue.project.key
    const ticketId: string = issue.id

    log(ticketId, `Guard evaluating. Project: ${projectKey}`)

    try {
      // @ts-ignore
      const projectMap = parseProjectMap(ctx.settings?.projectMap, LOG_PREFIX)
      if (!projectMap) {
        // @ts-ignore
        log(ticketId, `Guard EXIT — projectMap is empty or invalid. Raw value: "${ctx.settings?.projectMap}"`)
        return false
      }

      const allProjects = getAllMappedProjects(projectMap)

      if (!allProjects.has(projectKey)) {
        log(ticketId, 'Guard EXIT — project not in any mapping.')
        return false
      }

      if (issue.comments.added.isEmpty()) {
        log(ticketId, 'Guard EXIT — no comments added.')
        return false
      }

      const linked = getLinkedIssues(issue, allProjects)
      if (linked.length === 0) {
        log(ticketId, 'Guard EXIT — no linked issues in mapped projects.')
        return false
      }

      log(ticketId, 'Guard PASSED.')
      return true
    } catch (e) {
      error(ticketId, `Guard crashed: ${e}`)
      return false
    }
  },

  action: (ctx): void => {
    const ticket = ctx.issue
    const ticketId: string = ticket.id

    try {
      // @ts-ignore
      const projectMap = parseProjectMap(ctx.settings?.projectMap, LOG_PREFIX)
      if (!projectMap) {
        ticket.addComment(alertComment('projectMap setting is empty or invalid. Configure it in Administration → Apps → helpdesk-sync → Settings.'))
        return
      }

      const allProjects = getAllMappedProjects(projectMap)

      const comment = ticket.comments.added.first()
      if (!comment) {
        warn(ticketId, 'No added comment found, skipping.')
        return
      }

      const authorName: string = comment.author?.fullName ?? 'Unknown'
      log(ticketId, `Action started. Author: ${authorName}`)

      const isPrivate: boolean =
        comment.permittedGroup != null ||
        (comment.permittedGroups != null && !comment.permittedGroups.isEmpty()) ||
        (comment.permittedUsers != null && !comment.permittedUsers.isEmpty())

      if (isPrivate) {
        warn(ticketId, 'Comment is private, skipping mirror.')
        return
      }

      // Skip comments that were already mirrored (prevent infinite loop)
      if (comment.text?.startsWith('[') && comment.text?.includes(']: ')) {
        log(ticketId, 'Comment looks like a mirrored comment, skipping to prevent loop.')
        return
      }

      const prefix = `[${ticketId} — ${authorName}]: \n\n`

      const linkedIssues = getLinkedIssues(ticket, allProjects)

      for (const linkedIssue of linkedIssues) {
        try {
          // Copy attachments referenced in the comment (images, files) so Markdown renders correctly
          const attCount = copyReferencedAttachments(
            comment,
            ticket,
            linkedIssue,
            (msg) => log(ticketId, msg)
          )
          if (attCount > 0) {
            log(ticketId, `Copied ${attCount} attachment(s) to ${linkedIssue.id}`)
          }

          linkedIssue.addComment(prefix + comment.text)
          log(ticketId, `Comment mirrored to ${linkedIssue.id}`)
        } catch (e) {
          error(ticketId, `Failed to mirror comment to ${linkedIssue.id}: ${e}`)
          try {
            linkedIssue.addComment(alertComment(`Failed to mirror comment from ${ticketId}: ${e}`))
          } catch (_) { /* ignore */ }
        }
      }

      log(ticketId, 'Action completed.')
    } catch (e) {
      error(ticketId, `Action crashed: ${e}`)
      try {
        ticket.addComment(alertComment(`Comment sync failed: ${e}`))
      } catch (_) { /* ignore */ }
    }
  },

  requirements: {
    Duplicate: {
      type: entities.IssueLinkPrototype,
      outward: LINK_TYPE_OUTWARD,
      inward: LINK_TYPE_INWARD
    }
  }
})
