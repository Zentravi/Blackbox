"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE_IN, EASE_OUT, MOTION } from "@/lib/motion";

/**
 * Open-state bridge (same pattern as Dialog): lets SelectContent animate out
 * via AnimatePresence instead of unmounting instantly.
 */
const SelectOpenContext = React.createContext<boolean>(false);

export function Select({
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : uncontrolledOpen;

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  return (
    <SelectOpenContext.Provider value={open}>
      <SelectPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
    </SelectOpenContext.Provider>
  );
}

export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-terminal px-3 py-2 text-sm whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  const open = React.useContext(SelectOpenContext);
  return (
    <SelectPrimitive.Portal forceMount>
      <AnimatePresence>
        {open ? (
          /* Radix popper owns the content transform — motion animates opacity
             only; extra polish comes from a scale on the inner wrapper. */
          <SelectPrimitive.Content
            key="select-content"
            forceMount
            asChild
            position={position}
            {...props}
          >
            <motion.div
              className={cn(
                "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl",
                className,
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: MOTION.instant, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.1, ease: EASE_IN } }}
            >
              <motion.div
                className="flex flex-col"
                initial={{ y: -4, scale: 0.985 }}
                animate={{ y: 0, scale: 1, transition: { duration: MOTION.fast, ease: EASE_OUT } }}
                exit={{ y: -3, scale: 0.99, transition: { duration: 0.1, ease: EASE_IN } }}
              >
                <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1">
                  <ChevronUp className="h-4 w-4" />
                </SelectPrimitive.ScrollUpButton>
                <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
                <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1">
                  <ChevronDown className="h-4 w-4" />
                </SelectPrimitive.ScrollDownButton>
              </motion.div>
            </motion.div>
          </SelectPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn("px-2 py-1.5 text-[11px] font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
