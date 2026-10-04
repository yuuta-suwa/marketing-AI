"use client";
import { cancelResearchAction } from "@/app/actions/research";
import { ActionForm } from "./action-form";
import { SubmitButton } from "../submit-button";

export function CancelRunForm({ runId }: { runId: string }) {
  return (
    <div className="mb-4" data-testid="cancel-run">
      <ActionForm action={cancelResearchAction}>
        <input type="hidden" name="runId" value={runId} />
        <SubmitButton variant="secondary">調査をキャンセル</SubmitButton>
      </ActionForm>
    </div>
  );
}
