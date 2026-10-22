"use client";

export default function GlobalError({ retry }: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, background: "#f5f7fb", color: "#0f172a", fontFamily: 'Arial, "Microsoft YaHei", sans-serif' }}>
        <main style={{ boxSizing: "border-box", display: "grid", minHeight: "100vh", placeItems: "center", padding: 24 }}>
          <section role="alert" style={{ width: "100%", maxWidth: 480, border: "1px solid #fecaca", borderRadius: 16, background: "white", padding: 28, boxShadow: "0 8px 30px rgba(15,23,42,.08)" }}>
            <p style={{ margin: 0, color: "#4f46e5", fontSize: 12, fontWeight: 700, letterSpacing: ".12em" }}>AGENT STUDIO</p>
            <h1 style={{ margin: "12px 0 0", fontSize: 24 }}>工作台暂时无法打开</h1>
            <p style={{ margin: "12px 0 0", color: "#64748b", fontSize: 14, lineHeight: 1.7 }}>可能是网络或服务暂时不可用。请稍后重试，已经保存的数据不会受到影响。</p>
            <button type="button" onClick={() => retry()} style={{ marginTop: 24, minHeight: 40, border: 0, borderRadius: 10, background: "#4f46e5", color: "white", cursor: "pointer", padding: "0 18px", fontSize: 14, fontWeight: 700 }}>重新加载</button>
          </section>
        </main>
      </body>
    </html>
  );
}
