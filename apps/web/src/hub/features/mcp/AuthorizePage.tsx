import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import { authClient } from "@kan/auth/client";
import { HUB_MCP_GUIDE_PATH } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { AuthShell } from "~/hub/features/auth/AuthShell";
import { hubRoutes } from "~/hub/lib/routes";
import { buttonClass, ErrorText } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";

const text = copy.mcp.authorize;

/** The query as plain strings; a repeated parameter is dropped and then reported missing. */
function stringQuery(
  query: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * `/mcp/authorize`, the OAuth authorization endpoint: an AI app sent the
 * person here to sign in and approve it. Signs them in first (back here
 * afterwards), shows which app and where they will be sent back to, and
 * answers with 允许 or 拒绝. Everything is checked on the server, twice.
 */
export function AuthorizePage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const signedIn = Boolean(session?.user.id);
  const query = useMemo(() => stringQuery(router.query), [router.query]);

  useEffect(() => {
    if (!router.isReady || isPending || signedIn) return;
    void router.replace(
      `${hubRoutes.login}?next=${encodeURIComponent(router.asPath)}`,
    );
  }, [router, isPending, signedIn]);

  const check = api.hub.mcp.check.useQuery(query, {
    enabled: router.isReady && signedIn,
    retry: false,
    staleTime: Infinity,
  });

  const [leaving, setLeaving] = useState(false);
  const goBack = ({ redirectTo }: { redirectTo: string }) => {
    setLeaving(true);
    window.location.assign(redirectTo);
  };
  const approve = api.hub.mcp.approve.useMutation({ onSuccess: goBack });
  const deny = api.hub.mcp.deny.useMutation({ onSuccess: goBack });
  const busy = approve.isPending || deny.isPending || leaving;

  return (
    <AuthShell title={text.title} heading={text.heading}>
      {!check.data && !check.error && (
        <p className="text-sm text-light-900 dark:text-dark-900">
          {text.checking}
        </p>
      )}
      <ErrorText message={check.error?.message} />

      {check.data && !check.data.ok && (
        <div className="space-y-4">
          <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {text.failedHeading}
          </p>
          <ErrorText message={check.data.message} />
          <div className="flex flex-wrap gap-2">
            {check.data.redirectTo && (
              <a href={check.data.redirectTo} className={buttonClass.ghost}>
                {text.backToApp}
              </a>
            )}
            <Link href={HUB_MCP_GUIDE_PATH} className={buttonClass.ghost}>
              {text.goGuide}
            </Link>
          </div>
        </div>
      )}

      {check.data?.ok && (
        <div className="space-y-4 text-sm leading-6 text-light-1000 dark:text-dark-1000">
          <p className="font-semibold">
            {text.asks(check.data.clientName, session?.user.email ?? "")}
          </p>
          <p className="text-light-900 dark:text-dark-900">
            {text.selfNamed}
            <code className="ml-1 rounded bg-light-200 px-1.5 py-0.5 font-mono text-xs text-light-1000 dark:bg-dark-300 dark:text-dark-1000">
              {check.data.returnTo}
            </code>
          </p>
          <p>{text.canDo}</p>
          <p className="text-light-900 dark:text-dark-900">
            {text.revoke} {text.notYou}
          </p>
          <ErrorText message={approve.error?.message ?? deny.error?.message} />
          {leaving ? (
            <p role="status" className="text-light-900 dark:text-dark-900">
              {text.redirecting}
            </p>
          ) : (
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                className={`${buttonClass.primary} flex-1`}
                disabled={busy}
                onClick={() => approve.mutate(query)}
              >
                {text.allow}
              </button>
              <button
                type="button"
                className={`${buttonClass.ghost} flex-1`}
                disabled={busy}
                onClick={() => deny.mutate(query)}
              >
                {text.deny}
              </button>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
}
