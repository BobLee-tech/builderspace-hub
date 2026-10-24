import { PageHead } from "~/components/PageHead";
import Toggle from "~/components/Toggle";
import { copy } from "~/hub/copy/zh";
import { Card, ErrorText, PageHeader } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { PersonalTabs } from "../personal/PersonalTabs";

const text = copy.reminders;

/**
 * 个人 → 提醒: whether teammates can send me 催一下 mail. On by default; the
 * mail's last line links here.
 */
export function RemindersPage() {
  const utils = api.useUtils();
  const mail = api.hub.nudges.mail.useQuery(undefined, { retry: false });
  const setMail = api.hub.nudges.setMail.useMutation({
    onSuccess: (saved) => utils.hub.nudges.mail.setData(undefined, saved),
  });
  const on = setMail.isPending ? setMail.variables.on : (mail.data?.on ?? true);

  return (
    <div className="m-auto w-full max-w-[1100px] px-5 py-8 md:px-12 md:py-12">
      <PageHead title={`${text.title} · ${copy.brand}`} />
      <PersonalTabs />
      <PageHeader title={text.title} description={text.description} />
      <ErrorText message={mail.error?.message} />
      {mail.data ? (
        <Card className="max-w-2xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
                {text.mail}
              </p>
              <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
                {on ? text.on : text.off}
              </p>
            </div>
            <Toggle
              label={text.mail}
              showLabel={false}
              isChecked={on}
              disabled={setMail.isPending}
              onChange={() => setMail.mutate({ on: !on })}
            />
          </div>
          {setMail.isError && (
            <div className="mt-3">
              <ErrorText message={text.saveFailed} />
            </div>
          )}
        </Card>
      ) : (
        !mail.error && (
          <div className="h-24 max-w-2xl animate-pulse rounded-xl bg-light-200 dark:bg-dark-200" />
        )
      )}
    </div>
  );
}
