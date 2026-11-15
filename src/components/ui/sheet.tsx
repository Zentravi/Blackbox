"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE_IN, EASE_OUT, MOTION } from "@/lib/motion";

export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;

/** Same open-state bridge as Dialog — enables real exit animations. */
const SheetOpenContext = React.createContext<boolean>(false);

export function Sheet({
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Root>) {
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
    <SheetOpenContext.Provider value={open}>
      <SheetPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
    </SheetOpenContext.Provider>
  );
}

export function SheetContent({
  className,
  children,
  side = "left",
  ...props
}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  const open = React.useContext(SheetOpenContext);
  const hidden = side === "left" ? "-100%" : "100%";
  return (
    <SheetPrimitive.Portal forceMount>
      <AnimatePresence>
        {open ? (
          <SheetPrimitive.Overlay asChild forceMount key="sheet-overlay">
            <motion.div
              className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: MOTION.fast, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: MOTION.instant, ease: EASE_IN } }}
            />
          </SheetPrimitive.Overlay>
        ) : null}
        {open ? (
          <SheetPrimitive.Content asChild forceMount key="sheet-content" {...props}>
            <motion.div
              className={cn(
                "fixed z-50 flex h-full w-[min(19rem,calc(100vw-3rem))] flex-col border-border bg-sidebar shadow-2xl",
                side === "left" && "left-0 top-0 border-r",
                side === "right" && "right-0 top-0 border-l",
                className,
              )}
              initial={{ x: hidden, opacity: 0.6 }}
              animate={{ x: "0%", opacity: 1, transition: { duration: MOTION.base, ease: EASE_OUT } }}
              exit={{ x: hidden, opacity: 0.6, transition: { duration: MOTION.base, ease: EASE_IN } }}
            >
              {children}
              <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </SheetPrimitive.Close>
            </motion.div>
          </SheetPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </SheetPrimitive.Portal>
  );
}

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 p-4 pb-2", className)} {...props} />;
}

export function SheetTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title className={cn("text-sm font-semibold", className)} {...props} />
  );
}

export function SheetDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description className={cn("text-xs text-muted-foreground", className)} {...props} />
  );
}
