-- M1 follow-up: compliance status vocabulary + connector terms notes.
--   APPROVED | RESTRICTED | PENDING_REVIEW | DISABLED_PENDING_COMPLIANCE | DISABLED
-- (BLOCKED is renamed to DISABLED.)

update public.connectors set compliance_status = 'DISABLED' where compliance_status = 'BLOCKED';
update public.compliance_checks set status = 'DISABLED' where status = 'BLOCKED';

alter table public.connectors drop constraint connectors_compliance_status_check;
alter table public.connectors add constraint connectors_compliance_status_check
  check (compliance_status in ('APPROVED', 'RESTRICTED', 'PENDING_REVIEW', 'DISABLED_PENDING_COMPLIANCE', 'DISABLED'));

alter table public.compliance_checks drop constraint compliance_checks_status_check;
alter table public.compliance_checks add constraint compliance_checks_status_check
  check (status in ('APPROVED', 'RESTRICTED', 'PENDING_REVIEW', 'DISABLED_PENDING_COMPLIANCE', 'DISABLED'));

alter table public.connectors add column terms_url text;
alter table public.connectors add column terms_notes text;

comment on column public.connectors.terms_notes is
  'Reviewer notes about the provider terms (storage rights, attribution, deletion duties).';
