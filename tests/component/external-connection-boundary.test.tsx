import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ExternalConnectionBoundary } from "@/features/connections/ExternalConnectionBoundary";

it("区分服务端工具登记与尚未具备的协议连接", () => {
  render(<ExternalConnectionBoundary registeredCount={2} />);
  expect(screen.getByText(/登记了 2 项可供流程选择的业务工具/)).toBeVisible();
  expect(screen.getByRole("heading", { name: "连接与握手" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "发现与复核" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "授权与运行" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /测试连接|添加连接|授权/ })).not.toBeInTheDocument();
});
