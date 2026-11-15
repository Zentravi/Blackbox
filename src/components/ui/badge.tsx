import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 transition-colors",
  {
    variants: {
      variant: {
        default: "border-primary/40 bg-primary/15 text-primary",
        secondary: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        success: "border-success/40 bg-success/12 text-success",
        warning: "border-warning/40 bg-warning/12 text-warning",
        destructive: "border-destructive/40 bg-destructive/15 text-destructive",
        info: "border-info/40 bg-info/12 text-info",
        cyan: "border-cyan/40 bg-cyan/12 text-cyan",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
