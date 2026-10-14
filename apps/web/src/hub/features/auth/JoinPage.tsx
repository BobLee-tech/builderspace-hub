import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authClient } from "@kan/auth/client";
import { HUB_GRANT_HEADER } from "@kan/hub/public";

import type { JoinStatus } from "./join-status";
import Button from "~/components/Button";
import Input from "~/components/Input";
import { copy } from "~/hub/copy/zh";
import { hubRoutes } from "~/hub/lib/routes";
import { AuthShell } from "./AuthShell";
import { JOIN_STATUS_PATH } from "./join-status";

const text = copy.auth.join;

// Better Auth's own limits for passwords.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

type LinkState =
  | { state: "loading" }
  | { state: "unreachable" }
  | (JoinStatus & { token: string });

async function fetchJoinStatus(token: string): Promise<JoinStatus> {
  const response = await fetch(JOIN_STATUS_PATH, {
    headers: { [HUB_GRANT_HEADER]: token },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`join-status ${response.status}`);
  return (await response.json()) as JoinStatus;
}

/**
 * The registration page a link opens. The token is read from the URL
 * fragment, which browsers never send to a server, and passed on in a header.
 */
export function JoinPage() {
  const [link, setLink] = useState<LinkState>({ state: "loading" });

  useEffect(() => {
    const token = window.location.hash.slice(1);
    let cancelled = false;

    fetchJoinStatus(token)
      .then((status) => {
        if (!cancelled) setLink({ ...status, token });
      })
      .catch(() => {
        if (!cancelled) setLink({ state: "unreachable" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (link.state === "loading") {
    return (
      <AuthShell title={text.title} heading={text.heading}>
        <p className="text-sm text-light-900 dark:text-dark-900">
          {text.loading}
        </p>
      </AuthShell>
    );
  }

  if (link.state !== "valid") {
    const state = text.states[link.state];
    return (
      <AuthShell
        title={text.title}
        heading={state.heading}
        footer={
          link.state === "consumed" ? (
            <Link href={hubRoutes.login} className="underline">
              {copy.auth.inviteOnly.login}
            </Link>
          ) : undefined
        }
      >
        <p className="text-sm leading-6 text-light-1000 dark:text-dark-1000">
          {state.body}
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={text.title} heading={text.heading}>
      <JoinForm email={link.email} token={link.token} />
    </AuthShell>
  );
}

function validate(name: string, password: string): string | null {
  if (name.trim().length === 0) return text.nameRequired;
  if (password.length < PASSWORD_MIN) return text.passwordTooShort;
  if (password.length > PASSWORD_MAX) return text.passwordTooLong;
  return null;
}

function JoinForm({ email, token }: { email: string; token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const problem = validate(name, password);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    await authClient.signUp.email(
      { name: name.trim(), email, password },
      {
        headers: { [HUB_GRANT_HEADER]: token },
        onSuccess: () => router.push(hubRoutes.afterLogin),
        // The server's reasons are deliberately vague; say what to do next.
        onError: () => setError(text.failed),
      },
    );
    setIsSubmitting(false);
  };

  const labelClass =
    "mb-1 block text-sm font-medium text-light-1000 dark:text-dark-1000";

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="join-email" className={labelClass}>
          {text.emailLabel}
        </label>
        <Input id="join-email" type="email" value={email} readOnly disabled />
        <p className="mt-1 text-xs text-light-900 dark:text-dark-900">
          {text.emailHint}
        </p>
      </div>

      <div>
        <label htmlFor="join-name" className={labelClass}>
          {text.nameLabel}
        </label>
        <Input
          id="join-name"
          autoComplete="name"
          maxLength={64}
          placeholder={text.namePlaceholder}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="join-password" className={labelClass}>
          {text.passwordLabel}
        </label>
        <Input
          id="join-password"
          type="password"
          autoComplete="new-password"
          placeholder={text.passwordPlaceholder}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}

      <Button type="submit" fullWidth isLoading={isSubmitting}>
        {text.submit}
      </Button>
    </form>
  );
}
