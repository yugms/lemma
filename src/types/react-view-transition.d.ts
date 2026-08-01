import "react";

/**
 * `<ViewTransition>` ships in the React build Next.js vendors for the App
 * Router, but it isn't in the stable `@types/react` yet. Declared here so the
 * directional route animations in `layout.tsx` typecheck.
 */
declare module "react" {
  interface ViewTransitionProps {
    children?: React.ReactNode;
    name?: string;
    /** Class applied when no transition type matches. "none" disables it. */
    default?: string;
    enter?: string | Record<string, string>;
    exit?: string | Record<string, string>;
    share?: string | Record<string, string>;
    update?: string | Record<string, string>;
  }
  export const ViewTransition: React.FC<ViewTransitionProps>;
}
