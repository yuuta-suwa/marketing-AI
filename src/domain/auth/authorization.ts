import { DomainError } from "../shared/errors";

export const ORG_ROLES = ["viewer", "member", "admin", "owner"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

const RANK: Record<OrgRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export const ACTIONS = {
  "research.read": "viewer",
  "research.create": "member",
  "opportunity.update": "member",
  "opportunity.decide": "member",
  "analysis.run": "member",
  "watchlist.manage": "member",
  "opportunity.ceo_approve": "admin",
  "connector.configure": "admin",
  "scoring.configure": "admin",
  "member.manage": "admin",
  "audit.read": "admin",
  "job.manage": "admin",
  "data.delete": "admin",
  "organization.delete": "owner",
} as const satisfies Record<string, OrgRole>;
export type Action = keyof typeof ACTIONS;

export type Actor = {
  userId: string;
  organizationId: string;
  /** Role from organization_members — never from user-editable metadata. */
  role: OrgRole;
};

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return RANK[role] >= RANK[min];
}

export function can(actor: Actor | null | undefined, action: Action, organizationId?: string): boolean {
  if (!actor) return false;
  if (organizationId && actor.organizationId !== organizationId) return false;
  return roleAtLeast(actor.role, ACTIONS[action]);
}

/**
 * Application-level check. RLS in the database is the authoritative control;
 * this exists to fail fast with a clear error and to hide UI affordances.
 */
export function authorize(actor: Actor | null | undefined, action: Action, organizationId?: string): Actor {
  if (!actor) throw new DomainError("FORBIDDEN", "Authentication required");
  if (!can(actor, action, organizationId)) {
    throw new DomainError("FORBIDDEN", `Not allowed: ${action}`, { role: actor.role });
  }
  return actor;
}
