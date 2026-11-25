"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./tapd-arc-select.module.css";

type TriggerProps = Pick<ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>, "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid" | "style">;
export interface SelectProps extends Omit<ComponentPropsWithoutRef<typeof SelectPrimitive.Root>, "children">, TriggerProps {
  label?: string;
  description?: string;
  placeholder?: string;
  id?: string;
  className?: string;
  options: { value: string; label: string; disabled?: boolean }[];
}

/** The shown value rolls in the direction of the list: a later option rises from below, an earlier one drops from above. */
const valueRoll: Variants = {
  enter: (direction: number) => ({ opacity: 0, y: `${direction * 0.35}em`, filter: `blur(${motionTokens.blur.soft}px)` }),
  center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] } },
};
/** Reduced motion keeps a short crossfade; the resting state matches valueRoll so server and client markup agree. */
const valueFade: Variants = { enter: { opacity: 0 }, center: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: motionTokens.duration.instant } } };

export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { label, description, placeholder = "Select an option", options, id, className, disabled, onValueChange,
    "aria-label": ariaLabel, "aria-labelledby": labelledBy, "aria-describedby": describedBy, "aria-invalid": ariaInvalid, style, ...rootProps },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const labelId = label ? `${controlId}-arc-label` : undefined;
  const hintId = description ? `${controlId}-description` : undefined;
  const reduceMotion = useReducedMotion();
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; }, []);
  const [uncontrolledValue, setUncontrolledValue] = useState(rootProps.defaultValue ?? "");
  const currentValue = rootProps.value ?? uncontrolledValue;
  const index = options.findIndex((option) => option.value === currentValue);
  const shown = options[index]?.label ?? placeholder;
  const [previousIndex, setPreviousIndex] = useState(index);
  const [direction, setDirection] = useState(1);
  if (previousIndex !== index) { setPreviousIndex(index); setDirection(index > previousIndex ? 1 : -1); }

  return (
    <div className={styles.field} data-tavlo-tapd-arc-ui="">
      {label && <label id={labelId} htmlFor={controlId}>{label}</label>}
      <SelectPrimitive.Root {...rootProps} disabled={disabled} onValueChange={(next) => { setUncontrolledValue(next); onValueChange?.(next); }}>
        <SelectPrimitive.Trigger
          ref={ref}
          id={controlId}
          aria-label={ariaLabel}
          aria-labelledby={labelledBy ?? labelId}
          aria-describedby={[describedBy, hintId].filter(Boolean).join(" ") || undefined}
          aria-invalid={ariaInvalid}
          style={style}
          className={[styles.trigger, className].filter(Boolean).join(" ")}
        >
          {/* Render one visible and accessible label, even if CSS fails to load.
             Passing children lets us animate the same text Radix exposes to AT. */}
          <span className={styles.valueText}>
            <SelectPrimitive.Value placeholder={placeholder}>
              <motion.span className={styles.rollingValue} key={currentValue} custom={direction}
                variants={reduceMotion ? valueFade : valueRoll} initial={mounted.current ? "enter" : false} animate="center">{shown}</motion.span>
            </SelectPrimitive.Value>
          </span>
          <SelectPrimitive.Icon className={styles.chevron}>
            <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content className={styles.content} data-tavlo-tapd-arc-ui="" aria-label={ariaLabel}
            aria-labelledby={labelledBy ?? labelId} position="popper" sideOffset={4} collisionPadding={12}>
            <SelectPrimitive.ScrollUpButton className={styles.scrollButton}>
              <ChevronUp size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className={styles.viewport}>
              {options.map((option) => (
                <SelectPrimitive.Item key={option.value} value={option.value} disabled={option.disabled} className={styles.item}>
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className={styles.indicator}>
                    <Check size={16} strokeWidth={1.75} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className={styles.scrollButton}>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      {description && <span id={hintId} className={styles.hint}>{description}</span>}
    </div>
  );
});
