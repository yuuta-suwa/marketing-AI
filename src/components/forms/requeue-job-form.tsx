"use client";
import { requeueJobAction } from "@/app/actions/settings";
import { ActionForm } from "./action-form";
import { SubmitButton } from "../submit-button";

export function RequeueJobForm({ jobId }: { jobId: string }) {
  return (
    <ActionForm action={requeueJobAction} className="mt-1">
      <input type="hidden" name="jobId" value={jobId} />
      <SubmitButton variant="secondary">再キュー</SubmitButton>
    </ActionForm>
  );
}
