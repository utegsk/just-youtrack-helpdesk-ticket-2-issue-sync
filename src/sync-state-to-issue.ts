import { LINK_TYPE_INWARD, LINK_TYPE_OUTWARD, parseProjectMap, getAllMappedProjects, getLinkedIssues, alertComment } from './settings'

import entities from '@jetbrains/youtrack-scripting-api/entities'

const LOG_PREFIX = '[sync-fields]'

function log(id: string, msg: string) {
  console.log(`${LOG_PREFIX} [${id}] ${msg}`)
}

function error(id: string, msg: string) {
  console.error(`${LOG_PREFIX} [${id}] ERROR: ${msg}`)
}

/** Bundle-type fields store named values — need findValueByName to resolve in target project */
function isBundleType(typeName: string): boolean {
  return /^(state|enum|ownedField|version|build)\[/.test(typeName)
}

exports.rule = entities.Issue.onChange({
  title: 'Sync fields between linked issues (bidirectional)',

  guard: (ctx: any): boolean => {
    const issue = ctx.issue
    const projectKey: string = issue.project.key
    const ticketId: string = issue.id

    log(ticketId, `Guard evaluating. Project: ${projectKey}`)

    try {
      const projectMap = parseProjectMap(ctx.settings?.projectMap, LOG_PREFIX)
      if (!projectMap) {
        log(ticketId, `Guard EXIT — projectMap is empty or invalid. Raw value: "${ctx.settings?.projectMap}"`)
        return false
      }

      const allProjects = getAllMappedProjects(projectMap)

      if (!allProjects.has(projectKey)) {
        log(ticketId, 'Guard EXIT — project not in any mapping.')
        return false
      }

      // Check if any custom field changed
      let anyChanged = false
      issue.project.fields.forEach((field: any) => {
        if (!anyChanged && issue.fields.isChanged(field.name)) {
          anyChanged = true
        }
      })

      if (!anyChanged) {
        log(ticketId, 'Guard EXIT — no custom fields changed.')
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

  action: (ctx: any): void => {
    const ticket = ctx.issue
    const ticketId: string = ticket.id

    try {
      const projectMap = parseProjectMap(ctx.settings?.projectMap, LOG_PREFIX)
      if (!projectMap) {
        ticket.addComment(alertComment('projectMap setting is empty or invalid. Configure it in Administration → Apps → helpdesk-sync → Settings.'))
        return
      }

      const allProjects = getAllMappedProjects(projectMap)

      // Collect changed fields
      const changedFields: any[] = []
      ticket.project.fields.forEach((field: any) => {
        if (ticket.fields.isChanged(field.name)) {
          changedFields.push(field)
        }
      })

      log(ticketId, `Action started. Changed fields: ${changedFields.map((f: any) => f.name).join(', ')}`)

      const linkedIssues = getLinkedIssues(ticket, allProjects)

      for (const linkedIssue of linkedIssues) {
        log(ticketId, `Processing linked issue: ${linkedIssue.id} (project: ${linkedIssue.project.key})`)

        for (const srcField of changedFields) {
          const fieldName: string = srcField.name
          const fieldType: string = srcField.typeName

          try {
            // Find matching field (same name) in the target project
            const targetField = linkedIssue.project.findFieldByName(fieldName)
            if (!targetField) {
              log(ticketId, `Field "${fieldName}" not found in ${linkedIssue.project.key}, skipping.`)
              continue
            }

            if (targetField.typeName !== fieldType) {
              log(ticketId, `Field "${fieldName}" type mismatch: source="${fieldType}", target="${targetField.typeName}". Skipping.`)
              continue
            }

            const srcValue = ticket.fields[fieldName]

            // Handle null / cleared fields
            if (srcValue == null) {
              if (linkedIssue.fields[fieldName] == null) {
                log(ticketId, `"${fieldName}" already null on ${linkedIssue.id}, skipping.`)
                continue
              }
              linkedIssue.fields[fieldName] = null
              log(ticketId, `Cleared "${fieldName}" on ${linkedIssue.id}`)
              continue
            }

            if (isBundleType(fieldType)) {
              // Bundle fields: resolve value by name in target project
              const valueName: string = srcValue.name
              // Skip if already the same (prevent infinite loop)
              if (linkedIssue.fields[fieldName]?.name === valueName) {
                log(ticketId, `"${fieldName}" already "${valueName}" on ${linkedIssue.id}, skipping.`)
                continue
              }
              const targetValue = targetField.findValueByName(valueName)
              if (!targetValue) {
                error(ticketId, `Value "${valueName}" for field "${fieldName}" not found in ${linkedIssue.project.key}.`)
                linkedIssue.addComment(alertComment(`Value "${valueName}" for field "${fieldName}" does not exist in this project.`))
                continue
              }
              linkedIssue.fields[fieldName] = targetValue
            } else {
              // User / simple fields: skip if already the same (prevent infinite loop)
              const currentValue = linkedIssue.fields[fieldName]
              if (currentValue === srcValue || (currentValue?.id != null && currentValue.id === srcValue.id)) {
                log(ticketId, `"${fieldName}" already same on ${linkedIssue.id}, skipping.`)
                continue
              }
              linkedIssue.fields[fieldName] = srcValue
            }

            log(ticketId, `Synced "${fieldName}" on ${linkedIssue.id}`)
          } catch (e) {
            error(ticketId, `Failed to sync field "${fieldName}" on ${linkedIssue.id}: ${e}`)
            linkedIssue.addComment(alertComment(`Failed to sync field "${fieldName}": ${e}`))
          }
        }
      }

      log(ticketId, 'Action completed.')
    } catch (e) {
      error(ticketId, `Action crashed: ${e}`)
      try {
        ticket.addComment(alertComment(`Field sync failed: ${e}`))
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
