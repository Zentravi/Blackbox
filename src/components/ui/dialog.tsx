"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { EASE_IN, EASE_OUT, MOTION } from "@/lib/motion";

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Open-state bridge: our wrapper controls the Radix root (works with both
 * controlled `open` and uncontrolled usage) so DialogContent can gate an
 * AnimatePresence presence tree with forceMount — giving real exit
 * animations while Radix unmounts instantly by default.
 */
const DialogOpenContext = React.createContext<boolean>(false);

export function Dialog({
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) {
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
    <DialogOpenContext.Provider value={open}>
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
    </DialogOpenContext.Provider>
  );
}

export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
  const open = React.useContext(DialogOpenContext);
  return (
    <DialogPrimitive.Portal forceMount>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Overlay asChild forceMount key="dialog-overlay">
            <motion.div
              className="fixed inset-0 z-50 bg-black/65 backdrop-blur-[2px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: MOTION.fast, ease: EASE_OUT } }}
              exit={{ opacity: 0, transition: { duration: MOTION.instant, ease: EASE_IN } }}
            />
          </DialogPrimitive.Overlay>
        ) : null}
        {open ? (
          <DialogPrimitive.Content asChild forceMount key="dialog-content" {...props}>
            {/* Centering lives in motion x/y so it composes with the animated
                transform (translate first, then scale). */}
            <motion.div
              className={cn(
                "fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-2rem)] max-w-lg gap-4 border border-border bg-popover p-5 shadow-2xl",
                className,
              )}
              initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.97, x: "-50%", y: "-52%" }}
              transition={{ duration: MOTION.base, ease: EASE_OUT }}
            >
              {children}
              <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-60 transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </motion.div>
          </DialogPrimitive.Content>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1.5 text-left", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />
  );
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base font-semibold leading-none tracking-tight", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}
