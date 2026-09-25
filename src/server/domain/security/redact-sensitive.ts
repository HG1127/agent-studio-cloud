const SENSITIVE_KEY = /(?:password|passcode|secret|token|api[_-]?key|(?:private|access|secret)[_-]?key|authorization|cookie|credential|session[_-]?id|e-?mail|phone|mobile|ssn|social[_-]?security|credit[_-]?card|card[_-]?number|address|street|postal[_-]?code|密码|密钥|令牌|凭据|身份证|银行卡|手机号|邮箱|电话|住址|地址)/i;
const TOKEN_USAGE_KEY = /^(?:input|output|total|prompt|completion)[_-]?tokens?$/i;
const REDACTED = "[已隐藏敏感信息]";
const PRIVATE_KEY = /-----BEGIN [^-\r\n]{0,40}PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]{0,40}PRIVATE KEY-----/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const PROVIDER_KEY = /\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g;
const LABELED_SECRET = /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passcode|authorization)\s*[:=]\s*["']?[^\s,"'}]{6,}["']?/gi;
const CHINESE_LABELED_SECRET = /(?:(?:访问|刷新)?令牌|密钥|密码|凭据|授权)\s*[：:=]\s*[^\s，,。；;]{4,}/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const CHINESE_PHONE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const CHINESE_ID = /(?<!\d)\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;

function luhnValid(value: string): boolean {
  const digits = value.replace(/[ -]/g, "");
  if (!/^\d{13,19}$/.test(digits) || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function redactSensitiveText(value: string): string {
  const redacted = value
    .replace(PRIVATE_KEY, REDACTED)
    .replace(JWT, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(PROVIDER_KEY, REDACTED)
    .replace(LABELED_SECRET, REDACTED)
    .replace(CHINESE_LABELED_SECRET, REDACTED)
    .replace(EMAIL, REDACTED)
    .replace(CHINESE_PHONE, REDACTED)
    .replace(CHINESE_ID, REDACTED);
  return redacted
    .replace(/(?<![\d-])\d{13,19}(?![\d-])/g, (candidate) => (
      luhnValid(candidate) ? REDACTED : candidate
    ))
    .replace(/(?<![\d-])\d{4}(?:[ -]\d{4}){2}[ -]\d{1,7}(?![\d-])/g, (candidate) => (
      luhnValid(candidate) ? REDACTED : candidate
    ));
}

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[内容层级过深，已省略]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) && !TOKEN_USAGE_KEY.test(key) ? REDACTED : redactSensitiveData(item, depth + 1),
    ]));
  }
  return value;
}
