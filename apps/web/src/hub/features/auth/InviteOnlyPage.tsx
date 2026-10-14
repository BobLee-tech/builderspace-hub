import Link from "next/link";

import { copy } from "~/hub/copy/zh";
import { hubRoutes } from "~/hub/lib/routes";
import { AuthShell } from "./AuthShell";

const text = copy.auth.inviteOnly;

/** What `/signup` shows: registration is by invitation link only. */
export function InviteOnlyPage() {
  return (
    <AuthShell
      title={text.title}
      heading={text.heading}
      footer={
        <>
          {text.haveAccount}{" "}
          <Link href={hubRoutes.login} className="underline">
            {text.login}
          </Link>
        </>
      }
    >
      <p className="text-sm leading-6 text-light-1000 dark:text-dark-1000">
        {text.body}
      </p>
    </AuthShell>
  );
}
