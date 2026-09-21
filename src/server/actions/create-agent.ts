"use server";

import { revalidatePath } from "next/cache";
import { AgentCreateInput } from "@/contracts/agent";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { buildAgentDraft } from "@/server/domain/pipeline";
import { db } from "@/lib/db";

export type CreateAgentResult = { ok: true; agentId: string } | { ok: false; error: string };

export async function createAgentAction(input: AgentCreateInput): Promise<CreateAgentResult> {
  const parsedInput = AgentCreateInput.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, error: "请填写助手名称，并用至少 10 个字描述你想让助手完成的工作" };
  }
  const { name, intentText } = parsedInput.data;
  const built = buildAgentDraft({ name, intentText });
  if (!built.draft) {
    return { ok: false, error: "暂时无法根据这段描述生成流程草稿，请换个说法再试一次" };
  }
  try {
    // 入库前以契约解析结果为准（parse 补全默认值），不落原始结构
    const draft = WorkflowDraft.parse(built.draft);
    const description = intentText.split(/[。！？！？\n]/)[0]?.slice(0, 100) || null;
    const agentId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(agents)
        .values({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          name,
          description,
          intentText,
        })
        .returning({ id: agents.id });
      await tx.insert(workflowDefinitions).values({
        agentId: created.id,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        draft,
      });
      return created.id;
    });
    revalidatePath("/agents");
    return { ok: true, agentId };
  } catch {
    return { ok: false, error: "助手创建失败，请稍后重试" };
  }
}
