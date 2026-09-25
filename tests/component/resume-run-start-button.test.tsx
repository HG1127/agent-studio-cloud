import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { resumeMock, refreshMock } = vi.hoisted(() => ({ resumeMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("@/server/actions/resume-run-start", () => ({ resumeRunStartAction: resumeMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { ResumeRunStartButton } from "@/features/runs/ResumeRunStartButton";

afterEach(() => {
  resumeMock.mockReset();
  refreshMock.mockReset();
});

describe("继续启动按钮", () => {
  it("接管成功后刷新运行详情", async () => {
    resumeMock.mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-000000000001" });
    const user = userEvent.setup();
    render(<ResumeRunStartButton runId="00000000-0000-4000-8000-000000000001" />);

    await user.click(screen.getByRole("button", { name: "继续启动" }));

    expect(resumeMock).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001");
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("接管失败时展示明确原因", async () => {
    resumeMock.mockResolvedValue({ ok: false, error: "运行仍在启动中，请稍后刷新页面" });
    const user = userEvent.setup();
    render(<ResumeRunStartButton runId="00000000-0000-4000-8000-000000000001" />);

    await user.click(screen.getByRole("button", { name: "继续启动" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("运行仍在启动中");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
