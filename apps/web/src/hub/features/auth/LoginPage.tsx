import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { authClient } from "@kan/auth/client";

import { Auth } from "~/components/AuthForm";
import { copy } from "~/hub/copy/zh";
import { resolvePostLoginTarget } from "~/hub/lib/post-login";
import { hubRoutes } from "~/hub/lib/routes";
import { AuthShell } from "./AuthShell";

const text = copy.auth.login;

/** Hub accounts sign in with a password; there is no magic link to wait for. */
const ignoreMagicLink = () => undefined;

export function LoginPage() {
  const router = useRouter();
  const target = resolvePostLoginTarget(
    useSearchParams().get("next"),
    hubRoutes.afterLogin,
  );

  const { data: session } = authClient.useSession();
  const isSignedIn = Boolean(session?.user.id);

  useEffect(() => {
    if (isSignedIn) router.push(target);
  }, [isSignedIn, router, target]);

  return (
    <AuthShell
      title={text.title}
      heading={text.heading}
      footer={
        <>
          {text.noAccount}{" "}
          <Link href={hubRoutes.signup} className="underline">
            {text.learnMore}
          </Link>
        </>
      }
    >
      <Auth setIsMagicLinkSent={ignoreMagicLink} callbackURL={target} />
    </AuthShell>
  );
}
