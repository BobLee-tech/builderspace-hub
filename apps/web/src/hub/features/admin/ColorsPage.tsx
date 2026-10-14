import { useEffect, useState } from "react";
import { TbCheck } from "react-icons/tb";

import type { FunctionColors, FunctionKey } from "@kan/hub/public";
import {
  can,
  DEFAULT_FUNCTION_COLORS,
  functionColorPalette,
  functionKeys,
  functionNames,
  isHexColor,
} from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { tint } from "~/hub/lib/use-function-colors";
import {
  buttonClass,
  Card,
  ErrorText,
  PageHeader,
} from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { AdminLayout } from "./AdminLayout";

const text = copy.admin.colors;

/** What a task card's function tag looks like in this colour. */
function Preview({ name, color }: { name: string; color: string }) {
  return (
    <span className="relative inline-flex overflow-hidden rounded-md border border-light-300 bg-light-50 py-1.5 pl-3 pr-2 dark:border-dark-300 dark:bg-dark-100">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: color }}
      />
      <span
        className="rounded px-1.5 text-[11px] font-medium leading-5"
        style={{ backgroundColor: tint(color, 0.14), color }}
      >
        {name}
      </span>
    </span>
  );
}

function ColorRow({
  functionKey,
  value,
  disabled,
  onChange,
}: {
  functionKey: FunctionKey;
  value: string;
  disabled: boolean;
  onChange: (hex: string) => void;
}) {
  const name = functionNames[functionKey];
  return (
    <div className="flex flex-col gap-3 border-b border-light-200 py-4 last:border-b-0 dark:border-dark-200 md:flex-row md:items-center">
      <div className="w-40 shrink-0">
        <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {name}
        </p>
        <div className="mt-2">
          <Preview name={name} color={value} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {functionColorPalette.map((swatch) => {
          const selected = swatch.hex.toUpperCase() === value.toUpperCase();
          return (
            <button
              key={swatch.hex}
              type="button"
              title={`${swatch.name} ${swatch.hex}`}
              aria-label={`${name}：${swatch.name}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onChange(swatch.hex)}
              className="flex h-7 w-7 items-center justify-center rounded-full ring-offset-2 ring-offset-light-50 transition hover:scale-110 disabled:cursor-not-allowed disabled:hover:scale-100 dark:ring-offset-dark-50"
              style={{
                backgroundColor: swatch.hex,
                boxShadow: selected ? `0 0 0 2px ${swatch.hex}` : undefined,
              }}
            >
              {selected && (
                <TbCheck className="h-4 w-4 text-white" aria-hidden="true" />
              )}
            </button>
          );
        })}
        <label className="ml-1 flex items-center gap-1.5 text-xs text-light-900 dark:text-dark-900">
          {text.custom}
          <input
            type="color"
            aria-label={`${name}：${text.custom}`}
            disabled={disabled}
            value={value}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="h-7 w-9 cursor-pointer rounded border border-light-400 bg-transparent p-0.5 disabled:cursor-not-allowed dark:border-dark-400"
          />
          <span className="font-mono">{value}</span>
        </label>
      </div>
    </div>
  );
}

function ColorsContent() {
  const me = api.hub.me.get.useQuery();
  const saved = api.hub.settings.functionColors.useQuery();
  const utils = api.useUtils();
  const save = api.hub.settings.setFunctionColors.useMutation({
    onSuccess: (colors) =>
      utils.hub.settings.functionColors.setData(undefined, colors),
  });
  const mayEdit = can(me.data?.role ?? null, "settings.manage");

  const [draft, setDraft] = useState<FunctionColors>(DEFAULT_FUNCTION_COLORS);
  useEffect(() => {
    if (saved.data) setDraft(saved.data);
  }, [saved.data]);

  const changed =
    saved.data !== undefined &&
    functionKeys.some((key) => saved.data[key] !== draft[key]);

  return (
    <>
      <PageHeader title={text.title} description={text.description} />
      <Card>
        {functionKeys.map((key) => (
          <ColorRow
            key={key}
            functionKey={key}
            value={draft[key]}
            disabled={!mayEdit || save.isPending}
            onChange={(hex) => {
              if (isHexColor(hex))
                setDraft((current) => ({ ...current, [key]: hex }));
            }}
          />
        ))}
      </Card>

      <ErrorText message={save.error?.message} />
      {mayEdit ? (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            className={buttonClass.primary}
            disabled={!changed || save.isPending}
            onClick={() => save.mutate(draft)}
          >
            {text.save}
          </button>
          <button
            type="button"
            className={buttonClass.ghost}
            disabled={save.isPending}
            onClick={() => setDraft(DEFAULT_FUNCTION_COLORS)}
          >
            {text.reset}
          </button>
          {save.isSuccess && !changed && (
            <span className="text-xs text-light-900 dark:text-dark-900">
              {text.saved}
            </span>
          )}
        </div>
      ) : (
        me.data && (
          <p className="mt-4 text-xs text-light-900 dark:text-dark-900">
            {text.readOnly}
          </p>
        )
      )}
    </>
  );
}

export function ColorsPage() {
  return (
    <AdminLayout title={text.title}>
      <ColorsContent />
    </AdminLayout>
  );
}
