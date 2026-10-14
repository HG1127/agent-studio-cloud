import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConsoleError from "@/app/(console)/error";
import RunsError from "@/app/(console)/runs/error";
import SchedulesError from "@/app/(console)/schedules/error";
import KnowledgeError from "@/app/(console)/knowledge/error";
import MemoryError from "@/app/(console)/memory/error";
import AgentsError from "@/app/(console)/agents/error";
import AcceptanceError from "@/app/(console)/acceptance/error";
import ReleasesError from "@/app/(console)/releases/error";
import ActivityError from "@/app/(console)/activity/error";
import SettingsError from "@/app/(console)/settings/error";
import AgentDetailError from "@/app/(console)/agents/[agentId]/error";
import RunDetailError from "@/app/(console)/runs/[runId]/error";
import FrozenVersionError from "@/app/(console)/agents/[agentId]/versions/[versionId]/error";
import HarnessError from "@/app/(console)/harness/error";
import WebToolsError from "@/app/(console)/web-tools/error";

const routes = [
  { label: "控制台", Component: ConsoleError, button: "重新加载", returnLabel: "返回工作台", returnHref: "/" },
  { label: "运行列表", Component: RunsError, button: "重新读取", returnLabel: "返回工作台", returnHref: "/" },
  { label: "定时任务", Component: SchedulesError, button: "重新读取", returnLabel: "查看自动运行记录", returnHref: "/runs?source=schedule" },
  { label: "业务资料", Component: KnowledgeError, button: "重新读取", returnLabel: "返回工作台", returnHref: "/" },
  { label: "成长中心", Component: MemoryError, button: "重新读取", returnLabel: "返回工作台", returnHref: "/" },
  { label: "助手列表", Component: AgentsError, button: "重新读取", returnLabel: "返回工作台", returnHref: "/" },
  { label: "验收中心", Component: AcceptanceError, button: "重新读取", returnLabel: "返回助手列表", returnHref: "/agents" },
  { label: "发布中心", Component: ReleasesError, button: "重新读取", returnLabel: "返回助手列表", returnHref: "/agents" },
  { label: "操作记录", Component: ActivityError, button: "重新读取", returnLabel: "返回工作台", returnHref: "/" },
  { label: "管理设置", Component: SettingsError, button: "重新读取", returnLabel: "返回工作台", returnHref: "/" },
  { label: "助手详情", Component: AgentDetailError, button: "重新读取", returnLabel: "返回助手列表", returnHref: "/agents" },
  { label: "运行详情", Component: RunDetailError, button: "重新读取", returnLabel: "返回运行记录", returnHref: "/runs" },
  { label: "冻结版本", Component: FrozenVersionError, button: "重新读取", returnLabel: "返回发布中心", returnHref: "/releases" },
  { label: "运行控制台", Component: HarnessError, button: "重新读取", returnLabel: "返回运行记录", returnHref: "/runs" },
  { label: "网页工具", Component: WebToolsError, button: "重新读取", returnLabel: "返回发布中心", returnHref: "/releases" },
];

describe("当前框架错误恢复接线", () => {
  it.each(routes)("$label 手动点击和键盘恢复都调用重新读取，而不是仅清除错误", async ({ Component, button, returnLabel, returnHref }) => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const reset = vi.fn();
    const error = Object.assign(new Error("private-database-credential"), { digest: "private-error-digest" });
    const props = { error, retry, reset };
    const rendered = render(<StrictMode><Component {...props} /></StrictMode>);

    expect(retry).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).not.toHaveTextContent(error.message);
    expect(screen.getByRole("alert")).not.toHaveTextContent(error.digest);
    expect(screen.getByRole("link", { name: returnLabel })).toHaveAttribute("href", returnHref);

    const recover = screen.getByRole("button", { name: button });
    await user.click(recover);
    expect(retry).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
    recover.focus();
    await user.keyboard("{Enter}");
    expect(retry).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();

    rendered.rerender(<StrictMode><Component {...props} /></StrictMode>);
    expect(retry).toHaveBeenCalledTimes(2);
    expect(reset).not.toHaveBeenCalled();
  });
});
