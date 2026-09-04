import { Annotation, StateGraph } from "@langchain/langgraph";
import { RunnableLambda } from "@langchain/core/runnables";

const WorkflowState = Annotation.Root({
  releaseId: Annotation<string>,
  findings: Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  nextState: Annotation<string>({ reducer: (_, next) => next, default: () => "VALIDATING" }),
});

const inspect = new RunnableLambda({
  func: async (state: typeof WorkflowState.State) => ({
    findings: state.findings,
    nextState: state.findings.length > 0 ? "BLOCKED" : "READY_FOR_APPROVAL",
  }),
});

export async function runReleaseWorkflow(input: { releaseId: string; findings?: string[] }) {
  const graph = new StateGraph(WorkflowState)
    .addNode("inspect", inspect)
    .addEdge("__start__", "inspect")
    .addEdge("inspect", "__end__")
    .compile();

  return graph.invoke({ releaseId: input.releaseId, findings: input.findings ?? [] });
}
