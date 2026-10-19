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
  | { name: "mail-links"; email: string | null; dryRun: boolean }
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

function parseMailLinks(args: string[]): ParsedCli {
  let email: string | null = null;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const flag = args[i];
    if (flag === "--dry-run") {
      dryRun = true;
    } else if (flag === "--email") {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        return fail("--email 后面缺少值");
      }
      email = value;
      i += 1;
    } else {
      return fail("mail-links 只接受 --email 和 --dry-run");
    }
  }

  return { ok: true, command: { name: "mail-links", email, dryRun } };
}

/** Turns `process.argv.slice(2)` into a command, or a message saying why not. */
export function parseCli(argv: string[]): ParsedCli {
  const [name = "help", ...rest] = argv;

  if (name === "grant") return parseGrant(rest);
  if (name === "mail-links") return parseMailLinks(rest);

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
