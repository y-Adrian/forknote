import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
  className?: string;
}

/**
 * Translucent glass surface for user messages.
 * Assistant messages intentionally remain document-style for long-form reading.
 */
export function GlassMessageBubble({ children, className }: Props) {
  const classes = ["ds-bubble", "ds-bubble-user", "ds-bubble-user--glass"];
  if (className) classes.push(className);

  return <div className={classes.join(" ")}>{children}</div>;
}
