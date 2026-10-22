import { Children, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type OptionHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

/**
 * Single-selection control for filters and forms. Options use ordinary <option>
 * elements, but the interactive popup is entirely styled and keyboard accessible.
 * Pass onValueChange rather than emulating a native change event.
 */
type SelectValue = string | number | null;
type SelectOption = { value: string; label: ReactNode; text: string; disabled: boolean };
export type AppSelectProps = {
  children: ReactNode;
  value?: SelectValue;
  defaultValue?: SelectValue;
  onValueChange?: (value: string) => void;
  name?: string;
  id?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

function optionText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(optionText).join("");
  return "";
}

function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child) || child.type !== "option") return [];
    const props = child.props;
    const text = optionText(props.children);
    return [{ value: String(props.value ?? text), text, label: props.children, disabled: !!props.disabled }];
  });
}

export function AppSelect({
  children, value, defaultValue, onValueChange, name, id, disabled = false,
  required, className = "", placeholder = "Selecione uma opção",
  "aria-label": ariaLabel, "aria-labelledby": labelledBy,
  "aria-describedby": describedBy, "aria-invalid": invalid,
}: AppSelectProps) {
  const generatedId = useId();
  const controlId = id ?? `rt-select-${generatedId}`;
  const menuId = `${controlId}-listbox`;
  const options = useMemo(() => readOptions(children), [children]);
  const [uncontrolled, setUncontrolled] = useState(() =>
    String(defaultValue ?? readOptions(children).find(option => !option.disabled)?.value ?? "")
  );
  const controlled = value !== undefined;
  const current = controlled ? String(value ?? "") : uncontrolled;
  const selected = options.find(option => option.value === current);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState({ top: 0, left: 0, width: 200, maxHeight: 260 });
  const search = useRef({ text: "", time: 0 });
  const available = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);

  const openMenu = (preferLast = false) => {
    if (disabled || available.length === 0) return;
    const selectedIndex = options.findIndex(option => option.value === current && !option.disabled);
    setActive(selectedIndex >= 0 ? selectedIndex : preferLast ? available[available.length - 1] : available[0]);
    setOpen(true);
  };
  const closeMenu = () => { setOpen(false); search.current.text = ""; };
  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    if (!controlled) setUncontrolled(option.value);
    if (option.value !== current) onValueChange?.(option.value);
    closeMenu();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // The floating list lives at document level so panels and dialogs cannot clip it.
  useLayoutEffect(() => {
    if (!open) return;
    const align = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 5, edge = 8, maxVisible = 312;
      const desiredHeight = Math.min(maxVisible, options.length * 42 + 12);
      const width = Math.min(Math.max(rect.width, 180), window.innerWidth - edge * 2);
      const below = window.innerHeight - rect.bottom - gap - edge;
      const above = rect.top - gap - edge;
      const up = below < Math.min(desiredHeight, 180) && above > below;
      const height = Math.max(48, Math.min(desiredHeight, up ? above : below));
      setPlacement({
        top: up ? Math.max(edge, rect.top - gap - height) : Math.min(window.innerHeight - edge, rect.bottom + gap),
        left: Math.max(edge, Math.min(rect.left, window.innerWidth - width - edge)),
        width,
        maxHeight: height,
      });
    };
    align();
    window.addEventListener("resize", align);
    window.addEventListener("scroll", align, true);
    window.visualViewport?.addEventListener("resize", align);
    return () => {
      window.removeEventListener("resize", align);
      window.removeEventListener("scroll", align, true);
      window.visualViewport?.removeEventListener("resize", align);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!triggerRef.current?.contains(event.target) && !popupRef.current?.contains(event.target)) closeMenu();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const element = popupRef.current?.children[active] as HTMLElement | undefined;
    const container = popupRef.current;
    if (!container || !element) return;
    const top = element.offsetTop, bottom = top + element.offsetHeight;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
  }, [active, open]);

  const move = (direction: 1 | -1) => {
    if (!available.length) return;
    const at = available.indexOf(active);
    setActive(available[(at + direction + available.length) % available.length]);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "Escape") {
      if (open) { event.preventDefault(); closeMenu(); }
      return;
    }
    if (event.key === "Tab") { if (open) closeMenu(); return; }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(event.key === "ArrowUp");
      else move(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      if (!open) openMenu(event.key === "End");
      else setActive(event.key === "Home" ? available[0] : available[available.length - 1]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) commit(active);
      else openMenu();
      return;
    }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const now = Date.now();
      search.current.text = (now - search.current.time < 650 ? search.current.text : "") + event.key.toLocaleLowerCase("pt-BR");
      search.current.time = now;
      const found = options.findIndex(option => !option.disabled && option.text.toLocaleLowerCase("pt-BR").startsWith(search.current.text));
      if (found >= 0) { event.preventDefault(); if (!open) openMenu(); setActive(found); }
    }
  };

  return <div className={`rt-select ${className}`.trim()} data-open={open || undefined} data-disabled={disabled || undefined}>
    {name && <input type="hidden" name={name} value={current} disabled={disabled} />}
    <button
      type="button" id={controlId} ref={triggerRef} role="combobox" aria-haspopup="listbox"
      aria-expanded={open} aria-controls={open ? menuId : undefined}
      aria-activedescendant={open ? `${menuId}-option-${active}` : undefined}
      aria-label={ariaLabel} aria-labelledby={labelledBy} aria-describedby={describedBy}
      aria-invalid={invalid}
      aria-required={required || undefined}
      className="rt-select-trigger" disabled={disabled}
      onClick={() => open ? closeMenu() : openMenu()}
      onKeyDown={onKeyDown}
    >
      <span className={`rt-select-value ${selected ? "" : "rt-select-placeholder"}`} title={selected?.text}>
        {selected?.label ?? placeholder}
      </span>
      <ChevronDown className="rt-select-chevron" aria-hidden="true" size={16} />
    </button>
    {open && createPortal(<div
      id={menuId} role="listbox" aria-label={ariaLabel ?? selected?.text ?? placeholder}
      className="rt-select-menu" ref={popupRef}
      style={{ position: "fixed", top: placement.top, left: placement.left, width: placement.width, maxHeight: placement.maxHeight }}
    >
      {options.map((option, index) => <div
        id={`${menuId}-option-${index}`} role="option" key={`${option.value}-${index}`}
        aria-selected={option.value === current} aria-disabled={option.disabled || undefined}
        data-value={option.value}
        className="rt-select-option" data-active={index === active || undefined}
        data-selected={option.value === current || undefined}
        title={option.text}
        onMouseEnter={() => { if (!option.disabled) setActive(index); }}
        onMouseDown={event => event.preventDefault()}
        onClick={() => commit(index)}
      ><span className="rt-select-option-label">{option.label}</span>{option.value === current && <Check size={16} aria-hidden="true" className="rt-select-check"/>}</div>)}
    </div>, document.body)}
  </div>;
}
