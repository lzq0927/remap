import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  X,
  XCircle,
} from "lucide-react";

/** 提交式数字输入：编辑时保留原文，失焦或回车后校验并提交。 */
export function NumberField({
  value,
  onCommit,
  label,
  suffix,
  min = -Infinity,
  max = Infinity,
  digits = 6,
  factor = 1,
  width,
  disabled,
}: {
  value: number;
  onCommit: (value: number) => void;
  label: string;
  suffix?: string;
  min?: number;
  max?: number;
  /** 显示的最多小数位。 */
  digits?: number;
  /** 显示值 = 存储值 × factor（百分数用 100）。 */
  factor?: number;
  width?: number;
  disabled?: boolean;
}) {
  const shown = String(Number((value * factor).toFixed(digits)));
  const [draft, setDraft] = useState(shown),
    [invalid, setInvalid] = useState(false),
    editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(shown);
  }, [shown]);
  const commit = () => {
    editing.current = false;
    const parsed = Number(draft.replace(/,/g, "").trim());
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(shown);
      setInvalid(false);
      return;
    }
    const next = Math.min(max, Math.max(min, parsed / factor));
    setInvalid(false);
    setDraft(String(Number((next * factor).toFixed(digits))));
    if (next !== value) onCommit(next);
  };
  return (
    <span
      className={"rw-field" + (invalid ? " is-invalid" : "")}
      style={width ? { width } : undefined}
    >
      <input
        aria-label={label}
        inputMode="decimal"
        value={draft}
        disabled={disabled}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(
            e.target.value.trim() !== "" &&
              !Number.isFinite(Number(e.target.value.replace(/,/g, ""))),
          );
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            editing.current = false;
            setDraft(shown);
            setInvalid(false);
            e.currentTarget.blur();
          }
        }}
      />
      {suffix && <span className="rw-field-suffix">{suffix}</span>}
    </span>
  );
}

/** 提交式文本输入：失焦或回车后提交；不允许为空时退回备用文字。 */
export function TextField({
  value,
  onCommit,
  label,
  fallback,
  maxLength = 80,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  /** 输入为空时使用的文字；不提供则允许为空。 */
  fallback?: string;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={className}
      aria-label={label}
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim() || fallback || "";
        setDraft(next);
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}

const durationUnits = [
  { id: "s", name: "秒", perHour: 3600 },
  { id: "m", name: "分钟", perHour: 60 },
  { id: "h", name: "小时", perHour: 1 },
] as const;
type DurationUnit = (typeof durationUnits)[number]["id"];
const naturalUnit = (valueHours: number): DurationUnit =>
  valueHours * 3600 < 600 ? "s" : valueHours < 2 ? "m" : "h";

/** 时长输入：数值加单位，内部统一存小时。 */
export function DurationField({
  value,
  onCommit,
  label,
  disabled,
}: {
  value: number;
  onCommit: (valueHours: number) => void;
  label: string;
  disabled?: boolean;
}) {
  const [unit, setUnit] = useState<DurationUnit>(() => naturalUnit(value));
  const perHour = durationUnits.find((u) => u.id === unit)!.perHour;
  return (
    <span className="rw-duration">
      <NumberField
        label={label}
        value={value}
        factor={perHour}
        digits={unit === "h" ? 3 : 2}
        min={0}
        max={8760}
        disabled={disabled}
        onCommit={onCommit}
      />
      <select
        aria-label={label + "的单位"}
        value={unit}
        disabled={disabled}
        onChange={(e) => setUnit(e.target.value as DurationUnit)}
      >
        {durationUnits.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </select>
    </span>
  );
}

export type Tone = "good" | "warn" | "bad" | "idle";
const toneIcon = {
  good: CheckCircle2,
  warn: AlertTriangle,
  bad: XCircle,
  idle: CircleDashed,
};
/** 状态标签：图标加文字，不单靠颜色表达。 */
export function Status({
  tone,
  children,
}: {
  tone: Tone;
  children: ReactNode;
}) {
  const Icon = toneIcon[tone];
  return (
    <span className={"rw-status is-" + tone}>
      <Icon size={14} aria-hidden />
      {children}
    </span>
  );
}

/** 预算占用条：满格即用完预算，超出时保持满格并换色。 */
export function Meter({
  ratio,
  tone,
  label,
}: {
  ratio: number;
  tone: Tone;
  label: string;
}) {
  return (
    <span
      className={"rw-meter is-" + tone}
      role="img"
      aria-label={label}
      title={label}
    >
      <span style={{ width: Math.max(2, Math.min(1, ratio) * 100) + "%" }} />
    </span>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={"rw-toggle" + (checked ? " is-on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function Formula({ children }: { children: ReactNode }) {
  return <div className="rw-formula">{children}</div>;
}

/** 可折叠的方法说明，默认收起，避免干扰主要操作。 */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="rw-disclosure" open={defaultOpen}>
      <summary>
        <ChevronDown size={16} aria-hidden />
        {title}
      </summary>
      <div className="rw-disclosure-body">{children}</div>
    </details>
  );
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

/** 右侧抽屉：编辑模块与故障模式时不离开当前页面。 */
export function Drawer({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  useEscape(onClose);
  return (
    <div className="rw-overlay" onMouseDown={onClose}>
      <aside
        className="rw-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="rw-icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="rw-drawer-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </div>
  );
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const id = useId();
  useEscape(onClose);
  return (
    <div className="rw-overlay is-centered" onMouseDown={onClose}>
      <section
        className="rw-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h2 id={id}>{title}</h2>
          <button
            type="button"
            className="rw-icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="rw-dialog-body">{children}</div>
        <footer>{footer}</footer>
      </section>
    </div>
  );
}

/** 图表悬停提示：跟随指针，数值在前、名称在后。 */
export function useTooltip() {
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    content: ReactNode;
  } | null>(null);
  const bind = (content: ReactNode) => ({
    onPointerMove: (e: React.PointerEvent) =>
      setTip({ x: e.clientX, y: e.clientY, content }),
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent) => {
      const box = (e.currentTarget as Element).getBoundingClientRect();
      setTip({ x: box.left + box.width / 2, y: box.top, content });
    },
    onBlur: () => setTip(null),
  });
  const node = tip && (
    <div
      className="rw-tooltip"
      role="tooltip"
      style={{
        left: Math.min(tip.x + 14, window.innerWidth - 260),
        top: Math.max(8, tip.y - 12),
      }}
    >
      {tip.content}
    </div>
  );
  return { bind, node };
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rw-empty">{children}</p>;
}
