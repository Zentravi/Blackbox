import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
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

interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, ...props }: AlertProps) {
  return <div role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("mb-1 text-sm font-semibold", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <div className={cn("text-xs leading-relaxed opacity-90", className)} {...props} />;
}
