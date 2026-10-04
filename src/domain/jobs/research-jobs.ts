import type { JobType } from "./job";

/** Job types that drive one stage of a research run (their failure fails the run). */
export const RESEARCH_STAGE_JOB_TYPES: readonly JobType[] = [
  "RESEARCH_COLLECTION",
  "SIGNAL_EXTRACTION",
  "CLUSTER_GENERATION",
  "OPPORTUNITY_GENERATION",
];
