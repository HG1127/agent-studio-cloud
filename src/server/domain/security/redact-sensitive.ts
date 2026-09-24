const SENSITIVE_KEY = /(?:password|passcode|secret|token|api[_-]?key|(?:private|access|secret)[_-]?key|authorization|cookie|credential|session[_-]?id|密码|密钥|令牌|凭据|身份证|银行卡|手机号)/i;

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[内容层级过深，已省略]";
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[已隐藏敏感信息]" : redactSensitiveData(item, depth + 1),
    ]));
  }
  return value;
}
