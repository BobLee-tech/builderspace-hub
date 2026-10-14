import { twMerge } from "tailwind-merge";

import { copy } from "~/hub/copy/zh";
import { inputClass } from "~/hub/ui/admin-primitives";

export type ProjectRole = "admin" | "member" | "guest";

export interface ProjectChoice {
  publicId: string;
  name: string;
}

const text = copy.admin.projectRoles;

/** One select per project: not in it, guest, member or admin. */
export function ProjectRolePicker({
  projects,
  value,
  onChange,
  disabled,
}: {
  projects: ProjectChoice[];
  value: Record<string, ProjectRole | null>;
  onChange: (projectPublicId: string, role: ProjectRole | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      {projects.map((project) => (
        <label
          key={project.publicId}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="min-w-0 truncate">{project.name}</span>
          <select
            className={twMerge(inputClass, "w-40 shrink-0")}
            value={value[project.publicId] ?? ""}
            disabled={disabled}
            onChange={(event) =>
              onChange(
                project.publicId,
                (event.target.value || null) as ProjectRole | null,
              )
            }
          >
            <option value="">{text.none}</option>
            <option value="guest">{text.guest}</option>
            <option value="member">{text.member}</option>
            <option value="admin">{text.admin}</option>
          </select>
        </label>
      ))}
    </div>
  );
}
