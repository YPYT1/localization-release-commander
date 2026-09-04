"use client";

import { useActionState } from "react";
import { addAssetAction, createReleaseAction, decideActionAction, deliveryAction, executeActionAction, initialFormState, runReleaseAction } from "@/app/app/actions";
import type { RuleSetDto } from "@/lib/api";

function Feedback({ state }: { state: typeof initialFormState }) {
  if (state.status === "idle") return null;
  return <p className={`form-feedback ${state.status}`} role="status" aria-live="polite">{state.message}</p>;
}

export function CreateReleaseForm({ ruleSets }: { ruleSets: RuleSetDto[] }) {
  const [state, action, pending] = useActionState(createReleaseAction, initialFormState);
  return <form className="release-form" action={action}>
    <fieldset><legend><span>01</span> 内容与目标</legend><div className="field-grid">
      <label><span>项目名称</span><input name="projectName" defaultValue="Northline Shorts" autoComplete="organization" /></label>
      <label><span>集数 *</span><input name="episode" placeholder="例如：第 8 集" required /></label>
      <label><span>目标地区 *</span><select name="territory" required defaultValue=""><option value="" disabled>选择地区</option><option value="US">美国 / US</option><option value="BR">巴西 / BR</option><option value="JP">日本 / JP</option><option value="GLOBAL">全球 / GLOBAL</option></select></label>
      <label><span>目标平台 *</span><select name="platform" defaultValue="YOUTUBE"><option value="YOUTUBE">YouTube</option><option value="OTT">OTT</option></select></label>
      <label><span>交付语言 *</span><select name="language" defaultValue="en"><option value="en">英语 / en</option><option value="ja">日语 / ja</option><option value="es">西班牙语 / es</option><option value="pt-BR">葡萄牙语 / pt-BR</option></select></label>
      <label><span>交付截止</span><input name="deadline" type="datetime-local" /></label>
    </div></fieldset>
    <fieldset><legend><span>02</span> 规则版本</legend><label className="wide-field"><span>RuleSet *</span><select name="ruleSetId" required defaultValue=""><option value="" disabled>选择已发布规则</option>{ruleSets.map((ruleSet) => <option value={ruleSet.id} key={ruleSet.id}>{ruleSet.name} · v{ruleSet.version} · {ruleSet.checks} checks</option>)}</select><small>规则版本由 API 提供；创建请求会携带选中的 ruleSetId。</small></label></fieldset>
    <fieldset><legend><span>03</span> 下一步</legend><div className="form-note"><strong>先创建 DRAFT</strong><p>创建后进入详情登记正片、字幕、音频与版权资产。缺少必需资产时，确定性 QC 会返回明确阻断项。</p></div></fieldset>
    <Feedback state={state} /><div className="form-actions"><a href="/app/releases" className="quiet-button">取消</a><button className="primary-button" type="submit" disabled={pending}>{pending ? "正在创建…" : "创建 Release"}</button></div>
  </form>;
}

export function AddAssetForm({ releaseId }: { releaseId: string }) {
  const bound = addAssetAction.bind(null, releaseId);
  const [state, action, pending] = useActionState(bound, initialFormState);
  return <details className="asset-register"><summary>登记资产 <span aria-hidden="true">＋</span></summary><form action={action}>
    <div className="field-grid compact"><label><span>类型 *</span><select name="kind" defaultValue="SUBTITLE"><option>VIDEO</option><option>SUBTITLE</option><option>AUDIO</option><option>POSTER</option><option>METADATA</option><option>RIGHTS</option></select></label><label><span>文件名 *</span><input name="fileName" required placeholder="episode-08-en.srt" /></label><label><span>语言</span><input name="assetLanguage" placeholder="en" /></label></div>
    <div className="asset-source-grid"><label><span>小型文本内容</span><textarea name="content" placeholder="用于字幕、元数据或权利样例（最多 2 MB）" /></label><div><label><span>服务端对象 URI</span><input name="uri" placeholder="s3://delivery/episode-08.mov" /></label><label><span>SHA-256</span><input name="sha256" minLength={64} maxLength={64} pattern="[a-fA-F0-9]{64}" placeholder="64 位十六进制摘要" /></label></div></div>
    <label className="wide-field"><span>元数据 JSON</span><textarea name="metadata" placeholder={'{"duration": 1420, "codec": "h264"}'} /></label>
    <Feedback state={state} /><div className="form-actions"><button className="primary-button" disabled={pending}>{pending ? "正在登记…" : "登记到 manifest"}</button></div>
  </form></details>;
}

export function RunReleaseButton({ releaseId }: { releaseId: string }) {
  const bound = runReleaseAction.bind(null, releaseId);
  const [state, action, pending] = useActionState(bound, initialFormState);
  return <form className="inline-action-form" action={action}><button className="primary-button" disabled={pending}>{pending ? "正在运行…" : "运行交付检查"}</button><Feedback state={state} /></form>;
}

export function ExecuteActionForm({ actionId, releaseId }: { actionId: string; releaseId: string }) {
  const bound = executeActionAction.bind(null, actionId, releaseId);
  const [state, action, pending] = useActionState(bound, initialFormState);
  return <form className="operation-form compact-operation" action={action}><button className="primary-button" disabled={pending}>{pending ? "执行中…" : "执行可逆动作"}</button><Feedback state={state} /></form>;
}

export function ApprovalDecisionForm({ actionId, releaseId, decision }: { actionId: string; releaseId: string; decision: "approve" | "reject" }) {
  const bound = decideActionAction.bind(null, actionId, releaseId, decision);
  const [state, action, pending] = useActionState(bound, initialFormState);
  return <form className={`operation-form ${decision}`} action={action}><label><span>{decision === "approve" ? "批准依据" : "拒绝原因"} *</span><textarea name="reason" required minLength={3} placeholder={decision === "approve" ? "说明已核对的证据与适用范围" : "说明缺少的证据或不可接受的风险"} /></label><label className="confirm-field"><input type="checkbox" name="confirmed" value="yes" required /><span>我已查看动作输入、影响与回滚条件</span></label><button className={decision === "approve" ? "primary-button" : "danger-button"} disabled={pending}>{pending ? "提交决定中…" : decision === "approve" ? "批准动作" : "拒绝动作"}</button><Feedback state={state} /></form>;
}

export function DeliveryActionForm({ deliveryId, releaseId, retry = false }: { deliveryId: string; releaseId: string; retry?: boolean }) {
  const bound = deliveryAction.bind(null, deliveryId, releaseId, retry);
  const [state, action, pending] = useActionState(bound, initialFormState);
  return <form className="operation-form delivery-operation" action={action}><label className="confirm-field"><input type="checkbox" name="confirmed" value="yes" required /><span>确认调用真实 provider adapter；重复请求由幂等键保护</span></label><button className="primary-button" disabled={pending}>{pending ? "请求中…" : retry ? "重试平台提交" : "提交到平台"}</button><Feedback state={state} /></form>;
}
