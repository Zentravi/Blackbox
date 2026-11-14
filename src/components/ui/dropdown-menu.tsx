"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE_IN, EASE_OUT, MOTION } from "@/lib/motion";

/**
 * Open-state bridge (same pattern as Dialog): lets DropdownMenuContent gate an
 * AnimatePresence tree so menus get a real fade-out instead of vanishing.
 */
const DropdownOpenContext = React.createContext<boolean>(false);

export function DropdownMenu({
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>) {
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
    <DropdownOpenContext.Provider value={open}>
      <DropdownMenuPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
    </DropdownOpenContext.Provider>
  );
}

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
  const open = React.useContext(DropdownOpenContext);
  return (
    <DropdownMenuPrimitive.Portal forceMount>
      <AnimatePresence>
        {open ? (
          /* The Radix popper positions the content element with its own
             transform (translate3d) — so motion only animates opacity here;
             the scale/rise happens on an inner wrapper that Radix does not
             touch. */
          <DropdownMenuPrimitive.Content
            key="menu-content"
            forceMount
            asChild
            sideOffset={sideOffset}
            {...props}
          >
            <motion.div
              className={cn(
                "z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl",
                className,
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: MOTION.instant, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: 0.1, ease: EASE_IN } }}
            >
              <motion.div
                initial={{ y: -4, scale: 0.985 }}
                animate={{ y: 0, scale: 1, transition: { duration: MOTION.fast, ease: EASE_OUT } }}
                exit={{ y: -3, scale: 0.99, transition: { duration: 0.1, ease: EASE_IN } }}
              >
                {children}
              </motion.div>
            </motion.div>
          </DropdownMenuPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-xs outline-none focus:bg-accent",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4 text-primary" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn("px-2 py-1.5 text-[11px] font-semibold text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
  );
}

export function DropdownMenuShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ml-auto text-[10px] tracking-widest opacity-60", className)} {...props} />;
}

export { ChevronRight, Circle };
