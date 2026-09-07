"use client";

import { useRouter } from "next/navigation";
import { useActionState, useRef, useState, type FormEvent } from "react";
import { createReleaseAction, decideActionAction, deliveryAction, executeActionAction, runReleaseAction, type FormState } from "@/app/app/actions";
import type { AuthPrincipal, RuleSetDto } from "@/lib/api";

const initialFormState: FormState = { status: "idle", message: "" };
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

function Feedback({ state, pendingMessage }: { state: FormState; pendingMessage?: string }) {
  const message = pendingMessage || state.message;
  if (!message) return null;
  const error = state.status === "error" && !pendingMessage;
  return <p className={`form-feedback ${error ? "error" : state.status}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>{message}</p>;
}

export function CreateReleaseForm({ ruleSets, principal }: { ruleSets: RuleSetDto[]; principal: AuthPrincipal }) {
  const [state, action, pending] = useActionState(createReleaseAction, initialFormState);
  const admin = principal.roles.includes("Admin");
  return <form className="release-form" action={action}>
    <fieldset><legend><span>01</span> 内容与目标</legend><div className="field-grid">
      {admin ? <label><span>新项目名称</span><input name="projectName" defaultValue="Northline Shorts" autoComplete="organization" /></label> : <label><span>Project ID</span><input name="projectId" value={principal.projectIds[0]} readOnly /></label>}
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
  const router = useRouter();
  const [state, setState] = useState(initialFormState);
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const uploadRequest = useRef<XMLHttpRequest | null>(null);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get("file");
    const metadata = formData.get("metadata");

    if (!(file instanceof File) || !file.name) {
      setState({ status: "error", message: "请选择一个要上传的文件。" });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setState({ status: "error", message: "单个文件不能超过 500 MiB。" });
      return;
    }
    if (typeof metadata === "string" && metadata.trim()) {
      try {
        const parsed = JSON.parse(metadata) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      } catch {
        setState({ status: "error", message: "元数据必须是合法的 JSON 对象。" });
        return;
      }
    }

    setPending(true);
    setProgress(0);
    setState(initialFormState);
    try {
      const response = await new Promise<{ status: number; payload: { message?: unknown } | null }>((resolve, reject) => {
        const request = new XMLHttpRequest();
        uploadRequest.current = request;
        request.open("POST", `/api/releases/${encodeURIComponent(releaseId)}/assets/upload`);
        request.responseType = "json";
        request.upload.onprogress = (event) => {
          if (event.lengthComputable) setProgress(Math.min(100, Math.round(event.loaded / event.total * 100)));
        };
        request.onload = () => resolve({
          status: request.status,
          payload: request.response && typeof request.response === "object" ? request.response as { message?: unknown } : (() => {
            try { return JSON.parse(request.responseText) as { message?: unknown }; } catch { return null; }
          })(),
        });
        request.onerror = () => reject(new Error("upload request failed"));
        request.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
        request.send(formData);
      });
      if (response.status === 401) {
        router.replace(`/login?expired=1&next=${encodeURIComponent(location.pathname)}`);
        router.refresh();
        return;
      }
      if (response.status < 200 || response.status >= 300) {
        const message = Array.isArray(response.payload?.message)
          ? response.payload.message.filter((item): item is string => typeof item === "string").join("；")
          : typeof response.payload?.message === "string" ? response.payload.message : "上传未被服务接受。";
        setState({ status: "error", message });
        return;
      }
      form.reset();
      setState({ status: "success", message: `${file.name} 已上传并登记到 manifest。` });
      router.refresh();
    } catch (error) {
      setState(error instanceof DOMException && error.name === "AbortError"
        ? { status: "idle", message: "上传已取消。" }
        : { status: "error", message: "上传服务暂时不可用，请稍后重试。" });
    } finally {
      uploadRequest.current = null;
      setProgress(null);
      setPending(false);
    }
  }

  return <details className="asset-register"><summary>上传资产 <span aria-hidden="true">＋</span></summary><form onSubmit={upload} aria-busy={pending}>
    <div className="field-grid compact"><label><span>类型 *</span><select name="kind" defaultValue="SUBTITLE" required><option>VIDEO</option><option>SUBTITLE</option><option>AUDIO</option><option>POSTER</option><option>METADATA</option><option>RIGHTS</option></select></label><label><span>文件 *</span><input name="file" type="file" required /><small>单文件上限 500 MiB</small></label><label><span>语言</span><input name="language" placeholder="en" /></label></div>
    <label className="wide-field"><span>元数据 JSON</span><textarea name="metadata" placeholder={'{"source": "operator-upload"}'} /></label>
    {pending ? <div className="upload-progress" role="status" aria-live="polite"><div><span>浏览器传输到交付服务</span><strong>{progress === null || progress < 100 ? `${progress ?? 0}%` : "等待服务端检查与登记"}</strong></div><progress value={progress ?? 0} max={100} aria-label="上传传输进度" /><small>{progress === null || progress < 100 ? "传输完成前可取消。" : "文件已发送，正在等待 API 保存并检查。"}</small></div> : null}
    <Feedback state={state} /><div className="form-actions">{pending ? <button className="quiet-button" type="button" onClick={() => uploadRequest.current?.abort()}>取消上传</button> : null}<button className="primary-button" type="submit" disabled={pending}>{pending ? "正在上传…" : "上传并登记"}</button></div>
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
