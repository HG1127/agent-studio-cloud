import type { RunReportFile } from "@/contracts/run";

const SENSITIVE_KEY = /(?:password|passcode|secret|token|api[_-]?key|(?:private|access|secret)[_-]?key|authorization|cookie|credential|session[_-]?id|e-?mail|phone|mobile|ssn|social[_-]?security|credit[_-]?card|card[_-]?number|address|street|postal[_-]?code|密码|密钥|令牌|凭据|身份证|银行卡|手机号|邮箱|电话|住址|地址)/i;
const CREDENTIAL_KEY = /(?:password|passcode|secret|token|api[_-]?key|(?:private|access|secret)[_-]?key|authorization|cookie|credential|session[_-]?id|密码|密钥|令牌|凭据)/i;
const TOKEN_USAGE_KEY = /^(?:input|output|total|prompt|completion)[_-]?tokens?$/i;
const TOKEN_MEASUREMENT_KEY = /^token[_-]?(?:units?|usage|counts?|limits?|budgets?)$/i;
const REDACTED = "[已隐藏敏感信息]";
const URI_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^@\s/]+@/gi;
const PRIVATE_KEY = /-----BEGIN [^-\r\n]{0,40}PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]{0,40}PRIVATE KEY-----/g;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi;
const PROVIDER_KEY = /\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g;
const PUBLIC_TOOL_KEY = /\bpat_[a-f0-9]{64}\b/gi;
const LABELED_SECRET = /\b(?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|secret|password|passcode|authorization)\s*[:=]\s*(?!\[已隐藏敏感信息\])["']?(?:Bearer\s+)?[^\s,"'}）】》」』>]{6,}["']?/gi;
const CHINESE_LABELED_SECRET = /(?:(?:访问|刷新)?令牌|密钥|密码|凭据|授权)\s*[：:=]\s*(?!\[已隐藏敏感信息\])["']?(?:Bearer\s+)?[^\s，,。；;）】》」』>]{4,}["']?/gi;
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

export function redactCredentialText(value: string): string {
  return value
    .replace(URI_CREDENTIALS, `$1${REDACTED}@`)
    .replace(PRIVATE_KEY, REDACTED)
    .replace(JWT, REDACTED)
    .replace(LABELED_SECRET, REDACTED)
    .replace(CHINESE_LABELED_SECRET, REDACTED)
    .replace(BEARER, REDACTED)
    .replace(PROVIDER_KEY, REDACTED)
    .replace(PUBLIC_TOOL_KEY, REDACTED);
}

export function redactSensitiveText(value: string): string {
  const redacted = redactCredentialText(value)
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

function credentialFieldCandidate(name: string): string {
  return name.replace(/tokeniz(?:er|ation|e|ing)/gi, "");
}

function isSensitiveFieldName(name: string): boolean {
  const field = credentialFieldCandidate(name);
  return !TOKEN_MEASUREMENT_KEY.test(field) && SENSITIVE_KEY.test(field) && !TOKEN_USAGE_KEY.test(field);
}

function redactData(value: unknown, sensitiveField: (name: string) => boolean, redactText: (text: string) => string, depth = 0, maxDepth = 12): unknown {
  if (depth > maxDepth) return "[内容层级过深，已省略]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactData(item, sensitiveField, redactText, depth + 1, maxDepth));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      // 凭据也可能被当作字段名；省略整项避免重命名碰撞覆盖业务字段。
      if (redactText(key) !== key) return [];
      return [[key, sensitiveField(key) ? REDACTED : redactData(item, sensitiveField, redactText, depth + 1, maxDepth)]];
    }));
  }
  return value;
}

export function redactCredentialData(value: unknown): unknown {
  return redactData(value, isCredentialFieldName, redactCredentialText);
}

export function isCredentialFieldName(name: string): boolean {
  const field = credentialFieldCandidate(name);
  return !TOKEN_MEASUREMENT_KEY.test(field) && CREDENTIAL_KEY.test(field) && !TOKEN_USAGE_KEY.test(field);
}

// 结构化成果先经过有界 JSON 校验，不能按旧上下文的 12 层限制悄悄省略待确认字段。
export function redactStructuredCredentialData(value: unknown): unknown {
  return redactData(value, isCredentialFieldName, redactCredentialText, 0, 32);
}

export function redactSensitiveData(value: unknown): unknown {
  return redactData(value, isSensitiveFieldName, redactSensitiveText);
}

export function redactRunReportData(value: RunReportFile): RunReportFile {
  // 报告固定封套最多占三层，不能挤占业务 JSON 自身的 32 层预算。
  return redactData(value, isSensitiveFieldName, redactSensitiveText, 0, 35) as RunReportFile;
}
