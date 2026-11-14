"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

const alertVariants = cva("relative rounded-lg border p-4 text-sm", {
  variants: {
    variant: {
      default: "border-border bg-panel-2 text-foreground",
      info: "border-info/35 bg-info/8 text-info",
      warning: "border-warning/35 bg-warning/8 text-warning",
      destructive: "border-destructive/40 bg-destructive/10 text-destructive",
      success: "border-success/35 bg-success/8 text-success",
    },
  },
  defaultVariants: { variant: "default" },
});

interface AlertProps
  extends React.ComponentPropsWithoutRef<typeof motion.div>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("mb-1 text-sm font-semibold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn("text-xs leading-relaxed opacity-90", className)} {...props} />;
}
