import Link from "next/link";

import { PageHead } from "~/components/PageHead";
import PatternedBackground from "~/components/PatternedBackground";
import { copy } from "~/hub/copy/zh";

interface AuthShellProps {
  /** Browser tab title, without the brand. */
  title: string;
  heading: string;
  children: React.ReactNode;
  /** A line under the card, e.g. a link to the other auth page. */
  footer?: React.ReactNode;
}

/**
 * The frame shared by the sign-in, registration and invite-only pages: brand,
 * heading, one card, optional footer line.
 */
export function AuthShell({
  title,
  heading,
  children,
  footer,
}: AuthShellProps) {
  return (
    <>
      <PageHead title={`${title} | ${copy.brand}`} />
      <main className="h-screen bg-light-100 pt-20 dark:bg-dark-50 sm:pt-0">
        <div className="justify-top flex h-full flex-col items-center px-4 sm:justify-center">
          <div className="z-10 flex w-full flex-col items-center">
            <Link href="/">
              <p className="mb-6 text-lg font-bold tracking-tight text-light-1000 dark:text-dark-1000">
                {copy.brand}
              </p>
            </Link>
            <h1 className="mb-10 text-center text-3xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
              {heading}
            </h1>
            <div className="w-full rounded-lg border border-light-500 bg-light-300 px-4 py-10 dark:border-dark-400 dark:bg-dark-200 sm:max-w-md lg:px-10">
              <div className="sm:mx-auto sm:w-full sm:max-w-sm">{children}</div>
            </div>
            {footer && (
              <p className="mt-4 text-sm text-light-1000 dark:text-dark-1000">
                {footer}
              </p>
            )}
          </div>
          <PatternedBackground />
        </div>
      </main>
    </>
  );
}
