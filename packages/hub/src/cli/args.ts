import type { HubRole, ProjectRole } from "../schema";
import { hubRoles, projectRoles } from "../schema";

export type CliCommand =
  | {
      name: "grant";
      email: string;
      hubRole: HubRole | null;
      note: string | null;
      projects: { projectPublicId: string; role: ProjectRole }[];
    }
  | { name: "provision"; email: string }
  | { name: "setup-projects"; ownerEmail: string }
  | { name: "set-role"; email: string; role: HubRole | null }
  | {
      name: "import-documents";
      sources: { dir: string; folder: string[] }[];
      recursive: boolean;
      dryRun: boolean;
    }
  | { name: "projects" }
  | { name: "doctor" }
  | { name: "help" };

export type ParsedCli =
  | { ok: true; command: CliCommand }
  | { ok: false; error: string };

const fail = (error: string): ParsedCli => ({ ok: false, error });

const isHubRole = (value: string): value is HubRole =>
  (hubRoles as readonly string[]).includes(value);

const isProjectRole = (value: string): value is ProjectRole =>
  (projectRoles as readonly string[]).includes(value);

function parseGrant(args: string[]): ParsedCli {
  let email: string | null = null;
  let hubRole: HubRole | null = null;
  let note: string | null = null;
  const projects: { projectPublicId: string; role: ProjectRole }[] = [];

  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];

    if (
      flag !== "--email" &&
      flag !== "--hub-role" &&
      flag !== "--note" &&
      flag !== "--project"
    ) {
      return fail(`未知参数: ${flag}`);
    }
    if (value === undefined) return fail(`${flag} 后面缺少值`);

    if (flag === "--email") {
      email = value;
    } else if (flag === "--note") {
      note = value;
    } else if (flag === "--hub-role") {
      if (!isHubRole(value)) {
        return fail("--hub-role 只能是 owner、admin 或 viewer");
      }
      hubRole = value;
    } else {
      const [projectPublicId, role = "member"] = value.split(":");
      if (!projectPublicId) return fail("--project 的格式是 <项目ID>:<角色>");
      if (!isProjectRole(role)) {
        return fail("--project 的角色只能是 admin、member 或 guest");
      }
      projects.push({ projectPublicId, role });
    }
  }

  if (email === null) return fail("grant 需要 --email");

  return {
    ok: true,
    command: { name: "grant", email, hubRole, note, projects },
  };
}

function parseImportDocuments(args: string[]): ParsedCli {
  const sources: { dir: string; folder: string[] }[] = [];
  let recursive = false;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--recursive") {
      recursive = true;
    } else if (flag === "--dry-run") {
      dryRun = true;
    } else if (flag === "--source") {
      const value = args[i + 1];
      if (value === undefined) return fail("--source 后面缺少值");
      i += 1;
      // Split on the last "=": the folder side never has one, a path might.
      const at = value.lastIndexOf("=");
      const dir = at === -1 ? value : value.slice(0, at);
      const folder = (at === -1 ? "" : value.slice(at + 1))
        .split("/")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (dir.length === 0) return fail("--source 的格式是 <目录>=<文件夹>");
      sources.push({ dir, folder });
    } else {
      return fail(`未知参数: ${flag}`);
    }
  }

  if (sources.length === 0) {
    return fail("import-documents 需要至少一个 --source <目录>=<文件夹>");
  }
  return {
    ok: true,
    command: { name: "import-documents", sources, recursive, dryRun },
  };
}

/** Turns `process.argv.slice(2)` into a command, or a message saying why not. */
export function parseCli(argv: string[]): ParsedCli {
  const [name = "help", ...rest] = argv;

  if (name === "grant") return parseGrant(rest);
  if (name === "import-documents") return parseImportDocuments(rest);

  if (name === "set-role") {
    const flags = new Map<string, string>();
    for (let i = 0; i < rest.length; i += 2) {
      const flag = rest[i];
      const value = rest[i + 1];
      if ((flag !== "--email" && flag !== "--role") || value === undefined) {
        return fail("set-role 需要 --email 和 --role");
      }
      flags.set(flag, value);
    }
    const email = flags.get("--email");
    const role = flags.get("--role");
    if (email === undefined || role === undefined) {
      return fail("set-role 需要 --email 和 --role");
    }
    if (role !== "none" && !isHubRole(role)) {
      return fail("--role 只能是 owner、admin、viewer 或 none");
    }
    return {
      ok: true,
      command: { name: "set-role", email, role: role === "none" ? null : role },
    };
  }

  if (name === "setup-projects") {
    const [flag, ownerEmail, ...extra] = rest;
    if (flag === undefined) return fail("setup-projects 需要 --owner");
    if (flag !== "--owner" || extra.length > 0) {
      return fail("setup-projects 只接受 --owner");
    }
    if (ownerEmail === undefined) return fail("--owner 后面缺少值");
    return { ok: true, command: { name: "setup-projects", ownerEmail } };
  }

  if (name === "provision") {
    const [flag, email, ...extra] = rest;
    if (flag === undefined) return fail("provision 需要 --email");
    if (flag !== "--email" || extra.length > 0) {
      return fail("provision 只接受 --email");
    }
    if (email === undefined) return fail("--email 后面缺少值");
    return { ok: true, command: { name: "provision", email } };
  }

  if (name === "projects" || name === "doctor" || name === "help") {
    if (rest.length > 0) return fail(`${name} 不接受参数`);
    return { ok: true, command: { name } };
  }

  return fail(`未知命令: ${name}`);
}
