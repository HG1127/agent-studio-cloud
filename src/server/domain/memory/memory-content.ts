const SENSITIVE_KEY = /(?:password|passcode|secret|token|api[_-]?key|(?:private|access|secret)[_-]?key|authorization|cookie|credential|session[_-]?id|密码|密钥|令牌|凭据|身份证|银行卡|手机号)/i;
const MAX_MEMORY_CHARS = 20_000;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[内容层级过深，已省略]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[已隐藏敏感信息]" : redact(item, depth + 1),
    ]));
  }
  return value;
}

export function buildMemoryContent(args: {
  contentFrom?: string;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): string {
  const selected = args.contentFrom && args.contentFrom !== "run_summary"
    ? args.outputs[args.contentFrom]
    : { input: args.input, results: args.outputs };
  const fallback = selected === undefined ? { input: args.input, results: args.outputs } : selected;
  return JSON.stringify(redact(fallback), null, 2).slice(0, MAX_MEMORY_CHARS);
}
