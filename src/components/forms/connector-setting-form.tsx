"use client";
import { connectorSettingAction } from "@/app/actions/settings";
import { ActionForm } from "./action-form";
import { SubmitButton } from "../submit-button";

export function ConnectorSettingForm(props: {
  connectorKey: string;
  enabled: boolean;
  compliance: string;
  allowedStatuses: readonly string[];
  termsNotes: string | null;
}) {
  return (
    <ActionForm action={connectorSettingAction} className="mt-3 space-y-2 border-t border-line pt-3">
      <input type="hidden" name="connectorKey" value={props.connectorKey} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={props.enabled} className="size-4" /> この組織で有効にする
      </label>
      <label className="block text-xs text-muted" htmlFor={`cs-${props.connectorKey}`}>コンプライアンス状態（コード上の状態より緩めることはできません）</label>
      <select id={`cs-${props.connectorKey}`} name="complianceStatus" defaultValue={props.compliance} className="min-h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm">
        {props.allowedStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <textarea name="termsNotes" rows={2} maxLength={2000} defaultValue={props.termsNotes ?? ""} placeholder="Terms notes（規約レビューのメモ）" className="w-full rounded-xl border border-line bg-bg p-2 text-xs" />
      <SubmitButton variant="secondary">保存</SubmitButton>
    </ActionForm>
  );
}
