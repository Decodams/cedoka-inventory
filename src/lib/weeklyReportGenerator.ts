import { sanitizeMultiline } from '@/lib/sanitize';
import type { ActivityCategory, DailyActivity, Issue } from '@/types/database';

export interface GeneratedWeeklyNotes {
  activities_notes: string;
  challenges_notes: string;
  issues_notes: string;
  improvement_notes: string;
}

const CATEGORY_ORDER: ActivityCategory[] = [
  'meeting',
  'customer_event',
  'supplier_activity',
  'delivery',
  'maintenance',
  'staff',
  'incident',
  'follow_up',
  'other',
];

const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  meeting: 'Meetings',
  customer_event: 'Customer Events',
  supplier_activity: 'Supplier Activity',
  delivery: 'Deliveries',
  maintenance: 'Maintenance',
  staff: 'Staff Matters',
  incident: 'Incidents',
  follow_up: 'Follow-ups',
  other: 'Other Activities',
};

function oneLine(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Expert-system style roll-up of a Mon-Sat week of Daily Activities plus the
 * Issues raised in the same window, into the four weekly-report narrative
 * fields. Grouping is by category (in business priority order), within a
 * category by date then title, so the output reads as a clean narrative.
 */
export function buildWeeklyNotes(activities: DailyActivity[], issues: Issue[]): GeneratedWeeklyNotes & {
  count: number;
} {
  const byCategory = new Map<ActivityCategory, DailyActivity[]>();
  for (const activity of activities) {
    const list = byCategory.get(activity.category) ?? [];
    list.push(activity);
    byCategory.set(activity.category, list);
  }

  const activityLines: string[] = ['WEEKLY ACTIVITIES SUMMARY (Mon-Sat, Auto-Generated)', ''];
  for (const category of CATEGORY_ORDER) {
    const list = byCategory.get(category);
    if (!list || list.length === 0) continue;
    activityLines.push(CATEGORY_LABELS[category].toUpperCase());
    const sorted = [...list].sort((a, b) =>
      a.activity_date === b.activity_date
        ? a.title.localeCompare(b.title)
        : a.activity_date.localeCompare(b.activity_date),
    );
    for (const activity of sorted) {
      const detail = oneLine(activity.description);
      activityLines.push(
        `  - [${activity.activity_date}] ${oneLine(activity.title)}${detail ? `: ${detail}` : ''}`,
      );
      if (activity.requires_follow_up && oneLine(activity.follow_up_notes)) {
        activityLines.push(`    Follow-up: ${oneLine(activity.follow_up_notes)}`);
      }
    }
    activityLines.push('');
  }
  if (activities.length === 0) {
    activityLines.push('No daily activities were recorded for this week.');
    activityLines.push('');
  }

  const challenges: string[] = ['CHALLENGES & OBSTACLES'];
  for (const activity of byCategory.get('incident') ?? []) {
    const detail = oneLine(activity.description);
    challenges.push(
      `- [${activity.activity_date}] ${oneLine(activity.title)}${detail ? `: ${detail}` : ''}`,
    );
  }
  for (const issue of issues) {
    if (issue.priority === 'high' || issue.priority === 'critical' || issue.requires_management_attention) {
      const detail = oneLine(issue.description);
      challenges.push(
        `- [ISSUE:${issue.status}] ${oneLine(issue.title)} (${issue.priority}/${issue.severity})${detail ? `: ${detail}` : ''}`,
      );
    }
  }
  if (challenges.length === 1) challenges.push('- None recorded this week.');

  const escalations: string[] = ['ISSUES REQUIRING ESCALATION'];
  for (const issue of issues) {
    if (!issue.requires_management_attention && issue.priority !== 'critical' && issue.priority !== 'high') continue;
    const parts = [oneLine(issue.title), `[${issue.status}]`, `Priority: ${issue.priority}`, `Severity: ${issue.severity}`];
    if (issue.deadline) parts.push(`Deadline: ${issue.deadline}`);
    if (oneLine(issue.description)) parts.push(oneLine(issue.description));
    escalations.push(`- ${parts.join(' | ')}`);
  }
  if (escalations.length === 1) escalations.push('- None identified for escalation this week.');

  const improvements: string[] = ['IMPROVEMENTS / ACTIONS PLANNED'];
  for (const activity of byCategory.get('follow_up') ?? []) {
    const followUp = oneLine(activity.follow_up_notes);
    improvements.push(`- [${activity.activity_date}] ${oneLine(activity.title)}${followUp ? `: ${followUp}` : ''}`);
  }
  if (improvements.length === 1) improvements.push('- Review ongoing actions at the next weekly review.');

  return {
    activities_notes: sanitizeMultiline(activityLines.join('\n')),
    challenges_notes: sanitizeMultiline(challenges.join('\n')),
    issues_notes: sanitizeMultiline(escalations.join('\n')),
    improvement_notes: sanitizeMultiline(improvements.join('\n')),
    count: activities.length,
  };
}
