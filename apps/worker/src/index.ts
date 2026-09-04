import { runReleaseWorkflow } from "./workflow.js";

const result = await runReleaseWorkflow({ releaseId: "bootstrap", findings: [] });
console.info(JSON.stringify({ worker: "ready", releaseId: result.releaseId, nextState: result.nextState }));
