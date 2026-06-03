import type { DocType, Role } from '@/lib/domain';
import { ROLES } from '@/lib/domain';

/** Map a Korean/English role label to a canonical Role. */
const LABEL_TO_ROLE: Record<string, Role> = {
  // Korean
  지도교수: 'supervisor',
  지도: 'supervisor',
  부지도교수: 'co_supervisor',
  공동지도교수: 'co_supervisor',
  공동지도: 'co_supervisor',
  심사위원: 'committee',
  심사위원장: 'committee',
  위원: 'committee',
  위원장: 'committee',
  학과장: 'department_head',
  주임교수: 'department_head',
  책임자: 'principal_investigator',
  연구책임자: 'principal_investigator',
  참여연구진: 'research_staff',
  연구원: 'research_staff',
  공저자: 'coauthor',
  저자: 'coauthor',
  부서장: 'division_head',
  실장: 'office_head',
  과제책임자: 'project_manager',
  // English
  advisor: 'supervisor',
  supervisor: 'supervisor',
  'thesis advisor': 'supervisor',
  'co-advisor': 'co_supervisor',
  'co advisor': 'co_supervisor',
  'co-supervisor': 'co_supervisor',
  'co-chair': 'co_supervisor',
  chair: 'committee',
  committee: 'committee',
  'committee member': 'committee',
  examiner: 'committee',
  member: 'committee',
  head: 'department_head',
  'department head': 'department_head',
  'head of department': 'department_head',
  coauthor: 'coauthor',
  'co-author': 'coauthor',
  author: 'coauthor',
  pi: 'principal_investigator',
  'principal investigator': 'principal_investigator',
};

export function roleFromLabel(label?: string | null): Role | null {
  if (!label) return null;
  const trimmed = label.trim();
  if ((ROLES as readonly string[]).includes(trimmed)) return trimmed as Role;
  const lower = trimmed.toLowerCase();
  if ((ROLES as readonly string[]).includes(lower)) return lower as Role;
  return LABEL_TO_ROLE[trimmed] ?? LABEL_TO_ROLE[lower] ?? null;
}

export function defaultRoleForDoc(docType: DocType): Role {
  return docType === 'degree_thesis' ? 'committee' : 'coauthor';
}
